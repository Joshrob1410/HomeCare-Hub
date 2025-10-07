export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !anon || !svc) {
      return NextResponse.json({ error: 'Missing env.' }, { status: 500 });
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

    const searchParams = new URL(req.url).searchParams;
    const companyParam = searchParams.get('company_id') || undefined;

    const ids = new Set<string>();
    let allowedHomeIds: string[] = [];
    let myCompanyId: string | null = null;

    if (level === '2_COMPANY') {
      // All companies for caller; allow optional ?company_id=
      const { data: myCompanies } = await admin
        .from('company_memberships')
        .select('company_id')
        .eq('user_id', user.id);

      const myCompanyIds = Array.from(new Set((myCompanies || []).map(r => r.company_id)));
      if (myCompanyIds.length === 0) {
        return NextResponse.json({ error: 'No company scope.' }, { status: 403 });
      }

      if (companyParam) {
        if (!myCompanyIds.includes(companyParam)) {
          return NextResponse.json({ error: 'Not your company.' }, { status: 403 });
        }
        myCompanyId = companyParam;
      } else {
        // Backward compatible: pick first if multiple
        myCompanyId = myCompanyIds[0]!;
      }

      // Build scope
      const [homes, hm, bm, cmem] = await Promise.all([
        admin.from('homes').select('id').eq('company_id', myCompanyId),
        admin.from('home_memberships').select('user_id, home_id')
             .in('home_id',
                 (await admin.from('homes').select('id').eq('company_id', myCompanyId)).data?.map(h => h.id) || []),
        admin.from('bank_memberships').select('user_id').eq('company_id', myCompanyId),
        admin.from('company_memberships').select('user_id').eq('company_id', myCompanyId),
      ]);

      allowedHomeIds = (homes.data || []).map(h => h.id);
      (hm.data || []).forEach((r: any) => ids.add(r.user_id));
      (bm.data || []).forEach((r: any) => ids.add(r.user_id));
      (cmem.data || []).forEach((r: any) => ids.add(r.user_id));
    } else {
      // Manager: anyone in my homes
      const { data: myHomes } = await admin
        .from('home_memberships')
        .select('home_id')
        .eq('user_id', user.id)
        .eq('role', 'MANAGER');
      allowedHomeIds = (myHomes || []).map(r => r.home_id);
      if (allowedHomeIds.length === 0) {
        return NextResponse.json({ error: 'No managed homes.' }, { status: 403 });
      }

      const { data: rel } = await admin
        .from('home_memberships')
        .select('user_id')
        .in('home_id', allowedHomeIds);
      (rel || []).forEach(r => ids.add(r.user_id));
    }

    const userIds = [...ids];
    if (userIds.length === 0) return NextResponse.json({ members: [] });

    // profiles + auth emails
    const [{ data: profs }, { data: authUsers }] = await Promise.all([
      admin.from('profiles').select('user_id, full_name, is_admin').in('user_id', userIds),
      admin.auth.admin.listUsers({ page: 1, perPage: Math.max(1000, userIds.length) }),
    ]);

    const emailMap = new Map<string, any>();
    (authUsers?.users || []).forEach(u => emailMap.set(u.id, u));

    // memberships within scope
    const { data: homeMs } = await admin
      .from('home_memberships')
      .select('user_id, role, home_id')
      .in('home_id', allowedHomeIds)
      .in('user_id', userIds);

    // Map home_id -> name (avoid fragile joins)
    const homeIdSet = Array.from(new Set((homeMs || []).map(h => h.home_id)));
    const { data: homesInfo } = homeIdSet.length
      ? await admin.from('homes').select('id, name').in('id', homeIdSet)
      : { data: [] as any[] };
    const nameByHomeId = new Map<string, string>();
    (homesInfo || []).forEach((h: any) => nameByHomeId.set(h.id, h.name));

    let bankMs: any[] = [];
    let compMs: any[] = [];
    if (level === '2_COMPANY') {
      const [b, c] = await Promise.all([
        admin.from('bank_memberships').select('user_id').eq('company_id', myCompanyId!),
        admin.from('company_memberships').select('user_id, has_company_access, is_dsl').eq('company_id', myCompanyId!),
      ]);
      bankMs = b.data || [];
      compMs = c.data || [];
    }

    const members = userIds.map(id => {
      const p = (profs || []).find(pr => pr.user_id === id);
      const au = emailMap.get(id);

      const scopedHomes = (homeMs || []).filter(h => h.user_id === id);
      const managerHomes = scopedHomes
        .filter(h => h.role === 'MANAGER')
        .map(h => ({ id: h.home_id, name: nameByHomeId.get(h.home_id) || '' }));
      const staffHomes = scopedHomes
        .filter(h => h.role === 'STAFF')
        .map(h => ({ id: h.home_id, name: nameByHomeId.get(h.home_id) || '' }));

      const compRow = level === '2_COMPANY' ? compMs.find(x => x.user_id === id) : null;
      const bank = level === '2_COMPANY' ? !!bankMs.find(x => x.user_id === id) : false;
      const company = !!compRow?.has_company_access;
      const dsl = !!compRow?.is_dsl; // <= NEW

      return {
        id,
        full_name: p?.full_name || '',
        is_admin: !!p?.is_admin,
        email: au?.email || '',
        created_at: au?.created_at || null,
        last_sign_in_at: au?.last_sign_in_at || null,
        roles: {
          company,
          bank,
          manager_homes: managerHomes,
          staff_home: staffHomes.length ? staffHomes[0] : null,
          dsl, // <= NEW
        },
      };
    });

    return NextResponse.json({ members });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
