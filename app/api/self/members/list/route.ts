// app/api/self/members/list/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/** Minimal row shapes used here */
type CompanyIdRow = { company_id: string };
type UserIdRow = { user_id: string };
type HomeIdRow = { id: string };
type ManagedHomeRow = { home_id: string };
type HomeMembershipRow = { user_id: string; home_id: string; role: "MANAGER" | "STAFF" };
type HomeInfoRow = { id: string; name: string };
type CompanyMembershipInfoRow = {
  user_id: string;
  has_company_access: boolean | null;
  is_dsl: boolean | null;
};
type ProfileRow = { user_id: string; full_name: string | null; is_admin: boolean | null };

/** Minimal subset of the Auth admin user we actually read */
type AuthUserLite = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequester(req);
    const level = ctx.level;

    if (level !== "2_COMPANY" && level !== "3_MANAGER") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const companyParam = searchParams.get("company_id") ?? undefined;

    const ids = new Set<string>();
    let allowedHomeIds: string[] = [];
    let myCompanyId: string | null = null;

    if (level === "2_COMPANY") {
      // All companies for caller; allow optional ?company_id=
      const { data: myCompanies } = await ctx.admin
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", ctx.user.id)
        .returns<CompanyIdRow[]>();

      const myCompanyIds = Array.from(new Set((myCompanies ?? []).map((r) => r.company_id)));
      if (myCompanyIds.length === 0) {
        return NextResponse.json({ error: "No company scope." }, { status: 403 });
      }

      if (companyParam) {
        if (!myCompanyIds.includes(companyParam)) {
          return NextResponse.json({ error: "Not your company." }, { status: 403 });
        }
        myCompanyId = companyParam;
      } else {
        // Backward compatible: pick first if multiple
        myCompanyId = myCompanyIds[0]!;
      }

      // Build scope
      const { data: homes } = await ctx.admin
        .from("homes")
        .select("id")
        .eq("company_id", myCompanyId)
        .returns<HomeIdRow[]>();

      allowedHomeIds = (homes ?? []).map((h) => h.id);

      const [{ data: hm }, { data: bm }, { data: cmem }] = await Promise.all([
        ctx.admin
          .from("home_memberships")
          .select("user_id, home_id")
          .in("home_id", allowedHomeIds)
          .returns<HomeMembershipRow[]>(),
        ctx.admin
          .from("bank_memberships")
          .select("user_id")
          .eq("company_id", myCompanyId)
          .returns<UserIdRow[]>(),
        ctx.admin
          .from("company_memberships")
          .select("user_id")
          .eq("company_id", myCompanyId)
          .returns<UserIdRow[]>(),
      ]);

      (hm ?? []).forEach((r) => ids.add(r.user_id));
      (bm ?? []).forEach((r) => ids.add(r.user_id));
      (cmem ?? []).forEach((r) => ids.add(r.user_id));
    } else {
      // Manager: anyone in my homes
      const { data: myHomes } = await ctx.admin
        .from("home_memberships")
        .select("home_id")
        .eq("user_id", ctx.user.id)
        .eq("role", "MANAGER")
        .returns<ManagedHomeRow[]>();

      allowedHomeIds = (myHomes ?? []).map((r) => r.home_id);
      if (allowedHomeIds.length === 0) {
        return NextResponse.json({ error: "No managed homes." }, { status: 403 });
      }

      const { data: rel } = await ctx.admin
        .from("home_memberships")
        .select("user_id")
        .in("home_id", allowedHomeIds)
        .returns<UserIdRow[]>();

      (rel ?? []).forEach((r) => ids.add(r.user_id));
    }

    const userIds = [...ids];
    if (userIds.length === 0) return NextResponse.json({ members: [] });

    // profiles + auth emails
    const [{ data: profs }, authUsersRes] = await Promise.all([
      ctx.admin
        .from("profiles")
        .select("user_id, full_name, is_admin")
        .in("user_id", userIds)
        .returns<ProfileRow[]>(),
      ctx.admin.auth.admin.listUsers({
        page: 1,
        perPage: Math.max(1000, userIds.length),
      }),
    ]);

    // ---- SAFE PARSE listUsers() without `any`
    type ListUsersPayload = { data?: { users?: unknown } };
    const payload = authUsersRes as unknown as ListUsersPayload | undefined;
    const rawUsers = payload?.data?.users;
    const authUsers: AuthUserLite[] = Array.isArray(rawUsers)
      ? (rawUsers as AuthUserLite[])
      : [];

    const emailMap = new Map<string, AuthUserLite>();
    authUsers.forEach((u) => emailMap.set(u.id, u));

    // memberships within scope
    const { data: homeMs } = await ctx.admin
      .from("home_memberships")
      .select("user_id, role, home_id")
      .in("home_id", allowedHomeIds)
      .in("user_id", userIds)
      .returns<HomeMembershipRow[]>();

    // Map home_id -> name (avoid fragile joins)
    const homeIdSet = Array.from(new Set((homeMs ?? []).map((h) => h.home_id)));
    const { data: homesInfo } = homeIdSet.length
      ? await ctx.admin
          .from("homes")
          .select("id, name")
          .in("id", homeIdSet)
          .returns<HomeInfoRow[]>()
      : ({ data: [] as HomeInfoRow[] } as const);

    const nameByHomeId = new Map<string, string>();
    (homesInfo ?? []).forEach((h) => nameByHomeId.set(h.id, h.name));

    let bankMs: UserIdRow[] = [];
    let compMs: CompanyMembershipInfoRow[] = [];
    if (level === "2_COMPANY") {
      const [b, c] = await Promise.all([
        ctx.admin
          .from("bank_memberships")
          .select("user_id")
          .eq("company_id", myCompanyId!)
          .returns<UserIdRow[]>(),
        ctx.admin
          .from("company_memberships")
          .select("user_id, has_company_access, is_dsl")
          .eq("company_id", myCompanyId!)
          .returns<CompanyMembershipInfoRow[]>(),
      ]);
      bankMs = b.data ?? [];
      compMs = c.data ?? [];
    }

    const members = userIds.map((id) => {
      const p = (profs ?? []).find((pr) => pr.user_id === id);
      const au = emailMap.get(id);

      const scopedHomes = (homeMs ?? []).filter((h) => h.user_id === id);
      const managerHomes = scopedHomes
        .filter((h) => h.role === "MANAGER")
        .map((h) => ({ id: h.home_id, name: nameByHomeId.get(h.home_id) || "" }));
      const staffHomes = scopedHomes
        .filter((h) => h.role === "STAFF")
        .map((h) => ({ id: h.home_id, name: nameByHomeId.get(h.home_id) || "" }));

      const compRow = level === "2_COMPANY" ? compMs.find((x) => x.user_id === id) : null;
      const bank = level === "2_COMPANY" ? !!bankMs.find((x) => x.user_id === id) : false;
      const company = !!compRow?.has_company_access;
      const dsl = !!compRow?.is_dsl;

      return {
        id,
        full_name: p?.full_name ?? "",
        is_admin: Boolean(p?.is_admin),
        email: au?.email ?? "",
        created_at: au?.created_at ?? null,
        last_sign_in_at: au?.last_sign_in_at ?? null,
        roles: {
          company,
          bank,
          manager_homes: managerHomes,
          staff_home: staffHomes.length ? staffHomes[0] : null,
          dsl,
        },
      };
    });

    return NextResponse.json({ members });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
