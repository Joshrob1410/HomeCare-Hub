// app/api/admin/homes/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/**
 * POST { company_id: string, name: string }
 * PATCH { home_id: string, name: string }
 */
export async function POST(req: NextRequest) {
  try {
    const r = await getRequester(req);
    const body = await req.json();
    const { company_id, name } = body ?? {};

    if (!name || !company_id) return NextResponse.json({ error: "company_id and name are required" }, { status: 400 });
    if (!r.isAdmin && !r.canCompany) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (r.level === "2_COMPANY" && r.companyScope && r.companyScope !== company_id) {
      return NextResponse.json({ error: "Cannot create a home for another company" }, { status: 403 });
    }

    const { error } = await r.supa.from("homes").insert({ company_id, name: String(name).trim() });
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
    const body = await req.json();
    const { home_id, name } = body ?? {};

    if (!home_id || !name) return NextResponse.json({ error: "home_id and name are required" }, { status: 400 });
    if (!r.isAdmin && !r.canCompany) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (r.level === "2_COMPANY" && r.companyScope) {
      const { data: h } = await r.supa.from("homes").select("company_id").eq("id", home_id).maybeSingle();
      if (h?.company_id && h.company_id !== r.companyScope) {
        return NextResponse.json({ error: "Cannot rename a home in another company" }, { status: 403 });
      }
    }

    const { error } = await r.supa.from("homes").update({ name: String(name).trim() }).eq("id", home_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
