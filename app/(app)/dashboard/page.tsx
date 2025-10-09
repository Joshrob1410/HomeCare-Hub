'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

type View =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'ready'; level: AppLevel; bankOnly: boolean };

export default function DashboardPage() {
    const router = useRouter();
    const [view, setView] = useState<View>({ status: 'loading' });

    // Prevent flash-of-unstyled by fading content in after hydration
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => { setHydrated(true); }, []);


    useEffect(() => {
        let mounted = true;

        const load = async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;
            if (!session) { if (mounted) setView({ status: 'signed_out' }); return; }

            try {
                const lvl = await getEffectiveLevel();
                const uid = session.user.id;

                const { data: bankRows, error: bankErr } = await supabase
                    .from('bank_memberships')
                    .select('id', { count: 'exact', head: false })
                    .eq('user_id', uid)
                    .limit(1);
                if (bankErr) throw bankErr;

                const { data: homeRows, error: homeErr } = await supabase
                    .from('home_memberships')
                    .select('home_id', { count: 'exact', head: false })
                    .eq('user_id', uid)
                    .limit(1);
                if (homeErr) throw homeErr;

                const hasBank = !!(bankRows && bankRows.length > 0);
                const hasHome = !!(homeRows && homeRows.length > 0);
                const bankOnly = hasBank && !hasHome;

                mounted && setView({ status: 'ready', level: lvl, bankOnly });
            } catch {
                mounted && setView({ status: 'ready', level: '4_STAFF', bankOnly: false });
            }
        };

        load();
        const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
            if (!session) setView({ status: 'signed_out' }); else load();
        });
        const onFocus = () => load();
        const onVis = () => document.visibilityState === 'visible' && load();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVis);

        return () => {
            mounted = false;
            try { sub?.subscription?.unsubscribe(); } catch { }
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    useEffect(() => {
        if (view.status === 'signed_out') router.replace('/auth/login');
    }, [view.status, router]);

    if (view.status === 'loading') {
        return (
            <div className={`p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 bg-gray-50 min-h-screen transition-opacity duration-150 ${hydrated ? 'opacity-100' : 'opacity-0'}`}>
                <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        );
    }
    if (view.status === 'signed_out') return null;
    return (
        <div className={`p-5 space-y-5 bg-gray-50 min-h-screen transition-opacity duration-150 ${hydrated ? 'opacity-100' : 'opacity-0'}`}>
            {/* Page header */}
            <header className="flex items-end justify-between">
                <div>
                    <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight text-gray-900">Dashboard</h1>
                    <p className="text-[13px] text-gray-600">Everything you need at a glance.</p>
                </div>
            </header>

            {/* At-a-glance */}
            <div className="space-y-5">
                <WeekStrip />
                <TasksPanel />
            </div>
        </div>
    );
}

/* =========
   Sections
   ========= */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2">
            <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                <div className="h-px flex-1 bg-gray-200" />
            </div>
            {children}
        </section>
    );
}

function TileGrid({ children }: { children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {children}
        </div>
    );
}

/* =========================
   Tile
   ========================= */
function Tile({
    href, title, desc, icon, palette,
}: {
    href: string;
    title: string;
    desc: string;
    icon: React.ReactNode;
    palette: 'indigo' | 'violet' | 'fuchsia' | 'emerald' | 'cyan' | 'amber' | 'rose' | 'slate';
}) {
    const tone = {
        indigo: { chipBg: 'bg-indigo-50', chipRing: 'ring-indigo-200', chipText: 'text-indigo-700' },
        violet: { chipBg: 'bg-violet-50', chipRing: 'ring-violet-200', chipText: 'text-violet-700' },
        fuchsia: { chipBg: 'bg-fuchsia-50', chipRing: 'ring-fuchsia-200', chipText: 'text-fuchsia-700' },
        emerald: { chipBg: 'bg-emerald-50', chipRing: 'ring-emerald-200', chipText: 'text-emerald-700' },
        cyan: { chipBg: 'bg-cyan-50', chipRing: 'ring-cyan-200', chipText: 'text-cyan-700' },
        amber: { chipBg: 'bg-amber-50', chipRing: 'ring-amber-200', chipText: 'text-amber-700' },
        rose: { chipBg: 'bg-rose-50', chipRing: 'ring-rose-200', chipText: 'text-rose-700' },
        slate: { chipBg: 'bg-slate-50', chipRing: 'ring-slate-200', chipText: 'text-slate-700' },
    }[palette];

    return (
        <Link
            href={href}
            className="group relative block rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500"
        >
            <div className="relative rounded-xl bg-white border border-gray-300 shadow-sm transition duration-150 group-hover:shadow-md group-hover:-translate-y-0.5">
                <div className="p-3">
                    <div className="flex items-start gap-3">
                        <span className={`h-9 w-9 rounded-lg grid place-items-center ring-1 ${tone.chipBg} ${tone.chipRing}`}>
                            <span className={`${tone.chipText}`}>{icon}</span>
                        </span>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold leading-tight text-gray-900">{title}</h3>
                            <p className="mt-0.5 text-[13px]/5 text-gray-600">{desc}</p>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" className="ml-1 mt-0.5 text-gray-400 group-hover:text-gray-500 transition shrink-0">
                            <path d="M9 6l6 6-6 6" fill="currentColor" />
                        </svg>
                    </div>
                </div>
            </div>
        </Link>
    );
}

