// app/api/self/members/update-role/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

type TargetRole = "MANAGER" | "COMPANY" | "STAFF";

type PostBody = {
  user_id: string;
  role: TargetRole;            // 'MANAGER' | 'COMPANY' | 'STAFF'
  home_ids?: string[];         // for MANAGER (array of homes)
  home_id?: string;            // for STAFF (single home)
  bank?: boolean;              // STAFF + bank=true => make bank staff (company-only)
  is_dsl?: boolean;            // set/unset DSL (company-only)
  company_id?: string;         // disambiguates which company the op applies to
};

/** Minimal row shapes used here */
type CompanyIdRow = { company_id: string };
type HomeIdRow = { id: string };
type HomeMembershipRow = { user_id: string; home_id: string; role: "MANAGER" | "STAFF" };
type ManagedHomeRow = { home_id: string };
type ProfileRow = { is_admin: boolean | null };
type BankRow = { id?: string | null; company_id?: string | null };

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequester(req);

    const body = (await req.json()) as PostBody;
    const {
      user_id,
      role,
      home_ids,
      home_id,
      bank,
      is_dsl,
      company_id,
    } = body ?? ({} as PostBody);

    if (!user_id || !role) {
      return NextResponse.json(
        { error: "user_id and role are required." },
        { status: 400 }
      );
    }
    if (role !== "MANAGER" && role !== "COMPANY" && role !== "STAFF") {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const level = ctx.level;
    if (level !== "2_COMPANY" && level !== "3_MANAGER") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Block touching Admins entirely
    const { data: prof } = await ctx.admin
      .from("profiles")
      .select("is_admin")
      .eq("user_id", user_id)
      .maybeSingle()
      .returns<ProfileRow | null>();
    if (prof?.is_admin) {
      return NextResponse.json({ error: "Cannot modify an Admin." }, { status: 403 });
    }

    // --- Resolve caller scope ---
    let myCompanyId: string | null = null;
    let allowedHomeIds: string[] = [];

    if (level === "2_COMPANY") {
      // Companies where caller has a row (be permissive, legacy-safe)
      const { data: myCompanies } = await ctx.admin
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", ctx.user.id)
        .returns<CompanyIdRow[]>();

      const callerCompanies = Array.from(
        new Set((myCompanies ?? []).map((r) => r.company_id))
      );

      if (company_id) {
        if (!callerCompanies.includes(company_id)) {
          return NextResponse.json({ error: "Not your company." }, { status: 403 });
        }
        myCompanyId = company_id;
      } else if (callerCompanies.length === 1) {
        myCompanyId = callerCompanies[0]!;
      } else {
        // Infer from target user’s footprint (homes/bank/company rows)
        const [{ data: tHomesIds }, { data: tBank }, { data: tComp }] =
          await Promise.all([
            ctx.admin
              .from("home_memberships")
              .select("home_id")
              .eq("user_id", user_id)
              .returns<ManagedHomeRow[]>(),
            ctx.admin
              .from("bank_memberships")
              .select("company_id")
              .eq("user_id", user_id)
              .returns<CompanyIdRow[]>(),
            ctx.admin
              .from("company_memberships")
              .select("company_id")
              .eq("user_id", user_id)
              .returns<CompanyIdRow[]>(),
          ]);

        let companiesFromHomes: string[] = [];
        if ((tHomesIds ?? []).length) {
          const ids = (tHomesIds ?? []).map((r) => r.home_id);
          const { data: homesInfo } = await ctx.admin
            .from("homes")
            .select("id, company_id")
            .in("id", ids)
            .returns<(HomeIdRow & { company_id: string })[]>();
          companiesFromHomes = (homesInfo ?? []).map((h) => h.company_id);
        }

        const tCompanySet = new Set<string>([
          ...companiesFromHomes,
          ...((tBank ?? []).map((r) => r.company_id)),
          ...((tComp ?? []).map((r) => r.company_id)),
        ]);

        const overlap = callerCompanies.filter((c) => tCompanySet.has(c));
        if (overlap.length === 1) {
          myCompanyId = overlap[0]!;
        } else if (overlap.length === 0) {
          return NextResponse.json(
            { error: "Target user not in any of your companies." },
            { status: 403 }
          );
        } else {
          return NextResponse.json(
            { error: "Ambiguous company. Pass company_id." },
            { status: 400 }
          );
        }
      }

      // Allowed homes = all homes in that company
      const { data: homes } = await ctx.admin
        .from("homes")
        .select("id")
        .eq("company_id", myCompanyId)
        .returns<HomeIdRow[]>();
      allowedHomeIds = (homes ?? []).map((h) => h.id);
    } else {
      // Manager: allowed homes are homes I manage
      const { data: mh } = await ctx.admin
        .from("home_memberships")
        .select("home_id")
        .eq("user_id", ctx.user.id)
        .eq("role", "MANAGER")
        .returns<ManagedHomeRow[]>();
      allowedHomeIds = (mh ?? []).map((r) => r.home_id);
      if (allowedHomeIds.length === 0) {
        return NextResponse.json({ error: "No managed homes." }, { status: 403 });
      }
    }

    // --- Ensure target user is in scope ---
    const inScope = async (): Promise<boolean> => {
      if (level === "2_COMPANY") {
        const [{ data: hm }, { data: bm }, { data: cm }] = await Promise.all([
          ctx.admin
            .from("home_memberships")
            .select("user_id")
            .eq("user_id", user_id)
            .in("home_id", allowedHomeIds)
            .returns<{ user_id: string }[]>(),
          ctx.admin
            .from("bank_memberships")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("company_id", myCompanyId!)
            .returns<{ user_id: string }[]>(),
          ctx.admin
            .from("company_memberships")
            .select("user_id")
            .eq("user_id", user_id)
            .eq("company_id", myCompanyId!)
            .returns<{ user_id: string }[]>(),
        ]);
        return (hm?.length ?? 0) + (bm?.length ?? 0) + (cm?.length ?? 0) > 0;
      } else {
        const { data: rel } = await ctx.admin
          .from("home_memberships")
          .select("user_id")
          .eq("user_id", user_id)
          .in("home_id", allowedHomeIds)
          .returns<{ user_id: string }[]>();
        return (rel?.length ?? 0) > 0;
      }
    };
    if (!(await inScope())) {
      return NextResponse.json({ error: "Target user not in your scope." }, { status: 403 });
    }

    // Helper to keep a company_memberships row for storing DSL and/or access
    async function upsertCompanyMembership(opts: { access?: boolean; dsl?: boolean }) {
      if (level !== "2_COMPANY" || !myCompanyId) return;
      const payload: {
        user_id: string;
        company_id: string;
        has_company_access?: boolean;
        is_dsl?: boolean;
      } = { user_id, company_id: myCompanyId };
      if (typeof opts.access === "boolean") payload.has_company_access = opts.access;
      if (typeof opts.dsl === "boolean") payload.is_dsl = opts.dsl;

      const { error } = await ctx.admin
        .from("company_memberships")
        .upsert(payload, { onConflict: "user_id,company_id" });
      if (error) throw new Error(error.message);
    }

    // --- APPLY CHANGES ---

    // COMPANY access (company callers only)
    if (role === "COMPANY") {
      if (level !== "2_COMPANY") {
        return NextResponse.json(
          { error: "Only Company can set COMPANY access." },
          { status: 403 }
        );
      }

      // Clear homes & bank for this company
      await ctx.admin
        .from("home_memberships")
        .delete()
        .in("home_id", allowedHomeIds)
        .eq("user_id", user_id);
      await ctx.admin
        .from("bank_memberships")
        .delete()
        .eq("user_id", user_id)
        .eq("company_id", myCompanyId!);

      // Grant company access and set DSL if provided
      await upsertCompanyMembership({
        access: true,
        dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
      });

      return NextResponse.json({ ok: true });
    }

    // STAFF path
    if (role === "STAFF") {
      if (bank) {
        if (level !== "2_COMPANY") {
          return NextResponse.json(
            { error: "Only Company can set Bank staff." },
            { status: 403 }
          );
        }

        // Clear home memberships in this company
        await ctx.admin
          .from("home_memberships")
          .delete()
          .in("home_id", allowedHomeIds)
          .eq("user_id", user_id);

        // Upsert bank membership
        const { error: upBank } = await ctx.admin
          .from("bank_memberships")
          .upsert(
            { user_id, company_id: myCompanyId! },
            { onConflict: "user_id,company_id" }
          );
        if (upBank) {
          return NextResponse.json({ error: upBank.message }, { status: 400 });
        }

        // Keep a company_memberships row to store DSL; set company access to false here
        await upsertCompanyMembership({
          access: false,
          dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
        });

        return NextResponse.json({ ok: true });
      }

      // Normal staff (home-based)
      if (!home_id) {
        return NextResponse.json(
          { error: "home_id required for Staff." },
          { status: 400 }
        );
      }
      if (!allowedHomeIds.includes(home_id)) {
        return NextResponse.json({ error: "Home not in your scope." }, { status: 403 });
      }

      if (level === "2_COMPANY") {
        // Clear other memberships within company and any bank row
        await ctx.admin
          .from("home_memberships")
          .delete()
          .in("home_id", allowedHomeIds)
          .eq("user_id", user_id);
        await ctx.admin
          .from("bank_memberships")
          .delete()
          .eq("user_id", user_id)
          .eq("company_id", myCompanyId!);
        // Keep company_memberships row to store DSL; access=false
        await upsertCompanyMembership({
          access: false,
          dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
        });
      } else {
        // Manager: only within my homes (clean within scope)
        await ctx.admin
          .from("home_memberships")
          .delete()
          .in("home_id", allowedHomeIds)
          .eq("user_id", user_id);
        // Managers cannot set DSL
      }

      const { error: insErr } = await ctx.admin
        .from("home_memberships")
        .insert({ user_id, home_id, role: "STAFF" });
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true });
    }

    // MANAGER path
    if (role === "MANAGER") {
      const list = Array.isArray(home_ids) ? home_ids.filter(Boolean) : [];
      if (list.length === 0) {
        return NextResponse.json(
          { error: "Select at least one home." },
          { status: 400 }
        );
      }
      if (list.some((h) => !allowedHomeIds.includes(h))) {
        return NextResponse.json(
          { error: "One or more homes are outside your scope." },
          { status: 403 }
        );
      }

      if (level === "2_COMPANY") {
        // Cannot promote bank → manager directly
        const { data: isBank } = await ctx.admin
          .from("bank_memberships")
          .select("id")
          .eq("user_id", user_id)
          .eq("company_id", myCompanyId!)
          .maybeSingle()
          .returns<BankRow | null>();
        if (isBank) {
          return NextResponse.json(
            { error: "User is bank staff. Assign them to a home as STAFF first." },
            { status: 400 }
          );
        }

        // Replace in-company memberships with manager rows
        await ctx.admin
          .from("home_memberships")
          .delete()
          .in("home_id", allowedHomeIds)
          .eq("user_id", user_id);

        // Keep company_memberships row for DSL; access=false
        await upsertCompanyMembership({
          access: false,
          dsl: typeof is_dsl === "boolean" ? is_dsl : undefined,
        });

        const rows = list.map((hid) => ({
          user_id,
          home_id: hid,
          role: "MANAGER" as const,
        }));
        const { error } = await ctx.admin.from("home_memberships").insert(rows);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      } else {
        // Manager caller: upgrade within my homes (no DSL control)
        await ctx.admin
          .from("home_memberships")
          .update({ role: "MANAGER" })
          .eq("user_id", user_id)
          .in("home_id", list);

        // Insert missing manager rows
        const { data: existing } = await ctx.admin
          .from("home_memberships")
          .select("home_id")
          .eq("user_id", user_id)
          .eq("role", "MANAGER")
          .in("home_id", list)
          .returns<ManagedHomeRow[]>();
        const existingSet = new Set((existing ?? []).map((r) => r.home_id));
        const toInsert = list
          .filter((h) => !existingSet.has(h))
          .map((hid) => ({ user_id, home_id: hid, role: "MANAGER" as const }));
        if (toInsert.length) {
          const { error } = await ctx.admin.from("home_memberships").insert(toInsert);
          if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
        }
      }

      return NextResponse.json({ ok: true });
    }

    // Fallback (shouldn’t hit)
    return NextResponse.json({ error: "Unhandled path." }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    const err = e instanceof Error ? e : new Error("Unexpected error");
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
