// lib/requester.ts
import { cookies, headers as nextHeaders } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";

export type AppLevel = "1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF";

/** Server-side Supabase client bound to request cookies (Anon key). */
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  // Derive the type of the 3rd arg of `cookies().set(name, value, options)`
  type CookieStore = Awaited<ReturnType<typeof cookies>>;
  type CookieOpts = Parameters<CookieStore["set"]>[2];

  return createServerClient(url, anon, {
    cookies: {
      async get(name: string) {
        const store = await cookies();
        return store.get(name)?.value;
      },
      async set(name: string, value: string, options?: CookieOpts) {
        const store = await cookies();
        store.set(name, value, options);
      },
      async remove(name: string, options?: CookieOpts) {
        const store = await cookies();
        // Clear by setting maxAge=0
        store.set(name, "", { ...(options ?? {}), maxAge: 0, path: "/" });
      },
    },
  });
}

/** Privileged Supabase client using the Service Role key (never expose to client). */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!url || !key) throw new Error("Missing SUPABASE env vars for admin client.");
  return createClient(url, key);
}

function pickAuthHeader(h: Headers): string | null {
  return (
    h.get("authorization") ||
    h.get("Authorization") ||
    h.get("x-authorization") ||
    h.get("x-supabase-auth") ||
    null
  );
}

/** Get the current user (via Authorization bearer if present, else cookies). */
export async function requireUser(req?: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  const h = req ? req.headers : nextHeaders();
  const auth = pickAuthHeader(h);

  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();

    // Validate token using the service-role client
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    const user = (data?.user as User) ?? null;
    if (error || !user) throw new Response("Unauthorized", { status: 401 });

    // User-scoped client forwarding the bearer (keeps RLS intact)
    const supa = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return { supa, user };
  }

  // Fallback to cookie-based session
  const supa = supabaseServer();
  const { data, error } = await supa.auth.getUser();
  const user = (data?.user as User) ?? null;
  if (error || !user) throw new Response("Unauthorized", { status: 401 });
  return { supa, user };
}

/** Convenience context many routes use. */
export type RequesterContext = {
  supa: ReturnType<typeof supabaseServer>;
  admin: ReturnType<typeof supabaseAdmin>;
  user: User;
  level: AppLevel;
  isAdmin: boolean;
  canCompany: boolean;
  canManager: boolean;
  companyScope: string | null;
  managedHomeIds: string[];
};

/** Build a request-scoped context with role info + scopes. */
export async function getRequester(req?: Request): Promise<RequesterContext> {
  const { supa, user } = await requireUser(req);
  const admin = supabaseAdmin();

  // get_effective_level returns a single scalar row; use .single()
  const { data: lvlRow, error: lvlErr } = await supa.rpc("get_effective_level").single();
  if (lvlErr) throw new Response("Failed to resolve level", { status: 500 });
  const level = (lvlRow as { get_effective_level: AppLevel }).get_effective_level;

  const isAdmin = level === "1_ADMIN";
  const canCompany = isAdmin || level === "2_COMPANY";
  const canManager = isAdmin || level === "2_COMPANY" || level === "3_MANAGER";

  // Company scope (first membership if any; admins typically ignore)
  let companyScope: string | null = null;
  if (!isAdmin) {
    const { data: cm } = await supa
      .from("company_memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    companyScope = (cm as { company_id: string } | null)?.company_id ?? null;
  }

  // Manager scope homes
  let managedHomeIds: string[] = [];
  if (level === "3_MANAGER") {
    const { data: ids } = await supa.rpc("home_ids_managed_by", { p_user: user.id });
    if (Array.isArray(ids)) managedHomeIds = ids as string[];
  }

  return { supa, admin, user, level, isAdmin, canCompany, canManager, companyScope, managedHomeIds };
}

/* ──────────────────────────────────────────────────────────────────────────
   Guards
   ────────────────────────────────────────────────────────────────────────── */

export function restrictCompanyPositions(ctx: RequesterContext, _position: string) {
  if (ctx.isAdmin || ctx.canCompany) return;
  throw new Response("Forbidden", { status: 403 });
}

export function requireCompanyScope(ctx: RequesterContext, companyId: string) {
  if (ctx.isAdmin) return;
  if (ctx.companyScope && ctx.companyScope === companyId) return;
  throw new Response("Forbidden", { status: 403 });
}

export function requireManagerScope(ctx: RequesterContext, homeId: string) {
  if (ctx.isAdmin || ctx.canCompany) return;
  if (ctx.level === "3_MANAGER" && ctx.managedHomeIds.includes(homeId)) return;
  throw new Response("Forbidden", { status: 403 });
}
