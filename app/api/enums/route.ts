// app/api/enums/route.ts
import { NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type RpcOk = { data: string[] | null; error: { message: string } | null };

export async function GET() {
  try {
    const ctx = await getRequester();
    if (!ctx.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [cpRes, ssRes, msRes] = (await Promise.all([
      ctx.admin.rpc("list_company_positions"),
      ctx.admin.rpc("list_staff_subroles"),
      ctx.admin.rpc("list_manager_subroles"),
    ])) as RpcOk[];

    const { data: cp, error: cpErr } = cpRes;
    const { data: ss, error: ssErr } = ssRes;
    const { data: ms, error: msErr } = msRes;

    if (cpErr) throw new Error(cpErr.message);
    if (ssErr) throw new Error(ssErr.message);
    if (msErr) throw new Error(msErr.message);

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
