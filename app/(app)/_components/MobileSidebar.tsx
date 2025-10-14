"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import { supabase } from "@/supabase/client";
import { getEffectiveLevel, type AppLevel } from "@/supabase/roles";

// ---- Theme tokens (match layout/Sidebar) ----
const ORBIT = {
  panelBg:
    "linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)",
  ring: "rgba(148,163,184,0.16)",
  ringStrong: "rgba(148,163,184,0.20)",
  ink: "#E5E7EB",
  sub: "#94A3B8",
  ctaGrad: "linear-gradient(90deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)",
  rowBg: "bg-white/[0.02]",
  rowBgHover: "hover:bg-white/[0.05]",
  textBase: "text-slate-200",
  textStrong: "text-slate-100",
} as const;

const LIGHT = {
  panelBg: "linear-gradient(180deg, #FBFCFE 0%, #F8FAFD 60%, #F6F8FC 100%)",
  ring: "rgba(15,23,42,0.10)",
  ringStrong: "rgba(15,23,42,0.12)",
  ink: "#0F172A",
  sub: "#475569",
  ctaGrad: "linear-gradient(90deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)",
  rowBg: "bg-white",
  rowBgHover: "hover:bg-slate-50",
  textBase: "text-slate-800",
  textStrong: "text-slate-900",
} as const;

function readOrbitCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === "orbit=1");
}

/**
 * Mobile off-canvas sidebar (portal) — theme-aware (account-pref via prop, cookie thereafter)
 * - Role-aware (same visibility logic)
 * - No flashing of privileged sections before role loads
 */
