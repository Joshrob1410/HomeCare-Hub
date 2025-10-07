// app/api/admin/people/update/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getRequester } from "@/lib/requester";

/**
 * PATCH body:
 * {
 *   user_id: string,
 *   full_name?: string,
 *   email?: string,
 *   password?: string,
 *
 *   // memberships
 *   set_home?: { home_id: string, clear_bank_for_company?: string },
 *   clear_home?: { home_id: string },
 *   set_bank?: { company_id: string, home_id?: string },
 *
 *   // change position in an existing home membership
 *   // accepts one of: "STAFF" | "TEAM_LEADER" | "DEPUTY_MANAGER" | "MANAGER"
 *   set_home_role?: { home_id: string, role: string },
 *
 *   // admin-only: move user's company (simple upsert)
 *   set_company?: { company_id: string },
 *
 *   // app-level role change (server enforces caps)
 *   // level: "1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF"
 *   set_level?: { level: string }
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const r = await getRequester(req);
    const body = await req.json();

    const {
      user_id,
      full_name,
      email,
      password,
      set_home,
      clear_home,
      set_bank,
      set_home_role,
      set_company,
      set_level,
    } = body ?? {};

    if (!user_id) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    // only Admin / Company / Manager can use this route
    if (!r.isAdmin && !r.canCompany && r.level !== "3_MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const actingOwnAccount = r.user?.id && String(r.user.id) === String(user_id);

    // ─────────────────────────────────────────────────────────────────────────────
    // 1) Profile name (use ADMIN client to bypass RLS) + mirror to Auth metadata
    // ─────────────────────────────────────────────────────────────────────────────
    if (typeof full_name === "string" && full_name.trim()) {
      // profiles.full_name
      const { error: profileErr } = await r.admin
        .from("profiles")
        .update({ full_name: full_name.trim() })
        .eq("user_id", user_id);

      if (profileErr) {
        return NextResponse.json({ error: profileErr.message }, { status: 400 });
      }

      // auth.user_metadata.full_name (helps the Supabase Auth UI reflect the change)
      const { error: metaErr } = await r.admin.auth.admin.updateUserById(user_id, {
        user_metadata: { full_name: full_name.trim() },
      });
      if (metaErr) {
        return NextResponse.json({ error: metaErr.message }, { status: 400 });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2) Email / password (via Admin API). Allowed for admin/company/manager.
    // ─────────────────────────────────────────────────────────────────────────────
    if (email || password) {
      const patch: any = {};
      if (email) patch.email = String(email).trim();
      if (password) patch.password = String(password);
      const { error: updErr } = await r.admin.auth.admin.updateUserById(user_id, patch);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3) Admin-only: change company
    // ─────────────────────────────────────────────────────────────────────────────
    if (set_company?.company_id) {
      if (!r.isAdmin) {
        return NextResponse.json({ error: "Only admins can change company" }, { status: 403 });
      }
      const { error } = await r.admin
        .from("company_memberships")
        .upsert({ user_id, company_id: set_company.company_id }, { onConflict: "user_id,company_id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4) Assign / move to Bank
    // ─────────────────────────────────────────────────────────────────────────────
    if (set_bank?.company_id) {
      if (r.level === "2_COMPANY" && r.companyScope && r.companyScope !== set_bank.company_id) {
        return NextResponse.json({ error: "Cannot assign bank in another company" }, { status: 403 });
      }
      if (set_bank.home_id) {
        await r.admin
          .from("home_memberships")
          .delete()
          .eq("user_id", user_id)
          .eq("home_id", set_bank.home_id);
      }
      const { error } = await r.admin
        .from("bank_memberships")
        .upsert({ user_id, company_id: set_bank.company_id }, { onConflict: "user_id,company_id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5) Clear a specific home membership
    // ─────────────────────────────────────────────────────────────────────────────
    if (clear_home?.home_id) {
      if (r.level === "3_MANAGER" && !r.managedHomeIds.includes(clear_home.home_id)) {
        return NextResponse.json({ error: "Cannot remove from a home you don't manage" }, { status: 403 });
      }
      await r.admin
        .from("home_memberships")
        .delete()
        .eq("user_id", user_id)
        .eq("home_id", clear_home.home_id);
    }

      // 6) Assign to a specific home (move existing STAFF if present; insert otherwise)
      if (set_home?.home_id) {
          const targetHomeId: string = set_home.home_id;

          // Scope checks (use admin client so RLS can't block reads)
          if (r.level === "3_MANAGER" && !r.managedHomeIds.includes(targetHomeId)) {
              return NextResponse.json({ error: "Managers can only assign to their managed homes" }, { status: 403 });
          }
          if (r.level === "2_COMPANY" && r.companyScope) {
              const { data: h, error: homeErr } = await r.admin
                  .from("homes")
                  .select("company_id")
                  .eq("id", targetHomeId)
                  .maybeSingle();
              if (homeErr) return NextResponse.json({ error: homeErr.message }, { status: 400 });
              if (h?.company_id && h.company_id !== r.companyScope) {
                  return NextResponse.json({ error: "Cannot assign to a home in another company" }, { status: 403 });
              }
          }

          // If asked, clear bank membership for that company (move Bank → Home)
          if (set_home.clear_bank_for_company) {
              const { error: delBankErr } = await r.admin
                  .from("bank_memberships")
                  .delete()
                  .eq("user_id", user_id)
                  .eq("company_id", set_home.clear_bank_for_company);
              if (delBankErr) return NextResponse.json({ error: delBankErr.message }, { status: 400 });
          }

          // 6a) If the user already has *any* membership for the target home, do nothing.
          {
              const { data: existingAtTarget, error: exErr } = await r.admin
                  .from("home_memberships")
                  .select("user_id, home_id, role, staff_subrole, manager_subrole")
                  .eq("user_id", user_id)
                  .eq("home_id", targetHomeId)
                  .limit(1);
              if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });

              if (existingAtTarget && existingAtTarget.length) {
                  // Already a member of this home; no need to add/move a STAFF row.
                  // (Position changes, if requested, will be handled in step 7.)
              } else {
                  // 6b) See if they have a STAFF row on some other home → move it here.
                  const { data: staffElsewhere, error: staffErr } = await r.admin
                      .from("home_memberships")
                      .select("home_id")
                      .eq("user_id", user_id)
                      .eq("role", "STAFF")
                      .neq("home_id", targetHomeId)
                      .limit(1);

                  if (staffErr) return NextResponse.json({ error: staffErr.message }, { status: 400 });

                  if (staffElsewhere && staffElsewhere.length) {
                      // Move the existing STAFF membership to the new home.
                      const fromHomeId = staffElsewhere[0].home_id as string;

                      // NOTE: because you likely have a unique (user_id, home_id), make sure there isn't any row at target.
                      // We already checked existingAtTarget above, so this update won't violate that constraint.
                      const { error: moveErr } = await r.admin
                          .from("home_memberships")
                          .update({
                              home_id: targetHomeId,
                              // default subroles for STAFF when moving
                              role: "STAFF",
                              staff_subrole: "RESIDENTIAL",
                              manager_subrole: null,
                          })
                          .eq("user_id", user_id)
                          .eq("home_id", fromHomeId);

                      if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 400 });
                  } else {
                      // 6c) No STAFF row anywhere → create a new STAFF membership at the target home.
                      const { error: insErr } = await r.admin
                          .from("home_memberships")
                          .insert({
                              user_id,
                              home_id: targetHomeId,
                              role: "STAFF",
                              staff_subrole: "RESIDENTIAL",
                              manager_subrole: null,
                          });
                      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
                  }
              }
          }
      }



    // ─────────────────────────────────────────────────────────────────────────────
    // 7) Change position for an existing home membership
    //     UI sends one of:
    //       "STAFF" → STAFF + RESIDENTIAL
    //       "TEAM_LEADER" → STAFF + TEAM_LEADER
    //       "DEPUTY_MANAGER" → MANAGER + DEPUTY_MANAGER
    //       "MANAGER" → MANAGER + MANAGER
    // ─────────────────────────────────────────────────────────────────────────────
    if (set_home_role?.home_id && set_home_role?.role) {
      if (r.level === "3_MANAGER" && !r.managedHomeIds.includes(set_home_role.home_id)) {
        return NextResponse.json({ error: "Managers can only change positions in their homes" }, { status: 403 });
      }
      if (r.level === "2_COMPANY" && r.companyScope) {
        const { data: h } = await r.admin
          .from("homes")
          .select("company_id")
          .eq("id", set_home_role.home_id)
          .maybeSingle();
        if (h?.company_id && h.company_id !== r.companyScope) {
          return NextResponse.json({ error: "Cannot change position in another company" }, { status: 403 });
        }
      }

      const incoming = String(set_home_role.role).toUpperCase();

      type RolePatch = {
        role: "STAFF" | "MANAGER";
        staff_subrole: "RESIDENTIAL" | "TEAM_LEADER" | null;
        manager_subrole: "DEPUTY_MANAGER" | "MANAGER" | null;
      };

      let patch: RolePatch | null = null;
      switch (incoming) {
        case "STAFF":
          patch = { role: "STAFF", staff_subrole: "RESIDENTIAL", manager_subrole: null };
          break;
        case "TEAM_LEADER":
          patch = { role: "STAFF", staff_subrole: "TEAM_LEADER", manager_subrole: null };
          break;
        case "DEPUTY_MANAGER":
          patch = { role: "MANAGER", staff_subrole: null, manager_subrole: "DEPUTY_MANAGER" };
          break;
        case "MANAGER":
          patch = { role: "MANAGER", staff_subrole: null, manager_subrole: "MANAGER" };
          break;
        default:
          return NextResponse.json({ error: "Invalid home role" }, { status: 400 });
      }

      const { error } = await r.admin
        .from("home_memberships")
        .update(patch as any)
        .eq("user_id", user_id)
        .eq("home_id", set_home_role.home_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 8) App-level role change
    // ─────────────────────────────────────────────────────────────────────────────
    if (set_level?.level) {
      if (actingOwnAccount) {
        return NextResponse.json({ error: "You cannot change your own app role" }, { status: 403 });
      }

      const target = String(set_level.level).toUpperCase() as
        | "1_ADMIN"
        | "2_COMPANY"
        | "3_MANAGER"
        | "4_STAFF";

      const RANK: Record<"1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF", number> = {
        "1_ADMIN": 1,
        "2_COMPANY": 2,
        "3_MANAGER": 3,
        "4_STAFF": 4,
      };

      const viewerLevel =
        r.isAdmin ? "1_ADMIN" : r.canCompany ? "2_COMPANY" : r.level === "3_MANAGER" ? "3_MANAGER" : "4_STAFF";
      if (RANK[target] < RANK[viewerLevel]) {
        return NextResponse.json({ error: "You are not allowed to assign that app role" }, { status: 403 });
      }

      async function deriveCompanyIdForUser(): Promise<string | null> {
        const h = await r.admin
          .from("home_memberships")
          .select("home_id, homes!inner(company_id)")
          .eq("user_id", user_id)
          .limit(1);
        const viaHome = (h.data as any[])?.[0]?.homes?.company_id as string | undefined;
        if (viaHome) return viaHome;

        const b = await r.admin
          .from("bank_memberships")
          .select("company_id")
          .eq("user_id", user_id)
          .limit(1);
        const viaBank = (b.data as any[])?.[0]?.company_id as string | undefined;
        if (viaBank) return viaBank;

        const cm = await r.admin
          .from("company_memberships")
          .select("company_id")
          .eq("user_id", user_id)
          .limit(1);
        const viaCM = (cm.data as any[])?.[0]?.company_id as string | undefined;
        if (viaCM) return viaCM;

        if (r.companyScope) return r.companyScope;
        return null;
      }

      switch (target) {
        case "1_ADMIN": {
          if (!r.isAdmin) {
            return NextResponse.json({ error: "Only admins can assign Admin role" }, { status: 403 });
          }
          const { error } = await r.admin
            .from("profiles")
            .update({ is_admin: true })
            .eq("user_id", user_id);
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          break;
        }
        case "2_COMPANY": {
          const { error: pe } = await r.admin
            .from("profiles")
            .update({ is_admin: false })
            .eq("user_id", user_id);
          if (pe) return NextResponse.json({ error: pe.message }, { status: 400 });

          const cid = await deriveCompanyIdForUser();
          if (!cid) {
            return NextResponse.json({ error: "Cannot determine company to grant access" }, { status: 400 });
          }
          if (r.canCompany && r.companyScope && r.companyScope !== cid) {
            return NextResponse.json({ error: "Cannot grant company access in another company" }, { status: 403 });
          }

          const { error: ce } = await r.admin
            .from("company_memberships")
            .upsert(
              { user_id, company_id: cid, has_company_access: true },
              { onConflict: "user_id,company_id" }
            );
          if (ce) return NextResponse.json({ error: ce.message }, { status: 400 });
          break;
        }
        case "3_MANAGER": {
          const { error } = await r.admin
            .from("profiles")
            .update({ is_admin: false })
            .eq("user_id", user_id);
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });
          break;
        }
        case "4_STAFF": {
          const { error: pe } = await r.admin
            .from("profiles")
            .update({ is_admin: false })
            .eq("user_id", user_id);
          if (pe) return NextResponse.json({ error: pe.message }, { status: 400 });

          if (r.isAdmin) {
            await r.admin
              .from("company_memberships")
              .update({ has_company_access: false })
              .eq("user_id", user_id);
          } else if (r.canCompany && r.companyScope) {
            await r.admin
              .from("company_memberships")
              .update({ has_company_access: false })
              .eq("user_id", user_id)
              .eq("company_id", r.companyScope);
          }
          break;
        }
        default:
          return NextResponse.json({ error: "Invalid app level" }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
