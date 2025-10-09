// app/api/self/members/create/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type Role = "MANAGER" | "STAFF";

type CreateMemberBody = {
  email: string;
  password: string;
  full_name?: string;
  role: Role; // 'MANAGER' | 'STAFF'
  company_id?: string;
  home_id?: string;
  home_ids?: string[];
  bank_staff?: boolean; // STAFF company-only
  is_dsl?: boolean; // company-only DSL flag at creation
};

type CompanyIdRow = { company_id: string };
type HomeIdRow = { id: string };
type ManagedHomeRow = { home_id: string };

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequester(req);

    const body = (await req.json()) as CreateMemberBody;
    const {
      email,
      password,
      full_name,
      role,
      company_id,
      home_id,
      home_ids,
      bank_staff,
      is_dsl,
    } = body ?? ({} as CreateMemberBody);

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: "email, password, role are required." },
        { status: 400 }
      );
    }
    if (role !== "MANAGER" && role !== "STAFF") {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    // Only Level 2 (company) or Level 3 (manager)
    const level = ctx.level;
    if (level !== "2_COMPANY" && level !== "3_MANAGER") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // ----- Resolve scope -----
    let scopedCompanyId: string | null = null;
    let allowedHomes: string[] = [];

    if (level === "2_COMPANY") {
      // Which companies does caller belong to?
      const { data: myCompanies } = await ctx.admin
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", ctx.user.id)
        .returns<CompanyIdRow[]>();

      const myCompanyIds = Array.from(
        new Set((myCompanies ?? []).map((r) => r.company_id))
      );

      if (myCompanyIds.length === 0) {
        return NextResponse.json({ error: "No company scope." }, { status: 403 });
      }

      if (company_id) {
        if (!myCompanyIds.includes(company_id)) {
          return NextResponse.json({ error: "Not your company." }, { status: 403 });
        }
        scopedCompanyId = company_id;
      } else if (myCompanyIds.length === 1) {
        scopedCompanyId = myCompanyIds[0];
      } else {
        return NextResponse.json(
          { error: "Ambiguous company. Pass company_id." },
          { status: 400 }
        );
      }

      // Homes available in selected company
      const { data: homes } = await ctx.admin
        .from("homes")
        .select("id")
        .eq("company_id", scopedCompanyId)
        .returns<HomeIdRow[]>();
      allowedHomes = (homes ?? []).map((h) => h.id);
    } else {
      // Manager: homes I manage
      const { data: myHomeManager } = await ctx.admin
        .from("home_memberships")
        .select("home_id")
        .eq("user_id", ctx.user.id)
        .eq("role", "MANAGER")
        .returns<ManagedHomeRow[]>();
      const homes = (myHomeManager ?? []).map((r) => r.home_id);
      if (homes.length === 0) {
        return NextResponse.json({ error: "No managed homes." }, { status: 403 });
      }
      allowedHomes = homes;
    }

    // ----- Validate desired assignment -----
    if (level === "2_COMPANY") {
      if (role === "MANAGER") {
        const list = Array.isArray(home_ids) ? home_ids.filter(Boolean) : [];
        if (list.length === 0) {
          return NextResponse.json(
            { error: "Pick at least one home for Manager." },
            { status: 400 }
          );
        }
        if (list.some((h) => !allowedHomes.includes(h))) {
          return NextResponse.json(
            { error: "One or more homes not in your company." },
            { status: 403 }
          );
        }
      } else {
        // STAFF
        const isBank = Boolean(bank_staff);
        if (!isBank) {
          if (!home_id) {
            return NextResponse.json(
              { error: "Pick one home for Staff." },
              { status: 400 }
            );
          }
          if (!allowedHomes.includes(home_id)) {
            return NextResponse.json(
              { error: "Home not in your company." },
              { status: 403 }
            );
          }
        }
      }
    } else {
      // Manager: only STAFF, no bank, must be one of their homes
      if (role !== "STAFF") {
        return NextResponse.json(
          { error: "Managers can only create Staff." },
          { status: 403 }
        );
      }
      if (bank_staff) {
        return NextResponse.json(
          { error: "Managers cannot create bank staff." },
          { status: 403 }
        );
      }
      if (!home_id) {
        return NextResponse.json(
          { error: "Pick one home for Staff." },
          { status: 400 }
        );
      }
      if (!allowedHomes.includes(home_id)) {
        return NextResponse.json({ error: "Not one of your homes." }, { status: 403 });
      }
    }

    // ----- Create auth user -----
    const { data: created, error: cErr } = await ctx.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "" },
    });
    if (cErr || !created?.user) {
      return NextResponse.json(
        { error: cErr?.message || "Failed to create user." },
        { status: 400 }
      );
    }
    const newUserId = created.user.id;

    // profile upsert
    {
      const { error: pErr } = await ctx.admin
        .from("profiles")
        .upsert(
          { user_id: newUserId, full_name: full_name ?? "", is_admin: false },
          { onConflict: "user_id" }
        );
      if (pErr) {
        return NextResponse.json(
          { error: `Profile upsert failed: ${pErr.message}` },
          { status: 400 }
        );
      }
    }

    // helper: upsert company_memberships row to retain DSL/access
    async function upsertCompanyRow(opts: { access?: boolean; dsl?: boolean }) {
      if (level !== "2_COMPANY" || !scopedCompanyId) return;
      const payload: {
        user_id: string;
        company_id: string;
        has_company_access?: boolean;
        is_dsl?: boolean;
      } = { user_id: newUserId, company_id: scopedCompanyId };
      if (typeof opts.access === "boolean") payload.has_company_access = opts.access;
      if (typeof opts.dsl === "boolean") payload.is_dsl = opts.dsl;

      const { error } = await ctx.admin
        .from("company_memberships")
        .upsert(payload, { onConflict: "user_id,company_id" });
      if (error) throw new Error(error.message);
    }

    // ----- Write memberships -----
    if (level === "2_COMPANY") {
      if (role === "MANAGER") {
        const list = (home_ids ?? []).filter(Boolean);
        const rows = list.map((hid) => ({
          user_id: newUserId,
          home_id: hid,
          role: "MANAGER" as const,
        }));
        const { error } = await ctx.admin.from("home_memberships").insert(rows);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }

        // keep company row for DSL (no company access granted here)
        await upsertCompanyRow({
          access: false,
          dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
        });
      } else {
        // STAFF
        if (bank_staff) {
          const { error } = await ctx.admin
            .from("bank_memberships")
            .upsert(
              { user_id: newUserId, company_id: scopedCompanyId! },
              { onConflict: "user_id,company_id" }
            );
          if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }

          await upsertCompanyRow({
            access: false,
            dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
          });
        } else {
          const { error } = await ctx.admin
            .from("home_memberships")
            .insert({ user_id: newUserId, home_id, role: "STAFF" });
          if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }

          await upsertCompanyRow({
            access: false,
            dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
          });
        }
      }
    } else {
      // manager: staff into one of their homes; managers cannot set DSL
      const { error } = await ctx.admin
        .from("home_memberships")
        .insert({ user_id: newUserId, home_id, role: "STAFF" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json(
      { ok: true, user: { id: newUserId, email, full_name: full_name ?? "", role } },
      { status: 201 }
    );
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
