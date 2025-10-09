// app/api/self/homes/create/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type PostBody = { name: string };
type HomeRow = { id: string; name: string };

export async function POST(req: NextRequest) {
  try {
    // Auth + context (throws 401 as Response if not authenticated)
    const ctx = await getRequester(req);

    // Only company-level users (Level 2) may create homes (admins not included per original behavior)
    if (ctx.level !== "2_COMPANY") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await req.json()) as PostBody;
    const name = body?.name?.toString().trim();
    if (!name) {
      return NextResponse.json({ error: "Name required." }, { status: 400 });
    }

    // Must have a company scope
    const companyId = ctx.companyScope;
    if (!companyId) {
      return NextResponse.json({ error: "No company scope." }, { status: 403 });
    }

    // Create home under scoped company, using service-role client
    const { data: home, error } = await ctx.admin
      .from("homes")
      .insert({ name, company_id: companyId })
      .select("id,name")
      .single()
      .returns<HomeRow>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, home });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
