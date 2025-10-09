// app/api/validate/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type ValidateRow = { ok: boolean; reason?: string | null };

type Body =
  | {
      type: "company_position";
      user_id: string;
      company_id: string;
      position: string;
    }
  | {
    type: "staff_subrole";
    user_id: string;
    home_id: string;
    subrole: string;
  }
  | {
    type: "manager_subrole";
    user_id: string;
    home_id: string;
    subrole: string;
  };

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequester(req);
    if (!ctx.user) {
      return NextResponse.json({ ok: false, reason: "Unauthorized" }, { status: 401 });
    }

    const b = (await req.json()) as Body;

    if (b?.type === "company_position") {
      const { user_id, company_id, position } = b;
      if (!user_id || !company_id || !position) {
        return NextResponse.json(
          { ok: false, reason: "Missing user/company/position" },
          { status: 400 }
        );
      }

      const { data, error } = await ctx.admin.rpc<
        ValidateRow[],
        { p_user_id: string; p_company_id: string; p_position: string }
      >("validate_company_position_assignment", {
        p_user_id: user_id,
        p_company_id: company_id,
        p_position: String(position).toUpperCase(),
      });

      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    if (b?.type === "staff_subrole") {
      const { user_id, home_id, subrole } = b;
      if (!user_id || !home_id || !subrole) {
        return NextResponse.json(
          { ok: false, reason: "Missing user/home/subrole" },
          { status: 400 }
        );
      }

      const { data, error } = await ctx.admin.rpc<
        ValidateRow[],
        { p_user_id: string; p_home_id: string; p_staff_subrole: string }
      >("validate_staff_subrole_assignment", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_staff_subrole: String(subrole).toUpperCase(),
      });

      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    if (b?.type === "manager_subrole") {
      const { user_id, home_id, subrole } = b;
      if (!user_id || !home_id || !subrole) {
        return NextResponse.json(
          { ok: false, reason: "Missing user/home/subrole" },
          { status: 400 }
        );
      }

      const mapped =
        String(subrole).toUpperCase() === "DEPUTY" ? "DEPUTY_MANAGER" : "MANAGER";

      const { data, error } = await ctx.admin.rpc<
        ValidateRow[],
        { p_user_id: string; p_home_id: string; p_manager_subrole: string }
      >("validate_manager_subrole_assignment", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_manager_subrole: mapped,
      });

      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown validation type" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    console.error(e);
    return NextResponse.json({ ok: false, reason: msg }, { status: 500 });
  }
}
