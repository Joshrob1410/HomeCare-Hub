// app/api/self/homes/update/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type PostBody = { home_id: string; name: string };
type HomeRow = { id: string; company_id: string };

export async function POST(req: NextRequest) {
  try {
    // Auth + context (throws 401 as Response if not authenticated)
    const ctx = await getRequester(req);

    // Only company-level users (Level 2) may update homes (per original behavior)
    if (ctx.level !== "2_COMPANY") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await req.json()) as PostBody;
    const home_id = body?.home_id?.toString();
    const name = body?.name?.toString().trim();

    if (!home_id || !name) {
      return NextResponse.json(
        { error: "home_id and name required." },
        { status: 400 }
      );
    }

    // Must have a company scope
    const companyId = ctx.companyScope;
    if (!companyId) {
      return NextResponse.json({ error: "No company scope." }, { status: 403 });
    }

    // Ensure the home belongs to this company
    const { data: home } = await ctx.admin
      .from("homes")
      .select("id, company_id")
      .eq("id", home_id)
      .maybeSingle()
      .returns<HomeRow | null>();

    if (!home || home.company_id !== companyId) {
      return NextResponse.json(
        { error: "Home not in your company." },
        { status: 403 }
      );
    }

    const { error } = await ctx.admin
      .from("homes")
      .update({ name })
      .eq("id", home_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
