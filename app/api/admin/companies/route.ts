// app/api/admin/companies/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/** Typed bodies for this route */
type PostBody = { name: string };
type PatchBody = { company_id: string; name: string };

/**
 * POST { name: string }                       // Admin only
 * PATCH { company_id: string, name: string }  // Admin only
 */
export async function POST(req: NextRequest) {
  try {
    const r = await getRequester(req);
    if (!r.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = (await req.json()) as PostBody;
    const name = body?.name?.toString().trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { error } = await r.supa.from("companies").insert({ name });
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

export async function PATCH(req: NextRequest) {
  try {
    const r = await getRequester(req);
    if (!r.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = (await req.json()) as PatchBody;
    const company_id = body?.company_id?.toString();
    const name = body?.name?.toString().trim();

    if (!company_id || !name) {
      return NextResponse.json(
        { error: "company_id and name are required" },
        { status: 400 }
      );
    }

    const { error } = await r.supa
      .from("companies")
      .update({ name })
      .eq("id", company_id);

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
