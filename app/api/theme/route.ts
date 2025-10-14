import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { orbit } = await req.json().catch(() => ({ orbit: false }));

  const res = new NextResponse(null, { status: 204 });

  // 1 year — tweak if you prefer a session cookie
  const maxAge = 60 * 60 * 24 * 365;
  if (orbit) {
    res.headers.append(
      "Set-Cookie",
      `orbit=1; Path=/; Max-Age=${maxAge}; SameSite=Lax`
    );
  } else {
    // Clear by setting Max-Age=0
    res.headers.append("Set-Cookie", `orbit=; Path=/; Max-Age=0; SameSite=Lax`);
  }

  return res;
}
