export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

type Role = 'MANAGER' | 'STAFF';

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !anon || !svc) {
      return NextResponse.json({ error: 'Missing env.' }, { status: 500 });
    }

    const body = await req.json();
    const {
      email, password, full_name,
      role,            // 'MANAGER' or 'STAFF'
      company_id,      // REQUIRED for company callers if they have >1 company; recommended always
      home_id,         // for STAFF (single home)
      home_ids,        // for MANAGER (multi)
      bank_staff,      // STAFF company-only
      is_dsl,          // NEW: company-only DSL flag at creation
    } = body as {
      email: string; password: string; full_name?: string;
      role: Role;
      company_id?: string;
      home_id?: string; home_ids?: string[]; bank_staff?: boolean;
      is_dsl?: boolean;
    };

    if (!email || !password || !role) {
      return NextResponse.json({ error: 'email, password, role are required.' }, { status: 400 });
    }
    if (!['MANAGER','STAFF'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }

    // auth/session
    const cookieStore = cookies();
    const session = createServerClient(url, anon, {
      cookies: { get: n => cookieStore.get(n)?.value, set(){}, remove(){} },
    });
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const { data: level } = await session.rpc('get_effective_level');
    if (level !== '2_COMPANY' && level !== '3_MANAGER') {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const admin = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } });

    // ----- Resolve scope -----
    let scopedCompanyId: string | null = null;
    let allowedHomes: string[] = [];

    if (level === '2_COMPANY') {
      // companies for caller
      const { data: myCompanies } = await admin
        .from('company_memberships')
        .select('company_id')
        .eq('user_id', user.id);
      const myCompanyIds = Array.from(new Set((myCompanies || []).map(r => r.company_id)));
      if (myCompanyIds.length === 0) {
        return NextResponse.json({ error: 'No company scope.' }, { status: 403 });
      }

      if (company_id) {
        if (!myCompanyIds.includes(company_id)) {
          return NextResponse.json({ error: 'Not your company.' }, { status: 403 });
        }
        scopedCompanyId = company_id;
      } else if (myCompanyIds.length === 1) {
        scopedCompanyId = myCompanyIds[0]!;
      } else {
        return NextResponse.json({ error: 'Ambiguous company. Pass company_id.' }, { status: 400 });
      }

      const { data: homes } = await admin.from('homes').select('id').eq('company_id', scopedCompanyId);
      allowedHomes = (homes || []).map(h => h.id);
    } else {
      // Manager: homes I manage
      const { data: myHomeManager } = await admin
        .from('home_memberships')
        .select('home_id')
        .eq('user_id', user.id)
        .eq('role', 'MANAGER');
      const homes = (myHomeManager || []).map(r => r.home_id);
      if (homes.length === 0) {
        return NextResponse.json({ error: 'No managed homes.' }, { status: 403 });
      }
      allowedHomes = homes;
    }

    // ----- Validate desired assignment -----
    if (level === '2_COMPANY') {
      if (role === 'MANAGER') {
        const list = Array.isArray(home_ids) ? home_ids.filter(Boolean) : [];
        if (list.length === 0) return NextResponse.json({ error: 'Pick at least one home for Manager.' }, { status: 400 });
        if (list.some(h => !allowedHomes.includes(h))) {
          return NextResponse.json({ error: 'One or more homes not in your company.' }, { status: 403 });
        }
      } else {
        // STAFF
        const isBank = !!bank_staff;
        if (!isBank) {
          if (!home_id) return NextResponse.json({ error: 'Pick one home for Staff.' }, { status: 400 });
          if (!allowedHomes.includes(home_id)) return NextResponse.json({ error: 'Home not in your company.' }, { status: 403 });
        }
      }
    } else {
      // Manager: only STAFF, no bank, must be one of their homes
      if (role !== 'STAFF') return NextResponse.json({ error: 'Managers can only create Staff.' }, { status: 403 });
      if (bank_staff) return NextResponse.json({ error: 'Managers cannot create bank staff.' }, { status: 403 });
      if (!home_id) return NextResponse.json({ error: 'Pick one home for Staff.' }, { status: 400 });
      if (!allowedHomes.includes(home_id)) return NextResponse.json({ error: 'Not one of your homes.' }, { status: 403 });
    }

    // ----- Create auth user -----
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: full_name ?? '' },
    });
    if (cErr || !created.user) {
      return NextResponse.json({ error: cErr?.message || 'Failed to create user.' }, { status: 400 });
    }
    const newUserId = created.user.id;

    // profile upsert
    {
      const { error: pErr } = await admin.from('profiles').upsert(
        { user_id: newUserId, full_name: full_name ?? '', is_admin: false },
        { onConflict: 'user_id' }
      );
      if (pErr) return NextResponse.json({ error: `Profile upsert failed: ${pErr.message}` }, { status: 400 });
    }

    // helper: upsert company_memberships row to retain DSL/access
    async function upsertCompanyRow(opts: { access?: boolean; dsl?: boolean }) {
      if (level !== '2_COMPANY' || !scopedCompanyId) return;
      const payload: any = { user_id: newUserId, company_id: scopedCompanyId };
      if (typeof opts.access === 'boolean') payload.has_company_access = opts.access;
      if (typeof opts.dsl === 'boolean') payload.is_dsl = opts.dsl;
      const { error } = await admin
        .from('company_memberships')
        .upsert(payload, { onConflict: 'user_id,company_id' });
      if (error) throw new Error(error.message);
    }

    // ----- Write memberships -----
    if (level === '2_COMPANY') {
      if (role === 'MANAGER') {
        const rows = (home_ids as string[]).map(hid => ({ user_id: newUserId, home_id: hid, role: 'MANAGER' as const }));
        const { error } = await admin.from('home_memberships').insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });

        // keep company row for DSL (no company access granted here)
        await upsertCompanyRow({ access: false, dsl: typeof is_dsl === 'boolean' ? is_dsl : undefined });
      } else {
        // STAFF
        if (bank_staff) {
          const { error } = await admin
            .from('bank_memberships')
            .upsert({ user_id: newUserId, company_id: scopedCompanyId! }, { onConflict: 'user_id,company_id' });
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });

          await upsertCompanyRow({ access: false, dsl: typeof is_dsl === 'boolean' ? is_dsl : undefined });
        } else {
          const { error } = await admin
            .from('home_memberships')
            .insert({ user_id: newUserId, home_id, role: 'STAFF' });
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });

          await upsertCompanyRow({ access: false, dsl: typeof is_dsl === 'boolean' ? is_dsl : undefined });
        }
      }
    } else {
      // manager: staff into one of their homes; managers cannot set DSL
      const { error } = await admin
        .from('home_memberships')
        .insert({ user_id: newUserId, home_id, role: 'STAFF' });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, user: { id: newUserId, email, full_name: full_name ?? '', role } },
      { status: 201 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
