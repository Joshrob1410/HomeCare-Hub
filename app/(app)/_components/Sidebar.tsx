// app/(app)/_components/Sidebar.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { getServerSupabase } from "@/supabase/server";

/**
 * Server component - no hooks.
 * Fixed left sidebar on lg+ screens; hidden on mobile (use MobileSidebar for small screens).
 * Role-aware:
 * - Shows "Management" to Admins, Company, and Managers.
 * - Hides removed links: People, Homes, Member Control, Companies & Homes.
 * - Bank-only users hide Budgets & Appointments under "My work".
 */
export default async function Sidebar() {
    const supabase = getServerSupabase();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // Defaults
    type AppLevel = "1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF";
    let level: AppLevel = "4_STAFF";
    let bankOnly = false;

    if (user) {
        // 1) Effective level (via secured SQL function in your schema)
        const { data: lvlData } = await supabase.rpc("get_effective_level");
        const raw: string = typeof lvlData === "string" ? lvlData : "";
        level =
            raw === "1_ADMIN"
                ? "1_ADMIN"
                : raw === "2_COMPANY"
                    ? "2_COMPANY"
                    : raw === "3_MANAGER"
                        ? "3_MANAGER"
                        : "4_STAFF";

        // 2) Bank-only? (has bank_membership but no home_membership)
        const [bank, home] = await Promise.all([
            supabase
                .from("bank_memberships")
                .select("id", { head: false, count: "exact" })
                .eq("user_id", user.id)
                .limit(1),
            supabase
                .from("home_memberships")
                .select("home_id", { head: false, count: "exact" })
                .eq("user_id", user.id)
                .limit(1),
        ]);

        const hasBank = !!(bank.data && bank.data.length > 0);
        const hasHome = !!(home.data && home.data.length > 0);
        bankOnly = hasBank && !hasHome;
    }

    const isAdmin = level === "1_ADMIN";
    const isCompany = level === "2_COMPANY";
    const isManager = level === "3_MANAGER";

    // Visibility rules
    const showManagement = isAdmin || isCompany || isManager; // Admins can now see Management

    // My work rules
    const showBudgets = !bankOnly;
    const showAppointments = !bankOnly;

    return (
        <aside
            className="
        hidden lg:flex flex-col
        fixed left-0 top-14 bottom-0
        w-64
        border-r border-gray-200 bg-white shadow-sm
      "
        >
            <div className="flex-1 overflow-y-auto">
                {/* Brand card */}
                <div className="p-4">
                    <div className="rounded-xl p-3 ring-1 ring-indigo-100 bg-gradient-to-br from-indigo-50 via-violet-50 to-purple-50">
                        <div className="flex items-center gap-3">
                            <span className="h-9 w-9 rounded-xl grid place-items-center font-bold text-white ring-2 ring-white shadow-sm bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600">
                                HC
                            </span>
                            <div>
                                <div className="text-sm font-semibold text-gray-900">Quick links</div>
                                <div className="text-[12px] text-gray-500">Navigate fast</div>
                            </div>
                        </div>

                        {/* Dashboard primary button */}
                        <div className="mt-3">
                            <Link
                                href="/dashboard"
                                className="
                  inline-flex w-full items-center justify-center gap-2
                  rounded-lg px-3 py-2 text-sm font-semibold
                  text-white shadow-sm ring-1 ring-indigo-300/50
                  bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600
                  hover:from-indigo-500 hover:via-violet-500 hover:to-purple-500
                  transition
                "
                            >
                                <IconHome />
                                <span>Dashboard</span>
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="px-4 pb-6 space-y-6 text-[13px]">
                    {/* My work: visible to everyone, with bank restrictions */}
                    <Section title="My work">
                        <Item href="/training" label="Training" icon={<IconBook />} tone="indigo" />
                        <Item href="/bookings" label="Training booking" icon={<IconCalendar />} tone="violet" />
                        <Item href="/rotas" label="Rotas" icon={<IconRota />} tone="fuchsia" />
                        <Item href="/timesheets" label="Timesheets" icon={<IconClock />} tone="cyan" />
                        <Item href="/annual-leave" label="Annual leave" icon={<IconLeave />} tone="rose" />
                        {showBudgets && <Item href="/budgets" label="Budgets" icon={<IconBudget />} tone="emerald" />}
                        <Item href="/supervisions" label="Supervisions" icon={<IconSupervision />} tone="sky" />
                        <Item href="/payslips" label="Payslips" icon={<IconPayslip />} tone="teal" />
                        {showAppointments && (
                            <Item href="/appointments" label="Appointments" icon={<IconAppointment />} tone="amber" />
                        )}
                    </Section>

                    {/* Management (Admins, Company, Managers) */}
                    {showManagement && (
                        <Section title="Management">
                            <Item href="/Management" label="Management" icon={<IconOrg />} tone="indigo" />
                        </Section>
                    )}

                    {/* Removed sections:
              - Team > People
              - Company > Homes
              - Admin > Member Control / Companies & Homes
          */}
                </nav>
            </div>

            {/* Help Centre pinned to bottom */}
            <div className="border-t border-gray-200 p-4">
                <Link
                    href="/help-centre"
                    className="
            group flex items-center gap-3 rounded-lg px-3 py-2
            text-sm font-semibold text-indigo-700
            bg-indigo-50 hover:bg-indigo-100
            ring-1 ring-indigo-200
            transition
          "
                >
                    <IconHelp />
                    <span>Help Centre</span>
                </Link>
            </div>
        </aside>
    );
}

