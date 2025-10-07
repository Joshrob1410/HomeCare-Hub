// app/api/validate/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequester } from "@/lib/requester";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/**
 * POST /api/validate
 * Body:
 *  - { type: "company_position", user_id, company_id, position }
 *  - { type: "staff_subrole",    user_id, home_id,    subrole }
 *  - { type: "manager_subrole",  user_id, home_id,    subrole }
 */
export async function POST(req: Request) {
  try {
    const ctx = await getRequester();
    if (!ctx.userId) return NextResponse.json({ ok: false, reason: "Unauthorized" }, { status: 401 });

    const b = await req.json();

    if (b?.type === "company_position") {
      const { user_id, company_id, position } = b;
      if (!user_id || !company_id || !position) {
        return NextResponse.json({ ok: false, reason: "Missing user/company/position" }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin.rpc("validate_company_position_assignment", {
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
        return NextResponse.json({ ok: false, reason: "Missing user/home/subrole" }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin.rpc("validate_staff_subrole_assignment", {
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
        return NextResponse.json({ ok: false, reason: "Missing user/home/subrole" }, { status: 400 });
      }
      const mapped =
        String(subrole).toUpperCase() === "DEPUTY" ? "DEPUTY_MANAGER" : "MANAGER";
      const { data, error } = await supabaseAdmin.rpc("validate_manager_subrole_assignment", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_manager_subrole: mapped,
      });
      if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
      return NextResponse.json(data?.[0] ?? { ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown validation type" }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, reason: e?.message || "Unexpected error" }, { status: 500 });
  }
}
