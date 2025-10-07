// app/api/admin/create-user/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/**
 * Body:
 * {
 *   full_name: string,
 *   email: string,
 *   password?: string,
 *   role: "1_ADMIN"|"2_COMPANY"|"3_MANAGER"|"4_STAFF",
 *   is_admin?: boolean,
 *   company_id?: string | null,
 *   home_id?: string | null,
 *   position?: string | null,             // e.g. BANK / RESIDENTIAL / TEAM_LEADER
 *   company_positions?: string[]          // optional
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const r = await getRequester(); // uses Authorization header or cookies
    const body = await req.json();

    const {
      full_name,
      email,
      password,
      role,
      is_admin,
      company_id,
      home_id,
      position,
      company_positions,
    } = body ?? {};

    if (!full_name || !email) {
      return NextResponse.json(
        { error: "full_name and email are required" },
        { status: 400 }
      );
    }

    // ---------- Privilege checks with user-scoped client ----------
    if (!r.isAdmin && !r.canCompany && r.level !== "3_MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (is_admin || role === "1_ADMIN") {
      if (!r.isAdmin) {
        return NextResponse.json(
          { error: "Only admins can create admins" },
          { status: 403 }
        );
      }
    }

    // Derive target company safely
    let targetCompanyId: string | null = company_id ?? null;

    if (r.level === "2_COMPANY") {
      if (!r.companyScope) {
        return NextResponse.json(
          { error: "Your company scope is unknown" },
          { status: 400 }
        );
      }
      if (targetCompanyId && targetCompanyId !== r.companyScope) {
        return NextResponse.json(
          { error: "Cannot create users in another company" },
          { status: 403 }
        );
      }
      targetCompanyId = r.companyScope;
      if (role === "1_ADMIN") {
        return NextResponse.json(
          { error: "Company level cannot create admins" },
          { status: 403 }
        );
      }
    }

    if (r.level === "3_MANAGER") {
      // Managers cannot create admin/company users
      if (role === "1_ADMIN" || role === "2_COMPANY") {
        return NextResponse.json(
          { error: "Managers cannot create admin/company users" },
          { status: 403 }
        );
      }
      // And can only assign to homes they manage
      if (home_id && !r.managedHomeIds.includes(home_id)) {
        return NextResponse.json(
          { error: "Managers can only create people for their managed homes" },
          { status: 403 }
        );
      }
      // If company not provided but a home is, derive company from the home
      if (!targetCompanyId && home_id) {
        const { data: h } = await r.supa
          .from("homes")
          .select("company_id")
          .eq("id", home_id)
          .maybeSingle();
        targetCompanyId = h?.company_id ?? null;
      }
    }

    // ---------- Create auth user (service role) ----------
    const passwordToUse =
      password && password.length >= 6
        ? password
        : crypto.randomUUID().slice(0, 12);

      const { data: created, error: createErr } = await r.admin.auth.admin.createUser({
          email,
          password: passwordToUse,
          email_confirm: true,
          user_metadata: {
              full_name,           // Supabase UI often reads this
              name: full_name,     // many libs expect "name"
              display_name: full_name, // belt-and-braces
          },
      });

    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: createErr?.message || "Failed to create auth user" },
        { status: 500 }
      );
    }
    const newUser = created.user;

    // ---------- DB writes with service-role (bypass RLS) ----------
    // 1) PROFILE: upsert to avoid duplicate key if a trigger already inserted it
    {
      const { error } = await r.admin
        .from("profiles")
        .upsert(
          { user_id: newUser.id, full_name },
          { onConflict: "user_id" } // adjust if your unique index is named/defined differently
        );
      if (error)
        return NextResponse.json(
          { error: error.message || "Failed to upsert profile" },
          { status: 500 }
        );
    }

    // 2) COMPANY MEMBERSHIP (skip for pure admin role)
    if (targetCompanyId && role !== "1_ADMIN") {
      const { error } = await r.admin
        .from("company_memberships")
        .upsert(
          { user_id: newUser.id, company_id: targetCompanyId },
          { onConflict: "user_id,company_id" }
        );
      if (error)
        return NextResponse.json(
          { error: error.message || "Failed to upsert company membership" },
          { status: 500 }
        );
    }

    // 3) HOME vs BANK placement
    if (home_id && role !== "2_COMPANY") {
      // Assign to a specific home
      const homeRole = role === "3_MANAGER" ? "MANAGER" : "STAFF";
      const { error } = await r.admin
        .from("home_memberships")
        .upsert(
          { user_id: newUser.id, home_id, role: homeRole },
          { onConflict: "user_id,home_id" }
        );
      if (error)
        return NextResponse.json(
          { error: error.message || "Failed to upsert home membership" },
          { status: 500 }
        );

      // Optional: if you don’t want dual home+bank in the same company, you could remove bank here.
      // await r.admin.from("bank_memberships").delete().eq("user_id", newUser.id).eq("company_id", targetCompanyId ?? "");
    } else if (position === "BANK" && targetCompanyId) {
      // Assign bank membership
      const { error } = await r.admin
        .from("bank_memberships")
        .upsert(
          { user_id: newUser.id, company_id: targetCompanyId },
          { onConflict: "user_id,company_id" }
        );
      if (error)
        return NextResponse.json(
          { error: error.message || "Failed to upsert bank membership" },
          { status: 500 }
        );
    }

    // 4) Optional company positions
    if (Array.isArray(company_positions) && company_positions.length && targetCompanyId) {
      const rows = company_positions.map((p: string) => ({
        user_id: newUser.id,
        company_id: targetCompanyId!,
        position: p,
      }));
      // Idempotent as well
      await r.admin
        .from("user_company_positions")
        .upsert(rows, { onConflict: "user_id,company_id,position" })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, user_id: newUser.id });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
