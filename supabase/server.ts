// supabase/server.ts
import { cookies, headers as nextHeaders } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export function getServerSupabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies,           // pass the functions, don't call them
      headers: nextHeaders,
    }
  );
}
