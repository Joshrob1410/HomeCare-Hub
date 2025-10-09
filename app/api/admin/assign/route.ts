// app/api/admin/assign/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  getRequester,
  requireCompanyScope,
  requireManagerScope,
  restrictCompanyPositions,
} from "@/lib/requester";

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

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequester(req);
    const body = (await req.json()) as AssignAction;

    if (!ctx.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!body?.action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    // -----------------------------
    // Company-level position toggle
    // -----------------------------
    if (body.action === "company_position") {
      const { user_id, company_id, position, enable } = body;

      restrictCompanyPositions(ctx, String(position || ""));
      requireCompanyScope(ctx, company_id);

      if (!user_id || !company_id || !position) {
        return NextResponse.json(
          { error: "user_id, company_id and position are required" },
          { status: 400 }
        );
      }

      const p = String(position).toUpperCase();
      const en = enable !== false;

      const { error } = await ctx.admin.rpc("admin_set_company_position", {
        p_user_id: user_id,
        p_company_id: company_id,
        p_position: p,
        p_enable: en,
      });

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    // -----------------------------
    // Staff subrole update
    // -----------------------------
    if (body.action === "staff_subrole") {
      const { user_id, home_id, subrole } = body;

      requireManagerScope(ctx, home_id);

      if (!user_id || !home_id) {
        return NextResponse.json(
          { error: "user_id and home_id are required" },
          { status: 400 }
        );
      }

      const s = subrole ? String(subrole).toUpperCase() : null;

      const { error } = await ctx.admin.rpc("admin_set_staff_subrole", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_staff_subrole: s,
      });

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    // -----------------------------
    // Manager subrole update
    // -----------------------------
    if (body.action === "manager_subrole") {
      const { user_id, home_id, subrole } = body;

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
          : String(subrole).toUpperCase() === "DEPUTY"
          ? "DEPUTY_MANAGER"
          : "MANAGER";

      const { error } = await ctx.admin.rpc("admin_set_manager_subrole", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_manager_subrole: mapped,
      });

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
