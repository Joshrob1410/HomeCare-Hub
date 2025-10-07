// app/api/admin/companies/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/**
 * POST { name: string }                   // Admin only
 * PATCH { company_id: string, name: string }  // Admin only
 */
export async function POST(req: NextRequest) {
  try {
    const r = await getRequester(req);
    if (!r.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const body = await req.json();
    const { name } = body ?? {};
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const { error } = await r.supa.from("companies").insert({ name: String(name).trim() });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const r = await getRequester(req);
    if (!r.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const body = await req.json();
    const { company_id, name } = body ?? {};
    if (!company_id || !name) return NextResponse.json({ error: "company_id and name are required" }, { status: 400 });

    const { error } = await r.supa.from("companies").update({ name: String(name).trim() }).eq("id", company_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
