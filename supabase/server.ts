import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * For Server Components / layouts / RSC:
 * - We can safely *read* cookies, but we can't mutate them here.
 * - Provide get/set/remove methods that match the expected shape.
 *   set/remove are no-ops in RSC to keep types happy.
 */
export async function getServerSupabase() {
  const store = await cookies(); // ReadonlyRequestCookies in Next 15

  const cookieMethods = {
    get(name: string) {
      return store.get(name)?.value;
    },
    // No-ops in RSC (can't set cookies here)
    set(_name: string, _value: string, _options?: unknown) {},
    remove(_name: string, _options?: unknown) {},
  };

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods }
  );
}

/**
 * For Route Handlers / Server Actions ONLY:
 * - Here cookies are mutable, so we wire through set/remove.
 * - We cast `store` to any so types won't block us in either runtime.
 */
export async function getRouteSupabase() {
  const store: any = await cookies(); // mutable in route handlers

  const cookieMethods = {
    get(name: string) {
      return store.get?.(name)?.value;
    },
    set(name: string, value: string, options?: unknown) {
      store.set?.(name, value, options);
    },
    remove(name: string, options?: unknown) {
      // clear by setting maxAge: 0
      if (store.set) store.set(name, '', { ...(options as any), maxAge: 0 });
    },
  };

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods }
  );
}
