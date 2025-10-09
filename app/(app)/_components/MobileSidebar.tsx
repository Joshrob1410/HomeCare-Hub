// app/(app)/_components/MobileSidebar.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import { supabase } from "@/supabase/client";
import { getEffectiveLevel, type AppLevel } from "@/supabase/roles";

/**
 * Mobile off-canvas sidebar (portal) - role-aware
 * - Uses Supabase client to get effective level + bank-only on mount
 * - Hides privileged sections until computed (no flash)
 * - Opens under the sticky header (top-14)
 * - Locks body scroll while open
 * - Closes on route change, ESC, backdrop click, or link click
 *
 * Changes:
 * - Removed links: People, Homes, Member Control, Companies & Homes.
 * - Added "Management" section visible to Admins, Company, and Managers.
 */
export default function MobileSidebar() {
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const pathname = usePathname();

    // Role & visibility state
    const [computed, setComputed] = useState(false);
    const [level, setLevel] = useState<AppLevel>("4_STAFF");
    const [bankOnly, setBankOnly] = useState(false);

    useEffect(() => setMounted(true), []);

    // Resolve effective level + bankOnly
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data: u } = await supabase.auth.getUser();
                const me = u.user?.id;
                if (!me) {
                    if (alive) setComputed(true);
                    return;
                }

                // Effective level via shared helper
                let lvl: AppLevel = "4_STAFF";
                try {
                    lvl = await getEffectiveLevel();
                } catch { }
                if (alive) setLevel(lvl);

                // bankOnly: has bank_membership, no home_membership
                const [bank, home] = await Promise.all([
                    supabase
                        .from("bank_memberships")
                        .select("id", { head: false, count: "exact" })
                        .eq("user_id", me)
                        .limit(1),
                    supabase
                        .from("home_memberships")
                        .select("home_id", { head: false, count: "exact" })
                        .eq("user_id", me)
                        .limit(1),
                ]);

                const hasBank = !!(bank.data && bank.data.length > 0);
                const hasHome = !!(home.data && home.data.length > 0);
                if (alive) setBankOnly(hasBank && !hasHome);
            } finally {
                if (alive) setComputed(true);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    // Close on route change
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    // ESC to close
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false);
        }
        if (open) window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    // Lock body scroll when open
    useEffect(() => {
        if (!mounted) return;
        const prev = document.body.style.overflow;
        if (open) document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open, mounted]);

    // Role flags
    const isAdmin = level === "1_ADMIN";
    const isCompany = level === "2_COMPANY";
    const isManager = level === "3_MANAGER";

    // Section visibility
    const showManagement = computed && (isAdmin || isCompany || isManager); // Admins can see Management

    // My work (always visible), but hide these for bank-only
    const showBudgets = computed && !bankOnly;
    const showAppointments = computed && !bankOnly;

    return (
        <>
            {/* Trigger in header */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md ring-1 ring-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                aria-label="Open menu"
            >
                <IconMenu />
            </button>

            {/* Portal layer */}
            {mounted &&
                createPortal(
                    <>
                        {/* Backdrop (starts below header, above page) */}
                        {open && (
                            <div
                                className="fixed inset-0 top-14 z-[60] bg-black/40 backdrop-blur-[1px]"
                                onClick={() => setOpen(false)}
                                aria-hidden
                            />
                        )}

                        {/* Drawer below the header */}
                        <aside
                            className={`
                fixed top-14 bottom-0 left-0 z-[61] w-72 max-w-[85vw]
                bg-gray-50 ring-1 ring-gray-200 shadow-xl
                transform transition-transform duration-200
                ${open ? "translate-x-0" : "-translate-x-full"}
                lg:hidden
              `}
                            role="dialog"
                            aria-modal="true"
                        >
                            <div className="h-full flex flex-col overflow-y-auto">
                                {/* Brand + Close */}
                                <div className="px-4 py-3 border-b border-gray-200 bg-white text-gray-900">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="h-8 w-8 rounded-xl grid place-items-center font-bold text-white shadow-sm ring-2 ring-white bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600">
                                                HC
                                            </span>
                                            <span className="font-semibold text-gray-900 text-sm">HomeCare Hub</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setOpen(false)}
                                            className="
    inline-flex h-8 w-8 items-center justify-center rounded-md
    bg-white ring-1 ring-gray-300 hover:bg-gray-100
    text-gray-900                          /* force strong icon color on mobile */
  "
                                            aria-label="Close menu"
                                            style={{ WebkitTapHighlightColor: 'transparent' }}
                                        >
                                            <IconClose />
                                        </button>
                                    </div>

                                    {/* Dashboard CTA */}
                                    <div className="mt-3">
                                        <Link
                                            href="/dashboard"
                                            onClick={() => setOpen(false)}
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

                                {/* Nav */}
                                <nav className="flex-1 p-4 space-y-6 text-[13px]">
                                    <Section title="My work">
                                        <Item
                                            href="/training"
                                            label="Training"
                                            icon={<IconBook />}
                                            tone="indigo"
                                            onClick={() => setOpen(false)}
                                        />
                                        <Item
                                            href="/bookings"
                                            label="Training booking"
                                            icon={<IconCalendar />}
                                            tone="violet"
                                            onClick={() => setOpen(false)}
                                        />
                                        <Item
                                            href="/rotas"
                                            label="Rotas"
                                            icon={<IconRota />}
                                            tone="fuchsia"
                                            onClick={() => setOpen(false)}
                                        />
                                        <Item
                                            href="/timesheets"
                                            label="Timesheets"
                                            icon={<IconClock />}
                                            tone="cyan"
                                            onClick={() => setOpen(false)}
                                        />
                                        <Item
                                            href="/annual-leave"
                                            label="Annual leave"
                                            icon={<IconLeave />}
                                            tone="rose"
                                            onClick={() => setOpen(false)}
                                        />
                                        {showBudgets && (
                                            <Item
                                                href="/budgets"
                                                label="Budgets"
                                                icon={<IconBudget />}
                                                tone="emerald"
                                                onClick={() => setOpen(false)}
                                            />
                                        )}
                                        <Item
                                            href="/supervisions"
                                            label="Supervisions"
                                            icon={<IconSupervision />}
                                            tone="sky"
                                            onClick={() => setOpen(false)}
                                        />
                                        <Item
                                            href="/payslips"
                                            label="Payslips"
                                            icon={<IconPayslip />}
                                            tone="teal"
                                            onClick={() => setOpen(false)}
                                        />
                                        {showAppointments && (
                                            <Item
                                                href="/appointments"
                                                label="Appointments"
                                                icon={<IconAppointment />}
                                                tone="amber"
                                                onClick={() => setOpen(false)}
                                            />
                                        )}
                                    </Section>

                                    {/* Management (Admins, Company, Managers) */}
                                    {showManagement && (
                                        <Section title="Management">
                                            <Item
                                                href="/Management"
                                                label="Management"
                                                icon={<IconOrg />}
                                                tone="indigo"
                                                onClick={() => setOpen(false)}
                                            />
                                        </Section>
                                    )}

                                    {/* Removed sections:
                      - Team > People
                      - Company > Homes
                      - Admin > Member Control / Companies & Homes
                  */}
                                </nav>

                                {/* Help Centre bottom */}
                                <div className="border-t border-gray-200 p-4 bg-white">
                                    <Link
                                        href="/help-centre"
                                        onClick={() => setOpen(false)}
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
                            </div>
                        </aside>
                    </>,
                    document.body
                )}
        </>
    );
}

