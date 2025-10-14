'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/* ===== Tokens (ORBIT + LIGHT) ===== */
type Theme = {
    pageBg: string;
    ring: string;
    ink: string;
    sub: string;
    faint: string;
    cardBg: string;
};
const ORBIT: Theme = {
    pageBg:
        'linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)',
    ring: 'rgba(148,163,184,0.16)',
    ink: '#E5E7EB',
    sub: '#94A3B8',
    faint: 'rgba(148,163,184,0.10)',
    cardBg: 'rgba(255,255,255,0.03)',
};
const LIGHT: Theme = {
    pageBg:
        'linear-gradient(180deg, #F7F8FB 0%, #F4F6FA 60%, #F2F4F8 100%)',
    ring: 'rgba(15,23,42,0.10)',
    ink: '#0F172A',
    sub: '#475569',
    faint: 'rgba(15,23,42,0.08)',
    cardBg: '#FFFFFF',
};
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

/* ===== Types ===== */
type View =
    | { status: 'loading' }
    | { status: 'signed_out' }
    | { status: 'ready'; level: AppLevel; bankOnly: boolean };

/* Cookie reader (client) */
function readOrbitCookie(): boolean {
    if (typeof document === 'undefined') return false;
    return document.cookie.split('; ').some((c) => c === 'orbit=1');
}