export default function MobileSidebar({ orbitInitial = false }: { orbitInitial?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // Theme (start from server-provided initial; keep in sync with cookie on focus/visibility)
  const [orbit, setOrbit] = useState<boolean>(orbitInitial);
  const T = orbit ? ORBIT : LIGHT;

  // Role & visibility state
  const [computed, setComputed] = useState(false);
  const [level, setLevel] = useState<AppLevel>("4_STAFF");
  const [bankOnly, setBankOnly] = useState(false);

  useEffect(() => {
    setMounted(true);
    // refresh from cookie on mount in case user toggled in a different tab
    setOrbit(readOrbitCookie());

    const onFocus = () => setOrbit(readOrbitCookie());
    const onVis = () => {
      if (document.visibilityState === "visible") setOrbit(readOrbitCookie());
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

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

        let lvl: AppLevel = "4_STAFF";
        try {
          lvl = await getEffectiveLevel();
        } catch {
          // ignore
        }
        if (alive) setLevel(lvl);

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
  const showManagement = computed && (isAdmin || isCompany || isManager);

  // My work (always visible), but hide these for bank-only
  const showBudgets = computed && !bankOnly;
  const showAppointments = computed && !bankOnly;

  return (
    <>
      {/* Trigger lives in header; neutral so it works for light/dark */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md ring-1 ${
          orbit ? "ring-indigo-200/60 bg-white text-slate-700 hover:bg-slate-50" : "ring-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
        aria-label="Open menu"
      >
        <IconMenu />
      </button>

      {/* Portal layer */}
      {mounted &&
        createPortal(
          <>
            {/* Backdrop (starts below header) */}
            {open && (
              <div
                className="fixed inset-0 top-14 z-[60] bg-black/50 backdrop-blur-[2px]"
                onClick={() => setOpen(false)}
                aria-hidden
              />
            )}

            {/* Drawer */}
            <aside
              className={`fixed top-14 bottom-0 left-0 z-[61] w-72 max-w-[85vw] transform transition-transform duration-200 lg:hidden
                ${open ? "translate-x-0" : "-translate-x-full"}
                shadow-2xl ring-1
              `}
              style={{
                background: T.panelBg,
                borderColor: T.ring,
                color: T.ink,
              }}
              role="dialog"
              aria-modal="true"
            >
              <div className="h-full flex flex-col overflow-y-auto">
                {/* Brand + Close */}
                <div
                  className="px-4 py-3 border-b flex items-center justify-between"
                  style={{ borderColor: T.ring }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-8 w-8 rounded-xl grid place-items-center font-bold text-white ring-2 ring-white/80 shadow-sm"
                      style={{
                        backgroundImage:
                          "linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)",
                      }}
                    >
                      HO
                    </span>
                    <span className={`font-semibold text-sm ${orbit ? "text-slate-100" : "text-slate-900"}`}>
                      HomeOrbit
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md ring-1 hover:bg-white/10 ${
                      orbit ? "bg-white/5 ring-white/10 text-slate-100" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                    }`}
                    aria-label="Close menu"
                    style={{ WebkitTapHighlightColor: "transparent" }}
                  >
                    <IconClose />
                  </button>
                </div>

                {/* Dashboard CTA */}
                <div className="px-4 pt-3">
                  <Link
                    href="/dashboard"
                    onClick={() => setOpen(false)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm ring-1 transition"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)",
                      borderColor: orbit ? "rgba(99,102,241,0.30)" : "rgba(99,102,241,0.35)",
                    }}
                  >
                    <IconHome />
                    <span>Dashboard</span>
                  </Link>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-4 space-y-6 text-[13px]">
                  <Section title="My work" orbit={orbit}>
                    <Item href="/training" label="Training" icon={<IconBook />} tone="indigo" onClick={() => setOpen(false)} orbit={orbit} />
                    <Item href="/bookings" label="Training booking" icon={<IconCalendar />} tone="violet" onClick={() => setOpen(false)} orbit={orbit} />
                    <Item href="/rotas" label="Rotas" icon={<IconRota />} tone="fuchsia" onClick={() => setOpen(false)} orbit={orbit} />
                    <Item href="/timesheets" label="Timesheets" icon={<IconClock />} tone="cyan" onClick={() => setOpen(false)} orbit={orbit} />
                    <Item href="/annual-leave" label="Annual leave" icon={<IconLeave />} tone="rose" onClick={() => setOpen(false)} orbit={orbit} />
                    {showBudgets && (
                      <Item href="/budgets" label="Budgets" icon={<IconBudget />} tone="emerald" onClick={() => setOpen(false)} orbit={orbit} />
                    )}
                    <Item href="/supervisions" label="Supervisions" icon={<IconSupervision />} tone="sky" onClick={() => setOpen(false)} orbit={orbit} />
                    <Item href="/payslips" label="Payslips" icon={<IconPayslip />} tone="teal" onClick={() => setOpen(false)} orbit={orbit} />
                    {showAppointments && (
                      <Item href="/appointments" label="Appointments" icon={<IconAppointment />} tone="amber" onClick={() => setOpen(false)} orbit={orbit} />
                    )}
                    <Item href="/policies" label="Policies" icon={<IconPolicy />} tone="slate" onClick={() => setOpen(false)} orbit={orbit} />
                  </Section>

                  {showManagement && (
                    <Section title="Management" orbit={orbit}>
                      <Item href="/Management" label="Management" icon={<IconOrg />} tone="indigo" onClick={() => setOpen(false)} orbit={orbit} />
                    </Section>
                  )}
                </nav>

                {/* Help Centre bottom */}
                <div className="p-4 border-t" style={{ borderColor: T.ring }}>
                  <Link
                    href="/help-centre"
                    onClick={() => setOpen(false)}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold ring-1 transition"
                    style={{
                      background: orbit
                        ? "linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(99,102,241,0.10) 50%, rgba(59,130,246,0.10) 100%)"
                        : "linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(99,102,241,0.05) 50%, rgba(59,130,246,0.05) 100%)",
                      borderColor: T.ringStrong,
                      color: T.ink,
                    }}
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
function Section({ title, children, orbit }: { title: string; children: ReactNode; orbit: boolean }) {
  return (
    <div className="space-y-2">
      <div className="px-1 flex items-center gap-2">
        <span
          className={`h-px flex-1 bg-gradient-to-r ${
            orbit ? "from-indigo-500/20 via-violet-500/20 to-blue-500/20" : "from-indigo-200 via-violet-200 to-blue-200"
          }`}
        />
        <span className={`text-xs font-semibold ${orbit ? "text-slate-300" : "text-slate-600"}`}>{title}</span>
        <span
          className={`h-px flex-1 bg-gradient-to-r ${
            orbit ? "from-blue-500/20 via-violet-500/20 to-indigo-500/20" : "from-blue-200 via-violet-200 to-indigo-200"
          }`}
        />
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
  orbit,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  orbit: boolean;
}) {
  const t = getTone(tone, orbit);
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className={`group flex items-center gap-3 rounded-lg px-2 py-2 ring-1 ring-transparent transition ${
          orbit ? "text-slate-200 bg-white/[0.02] hover:bg-white/[0.05]" : "text-slate-800 bg-white hover:bg-slate-50"
        } ${t.rowHoverRing}`}
      >
        <span className={`h-7 w-7 grid place-items-center rounded-md ring-1 ${t.chipBg} ${t.chipRing} ${t.chipText}`}>{icon}</span>
        <span className="flex-1 truncate">{label}</span>
      </Link>
    </li>
  );
}

function getTone(tone: Tone, orbit: boolean) {
  if (orbit) {
    switch (tone) {
      case "indigo":
        return { chipBg: "bg-indigo-500/10", chipRing: "ring-indigo-400/20", chipText: "text-indigo-300", rowHoverRing: "hover:ring-indigo-400/20" };
      case "violet":
        return { chipBg: "bg-violet-500/10", chipRing: "ring-violet-400/20", chipText: "text-violet-300", rowHoverRing: "hover:ring-violet-400/20" };
      case "fuchsia":
        return { chipBg: "bg-fuchsia-500/10", chipRing: "ring-fuchsia-400/20", chipText: "text-fuchsia-300", rowHoverRing: "hover:ring-fuchsia-400/20" };
      case "emerald":
        return { chipBg: "bg-emerald-500/10", chipRing: "ring-emerald-400/20", chipText: "text-emerald-300", rowHoverRing: "hover:ring-emerald-400/20" };
      case "cyan":
        return { chipBg: "bg-cyan-500/10", chipRing: "ring-cyan-400/20", chipText: "text-cyan-300", rowHoverRing: "hover:ring-cyan-400/20" };
      case "amber":
        return { chipBg: "bg-amber-500/10", chipRing: "ring-amber-400/20", chipText: "text-amber-300", rowHoverRing: "hover:ring-amber-400/20" };
      case "rose":
        return { chipBg: "bg-rose-500/10", chipRing: "ring-rose-400/20", chipText: "text-rose-300", rowHoverRing: "hover:ring-rose-400/20" };
      case "slate":
        return { chipBg: "bg-slate-500/10", chipRing: "ring-slate-400/20", chipText: "text-slate-300", rowHoverRing: "hover:ring-slate-400/20" };
      case "teal":
        return { chipBg: "bg-teal-500/10", chipRing: "ring-teal-400/20", chipText: "text-teal-300", rowHoverRing: "hover:ring-teal-400/20" };
      case "sky":
      default:
        return { chipBg: "bg-sky-500/10", chipRing: "ring-sky-400/20", chipText: "text-sky-300", rowHoverRing: "hover:ring-sky-400/20" };
    }
  }
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} aria-hidden>
      <path d="M3 10.5l9-7 9 7" />
      <path d="M5 10v9h14v-9" />
    </svg>
  );
}
function IconHelp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16h.01" />
      <path d="M12 12a3 3 0 1 0-3-3" />
    </svg>
  );
}
function IconSupervision() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h6M7 16h4" />
      <path d="M4 4l2-2h12l2 2" />
    </svg>
  );
}
function IconPayslip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} aria-hidden>
      <path d="M7 3h10a2 2 0 0 1 2 2v13l-2-1-2 1-2-1-2 1-2-1-2 1V5a2 2 0 0 1 2-2z" />
      <path d="M11 9c0-1.2.8-2 2-2h1" />
      <path d="M10 12h4" />
      <path d="M10 15h6" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <path d="M6 17V5a2 2 0 0 1 2-2h10v14" />
      <path d="M4 19a2 2 0 0 1 2-2h12" />
      <path d="M8 6h10" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconRota() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9h10M7 13h6" />
    </svg>
  );
}
function IconBudget() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <path d="M3 12h18" />
      <path d="M5 9h14a2 2 0 0 1 2 2v6H3v-6a2 2 0 0 1 2-2z" />
      <circle cx="7.5" cy="15" r="1" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function IconAppointment() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <path d="M4 7h16M7 3v4M17 3v4" />
      <rect x="4" y="7" width="16" height="14" rx="2" />
      <path d="M8 12h4" />
    </svg>
  );
}
function IconLeave() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <path d="M4 7h16M7 3v4M17 3v4" />
      <rect x="4" y="7" width="16" height="14" rx="2" />
      <path d="M8 12h5M14 16h2" />
      <path d="M6 18l3-3" />
    </svg>
  );
}
function IconOrg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M7 10v4M17 10v4M10 7h4M7 17h10" />
    </svg>
  );
}
function IconPolicy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} aria-hidden>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 12h6M10 16h6M10 8h2" />
    </svg>
  );
}
