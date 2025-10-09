// app/api/enums/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type EnumValues = string[];

export async function GET(req: NextRequest) {
  try {
    // Will throw Response(401) if not authenticated
    const ctx = await getRequester(req);

    const [{ data: cp, error: cpErr }, { data: ss, error: ssErr }, { data: ms, error: msErr }] =
      await Promise.all([
        ctx.admin.rpc<EnumValues>("list_company_positions"),
        ctx.admin.rpc<EnumValues>("list_staff_subroles"),
        ctx.admin.rpc<EnumValues>("list_manager_subroles"),
      ]);

    if (cpErr) throw cpErr;
    if (ssErr) throw ssErr;
    if (msErr) throw msErr;

    return NextResponse.json({
      company_positions: cp ?? [],
      staff_subroles: ss ?? [],
      manager_subroles: ms ?? [],
    });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
