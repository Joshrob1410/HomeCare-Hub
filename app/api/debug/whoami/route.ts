// app/api/debug/whoami/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requester";

export async function GET(req: NextRequest) {
  const { user } = await requireUser(req);
  return NextResponse.json({ user_id: user.id, email: user.email });
}