/* ---------- Building blocks ---------- */
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
    onClick,
}: {
    href: string;
    label: string;
        icon: ReactNode;
    tone?: Tone;
    onClick?: () => void;
}) {
    const t = getTone(tone);
    return (
        <li>
            <Link
                href={href}
                onClick={onClick}
                className={`
          group flex items-center gap-3 rounded-lg px-2 py-2
          text-gray-800 ring-1 ring-transparent transition
          hover:bg-white hover:shadow-sm ${t.rowHoverRing}
          bg-gradient-to-br from-white to-gray-50
        `}
            >
                <span className={`h-7 w-7 grid place-items-center rounded-md ring-1 ${t.chipBg} ${t.chipRing} ${t.chipText}`}>
                    {icon}
                </span>
                <span className="flex-1 truncate">{label}</span>
            </Link>
        </li>
    );
}

function getTone(tone: Tone) {
    switch (tone) {
        case "indigo":
            return { chipBg: "bg-indigo-50", chipRing: "ring-indigo-200", chipText: "text-indigo-700", rowHoverRing: "hover:ring-indigo-100" };
        case "violet":
            return { chipBg: "bg-violet-50", chipRing: "ring-violet-200", chipText: "text-violet-700", rowHoverRing: "hover:ring-violet-100" };
        case "fuchsia":
            return { chipBg: "bg-fuchsia-50", chipRing: "ring-fuchsia-200", chipText: "text-fuchsia-700", rowHoverRing: "hover:ring-fuchsia-100" };
        case "emerald":
            return { chipBg: "bg-emerald-50", chipRing: "ring-emerald-200", chipText: "text-emerald-700", rowHoverRing: "hover:ring-emerald-100" };
        case "cyan":
            return { chipBg: "bg-cyan-50", chipRing: "ring-cyan-200", chipText: "text-cyan-700", rowHoverRing: "hover:ring-cyan-100" };
        case "amber":
            return { chipBg: "bg-amber-50", chipRing: "ring-amber-200", chipText: "text-amber-700", rowHoverRing: "hover:ring-amber-100" };
        case "rose":
            return { chipBg: "bg-rose-50", chipRing: "ring-rose-200", chipText: "text-rose-700", rowHoverRing: "hover:ring-rose-100" };
        case "slate":
            return { chipBg: "bg-slate-50", chipRing: "ring-slate-200", chipText: "text-slate-700", rowHoverRing: "hover:ring-slate-100" };
        case "teal":
            return { chipBg: "bg-teal-50", chipRing: "ring-teal-200", chipText: "text-teal-700", rowHoverRing: "hover:ring-teal-100" };
        case "sky":
        default:
            return { chipBg: "bg-sky-50", chipRing: "ring-sky-200", chipText: "text-sky-700", rowHoverRing: "hover:ring-sky-100" };
    }
}

/* ---------- Icons ---------- */
function IconMenu() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
    );
}
function IconClose() {
    return (
        <svg
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.25"  /* slightly bolder */
            aria-hidden="true"
        >
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    );
}
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
            <path d="M4 19a 2 2 0 0 1 2-2h12" />
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
