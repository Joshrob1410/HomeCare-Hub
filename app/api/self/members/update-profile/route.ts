// app/api/self/members/update-profile/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type PostBody = { user_id: string; full_name?: string; email?: string };
type CompanyIdRow = { company_id: string };
type HomeIdRow = { id: string };
type UserIdRow = { user_id: string };
type ManagedHomeRow = { home_id: string };

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequester(req);

    const { user_id, full_name, email } = (await req.json()) as PostBody;
    if (!user_id) {
      return NextResponse.json({ error: "user_id required." }, { status: 400 });
    }

    // Only company-level (2) or manager (3)
    if (ctx.level !== "2_COMPANY" && ctx.level !== "3_MANAGER") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Determine scope (company vs manager)
    const allowedUserIds = new Set<string>();

    if (ctx.level === "2_COMPANY") {
      // Resolve caller's company scope
      const companyId = ctx.companyScope;
      if (!companyId) {
        return NextResponse.json({ error: "No company scope." }, { status: 403 });
      }

      // collect all user_ids in that company
      const { data: homes } = await ctx.admin
        .from("homes")
        .select("id")
        .eq("company_id", companyId)
        .returns<HomeIdRow[]>();

      const allowedHomeIds = (homes ?? []).map((h) => h.id);

      const [{ data: hm }, { data: bm }, { data: cmem }] = await Promise.all([
        ctx.admin
          .from("home_memberships")
          .select("user_id")
          .in("home_id", allowedHomeIds)
          .returns<UserIdRow[]>(),
        ctx.admin
          .from("bank_memberships")
          .select("user_id")
          .eq("company_id", companyId)
          .returns<UserIdRow[]>(),
        ctx.admin
          .from("company_memberships")
          .select("user_id")
          .eq("company_id", companyId)
          .returns<UserIdRow[]>(),
      ]);

      (hm ?? []).forEach((r) => allowedUserIds.add(r.user_id));
      (bm ?? []).forEach((r) => allowedUserIds.add(r.user_id));
      (cmem ?? []).forEach((r) => allowedUserIds.add(r.user_id));
    } else {
      // manager: STAFF in my homes
      const { data: myHomes } = await ctx.admin
        .from("home_memberships")
        .select("home_id")
        .eq("user_id", ctx.user.id)
        .eq("role", "MANAGER")
        .returns<ManagedHomeRow[]>();

      const homeIds = (myHomes ?? []).map((r) => r.home_id);
      if (homeIds.length === 0) {
        return NextResponse.json({ error: "No managed homes." }, { status: 403 });
      }

      const { data: staff } = await ctx.admin
        .from("home_memberships")
        .select("user_id")
        .eq("role", "STAFF")
        .in("home_id", homeIds)
        .returns<UserIdRow[]>();

      (staff ?? []).forEach((r) => allowedUserIds.add(r.user_id));
    }

    if (!allowedUserIds.has(user_id)) {
      return NextResponse.json({ error: "Target user not in your scope." }, { status: 403 });
    }

    // Update public.profiles (name)
    if (typeof full_name === "string") {
      const { error } = await ctx.admin
        .from("profiles")
        .upsert({ user_id, full_name }, { onConflict: "user_id" });
      if (error) {
        return NextResponse.json(
          { error: `Profile update failed: ${error.message}` },
          { status: 400 }
        );
      }
    }

    // Update auth.users (email)
    if (typeof email === "string" && email.trim()) {
      const { error } = await ctx.admin.auth.admin.updateUserById(user_id, {
        email: email.trim(),
      });
      if (error) {
        return NextResponse.json(
          { error: `Email update failed: ${error.message}` },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
