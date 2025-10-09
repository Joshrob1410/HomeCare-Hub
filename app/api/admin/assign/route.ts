// app/api/admin/assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRequester, supabaseAdmin } from "@/lib/requester";

/** Typed request body (discriminated union). */
type AssignAction =
  | {
      action: "company_position";
      user_id: string;
      company_id: string;
      position: string;
      enable?: boolean;
    }
  | {
    action: "staff_subrole";
    user_id: string;
    home_id: string;
    subrole?: string | null;
  }
  | {
    action: "manager_subrole";
    user_id: string;
    home_id: string;
    subrole?: "DEPUTY" | "MANAGER" | null;
  };

/** Minimal local guards that mirror the original helpers' intent. */
function restrictCompanyPositions(
  ctx: { isAdmin: boolean; canCompany: boolean },
  _position: string
) {
  // Comment in original file: "only company-level (or admin) can set company positions"
  if (!(ctx.isAdmin || ctx.canCompany)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

function requireCompanyScope(
  ctx: { isAdmin: boolean; companyScope: string | null },
  companyId: string
) {
  if (ctx.isAdmin) return;
  if (!companyId || ctx.companyScope !== companyId) {
    throw new Response("Forbidden", { status: 403 });
  }
}

function requireManagerScope(
  ctx: { isAdmin: boolean; canCompany: boolean; managedHomeIds: string[] },
  homeId: string
) {
  if (ctx.isAdmin || ctx.canCompany) return;
  if (!homeId || !ctx.managedHomeIds.includes(homeId)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AssignAction;
    const ctx = await getRequester(req); // bearer/cookies consistent

    if (!ctx.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!body?.action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    if (body.action === "company_position") {
      const { user_id, company_id, position, enable } = body;

      // guard: only company-level (or admin) can set company positions
      restrictCompanyPositions(ctx, String(position || ""));
      // scope: must be within same company (admins bypass)
      requireCompanyScope(ctx, company_id);

      if (!user_id || !company_id || !position) {
        return NextResponse.json(
          { error: "user_id, company_id and position are required" },
          { status: 400 }
        );
      }

      const p = String(position).toUpperCase();
      const en = enable !== false;

      const { error } = await admin.rpc<null>("admin_set_company_position", {
        p_user_id: user_id,
        p_company_id: company_id,
        p_position: p,
        p_enable: en,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "staff_subrole") {
      const { user_id, home_id, subrole } = body;

      // managers can only update subroles for homes they manage; admins/company-level bypass
      requireManagerScope(ctx, home_id);

      if (!user_id || !home_id) {
        return NextResponse.json(
          { error: "user_id and home_id are required" },
          { status: 400 }
        );
      }

      const s = subrole ? String(subrole).toUpperCase() : null;

      const { error } = await admin.rpc<null>("admin_set_staff_subrole", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_staff_subrole: s,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "manager_subrole") {
      const { user_id, home_id, subrole } = body;

      // same home scoping as above
      requireManagerScope(ctx, home_id);

      if (!user_id || !home_id) {
        return NextResponse.json(
          { error: "user_id and home_id are required" },
          { status: 400 }
        );
      }

      const mapped =
        !subrole
          ? null
          : subrole === "DEPUTY"
          ? "DEPUTY_MANAGER"
          : "MANAGER";

      const { error } = await admin.rpc<null>("admin_set_manager_subrole", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_manager_subrole: mapped,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    // If one of our guards threw a Response (e.g., 401/403), return it as-is.
    if (e instanceof Response) return e;

    const err = e instanceof Error ? e : new Error("Unknown error");
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
