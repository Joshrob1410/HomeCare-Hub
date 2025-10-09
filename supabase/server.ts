// supabase/server.ts
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Next.js 15: cookies() is async.
 * We await it ONCE, then give Supabase a sync getter that returns the store.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies(); // <- await here

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Hand Supabase a SYNC function that returns the already-fetched store
      cookies: () => cookieStore,
    }
  );
}
