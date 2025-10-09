// lib/requester.ts
import { cookies, headers as nextHeaders } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";

export type AppLevel = "1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF";

/** Minimal cookie options shape for Supabase SSR adapter */
type CookieOptions = {
  expires?: Date;
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
};

/** Server-side Supabase client bound to request cookies (Anon key). */
export function supabaseServer() {
  const cookieStore = cookies();
  // Cast to 'any' so we can feature-detect .set() (read-only in most Next 15 contexts)
  const anyCookies = cookieStore as unknown as {
    get?: (name: string) => { value?: string } | undefined;
    set?: (opts: { name: string; value: string } & CookieOptions) => void;
  };

  const supa = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        get(name: string) {
          // Return undefined when missing (what supabase expects)
          return cookieStore.get(name)?.value ?? undefined;
        },
        set(name: string, value: string, options?: CookieOptions) {
          try {
            anyCookies.set?.({ name, value, ...(options ?? {}) });
          } catch {
            // no-op when cookies are read-only (e.g., most Next 15 server contexts)
          }
        },
        remove(name: string, options?: CookieOptions) {
          try {
            anyCookies.set?.({ name, value: "", ...(options ?? {}), maxAge: 0 });
          } catch {
            // no-op when cookies are read-only
          }
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
    const user = (data?.user as User) ?? null;
    if (error || !user) throw new Response("Unauthorized", { status: 401 });

    // user-scoped client that forwards the bearer to PostgREST (for RLS)
    const supa = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return { supa, user };
  }

  // fallback to cookie-based session
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

  // get_effective_level returns a single scalar; pick it from the field named after the function
  const { data: lvlRow, error: lvlErr } = await supa.rpc("get_effective_level").single();
  if (lvlErr) throw new Response("Failed to resolve level", { status: 500 });
  const level = (lvlRow as { get_effective_level: AppLevel }).get_effective_level;

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
    companyScope = (cm as { company_id: string } | null)?.company_id ?? null;
  }

  // manager scope homes
  let managedHomeIds: string[] = [];
  if (level === "3_MANAGER") {
    const { data: ids } = await supa.rpc("home_ids_managed_by", { p_user: user.id });
    if (Array.isArray(ids)) managedHomeIds = ids as string[];
  }

  return { supa, admin, user, level, isAdmin, canCompany, canManager, companyScope, managedHomeIds };
}

/* ──────────────────────────────────────────────────────────────────────────
   Helper guards used by admin/self routes
   These throw Response(403) when the caller lacks scope/privilege.
   Exported symbols must match the imports in the routes.
   ────────────────────────────────────────────────────────────────────────── */

/** Only Admin or Company-level can set company positions. */
export function restrictCompanyPositions(ctx: RequesterContext, _position: string) {
  if (ctx.isAdmin || ctx.canCompany) return;
  throw new Response("Forbidden", { status: 403 });
}

/** Require that the operation is within the caller's company scope (admins bypass). */
export function requireCompanyScope(ctx: RequesterContext, companyId: string) {
  if (ctx.isAdmin) return;
  if (ctx.companyScope && ctx.companyScope === companyId) return;
  throw new Response("Forbidden", { status: 403 });
}

/** Require that the operation targets a home the caller manages (admins/company bypass). */
export function requireManagerScope(ctx: RequesterContext, homeId: string) {
  if (ctx.isAdmin || ctx.canCompany) return;
  if (ctx.level === "3_MANAGER" && ctx.managedHomeIds.includes(homeId)) return;
  throw new Response("Forbidden", { status: 403 });
}