export default function DashboardPage() {
    const router = useRouter();
    const [view, setView] = useState<View>({ status: 'loading' });

    // 🔧 Instant theme: read cookie in the initial render
    const [orbit, setOrbit] = useState<boolean>(() => {
        if (typeof document === 'undefined') return false;
        return document.cookie.split('; ').some((c) => c === 'orbit=1');
    });
    const T = orbit ? ORBIT : LIGHT;

    // Fade-in after hydration (no theme work here)
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        setHydrated(true);
    }, []);

    // Live listeners (same-tab custom event + cross-tab storage) + safety refreshers
    useEffect(() => {
        function onOrbitChanged(e: Event) {
            const detail = (e as CustomEvent).detail as { orbit?: boolean } | undefined;
            if (typeof detail?.orbit === 'boolean') setOrbit(detail.orbit);
            else setOrbit(readOrbitCookie());
        }

        function onStorage(e: StorageEvent) {
            if (e.key === 'orbit:lastChange' && e.newValue) {
                try {
                    const payload = JSON.parse(e.newValue) as { orbit?: boolean };
                    if (typeof payload.orbit === 'boolean') setOrbit(payload.orbit);
                } catch {
                    /* ignore */
                }
            }
        }

        const onFocus = () => setOrbit(readOrbitCookie());
        const onVis = () => document.visibilityState === 'visible' && setOrbit(readOrbitCookie());

        window.addEventListener('orbit:changed', onOrbitChanged as EventListener);
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVis);

        return () => {
            window.removeEventListener('orbit:changed', onOrbitChanged as EventListener);
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;
            if (!session) {
                if (mounted) setView({ status: 'signed_out' });
                return;
            }

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
            if (!session) setView({ status: 'signed_out' });
            else load();
        });
        const onFocus = () => load();
        const onVis = () => document.visibilityState === 'visible' && load();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVis);

        return () => {
            mounted = false;
            try {
                sub?.subscription?.unsubscribe();
            } catch {
                // noop
            }
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    useEffect(() => {
        if (view.status === 'signed_out') router.replace('/auth/login');
    }, [view.status, router]);

    /* ---------- Loading ---------- */
    if (view.status === 'loading') {
        return (
            <div
                className={`p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 min-h-screen transition-opacity duration-150 ${hydrated ? 'opacity-100' : 'opacity-0'}`}
                style={{ background: T.pageBg }}
            >
                <SkeletonCard T={T} orbit={orbit} />
                <SkeletonCard T={T} orbit={orbit} />
                <SkeletonCard T={T} orbit={orbit} />
                <SkeletonCard T={T} orbit={orbit} />
            </div>
        );
    }
    if (view.status === 'signed_out') return null;

    /* ---------- Ready ---------- */
    return (
        <div
            className={`p-5 space-y-5 min-h-screen transition-opacity duration-150 ${hydrated ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: T.pageBg }}
        >
            {/* Page header */}
            <header className="flex items-end justify-between">
                <div>
                    <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight" style={{ color: T.ink }}>
                        Dashboard
                    </h1>
                    <p className="text-[13px]" style={{ color: T.sub }}>
                        Everything you need at a glance.
                    </p>
                </div>
            </header>

            {/* At-a-glance */}
            <div className="space-y-5">
                <WeekStrip T={T} orbit={orbit} />
                <TasksPanel T={T} orbit={orbit} />
            </div>
        </div>
    );
}

/* =========
   Sections
   ========= */
function Section({ title, children, T }: { title: string; children: React.ReactNode; T: Theme }) {
    return (
        <section className="space-y-2">
            <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold" style={{ color: T.ink }}>
                    {title}
                </h2>
                <div className="h-px flex-1" style={{ background: T.faint }} />
            </div>
            {children}
        </section>
    );
}

/* =========================
   Skeleton
   ========================= */
function SkeletonCard({ T, orbit }: { T: Theme; orbit: boolean }) {
    return (
        <div className="rounded-2xl h-[96px] ring-1" style={{ background: T.cardBg, borderColor: T.ring }}>
            <div className="p-3 flex items-start gap-3 h-full">
                <div className={`h-9 w-9 rounded-lg ${orbit ? 'bg-white/10' : 'bg-slate-200/60'} animate-pulse`} />
                <div className="flex-1 space-y-2 self-center">
                    <div className={`h-4 rounded w-3/5 animate-pulse ${orbit ? 'bg-white/10' : 'bg-slate-200/60'}`} />
                    <div className={`h-3 rounded w-2/5 animate-pulse ${orbit ? 'bg-white/10' : 'bg-slate-200/60'}`} />
                </div>
            </div>
        </div>
    );
}

/* =========================
   WEEK STRIP (Mon→Sun)
   ========================= */
function WeekStrip({ T, orbit }: { T: Theme; orbit: boolean }) {
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
            const dayNos = weekDates.map((d) => d.getDate());
            const monthFirsts = Array.from(new Set(weekDates.map(monthFirstISO)));

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

            setItems(
                weekDates.map((d) => {
                    const monthKey = monthFirstISO(d);
                    return {
                        date: localISO(d),
                        label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d),
                        dd: d.getDate(),
                        isToday: localISO(d) === todayIso,
                        hasShift: hasByMonthDay.has(`${monthKey}:${d.getDate()}`),
                    };
                })
            );
        })();
    }, []);

    const niceRange = (() => {
        if (!items.length) return '';
        const first = new Date(items[0].date);
        const last = new Date(items[items.length - 1].date);
        const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts).format(d);
        const left = `${fmt(first, { day: '2-digit' })} ${fmt(first, { month: 'short' })}`;
        const right = `${fmt(last, { day: '2-digit' })} ${fmt(last, { month: 'short' })}`;
        return `${left} — ${right}`;
    })();

    return (
        <div className="rounded-2xl p-4 ring-1" style={{ background: T.cardBg, borderColor: T.ring }}>
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: T.ink }}>
                    My week
                </h3>
                <div className="text-xs" style={{ color: T.sub }}>
                    {niceRange}
                </div>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2">
                {items.map((d) => (
                    <div key={d.date} className="text-center">
                        <div className="text-xs" style={{ color: T.sub }}>
                            {d.label}
                        </div>
                        <div
                            className={['mt-1 mx-auto h-9 w-9 rounded-full grid place-items-center ring-1 transition'].join(' ')}
                            style={{
                                background: d.hasShift ? BRAND_GRADIENT : 'transparent',
                                color: d.hasShift ? '#FFFFFF' : T.ink,
                                borderColor: d.isToday ? 'rgba(99,102,241,0.50)' : T.ring,
                            }}
                            title={d.hasShift ? 'Scheduled to work' : 'No shift'}
                        >
                            {d.dd}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-3 flex items-center gap-4 text-[11px]" style={{ color: T.sub }}>
                <span className="inline-flex h-3 w-3 rounded-sm ring-1 ring-indigo-300/30" style={{ background: BRAND_GRADIENT }} />
                <span>Working day</span>
                <span className="inline-flex h-3 w-3 rounded-sm ring-1" style={{ background: 'transparent', borderColor: T.ring }} />
                <span>Off</span>
                <span className="inline-flex h-3 w-3 rounded-full ring-1" style={{ borderColor: 'rgba(99,102,241,0.50)' }} />
                <span>Today</span>
            </div>
        </div>
    );
}

/* =========================
   TASKS PANEL (Training)
   ========================= */
function TasksPanel({ T, orbit }: { T: Theme; orbit: boolean }) {
    // ===== State =====
    const [today, setToday] = useState<{ label: string; items: { name: string; due: string }[] }>({ label: '', items: [] });
    const [upcoming, setUpcoming] = useState<{ items: { name: string; due: string }[] }>({ items: [] });

    // Booked training sessions (next 14 days)
    type SessionItem = { id: string; title: string | null; starts_at: string; location: string | null; status: string };
    const [sessions, setSessions] = useState<SessionItem[]>([]);

    // Timesheet for current month
    type Timesheet = { id: string; status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'MANAGER_SUBMITTED'; month_date: string };
    const [timesheet, setTimesheet] = useState<Timesheet | null>(null);

    // Leave (approved/pending next 30 days)
    type LeaveRow = { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CANCEL_REQUESTED'; starts_on: string; ends_on: string };
    const [leaveSoon, setLeaveSoon] = useState<LeaveRow[]>([]);

    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;
            if (!me) return;

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
            const tr = await supabase.from('training_records_v').select('course_name,next_due_date,status').eq('user_id', me);

            if (!tr.error) {
                const rows = (tr.data || []) as { course_name: string; next_due_date: string | null; status: 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE' }[];
                const dueToday = rows.filter((x) => x.next_due_date === todayIso).map((x) => ({ name: x.course_name, due: x.next_due_date! }));
                const upSoon = rows
                    .filter((x) => x.next_due_date && x.next_due_date > todayIso && x.next_due_date <= cut14Iso && x.status === 'DUE_SOON')
                    .sort((a, b) => (a.next_due_date! < b.next_due_date! ? -1 : 1))
                    .map((x) => ({ name: x.course_name, due: x.next_due_date! }));

                setToday({
                    label: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: '2-digit', month: 'short' }).format(now),
                    items: dueToday,
                });
                setUpcoming({ items: upSoon });
            }

            // 2) Booked training sessions (next 14 days)
            const sa = await supabase.from('training_session_attendees').select('session_id,status').eq('user_id', me);

            let mySessionIds: string[] = [];
            const myByStatus = new Map<string, string>();
            if (!sa.error) {
                type SessionAssignment = { session_id: string; status: string };
                const sessionAssignments: SessionAssignment[] = (sa.data ?? []) as SessionAssignment[];
                mySessionIds = sessionAssignments.map((r) => r.session_id);
                sessionAssignments.forEach((r) => myByStatus.set(r.session_id, r.status));
            }

            if (mySessionIds.length) {
                const ss = await supabase
                    .from('training_sessions')
                    .select('id, title, starts_at, location')
                    .in('id', mySessionIds)
                    .gte('starts_at', todayIso)
                    .lte('starts_at', cut14Iso);

                type SessionRow = { id: string; title: string | null; starts_at: string; location: string | null };

                if (!ss.error) {
                    const rows: SessionRow[] = (ss.data ?? []) as SessionRow[];
                    const sitems: SessionItem[] = rows
                        .map((s) => ({ id: s.id, title: s.title, starts_at: s.starts_at, location: s.location, status: myByStatus.get(s.id) || '' }))
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

            if (!ts.error) {
                const row: Timesheet | null = ts.data
                    ? { id: ts.data.id, status: ts.data.status as Timesheet['status'], month_date: ts.data.month_date }
                    : null;
                setTimesheet(row);
            }

            // 4) Leave in next 30 days (approved/pending)
            const lv = await supabase
                .from('leave_requests')
                .select('id,status,starts_on,ends_on')
                .eq('user_id', me)
                .in('status', ['PENDING', 'APPROVED'])
                .lte('starts_on', cut30Iso)
                .gte('ends_on', todayIso);

            if (!lv.error) {
                const rows = (lv.data || []) as LeaveRow[];
                rows.sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1));
                setLeaveSoon(rows);
            }
        })();
    }, []);

    /* Pills that look good in both themes */
    function pill(txt: string, tone: 'indigo' | 'amber' | 'slate' | 'emerald' | 'rose') {
        const darkStyles: Record<typeof tone, React.CSSProperties> = {
            indigo: { background: 'rgba(99,102,241,0.12)', color: '#C7D2FE', borderColor: 'rgba(99,102,241,0.25)' },
            amber: { background: 'rgba(245,158,11,0.12)', color: '#FDE68A', borderColor: 'rgba(245,158,11,0.25)' },
            emerald: { background: 'rgba(16,185,129,0.12)', color: '#A7F3D0', borderColor: 'rgba(16,185,129,0.25)' },
            rose: { background: 'rgba(244,63,94,0.12)', color: '#FCA5A5', borderColor: 'rgba(244,63,94,0.25)' },
            slate: { background: 'rgba(148,163,184,0.12)', color: '#CBD5E1', borderColor: 'rgba(148,163,184,0.25)' },
        };
        const lightStyles: Record<typeof tone, React.CSSProperties> = {
            indigo: { background: 'rgba(99,102,241,0.10)', color: '#3730A3', borderColor: 'rgba(99,102,241,0.25)' },
            amber: { background: 'rgba(245,158,11,0.10)', color: '#92400E', borderColor: 'rgba(245,158,11,0.25)' },
            emerald: { background: 'rgba(16,185,129,0.12)', color: '#065F46', borderColor: 'rgba(16,185,129,0.25)' },
            rose: { background: 'rgba(244,63,94,0.10)', color: '#991B1B', borderColor: 'rgba(244,63,94,0.25)' },
            slate: { background: 'rgba(148,163,184,0.12)', color: '#334155', borderColor: 'rgba(148,163,184,0.25)' },
        };
        const style = orbit ? darkStyles[tone] : lightStyles[tone];
        return (
            <span className="rounded-md px-2 py-0.5 text-[11px] ring-1" style={style}>
                {txt}
            </span>
        );
    }

    const fmtDateShort = (d: string) => new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

    const Card = ({ title, children, cta }: { title: string; children: React.ReactNode; cta?: React.ReactNode }) => (
        <div className="rounded-2xl p-4 ring-1" style={{ background: T.cardBg, borderColor: T.ring }}>
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold" style={{ color: T.ink }}>
                    {title}
                </h4>
                {cta}
            </div>
            <div className="mt-3" style={{ color: T.ink }}>
                {children}
            </div>
        </div>
    );

    return (
        <div className="space-y-5">
            {/* Row 1: Training today + Timesheet */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Training due today */}
                <Card title="Today">
                    {today.items.length === 0 ? (
                        <div className="text-[13px]" style={{ color: T.sub }}>
                            Nothing due today 🎉
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {today.items.map((t, i) => (
                                <li key={i} className="text-[13px] flex items-center justify-between" style={{ color: T.ink }}>
                                    <span className="truncate">{t.name}</span>
                                    {pill('Training', 'amber')}
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="mt-2 text-[12px]" style={{ color: T.sub }}>
                        {today.label}
                    </div>
                </Card>

                {/* Timesheet status with CTA */}
                <Card
                    title="Timesheet (this month)"
                    cta={
                        <Link href="/timesheets" className="text-[12px] underline-offset-4 hover:underline" style={{ color: orbit ? '#C7D2FE' : '#4F46E5' }}>
                            Open →
                        </Link>
                    }
                >
                    {timesheet ? (
                        <div className="flex items-center justify-between text-[13px]" style={{ color: T.ink }}>
                            <span>{new Date(timesheet.month_date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                            {pill(timesheet.status.replace('_', ' '), 'slate')}
                        </div>
                    ) : (
                        <div className="flex items-center justify-between text-[13px]" style={{ color: T.ink }}>
                            <span>No timesheet created</span>
                            <Link href="/timesheets" className="text-[12px] underline-offset-4 hover:underline" style={{ color: orbit ? '#C7D2FE' : '#4F46E5' }}>
                                Create
                            </Link>
                        </div>
                    )}
                </Card>

                {/* Leave (next 30 days) */}
                <Card
                    title="Leave (next 30 days)"
                    cta={
                        <Link href="/annual-leave" className="text-[12px] underline-offset-4 hover:underline" style={{ color: orbit ? '#C7D2FE' : '#4F46E5' }}>
                            Manage →
                        </Link>
                    }
                >
                    {leaveSoon.length === 0 ? (
                        <div className="text-[13px]" style={{ color: T.sub }}>
                            No upcoming leave
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {leaveSoon.map((l) => (
                                <li key={l.id} className="text-[13px] flex items-center justify-between" style={{ color: T.ink }}>
                                    <span className="truncate">
                                        {fmtDateShort(l.starts_on)} – {fmtDateShort(l.ends_on)}
                                    </span>
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
                    cta={
                        <Link href="/training" className="text-[12px] underline-offset-4 hover:underline" style={{ color: orbit ? '#C7D2FE' : '#4F46E5' }}>
                            View all →
                        </Link>
                    }
                >
                    {upcoming.items.length === 0 ? (
                        <div className="text-[13px]" style={{ color: T.sub }}>
                            No upcoming training
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {upcoming.items.map((t, i) => (
                                <li key={i} className="text-[13px] flex items-center justify-between" style={{ color: T.ink }}>
                                    <span className="truncate">{t.name}</span>
                                    <span className="ml-3 text-[12px]" style={{ color: T.sub }}>
                                        due {fmtDateShort(t.due)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                {/* My booked sessions (next 14 days) */}
                <Card
                    title="My booked sessions (next 14 days)"
                    cta={
                        <Link href="/bookings" className="text-[12px] underline-offset-4 hover:underline" style={{ color: orbit ? '#C7D2FE' : '#4F46E5' }}>
                            Manage →
                        </Link>
                    }
                >
                    {sessions.length === 0 ? (
                        <div className="text-[13px]" style={{ color: T.sub }}>
                            No upcoming booked sessions
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {sessions.map((s) => (
                                <li key={s.id} className="text-[13px] flex items-center justify-between" style={{ color: T.ink }}>
                                    <span className="truncate">
                                        {s.title || 'Training session'} •{' '}
                                        {new Date(s.starts_at).toLocaleString(undefined, {
                                            weekday: 'short',
                                            day: '2-digit',
                                            month: 'short',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
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
