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

    const { home_id, name } = await req.json() as { home_id?: string; name?: string };
    if (!home_id || !name?.trim()) return NextResponse.json({ error: 'home_id and name required.' }, { status: 400 });

    const cookieStore = cookies();
    const session = createServerClient(url, anon, {
      cookies: { get: n => cookieStore.get(n)?.value, set(){}, remove(){} },
    });
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const admin = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: lvl } = await session.rpc('get_effective_level');
    if (lvl !== '2_COMPANY') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });

    // Look up caller's company
    const { data: cm } = await admin
      .from('company_memberships')
      .select('company_id')
      .eq('user_id', user.id)
      .limit(1).maybeSingle();
    if (!cm?.company_id) return NextResponse.json({ error: 'No company scope.' }, { status: 403 });

    // Ensure the home belongs to this company
    const { data: home } = await admin
      .from('homes')
      .select('id, company_id')
      .eq('id', home_id)
      .maybeSingle();

    if (!home || home.company_id !== cm.company_id) {
      return NextResponse.json({ error: 'Home not in your company.' }, { status: 403 });
    }

    const { error } = await admin.from('homes').update({ name: name.trim() }).eq('id', home_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}
