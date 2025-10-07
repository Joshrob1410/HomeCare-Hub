import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/supabase/server';

export async function POST() {
  const supabase = getServerSupabase();
  await supabase.auth.signOut();

  // Use env var in production; fallback for local dev
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return NextResponse.redirect(new URL('/auth/login', base));
}
