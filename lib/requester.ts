// lib/requester.ts
import { cookies, headers as nextHeaders } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";

export type AppLevel = "1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF";

/** Server-side Supabase client bound to request cookies (Anon key). */
export function supabaseServer() {
  const cookieStore = cookies();
  const supa = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set(name, value, options);
        },
        remove(name: string, options: any) {
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        },
      },
    }
  );
  return supa;
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

    // validate token using the service-role client
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    const user = data?.user as User | null;
    if (error || !user) throw new Response("Unauthorized", { status: 401 });

    // user-scoped client that forwards the bearer to PostgREST (for RLS)
    const supa = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return { supa, user };
  }

  // fallback to cookie-based session (if you later sync cookies to routes)
  const supa = supabaseServer();
  const { data, error } = await supa.auth.getUser();
  const user = data?.user as User | null;
  if (error || !user) throw new Response("Unauthorized", { status: 401 });
  return { supa, user };
}

/** Convenience context many routes use. */
export type RequesterContext = {
  supa: ReturnType<typeof supabaseServer>;
  admin: ReturnType<typeof supabaseAdmin>;
  user: User;
  /** Convenience mirror to avoid dotting everywhere. */
  userId: string;
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

  // effective level via your RPC
  const { data: lvl, error: lvlErr } = await supa.rpc("get_effective_level");
  if (lvlErr) throw new Response("Failed to resolve level", { status: 500 });
  const level = (lvl as string) as AppLevel;

  const isAdmin = level === "1_ADMIN";
  const canCompany = isAdmin || level === "2_COMPANY";
  const canManager = isAdmin || level === "2_COMPANY" || level === "3_MANAGER";

  // company scope (first membership if any; admins typically ignore)
  let companyScope: string | null = null;
  if (!isAdmin) {
    const { data: cm } = await supa
      .from("company_memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    companyScope = cm?.company_id ?? null;
  }

  // manager scope homes
  let managedHomeIds: string[] = [];
  if (level === "3_MANAGER") {
    const { data: ids } = await supa.rpc("home_ids_managed_by", { p_user: user.id });
    if (Array.isArray(ids)) managedHomeIds = ids as string[];
  }

  return {
    supa,
    admin,
    user,
    userId: user.id,
    level,
    isAdmin,
    canCompany,
    canManager,
    companyScope,
    managedHomeIds,
  };
}

/* =========================
   Guard helpers (exported)
   ========================= */

/**
 * Only admin or company-level users can modify "company positions".
 * Managers/staff are blocked.
 * Throws a 403 Response if not allowed.
 */
export function restrictCompanyPositions(ctx: RequesterContext, _position?: string) {
  if (ctx.isAdmin || ctx.canCompany) return;
  throw new Response("Forbidden: requires company scope", { status: 403 });
}

/**
 * Ensure the action is within the caller's company scope
 * (admins bypass; company users must match; managers/staff forbidden).
 */
export function requireCompanyScope(ctx: RequesterContext, companyId: string | null | undefined) {
  if (!companyId) throw new Response("Bad Request: company_id is required", { status: 400 });
  if (ctx.isAdmin) return;
  if (!ctx.canCompany) throw new Response("Forbidden: requires company role", { status: 403 });
  if (ctx.companyScope !== companyId) throw new Response("Forbidden: wrong company", { status: 403 });
}

/**
 * Ensure the caller is allowed to act on a home.
 * Admins and company-level users are allowed on any home in their company
 * (you can tighten this later if needed). Managers must manage that home.
 */
export function requireManagerScope(ctx: RequesterContext, homeId: string | null | undefined) {
  if (!homeId) throw new Response("Bad Request: home_id is required", { status: 400 });
  if (ctx.isAdmin || ctx.canCompany) return;
  if (ctx.level === "3_MANAGER") {
    if (ctx.managedHomeIds.includes(homeId)) return;
    throw new Response("Forbidden: not manager of this home", { status: 403 });
  }
  throw new Response("Forbidden: requires manager role", { status: 403 });
}
