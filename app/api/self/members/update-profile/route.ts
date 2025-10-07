export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !anon || !svc) return NextResponse.json({ error: 'Missing env.' }, { status: 500 });

    const { user_id, full_name, email } = await req.json() as {
      user_id: string; full_name?: string; email?: string;
    };
    if (!user_id) return NextResponse.json({ error: 'user_id required.' }, { status: 400 });

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

    // Determine scope (company vs manager)
    let allowedUserIds = new Set<string>();

    if (level === '2_COMPANY') {
      // users in my company (via homes OR bank OR company)
      const { data: cm } = await admin
        .from('company_memberships')
        .select('company_id')
        .eq('user_id', user.id)
        .limit(1).maybeSingle();
      if (!cm?.company_id) return NextResponse.json({ error: 'No company scope.' }, { status: 403 });

      // collect all user_ids in that company
      const [hm, bm, cmem] = await Promise.all([
        admin.from('home_memberships').select('user_id, homes(company_id)').eq('homes.company_id', cm.company_id),
        admin.from('bank_memberships').select('user_id').eq('company_id', cm.company_id),
        admin.from('company_memberships').select('user_id').eq('company_id', cm.company_id),
      ]);
      (hm.data || []).forEach((r: any) => allowedUserIds.add(r.user_id));
      (bm.data || []).forEach((r: any) => allowedUserIds.add(r.user_id));
      (cmem.data || []).forEach((r: any) => allowedUserIds.add(r.user_id));
    } else {
      // manager: staff in my homes
      const { data: myHomes } = await admin
        .from('home_memberships')
        .select('home_id')
        .eq('user_id', user.id)
        .eq('role', 'MANAGER');
      const homeIds = (myHomes || []).map(r => r.home_id);
      if (homeIds.length === 0) return NextResponse.json({ error: 'No managed homes.' }, { status: 403 });

      const { data: staff } = await admin
        .from('home_memberships')
        .select('user_id')
        .eq('role', 'STAFF')
        .in('home_id', homeIds);
      (staff || []).forEach(r => allowedUserIds.add(r.user_id));
    }

    if (!allowedUserIds.has(user_id)) {
      return NextResponse.json({ error: 'Target user not in your scope.' }, { status: 403 });
    }

    // Update public.profiles (name)
    if (typeof full_name === 'string') {
      const { error } = await admin.from('profiles').upsert({ user_id, full_name }, { onConflict: 'user_id' });
      if (error) return NextResponse.json({ error: `Profile update failed: ${error.message}` }, { status: 400 });
    }

    // Update auth.users (email)
    if (typeof email === 'string' && email.trim()) {
      const { error } = await admin.auth.admin.updateUserById(user_id, { email: email.trim() });
      if (error) return NextResponse.json({ error: `Email update failed: ${error.message}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
