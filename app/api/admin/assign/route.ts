// app/api/admin/assign/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getRequester,
  requireCompanyScope,
  requireManagerScope,
  restrictCompanyPositions,
} from "@/lib/requester";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ctx = await getRequester();
    if (!ctx.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!body?.action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    if (body.action === "company_position") {
      const { user_id, company_id, position, enable } = body;
      restrictCompanyPositions(ctx, String(position || ""));
      requireCompanyScope(ctx, company_id);
      if (!user_id || !company_id || !position) {
        return NextResponse.json({ error: "user_id, company_id and position are required" }, { status: 400 });
      }
      const p = String(position).toUpperCase();
      const en = enable !== false;
      const { error } = await supabaseAdmin.rpc("admin_set_company_position", {
        p_user_id: user_id,
        p_company_id: company_id,
        p_position: p,
        p_enable: en,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "staff_subrole") {
      const { user_id, home_id, subrole } = body;
      requireManagerScope(ctx, home_id);
      if (!user_id || !home_id) {
        return NextResponse.json({ error: "user_id and home_id are required" }, { status: 400 });
      }
      const s = subrole ? String(subrole).toUpperCase() : null;
      const { error } = await supabaseAdmin.rpc("admin_set_staff_subrole", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_staff_subrole: s,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "manager_subrole") {
      const { user_id, home_id, subrole } = body;
      requireManagerScope(ctx, home_id);
      if (!user_id || !home_id) {
        return NextResponse.json({ error: "user_id and home_id are required" }, { status: 400 });
      }
      const mapped = !subrole
        ? null
        : String(subrole).toUpperCase() === "DEPUTY"
        ? "DEPUTY_MANAGER"
        : "MANAGER";
      const { error } = await supabaseAdmin.rpc("admin_set_manager_subrole", {
        p_user_id: user_id,
        p_home_id: home_id,
        p_manager_subrole: mapped,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    const status = e?.status || 500;
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status });
  }
}
