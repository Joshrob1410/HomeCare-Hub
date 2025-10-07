// app/api/enums/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequester } from "@/lib/requester";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET() {
  try {
    const ctx = await getRequester();
    if (!ctx.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [cp, ss, ms] = await Promise.all([
      supabaseAdmin.rpc("list_company_positions"),
      supabaseAdmin.rpc("list_staff_subroles"),
      supabaseAdmin.rpc("list_manager_subroles"),
    ]);

    if (cp.error) throw cp.error;
    if (ss.error) throw ss.error;
    if (ms.error) throw ms.error;

    return NextResponse.json({
      company_positions: cp.data || [],
      staff_subroles: ss.data || [],
      manager_subroles: ms.data || [],
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