/* =========================
   Skeleton
   ========================= */
function SkeletonCard() {
    return (
        <div className="rounded-xl border border-gray-300 bg-white shadow-sm h-[96px]">
            <div className="p-3 flex items-start gap-3 h-full">
                <div className="h-9 w-9 rounded-lg bg-gray-100 animate-pulse" />
                <div className="flex-1 space-y-2 self-center">
                    <div className="h-4 bg-gray-100 rounded w-3/5 animate-pulse" />
                    <div className="h-3 bg-gray-100 rounded w-2/5 animate-pulse" />
                </div>
            </div>
        </div>
    );
}


/* =========================
   Minimal inline icons
   ========================= */
function IconBook() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><path d="M6 17V5a2 2 0 0 1 2-2h10v14" /><path d="M4 19a2 2 0 0 1 2-2h12" /><path d="M8 6h10" /></svg>); }
function IconCalendar() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>); }
function IconRota() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h6" /></svg>); }
function IconBudget() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><path d="M3 12h18" /><path d="M5 9h14a2 2 0 0 1 2 2v6H3v-6a2 2 0 0 1 2-2z" /><circle cx="7.5" cy="15" r="1" /></svg>); }
function IconClock() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>); }
function IconAppointment() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><path d="M4 7h16M7 3v4M17 3v4" /><rect x="4" y="7" width="16" height="14" rx="2" /><path d="M8 12h4" /></svg>); }
function IconLeave() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><path d="M4 7h16M7 3v4M17 3v4" /><rect x="4" y="7" width="16" height="14" rx="2" /><path d="M8 12h5M14 16h2" /><path d="M6 18l3-3" /></svg>); }
function IconUsers() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><circle cx="9" cy="7" r="3" /><path d="M2 21v-1a6 6 0 0 1 6-6h2" /><circle cx="17" cy="11" r="3" /><path d="M22 21v-1a6 6 0 0 0-6-6h-1" /></svg>); }
function IconOrg() { return (<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M7 10v4M17 10v4M10 7h4M7 17h10" /></svg>); }

/* =========================
   WEEK STRIP (Mon→Sun)
   ========================= */
function WeekStrip() {
    const [items, setItems] = useState<
        { date: string; label: string; dd: number; isToday: boolean; hasShift: boolean }[]
    >([]);

    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;
            if (!me) return;

            const now = new Date();
            const monIdx = (now.getDay() + 6) % 7; // Monday=0
            const monday = new Date(now);
            monday.setHours(0, 0, 0, 0);
            monday.setDate(now.getDate() - monIdx);

            const weekDates = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                d.setHours(0, 0, 0, 0);
                return d;
            });

            const localISO = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
            };
            const monthFirstISO = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                return `${y}-${m}-01`;
            };

            const todayIso = localISO(now);
            const dayNos = weekDates.map(d => d.getDate());
            const monthFirsts = Array.from(new Set(weekDates.map(monthFirstISO)));

            // 1) Get LIVE rotas for the months in this week — include month_date
            // 1) Get LIVE rotas for the months in this week — include month_date
            const ro = await supabase
                .from('rotas')
                .select('id, month_date')
                .in('month_date', monthFirsts)
                .eq('status', 'LIVE');

            type RotaRow = { id: string; month_date: string };

            const rotaRows: RotaRow[] = ro.error ? [] : ((ro.data ?? []) as RotaRow[]);
            const rotaIds: string[] = rotaRows.map((r) => r.id);
            const rotaMonthById = new Map<string, string>();
            rotaRows.forEach((r) => rotaMonthById.set(r.id, r.month_date));

            // 2) My entries for those rotas + day numbers — include rota_id
            const hasByMonthDay = new Set<string>(); // key: `${month_date}:${day}`
            if (rotaIds.length) {
                const re = await supabase
                    .from('rota_entries')
                    .select('rota_id, day_of_month')
                    .in('rota_id', rotaIds)
                    .eq('user_id', me)
                    .in('day_of_month', dayNos);

                type RotaEntryLite = { rota_id: string; day_of_month: number };

                if (!re.error && Array.isArray(re.data)) {
                    const entries = re.data as RotaEntryLite[];
                    for (const r of entries) {
                        const m = rotaMonthById.get(r.rota_id);
                        if (m) hasByMonthDay.add(`${m}:${r.day_of_month}`);
                    }
                }
            }

            setItems(weekDates.map(d => {
                const monthKey = monthFirstISO(d);
                return {
                    date: localISO(d),
                    label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d),
                    dd: d.getDate(),
                    isToday: localISO(d) === todayIso,
                    // ✅ only marks a shift if there’s a LIVE rota for THIS month and THIS day
                    hasShift: hasByMonthDay.has(`${monthKey}:${d.getDate()}`),
                };
            }));
        })();
    }, []);


    const niceRange = (() => {
        if (!items.length) return '';
        const first = new Date(items[0].date);
        const last = new Date(items[items.length - 1].date);
        const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
            new Intl.DateTimeFormat(undefined, opts).format(d);
        const left = `${fmt(first, { day: '2-digit' })} ${fmt(first, { month: 'short' })}`;
        const right = `${fmt(last, { day: '2-digit' })} ${fmt(last, { month: 'short' })}`;
        return `${left} — ${right}`;
    })();

    return (
        <div className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">My week</h3>
                <div className="text-xs text-gray-500">{niceRange}</div>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2">
                {items.map(d => (
                    <div key={d.date} className="text-center">
                        <div className="text-xs text-gray-500">{d.label}</div>
                        <div
                            className={[
                                "mt-1 mx-auto h-9 w-9 rounded-full grid place-items-center ring-1 transition",
                                d.isToday ? "ring-indigo-400" : "ring-gray-200",
                                d.hasShift
                                    ? "text-white bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600"
                                    : "text-gray-900 bg-white"
                            ].join(' ')}
                            title={d.hasShift ? "Scheduled to work" : "No shift"}
                        >
                            {d.dd}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-500">
                <span className="inline-flex h-3 w-3 rounded-sm bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 ring-1 ring-indigo-200" />
                <span>Working day</span>
                <span className="inline-flex h-3 w-3 rounded-sm bg-white ring-1 ring-gray-300 ml-4" />
                <span>Off</span>
                <span className="inline-flex h-3 w-3 rounded-full ring-1 ring-indigo-400 ml-4" />
                <span>Today</span>
            </div>
        </div>
    );
}

/* =========================
   TASKS PANEL (Training)
   ========================= */
function TasksPanel() {
    // ===== State =====
    // Training due
    const [today, setToday] = useState<{ label: string; items: { name: string; due: string }[] }>({ label: '', items: [] });
    const [upcoming, setUpcoming] = useState<{ items: { name: string; due: string }[] }>({ items: [] });

    // Booked training sessions (next 14 days)
    type SessionItem = { id: string; title: string | null; starts_at: string; location: string | null; status: string };
    const [sessions, setSessions] = useState<SessionItem[]>([]);

    // Timesheet for current month
    type Timesheet = { id: string; status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'MANAGER_SUBMITTED'; month_date: string };
    const [timesheet, setTimesheet] = useState<Timesheet | null>(null);

    // Leave (approved/pending next 30 days)
    type LeaveRow = { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CANCEL_REQUESTED'; starts_on: string; ends_on: string; };
    const [leaveSoon, setLeaveSoon] = useState<LeaveRow[]>([]);

    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;
            if (!me) return;

            // Local date helpers (avoid UTC issues)
            const localISO = (d: Date) => {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
            };

            const now = new Date();
            const todayIso = localISO(now);
            const plusDays = (n: number) => {
                const d = new Date(now);
                d.setDate(d.getDate() + n);
                return d;
            };
            const cut14Iso = localISO(plusDays(14));
            const cut30Iso = localISO(plusDays(30));
            const monthFirstIso = localISO(new Date(now.getFullYear(), now.getMonth(), 1));

            // 1) Training due (records view)
            const tr = await supabase
                .from('training_records_v')
                .select('course_name,next_due_date,status')
                .eq('user_id', me);

            if (!tr.error) {
                const rows = (tr.data || []) as { course_name: string; next_due_date: string | null; status: 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE' }[];
                const dueToday = rows.filter(x => x.next_due_date === todayIso)
                    .map(x => ({ name: x.course_name, due: x.next_due_date! }));
                const upSoon = rows
                    .filter(x => x.next_due_date && x.next_due_date > todayIso && x.next_due_date <= cut14Iso && x.status === 'DUE_SOON')
                    .sort((a, b) => (a.next_due_date! < b.next_due_date! ? -1 : 1))
                    .map(x => ({ name: x.course_name, due: x.next_due_date! }));

                setToday({
                    label: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: '2-digit', month: 'short' }).format(now),
                    items: dueToday
                });
                setUpcoming({ items: upSoon });
            }

            // 2) Booked training sessions (next 14 days)
            const sa = await supabase
                .from('training_session_attendees')
                .select('session_id,status')
                .eq('user_id', me);

            let mySessionIds: string[] = [];
            const myByStatus = new Map<string, string>();
            if (!sa.error) {
                type SessionAssignment = {
                    session_id: string;
                    status: string;
                };

                const sessionAssignments: SessionAssignment[] = (sa.data ?? []) as SessionAssignment[];
                mySessionIds = sessionAssignments.map((r) => r.session_id);
                sessionAssignments.forEach((r) => myByStatus.set(r.session_id, r.status));
            }

            if (mySessionIds.length) {
                const ss = await supabase
                    .from('training_sessions')
                    .select('id, title, starts_at, location')
                    .in('id', mySessionIds)
                    .gte('starts_at', todayIso) // date comparison is fine; PG will cast
                    .lte('starts_at', cut14Iso);

                type SessionRow = {
                    id: string;
                    title: string | null;
                    starts_at: string;
                    location: string | null;
                };

                if (!ss.error) {
                    const rows: SessionRow[] = (ss.data ?? []) as SessionRow[];
                    const sitems: SessionItem[] = rows
                        .map((s) => ({
                            id: s.id,
                            title: s.title,
                            starts_at: s.starts_at,
                            location: s.location,
                            status: myByStatus.get(s.id) || '',
                        }))
                        .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));

                    setSessions(sitems);
                }
            } else {
                setSessions([]);
            }

            // 3) Timesheet (current month)
            const ts = await supabase
                .from('timesheets')
                .select('id,status,month_date')
                .eq('user_id', me)
                .eq('month_date', monthFirstIso)
                .maybeSingle();

            // Reuse the existing Timesheet state shape
            // type Timesheet = { id: string; status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'MANAGER_SUBMITTED'; month_date: string };

            if (!ts.error) {
                const row: Timesheet | null = ts.data
                    ? {
                        id: ts.data.id,
                        status: ts.data.status as Timesheet['status'],
                        month_date: ts.data.month_date,
                    }
                    : null;
                setTimesheet(row);
            }

            // 4) Leave in next 30 days (approved/pending)
            const lv = await supabase
                .from('leave_requests')
                .select('id,status,starts_on,ends_on')
                .eq('user_id', me)
                .in('status', ['PENDING', 'APPROVED'])
                .lte('starts_on', cut30Iso)   // starts before or on +30
                .gte('ends_on', todayIso);    // ends today or later

            if (!lv.error) {
                const rows = (lv.data || []) as LeaveRow[];
                rows.sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1));
                setLeaveSoon(rows);
            }
        })();
    }, []);

    // ===== UI helpers =====
    const fmtDateShort = (d: string) =>
        new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

    const Card = ({ title, children, cta }: { title: string; children: React.ReactNode; cta?: React.ReactNode }) => (
        <div className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
                {cta}
            </div>
            <div className="mt-3">{children}</div>
        </div>
    );

    const pill = (txt: string, tone: 'indigo' | 'amber' | 'slate' | 'emerald' | 'rose') =>
        <span className={
            `rounded-md ring-1 px-2 py-0.5 text-[11px] ` +
            (tone === 'indigo' ? 'bg-indigo-50 text-indigo-700 ring-indigo-100' :
                tone === 'amber' ? 'bg-amber-50  text-amber-700  ring-amber-100' :
                    tone === 'slate' ? 'bg-slate-50  text-slate-700  ring-slate-100' :
                        tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' :
                            'bg-rose-50   text-rose-700   ring-rose-100')
        }>{txt}</span>;

    // ===== Render =====
    return (
        <div className="space-y-5">
            {/* Row 1: Training today + Timesheet */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Training due today */}
                <Card title="Today">
                    {today.items.length === 0 ? (
                        <div className="text-[13px] text-gray-500">Nothing due today 🎉</div>
                    ) : (
                        <ul className="space-y-2">
                            {today.items.map((t, i) => (
                                <li key={i} className="text-[13px] text-gray-800 flex items-center justify-between">
                                    <span className="truncate">{t.name}</span>
                                    {pill('Training', 'amber')}
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="mt-2 text-[12px] text-gray-500">{today.label}</div>
                </Card>

                {/* Timesheet status with CTA */}
                <Card
                    title="Timesheet (this month)"
                    cta={
                        <Link href="/timesheets" className="text-[12px] text-indigo-700 hover:underline">
                            Open →
                        </Link>
                    }
                >
                    {timesheet ? (
                        <div className="flex items-center justify-between text-[13px] text-gray-800">
                            <span>{new Date(timesheet.month_date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                            {pill(timesheet.status.replace('_', ' '), 'slate')}
                        </div>
                    ) : (
                        <div className="flex items-center justify-between text-[13px] text-gray-800">
                            <span>No timesheet created</span>
                            <Link href="/timesheets" className="text-[12px] text-indigo-700 hover:underline">Create</Link>
                        </div>
                    )}
                </Card>

                {/* Leave (next 30 days) */}
                <Card
                    title="Leave (next 30 days)"
                    cta={<Link href="/annual-leave" className="text-[12px] text-indigo-700 hover:underline">Manage →</Link>}
                >
                    {leaveSoon.length === 0 ? (
                        <div className="text-[13px] text-gray-500">No upcoming leave</div>
                    ) : (
                        <ul className="space-y-2">
                            {leaveSoon.map(l => (
                                <li key={l.id} className="text-[13px] text-gray-800 flex items-center justify-between">
                                    <span className="truncate">{fmtDateShort(l.starts_on)} – {fmtDateShort(l.ends_on)}</span>
                                    {pill(l.status.replaceAll('_', ' '), 'rose')}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            {/* Row 2: Upcoming training + Booked sessions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Upcoming training (next 14 days) */}
                <Card
                    title="Upcoming training (next 14 days)"
                    cta={<Link href="/training" className="text-[12px] text-indigo-700 hover:underline">View all →</Link>}
                >
                    {upcoming.items.length === 0 ? (
                        <div className="text-[13px] text-gray-500">No upcoming training</div>
                    ) : (
                        <ul className="space-y-2">
                            {upcoming.items.map((t, i) => (
                                <li key={i} className="text-[13px] text-gray-800 flex items-center justify-between">
                                    <span className="truncate">{t.name}</span>
                                    <span className="ml-3 text-[12px] text-gray-600">due {fmtDateShort(t.due)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                {/* My booked sessions (next 14 days) */}
                <Card
                    title="My booked sessions (next 14 days)"
                    cta={<Link href="/bookings" className="text-[12px] text-indigo-700 hover:underline">Manage →</Link>}
                >
                    {sessions.length === 0 ? (
                        <div className="text-[13px] text-gray-500">No upcoming booked sessions</div>
                    ) : (
                        <ul className="space-y-2">
                            {sessions.map(s => (
                                <li key={s.id} className="text-[13px] text-gray-800 flex items-center justify-between">
                                    <span className="truncate">
                                        {s.title || 'Training session'} • {new Date(s.starts_at).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        {s.location ? ` @ ${s.location}` : ''}
                                    </span>
                                    {pill(s.status, 'indigo')}
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    );
}