/* --------------------------
   Building blocks
--------------------------- */
function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="px-1 flex items-center gap-2">
                <span className="h-px flex-1 bg-gradient-to-r from-indigo-200 via-violet-200 to-purple-200" />
                <span className="text-xs font-semibold text-gray-600">{title}</span>
                <span className="h-px flex-1 bg-gradient-to-r from-purple-200 via-violet-200 to-indigo-200" />
            </div>
            <ul className="space-y-1">{children}</ul>
        </div>
    );
}

type Tone =
    | "indigo"
    | "violet"
    | "fuchsia"
    | "emerald"
    | "cyan"
    | "amber"
    | "rose"
    | "slate"
    | "teal"
    | "sky";

function Item({
    href,
    label,
    icon,
    tone = "indigo",
}: {
    href: string;
    label: string;
    icon: ReactNode;
    tone?: Tone;
}) {
    const t = getTone(tone);

    return (
        <li>
            <Link
                href={href}
                className={`
          group flex items-center gap-3 rounded-lg px-2 py-2
          text-gray-800 ring-1 ring-transparent transition
          hover:bg-white hover:shadow-sm ${t.rowHoverRing}
          bg-gradient-to-br from-white to-gray-50
        `}
            >
                <span
                    className={`
            h-7 w-7 grid place-items-center rounded-md ring-1
            ${t.chipBg} ${t.chipRing} ${t.chipText}
          `}
                >
                    {icon}
                </span>
                <span className="flex-1 truncate">{label}</span>
            </Link>
        </li>
    );
}

/* --------------------------
   Tone helpers
--------------------------- */
function getTone(tone: Tone) {
    switch (tone) {
        case "indigo":
            return {
                chipBg: "bg-indigo-50",
                chipRing: "ring-indigo-200",
                chipText: "text-indigo-700",
                rowHoverRing: "hover:ring-indigo-100",
            };
        case "violet":
            return {
                chipBg: "bg-violet-50",
                chipRing: "ring-violet-200",
                chipText: "text-violet-700",
                rowHoverRing: "hover:ring-violet-100",
            };
        case "fuchsia":
            return {
                chipBg: "bg-fuchsia-50",
                chipRing: "ring-fuchsia-200",
                chipText: "text-fuchsia-700",
                rowHoverRing: "hover:ring-fuchsia-100",
            };
        case "emerald":
            return {
                chipBg: "bg-emerald-50",
                chipRing: "ring-emerald-200",
                chipText: "text-emerald-700",
                rowHoverRing: "hover:ring-emerald-100",
            };
        case "cyan":
            return {
                chipBg: "bg-cyan-50",
                chipRing: "ring-cyan-200",
                chipText: "text-cyan-700",
                rowHoverRing: "hover:ring-cyan-100",
            };
        case "amber":
            return {
                chipBg: "bg-amber-50",
                chipRing: "ring-amber-200",
                chipText: "text-amber-700",
                rowHoverRing: "hover:ring-amber-100",
            };
        case "rose":
            return {
                chipBg: "bg-rose-50",
                chipRing: "ring-rose-200",
                chipText: "text-rose-700",
                rowHoverRing: "hover:ring-rose-100",
            };
        case "slate":
            return {
                chipBg: "bg-slate-50",
                chipRing: "ring-slate-200",
                chipText: "text-slate-700",
                rowHoverRing: "hover:ring-slate-100",
            };
        case "teal":
            return {
                chipBg: "bg-teal-50",
                chipRing: "ring-teal-200",
                chipText: "text-teal-700",
                rowHoverRing: "hover:ring-teal-100",
            };
        case "sky":
        default:
            return {
                chipBg: "bg-sky-50",
                chipRing: "ring-sky-200",
                chipText: "text-sky-700",
                rowHoverRing: "hover:ring-sky-100",
            };
    }
}

/* --------------------------
   Inline icons
--------------------------- */
function IconHome() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <path d="M3 10.5l9-7 9 7" />
            <path d="M5 10v9h14v-9" />
        </svg>
    );
}
function IconHelp() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16h.01" />
            <path d="M12 12a3 3 0 1 0-3-3" />
        </svg>
    );
}
function IconSupervision() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 8h10M7 12h6M7 16h4" />
            <path d="M4 4l2-2h12l2 2" />
        </svg>
    );
}
function IconPayslip() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <path d="M7 3h10a2 2 0 0 1 2 2v13l-2-1-2 1-2-1-2 1-2-1-2 1V5a2 2 0 0 1 2-2z" />
            <path d="M11 9c0-1.2.8-2 2-2h1" />
            <path d="M10 12h4" />
            <path d="M10 15h6" />
        </svg>
    );
}
function IconBook() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <path d="M6 17V5a2 2 0 0 1 2-2h10v14" />
            <path d="M4 19a2 2 0 0 1 2-2h12" />
            <path d="M8 6h10" />
        </svg>
    );
}
function IconCalendar() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
    );
}
function IconRota() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M7 9h10M7 13h6" />
        </svg>
    );
}
function IconBudget() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <path d="M3 12h18" />
            <path d="M5 9h14a2 2 0 0 1 2 2v6H3v-6a2 2 0 0 1 2-2z" />
            <circle cx="7.5" cy="15" r="1" />
        </svg>
    );
}
function IconClock() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
        </svg>
    );
}
function IconAppointment() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <path d="M4 7h16M7 3v4M17 3v4" />
            <rect x="4" y="7" width="16" height="14" rx="2" />
            <path d="M8 12h4" />
        </svg>
    );
}
function IconLeave() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <path d="M4 7h16M7 3v4M17 3v4" />
            <rect x="4" y="7" width="16" height="14" rx="2" />
            <path d="M8 12h5M14 16h2" />
            <path d="M6 18l3-3" />
        </svg>
    );
}
function IconOrg() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M7 10v4M17 10v4M10 7h4M7 17h10" />
        </svg>
    );
}
