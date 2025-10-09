// app/api/enums/route.ts
import { NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type EnumValues = string[];

export async function GET() {
  try {
    const ctx = await getRequester();
    // make sure we have a user
    if (!ctx.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [{ data: cp, error: cpErr }, { data: ss, error: ssErr }, { data: ms, error: msErr }] =
      await Promise.all([
        ctx.admin.rpc<EnumValues, Record<string, never>>("list_company_positions"),
        ctx.admin.rpc<EnumValues, Record<string, never>>("list_staff_subroles"),
        ctx.admin.rpc<EnumValues, Record<string, never>>("list_manager_subroles"),
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
    const err = e instanceof Error ? e : new Error("Unexpected error");
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
