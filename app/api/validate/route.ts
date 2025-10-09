// app/api/validate/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/** Request body */
type ValidateBody =
  | { type: "company_position"; user_id: string; company_id: string; position: string }
  | { type: "staff_subrole"; user_id: string; home_id: string; subrole: string }
  | { type: "manager_subrole"; user_id: string; home_id: string; subrole: string };

/** RPC return (each RPC returns a 1-row array with ok/reason) */
type ValidateRow = { ok: boolean; reason?: string | null };

export async function POST(req: NextRequest) {
  try {
    // Will throw Response(401) if not authenticated
    const ctx = await getRequester(req);
    const b = (await req.json()) as ValidateBody;

    if (b?.type === "company_position") {
      const { user_id, company_id, position } = b;
      if (!user_id || !company_id || !position) {
        return NextResponse.json({ ok: false, reason: "Missing user/company/position" }, { status: 400 });
      }
      const { data, error } = await ctx.admin.rpc<ValidateRow[]>(
        "validate_company_position_assignment",
        {
          p_user_id: user_id,
          p_company_id: company_id,
          p_position: String(position).toUpperCase(),
        }
      );
      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    if (b?.type === "staff_subrole") {
      const { user_id, home_id, subrole } = b;
      if (!user_id || !home_id || !subrole) {
        return NextResponse.json({ ok: false, reason: "Missing user/home/subrole" }, { status: 400 });
      }
      const { data, error } = await ctx.admin.rpc<ValidateRow[]>(
        "validate_staff_subrole_assignment",
        {
          p_user_id: user_id,
          p_home_id: home_id,
          p_staff_subrole: String(subrole).toUpperCase(),
        }
      );
      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    if (b?.type === "manager_subrole") {
      const { user_id, home_id, subrole } = b;
      if (!user_id || !home_id || !subrole) {
        return NextResponse.json({ ok: false, reason: "Missing user/home/subrole" }, { status: 400 });
      }
      const mapped = String(subrole).toUpperCase() === "DEPUTY" ? "DEPUTY_MANAGER" : "MANAGER";
      const { data, error } = await ctx.admin.rpc<ValidateRow[]>(
        "validate_manager_subrole_assignment",
        {
          p_user_id: user_id,
          p_home_id: home_id,
          p_manager_subrole: mapped,
        }
      );
      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown validation type" }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    console.error(err);
    return NextResponse.json({ ok: false, reason: err.message }, { status: 500 });
  }
}
