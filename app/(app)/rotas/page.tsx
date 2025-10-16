'use client';

import React, { useEffect, useMemo, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

/* ========= Brand ========= */
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

/* ========= Types ========= */
type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type Company = { id: string; name: string };
type Home = { id: string; name: string; company_id: string };

type ShiftType = {
    id: string;
    company_id: string;
    code: string;
    label: string;
    default_hours: number;
    is_active: boolean;
    kind: string | null;
};

type Rota = {
    id: string;
    home_id: string;
    month_date: string; // 'YYYY-MM-01'
    status: 'DRAFT' | 'LIVE';
    created_by?: string | null;
};

type Entry = {
    id: string;
    rota_id: string;
    day_of_month: number;
    user_id: string;
    shift_type_id: string | null;
    hours: number;
    notes: string | null;
    start_time: string | null; // 'HH:MM:SS' from Postgres time
};

type Profile = { user_id: string; full_name: string | null };

type KpiRow = { week_start: string; week_end: string; hours: number };

/* ========= Helpers ========= */

// Local-time first-of-month ISO (avoids UTC shift issues)
function firstOfMonthLocalISO(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}-01`;
}

function ym(iso: string): string {
    return iso.slice(0, 7);
}

function initialsFor(list: Profile[], id: string): string {
    const full = list.find(p => p.user_id === id)?.full_name?.trim();
    if (full && full.length) {
        const parts = full.split(/\s+/);
        const first = parts[0]?.[0] || '';
        const last = (parts.length > 1 ? parts[parts.length - 1]?.[0] : '') || (parts[0]?.[1] || '');
        const res = (first + (last || '')).toUpperCase();
        return res || full[0]?.toUpperCase() || id.slice(0, 2).toUpperCase();
    }
    return id.slice(0, 2).toUpperCase();
}

const PALETTE = [
    '#E3F2FD', '#FCE4EC', '#E8F5E9', '#FFF3E0', '#EDE7F6', '#E0F7FA',
    '#F3E5F5', '#F1F8E9', '#FFFDE7', '#E0F2F1', '#FBE9E7', '#E8EAF6'
] as const;
const BORDER = [
    '#90CAF9', '#F48FB1', '#A5D6A7', '#FFCC80', '#B39DDB', '#80DEEA',
    '#CE93D8', '#C5E1A5', '#FFF59D', '#80CBC4', '#FFAB91', '#9FA8DA'
] as const;

// Show a user's full name if we have it, otherwise fall back to short id
function displayName(list: Profile[], id: string): string {
    const full = list.find(p => p.user_id === id)?.full_name?.trim();
    return full && full.length ? full : id.slice(0, 8);
}

// 'HH:MM(:SS)?' -> 'HH:MM'
function hhmm(t?: string | null): string | null {
    return t ? t.slice(0, 5) : null;
}

// returns { end: 'HH:MM', nextDay: boolean }
function endTimeFrom(startHHMM: string, hours: number): { end: string; nextDay: boolean } {
    const [H, M] = startHHMM.split(':').map(n => parseInt(n, 10));
    if (Number.isNaN(H) || Number.isNaN(M)) return { end: startHHMM, nextDay: false };
    const add = Math.round((hours || 0) * 60);
    let mins = H * 60 + M + add;
    let nextDay = false;
    if (mins >= 24 * 60) { mins = mins % (24 * 60); nextDay = true; }
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    return { end: `${hh}:${mm}`, nextDay };
}

/* ========= Calendar ========= */
function CalendarGrid({
    monthISO, hidden, cellRenderer,
}: {
    monthISO: string;
    hidden?: boolean;
    cellRenderer: (day: number) => React.ReactNode;
}) {
    if (hidden) return null;

    const base = new Date(`${monthISO}T00:00:00`);
    const year = base.getFullYear();
    const month = base.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const startDow = new Date(year, month, 1).getDay(); // 0 Sun..6 Sat

    // Build cells
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null); // leading blanks
    for (let d = 1; d <= days; d++) cells.push(d);       // 1..days
    while (cells.length % 7) cells.push(null);           // pad to full weeks

    const title = base.toLocaleString(undefined, { month: 'long', year: 'numeric' });

    return (
        <div className="space-y-3" style={{ color: 'var(--ink)' }}>
            <div className="text-lg font-semibold">{title}</div>
            <div
                className="rounded-xl p-3 ring-1"
                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
            >
                <div className="grid grid-cols-7 gap-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(h =>
                        <div key={h} className="text-xs font-medium" style={{ color: 'var(--sub)' }}>{h}</div>
                    )}
                    {cells.map((d, i) => (
                        <div
                            key={i}
                            className="min-h-28 rounded-lg p-2 flex flex-col ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        >
                            <div className="text-[11px] font-medium" style={{ color: 'var(--sub)' }}>{d ?? ''}</div>
                            <div className="mt-1 space-y-1 flex-1">{d ? cellRenderer(d) : null}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Detect dark mode (Orbit or system)
function useIsDark(): boolean {
    const [dark, setDark] = React.useState(false);

    React.useEffect(() => {
        const prefers = window.matchMedia?.('(prefers-color-scheme: dark)');

        const compute = () => {
            // Re-check Orbit on every call; don't close over a stale value
            const orbitOn = !!document.querySelector('[data-orbit="1"]');
            setDark(orbitOn || !!prefers?.matches);
        };

        // Initial + next frame (in case Orbit flag is applied after hydration)
        compute();
        const raf = requestAnimationFrame(compute);

        // Listen to OS theme changes
        prefers?.addEventListener?.('change', compute);

        // Watch for [data-orbit] attribute toggles anywhere in the document
        const mo = new MutationObserver(compute);
        mo.observe(document.documentElement, {
            attributes: true,
            subtree: true,
            // If you know the attribute is always called "data-orbit", keep this;
            // otherwise omit attributeFilter to catch all attribute changes.
            // (Omitting filter is noisier but safe.)
            // attributeFilter: ['data-orbit'],
        });

        return () => {
            cancelAnimationFrame(raf);
            prefers?.removeEventListener?.('change', compute);
            mo.disconnect();
        };
    }, []);

    return dark;
}


// Theme-aware chip colours: stable hue per id, different lightness per theme
function colorFor(
    id?: string | null,
    dark = false
): { bg: string; border: string; fg: string } {
    const safe = (id && id.length) ? id : 'fallback';
    let h = 0;
    for (let i = 0; i < safe.length; i++) h = ((h << 5) - h) + safe.charCodeAt(i);
    const hue = Math.abs(h) % 360;

    if (dark) {
        // Dark background chip with light text
        const bg = `hsl(${hue}, 65%, 22%)`;
        const border = `hsl(${hue}, 65%, 35%)`;
        const fg = '#F8FAFC'; // light ink for dark chips
        return { bg, border, fg };
    } else {
        // Light background chip with dark text
        const bg = `hsl(${hue}, 90%, 90%)`;
        const border = `hsl(${hue}, 70%, 60%)`;
        const fg = '#0B1221'; // dark ink for light chips
        return { bg, border, fg };
    }
}


/* ========= Toolbar ========= */
function Toolbar({
    companies, companyId, setCompanyId,
    homes, homeId, setHomeId,
    month, setMonth,
    requireCompanyForAdmin = false,
    rightExtra,
}: {
    companies?: Company[];
    companyId?: string; setCompanyId?: (v: string) => void;
    homes: Home[]; homeId: string; setHomeId: (v: string) => void;
    month: string; setMonth: (v: string) => void;
    requireCompanyForAdmin?: boolean;
    rightExtra?: ReactNode;
}) {
    return (
        <div
            className="rounded-xl p-3 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end ring-1"
            style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
        >
            {companies && setCompanyId && (
                <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Company</label>
                    <select
                        className="w-full rounded-lg px-3 py-2 ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        value={companyId || ''}
                        onChange={e => setCompanyId(e.target.value)}
                    >
                        <option value="">{requireCompanyForAdmin ? 'Select company…' : 'Auto-detected'}</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
            )}
            <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Home</label>
                <select
                    className="w-full rounded-lg px-3 py-2 ring-1"
                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                    value={homeId}
                    onChange={e => setHomeId(e.target.value)}
                >
                    <option value="">{homes.length ? 'Select home…' : 'No homes'}</option>
                    {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Month</label>
                <input
                    type="month"
                    className="w-full rounded-lg px-3 py-2 ring-1"
                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                    value={ym(month)}
                    onChange={e => setMonth(`${e.target.value}-01`)}
                />
            </div>
            <div className="sm:justify-self-end">{rightExtra}</div>
        </div>
    );
}

/* ========= Root page ========= */
export default function RotasPage() {
    const [level, setLevel] = useState<Level>('4_STAFF');
    const [tab, setTab] = useState<'MY' | 'MANAGE' | 'SETTINGS'>('MY');

    useEffect(() => {
        (async () => {
            const lvl = await getEffectiveLevel();
            setLevel((lvl as Level) ?? '4_STAFF');
        })();
    }, []);

    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';
    const isStaff = level === '4_STAFF';

    const showManage = isAdmin || isCompany || isManager;
    const showSettings = isAdmin || isCompany;

    useEffect(() => {
        if (!showManage && tab === 'MANAGE') setTab('MY');
        if (!showSettings && tab === 'SETTINGS') setTab('MY');
    }, [showManage, showSettings, tab]);

    return (
        <div className="p-6 space-y-6" style={{ color: 'var(--ink)' }}>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Rotas</h1>

            {/* Tabs */}
            <div className="flex gap-2">
                <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>My Rotas</TabBtn>
                {showManage && <TabBtn active={tab === 'MANAGE'} onClick={() => setTab('MANAGE')}>Manage Rotas</TabBtn>}
                {showSettings && <TabBtn active={tab === 'SETTINGS'} onClick={() => setTab('SETTINGS')}>Rota Settings</TabBtn>}
            </div>

            {tab === 'MY' && <MyRotas isAdmin={isAdmin} isCompany={isCompany} isManager={isManager} isStaff={isStaff} />}
            {tab === 'MANAGE' && showManage && <ManageRotas isAdmin={isAdmin} isCompany={isCompany} isManager={isManager} />}
            {tab === 'SETTINGS' && showSettings && <RotaSettings isAdmin={isAdmin} />}

            {/* --- Orbit-only native control fixes (scoped to this page) --- */}
            <style jsx global>{`
        /* Make native popovers dark in Orbit and ensure closed state isn't washed out */
        [data-orbit="1"] select,
        [data-orbit="1"] input[type="number"],
        [data-orbit="1"] input[type="date"],
        [data-orbit="1"] input[type="time"],
        [data-orbit="1"] textarea {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        /* Option text inside the opened dropdown menu */
        [data-orbit="1"] select option {
          color: var(--ink);
          background-color: #0b1221; /* solid fallback so options don't look transparent */
        }
        /* Firefox also respects this for the popup list */
        @-moz-document url-prefix() {
          [data-orbit="1"] select option {
            background-color: #0b1221;
          }
        }
        /* Remove the greyed-out look some UAs apply */
        [data-orbit="1"] select:where(:not(:disabled)) {
          opacity: 1;
        }
      `}</style>
        </div>
    );
}

function TabBtn(
    { active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
    return (
        <button
            className="px-4 py-2 text-sm rounded-md ring-1 transition"
            style={
                active
                    ? { background: BRAND_GRADIENT, color: '#FFFFFF', borderColor: 'var(--ring-strong)' }
                    : { background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }
            }
            {...props}
        >
            {children}
        </button>
    );
}

/* =========================
   MY ROTAS (read-only view, incl. Bank View)
   ========================= */
function MyRotas({ isAdmin, isCompany, isManager, isStaff }: {
    isAdmin: boolean; isCompany: boolean; isManager: boolean; isStaff: boolean;
}) {
    // local helper just for this component
    const hhmmLocal = (t?: string | null) => (t ? t.slice(0, 5) : null);
    const endTimeFromLocal = (startHHMM: string, hours: number) => {
        const [H, M] = startHHMM.split(':').map(n => parseInt(n, 10));
        if (Number.isNaN(H) || Number.isNaN(M)) return { end: startHHMM, nextDay: false };
        const add = Math.round((hours || 0) * 60);
        let mins = H * 60 + M + add;
        let nextDay = false;
        if (mins >= 24 * 60) { mins = mins % (24 * 60); nextDay = true; }
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(mins % 60).padStart(2, '0');
        return { end: `${hh}:${mm}`, nextDay };
    };

    type EntryWithStart = Entry & { start_time?: string | null }; // adds start_time safely

    const [uid, setUid] = useState<string>('');

    const isDark = useIsDark();

    // Company/Home selectors (used for normal users)
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState<string>('');
    const [homes, setHomes] = useState<Home[]>([]);
    const [homeId, setHomeId] = useState<string>('');

    const [month, setMonth] = useState<string>(() => firstOfMonthLocalISO());

    // Standard (home-scoped) view state
    const [rota, setRota] = useState<Rota | null>(null);
    const [entries, setEntries] = useState<EntryWithStart[]>([]);
    const [people, setPeople] = useState<Profile[]>([]);

    // Bank view (across homes) extras
    const [bankEntries, setBankEntries] = useState<(EntryWithStart & { _home_id?: string })[]>([]);
    const [homeById, setHomeById] = useState<Map<string, Home>>(new Map());

    // Shift types (mapped by id, used in both views)
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
    const codeById = useMemo(() => {
        const m = new Map<string, string>();
        shiftTypes.forEach(s => m.set(s.id, s.code));
        return m;
    }, [shiftTypes]);

    // Filter: All vs Mine (when a home is chosen). For bank view (no home), it’s always “Mine”.
    const [viewMode, setViewMode] = useState<'ALL' | 'MINE'>(isStaff ? 'MINE' : 'ALL');

    /* ---------- Who am I & initial homes/companies ---------- */
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const me = data.user?.id;
            if (!me) return;
            setUid(me);

            if (isAdmin) {
                const co = await supabase.from('companies').select('id,name').order('name');
                const items = (co.data ?? []) as { id: string; name: string }[];
                setCompanies(items);
            }

            // homes visible to this user (RLS-safe)
            const rpc = await supabase.rpc('homes_list_for_ui', { p_company_id: isAdmin ? null : null });
            const list = (rpc.data ?? []) as Home[];
            if (!isAdmin) setHomes(list);

            if ((isManager || isStaff) && list.length === 1) {
                setHomeId(list[0].id);
                setCompanyId(list[0].company_id);
            } else if ((isManager || isCompany) && list[0] && !homeId) {
                setHomeId(list[0].id);
                setCompanyId(list[0].company_id);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, isCompany, isManager, isStaff]);

    /* ---------- Admin: homes refresh after company picked ---------- */
    useEffect(() => {
        (async () => {
            if (!isAdmin) return;
            if (!companyId) { setHomes([]); return; }
            const rpc = await supabase.rpc('homes_list_for_ui', { p_company_id: companyId });
            const list = (rpc.data ?? []) as Home[];
            setHomes(list);
            if (!homeId && list[0]) setHomeId(list[0].id);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, companyId]);

    /* ---------- Shift types loader (standard view only) ---------- */
    useEffect(() => {
        (async () => {
            const isBankView = !homeId;
            if (isBankView) return; // bank view handled in separate effect

            const cid =
                companyId ||
                homes.find(h => h.id === homeId)?.company_id ||
                '';

            if (!cid) { setShiftTypes([]); return; }

            const { data, error } = await supabase.rpc('shift_types_for_ui', {
                p_company_id: cid,
                p_include_inactive: false
            });
            if (!error) setShiftTypes((data ?? []) as ShiftType[]);
        })();
    }, [companyId, homeId, homes]);

    /* ---------- STANDARD VIEW: Live rota for selected home ---------- */
    useEffect(() => {
        (async () => {
            setRota(null); setEntries([]); setPeople([]);
            if (!homeId || !month) return;

            const r = await supabase.from('rotas').select('*')
                .eq('home_id', homeId).eq('month_date', month).eq('status', 'LIVE').maybeSingle();
            setRota((r.data as Rota) || null);
            if (!r.data) return;

            const e = await supabase.from('rota_entries').select('*').eq('rota_id', (r.data as Rota).id);
            const rows = (e.data ?? []) as Entry[];
            setEntries(rows);

            const ids = viewMode === 'MINE'
                ? [uid]
                : Array.from(new Set(rows.map(x => x.user_id)));
            if (ids.length) {
                const prof = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
                setPeople((prof.data ?? []) as Profile[]);
            }
        })();
    }, [homeId, month, viewMode, uid]);

    /* ---------- BANK VIEW: my shifts across ALL homes (LIVE rotas in month) ---------- */
    useEffect(() => {
        (async () => {
            setBankEntries([]); setHomeById(new Map());
            const isBankView = !homeId;
            if (!isBankView || !uid || !month) return;

            // 1) My entries for LIVE rotas in the month (include start_time)
            const rs = await supabase
                .from('rota_entries')
                .select('id, rota_id, day_of_month, user_id, shift_type_id, hours, notes, start_time, rotas!inner(id, home_id, month_date, status)')
                .eq('user_id', uid)
                .eq('rotas.month_date', month)
                .eq('rotas.status', 'LIVE');

            const rows = ((rs.data as unknown[] | null) ?? []).map((x) => {
                const row = x as {
                    id: string; rota_id: string; day_of_month: number; user_id: string;
                    shift_type_id: string | null; hours: number; notes: string | null; start_time: string | null;
                    rotas?: { id: string; home_id: string; month_date: string; status: 'LIVE' | 'DRAFT' } | null;
                };
                return {
                    id: row.id,
                    rota_id: row.rota_id,
                    day_of_month: row.day_of_month,
                    user_id: row.user_id,
                    shift_type_id: row.shift_type_id,
                    hours: row.hours,
                    notes: row.notes,
                    start_time: row.start_time,
                    _home_id: row.rotas?.home_id,
                };
            }) as (Entry & { _home_id?: string })[];

            setBankEntries(rows);

            // 2) Homes + companies for those rotas
            const homeIds = Array.from(new Set(rows.map(r => r._home_id).filter((v): v is string => !!v)));
            if (homeIds.length) {
                const hq = await supabase.from('homes').select('id,name,company_id').in('id', homeIds);
                const map = new Map<string, Home>();
                (hq.data ?? []).forEach((h) => {
                    const item = h as Home;
                    map.set(item.id, item);
                });
                setHomeById(map);

                // 3) Shift types for all involved companies via RPC
                const cids = Array.from(new Set((hq.data ?? []).map(h => (h as Home).company_id)));
                if (cids.length) {
                    let combined: ShiftType[] = [];
                    for (const cid of cids) {
                        const { data } = await supabase.rpc('shift_types_for_ui', {
                            p_company_id: cid,
                            p_include_inactive: false
                        });
                        if (data && (data as unknown[]).length) combined = combined.concat(data as ShiftType[]);
                    }
                    // de-dupe by id
                    const seen = new Set<string>();
                    const dedup = combined.filter((st) => {
                        if (seen.has(st.id)) return false;
                        seen.add(st.id);
                        return true;
                    });
                    setShiftTypes(dedup);
                } else {
                    setShiftTypes([]);
                }
            } else {
                setShiftTypes([]);
            }

            // 4) Ensure initials for "me"
            const meProf = await supabase.from('profiles').select('user_id, full_name').eq('user_id', uid);
            setPeople((meProf.data ?? []) as Profile[]);
        })();
    }, [uid, month, homeId]);

    /* ---------- UI ---------- */
    const requireCompany = isAdmin;
    const isBankView = !homeId;
    const calendarHiddenStandard = (isAdmin && !companyId) || !homeId || !month;

    const rightExtra = (
        <div className="flex items-center gap-2 justify-end" style={{ color: 'var(--ink)' }}>
            {!isBankView && (
                <>
                    <label className="text-xs" style={{ color: 'var(--sub)' }}>View</label>
                    <select
                        className="rounded-lg px-2 py-1 text-sm ring-1"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={viewMode}
                        onChange={e => setViewMode(e.target.value as 'ALL' | 'MINE')}
                    >
                        <option value="ALL">Whole rota</option>
                        <option value="MINE">My shifts</option>
                    </select>
                </>
            )}
        </div>
    );

    return (
        <div className="space-y-4" style={{ color: 'var(--ink)' }}>
            <Toolbar
                companies={isAdmin ? companies : undefined}
                companyId={isAdmin ? companyId : undefined}
                setCompanyId={isAdmin ? setCompanyId : undefined}
                homes={homes}
                homeId={homeId}
                setHomeId={(v) => {
                    setHomeId(v);
                    const h = homes.find(x => x.id === v);
                    if (h) setCompanyId(h.company_id);
                }}
                month={month}
                setMonth={setMonth}
                requireCompanyForAdmin={requireCompany}
                rightExtra={rightExtra}
            />

            {/* Standard home-scoped view */}
            {!isBankView ? (
                calendarHiddenStandard ? (
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        Select {isAdmin ? 'a company and ' : ''}a home and month to view rotas.
                    </p>
                ) : !rota ? (
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>No LIVE rota for this month.</p>
                ) : (
                    <CalendarGrid
                        monthISO={month}
                        hidden={false}
                        cellRenderer={(d) => {
                            const todays = entries.filter(e => e.day_of_month === d);
                            const visible = viewMode === 'MINE' ? todays.filter(e => e.user_id === uid) : todays;
                            return (
                                <div className="space-y-1">
                                    {visible.length === 0 ? (
                                        <div className="text-xs" style={{ color: 'var(--sub)' }}>—</div>
                                    ) : visible.map(e => {
                                        const { bg, border, fg } = colorFor(e.user_id, isDark);
                                        const code = e.shift_type_id ? codeById.get(e.shift_type_id) : undefined;
                                        const inits = initialsFor(people, e.user_id);
                                        const titleText = (() => {
                                            const full = displayName(people, e.user_id);
                                            const s = hhmmLocal(e.start_time ?? null);
                                            if (!s) return full;
                                            const { end, nextDay } = endTimeFromLocal(s, e.hours || 0);
                                            return `${full} · ${s}–${end}${nextDay ? ' (+1d)' : ''}`;
                                        })();
                                        return (
                                            <div
                                                key={e.id}
                                                className="rounded-lg px-2 py-1"
                                                style={{ background: bg, border: `1px solid ${border}`, color: fg }}
                                                title={titleText}
                                            >
                                                <div className="text-[12px] leading-tight truncate">
                                                    <span className="font-semibold">{inits}</span>
                                                    {code && <> · <span className="font-mono">{code}</span></>}
                                                    <> · {e.hours}h</>
                                                </div>
                                                {e.notes && (
                                                    <div className="mt-0.5 text-[11px] break-words" style={{ color: 'var(--sub)' }}>
                                                        {e.notes}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        }}
                    />
                )
            ) : (
                // Bank View (no home selected): my shifts across all LIVE rotas in this month, per RLS
                <CalendarGrid
                    monthISO={month}
                    hidden={false}
                    cellRenderer={(d) => {
                        const todays = bankEntries.filter(e => e.day_of_month === d);
                        return (
                            <div className="space-y-1">
                                {todays.length === 0 ? (
                                    <div className="text-xs" style={{ color: 'var(--sub)' }}>—</div>
                                ) : todays.map(e => {
                                    const { bg, border, fg } = colorFor(e.user_id, isDark);
                                    const code = e.shift_type_id ? codeById.get(e.shift_type_id) : undefined;
                                    const inits = initialsFor(people, e.user_id);
                                    const h = e._home_id ? homeById.get(e._home_id) : undefined;
                                    const titleText = (() => {
                                        const full = displayName(people, e.user_id);
                                        const s = hhmmLocal(e.start_time ?? null);
                                        if (!s) return full;
                                        const { end, nextDay } = endTimeFromLocal(s, e.hours || 0);
                                        return `${full} · ${s}–${end}${nextDay ? ' (+1d)' : ''}`;
                                    })();
                                    return (
                                        <div
                                            key={e.id}
                                            className="rounded-lg px-2 py-1"
                                            style={{ background: bg, border: `1px solid ${border}`, color: fg }}
                                            title={titleText}
                                        >
                                            <div className="text-[12px] leading-tight truncate">
                                                <span className="font-semibold">{inits}</span>
                                                {code && <> · <span className="font-mono">{code}</span></>}
                                                <> · {e.hours}h</>
                                            </div>
                                            {h && (
                                                <div className="text-[11px]" style={{ color: 'var(--sub)' }}>
                                                    @ {h.name}
                                                </div>
                                            )}
                                            {e.notes && (
                                                <div className="mt-0.5 text-[11px] break-words" style={{ color: 'var(--sub)' }}>
                                                    {e.notes}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    }}
                />
            )}
        </div>
    );
}

/* ========= Utilities for KPIs ========= */

/* =========================
   MANAGE ROTAS (create/edit)
   ========================= */
function ManageRotas({ isAdmin, isCompany, isManager }: {
    isAdmin: boolean; isCompany: boolean; isManager: boolean;
}) {
    // local helpers for tooltips
    const hhmmLocal = (t?: string | null) => (t ? t.slice(0, 5) : null);
    const endTimeFromLocal = (startHHMM: string, hours: number) => {
        const [H, M] = startHHMM.split(':').map(n => parseInt(n, 10));
        if (Number.isNaN(H) || Number.isNaN(M)) return { end: startHHMM, nextDay: false };
        const add = Math.round((hours || 0) * 60);
        let mins = H * 60 + M + add;
        let nextDay = false;
        if (mins >= 24 * 60) { mins = mins % (24 * 60); nextDay = true; }
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(mins % 60).padStart(2, '0');
        return { end: `${hh}:${mm}`, nextDay };
    };

    type EntryWithStart = Entry & { start_time?: string | null };

    const isDark = useIsDark();

    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState<string>('');

    // Managers: only their homes. Admin/company: homes for selected/first company.
    const [myHomes, setMyHomes] = useState<Home[]>([]);
    const [homeId, setHomeId] = useState<string>('');

    const [month, setMonth] = useState<string>(() => firstOfMonthLocalISO());
    const [rota, setRota] = useState<Rota | null>(null);
    const [entries, setEntries] = useState<EntryWithStart[]>([]);
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);

    // KPI state
    const [kpiWeekly, setKpiWeekly] = useState<KpiRow[]>([]);
    const [kpiMonthTotal, setKpiMonthTotal] = useState<number>(0);
    const isAllHomes = (homeId === 'ALL');

    const [profiles, setProfiles] = useState<Profile[]>([]);
    const codeById = useMemo(() => {
        const m = new Map<string, string>();
        shiftTypes.forEach(s => m.set(s.id, s.code));
        return m;
    }, [shiftTypes]);

    // editor state
    const [editingDay, setEditingDay] = useState<number | null>(null);
    const [editUserId, setEditUserId] = useState<string>('');
    const [editShiftId, setEditShiftId] = useState<string | ''>('');
    const [editHours, setEditHours] = useState<number>(0);
    const [editNotes, setEditNotes] = useState<string>(''); // Notes
    const [editStart, setEditStart] = useState<string>(''); // 'HH:MM'
    const [editEntryId, setEditEntryId] = useState<string | undefined>(undefined);
    const [includeBank, setIncludeBank] = useState<boolean>(false);

    const [homePeopleIds, setHomePeopleIds] = useState<string[]>([]);
    const [bankPeopleIds, setBankPeopleIds] = useState<string[]>([]);

    // Initial companies + my homes
    useEffect(() => {
        (async () => {
            if (isAdmin) {
                const co = await supabase.from('companies').select('id,name').order('name');
                setCompanies(((co.data ?? []) as Company[]));
            }

            const rpcMine = await supabase.rpc('homes_list_for_ui', { p_company_id: isAdmin ? (companyId || null) : null });
            const list = (rpcMine.data ?? []) as Home[];
            setMyHomes(list);

            if (isManager && list.length === 1) {
                setHomeId(list[0].id);
                setCompanyId(list[0].company_id);
            }
            if ((isAdmin || isCompany) && !homeId && list[0]) {
                setHomeId(list[0].id);
                setCompanyId(list[0].company_id);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, isCompany, isManager]);

    // Admin: reload homes when company changes
    useEffect(() => {
        (async () => {
            if (!isAdmin) return;
            const rpcMine = await supabase.rpc('homes_list_for_ui', { p_company_id: companyId || null });
            const list = (rpcMine.data ?? []) as Home[];
            setMyHomes(list);
            if (!homeId && list[0]) {
                setHomeId(list[0].id);
                setCompanyId(list[0].company_id);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, companyId]);

    // Shift types via RPC
    useEffect(() => {
        (async () => {
            const cid =
                companyId ||
                myHomes.find(h => h.id === homeId)?.company_id ||
                '';

            if (!cid) { setShiftTypes([]); return; }

            const { data, error } = await supabase.rpc('shift_types_for_ui', {
                p_company_id: cid,
                p_include_inactive: false
            });
            if (!error) setShiftTypes((data ?? []) as ShiftType[]);
        })();
    }, [companyId, homeId, myHomes]);

    // Load rota + entries for selected home
    useEffect(() => {
        (async () => {
            setRota(null); setEntries([]);
            setKpiWeekly([]); setKpiMonthTotal(0);

            if (!homeId || !month) return;

            // If a specific home is selected → load single rota & entries
            if (!isAllHomes) {
                const h = myHomes.find(hh => hh.id === homeId);
                if (h && companyId !== h.company_id) setCompanyId(h.company_id);

                const r = await supabase.from('rotas').select('*')
                    .eq('home_id', homeId).eq('month_date', month).maybeSingle();
                setRota((r.data as Rota) || null);

                if (r.data) {
                    const e = await supabase.from('rota_entries').select('*').eq('rota_id', (r.data as Rota).id);
                    const rows = (e.data ?? []) as EntryWithStart[];
                    setEntries(rows);

                    // KPI (exclude Annual Leave)
                    const stKind = new Map(shiftTypes.map(s => [s.id, (s.kind || '').toUpperCase()]));
                    const k = buildWeeklyKpis(month, rows.map(x => ({
                        day_of_month: x.day_of_month,
                        hours: x.hours || 0,
                        isAnnualLeave: x.shift_type_id ? (stKind.get(x.shift_type_id) === 'ANNUAL_LEAVE') : false,
                    })));
                    setKpiWeekly(k.weekly); setKpiMonthTotal(k.monthTotal);
                }
                return;
            }

            // If "ALL" homes selected → aggregate across all homes for the company for that month
            if (!(isAdmin || isCompany)) return;
            const homeIds = myHomes.map(h => h.id);
            if (!homeIds.length) return;

            // entries across all rotas for the month (inner join rotas)
            const rs = await supabase
                .from('rota_entries')
                .select('id, day_of_month, hours, shift_type_id, rotas!inner(id, home_id, month_date)')
                .eq('rotas.month_date', month)
                .in('rotas.home_id', homeIds);

            const rows = ((rs.data as unknown[] | null) ?? []) as (EntryWithStart & { rotas?: { id: string; home_id: string; month_date: string } })[];

            // KPI (exclude Annual Leave)
            const stKind = new Map(shiftTypes.map(s => [s.id, (s.kind || '').toUpperCase()]));
            const k = buildWeeklyKpis(month, rows.map(x => ({
                day_of_month: x.day_of_month,
                hours: x.hours || 0,
                isAnnualLeave: x.shift_type_id ? (stKind.get(x.shift_type_id) === 'ANNUAL_LEAVE') : false,
            })));
            setKpiWeekly(k.weekly); setKpiMonthTotal(k.monthTotal);
        })();
    }, [homeId, month, shiftTypes, isAllHomes, myHomes, companyId, isAdmin, isCompany]);

    // People ids for the selected home (optionally bank)
    // MERGE profiles instead of replacing so bank names never drop to "numbers"
    useEffect(() => {
        (async () => {
            if (!homeId) {
                setHomePeopleIds([]); setBankPeopleIds([]); setProfiles([]); return;
            }

            // Everyone we can assign (home + optional bank)
            const people = await supabase.rpc('home_staff_for_ui', { p_home_id: homeId, include_bank: includeBank });
            const ids = (people.data ?? []) as { user_id: string }[];
            const uniqueIds = Array.from(new Set(ids.map(x => x.user_id)));

            // Merge fetched profiles into existing ones
            if (uniqueIds.length) {
                const prof = await supabase.from('profiles').select('user_id, full_name').in('user_id', uniqueIds);
                setProfiles(prev => {
                    const map = new Map(prev.map(p => [p.user_id, p.full_name]));
                    (prof.data ?? []).forEach((p) => {
                        const row = p as Profile;
                        map.set(row.user_id, row.full_name);
                    });
                    return Array.from(map, ([user_id, full_name]) => ({ user_id, full_name })) as Profile[];
                });
            } else {
                setProfiles([]);
            }

            // Split into home vs bank (for optgroups)
            const homeOnly = await supabase.rpc('home_staff_for_ui', { p_home_id: homeId, include_bank: false });
            const homeIds = ((homeOnly.data ?? []) as { user_id: string }[]).map(x => x.user_id);
            setHomePeopleIds(homeIds);

            if (includeBank) {
                const bankOnly = uniqueIds.filter(id => !homeIds.includes(id));
                setBankPeopleIds(bankOnly);
            } else {
                setBankPeopleIds([]);
            }
        })();
    }, [homeId, includeBank]);

    // Ensure names for existing entries too (even if you toggle the bank checkbox)
    // MERGE profiles here as well, and depend on includeBank
    useEffect(() => {
        (async () => {
            if (!entries.length) return;
            const ids = Array.from(new Set(entries.map(e => e.user_id)));
            if (!ids.length) return;
            const prof = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
            setProfiles(prev => {
                const map = new Map(prev.map(p => [p.user_id, p.full_name]));
                (prof.data ?? []).forEach((p) => {
                    const row = p as Profile;
                    map.set(row.user_id, row.full_name);
                });
                return Array.from(map, ([user_id, full_name]) => ({ user_id, full_name })) as Profile[];
            });
        })();
    }, [entries, includeBank]);

    async function ensureRota(): Promise<Rota | undefined> {
        if (!homeId || !month) return;
        const existing = await supabase.from('rotas').select('*')
            .eq('home_id', homeId).eq('month_date', month).maybeSingle();
        if (existing.data) return existing.data as Rota;

        const { data: u } = await supabase.auth.getUser();
        const ins = await supabase.from('rotas').insert({
            home_id: homeId, month_date: month, status: 'DRAFT', created_by: u.user?.id ?? null
        }).select('*').single();
        if (ins.error) { alert(ins.error.message); return; }
        setRota(ins.data as Rota);
        return ins.data as Rota;
    }

    async function makeLive() {
        if (!rota) { alert('No rota to publish. Add an entry first.'); return; }
        const { error } = await supabase.rpc('publish_rota', { p_rota_id: rota.id });
        if (error) { alert(error.message); return; }
        setRota({ ...rota, status: 'LIVE' });
    }

    async function setDraft() {
        if (!rota) return;
        const { error } = await supabase.rpc('unpublish_rota', { p_rota_id: rota.id });
        if (error) { alert(error.message); return; }
        setRota({ ...rota, status: 'DRAFT' });
    }

    function openEditor(day: number, entry?: EntryWithStart) {
        if (rota?.status === 'LIVE') return; // read-only when live
        setEditingDay(day);
        if (entry) {
            setEditEntryId(entry.id);
            setEditUserId(entry.user_id);
            setEditShiftId(entry.shift_type_id || '');
            setEditHours(entry.hours);
            setEditNotes(entry.notes || '');
            setEditStart(hhmmLocal(entry.start_time ?? null) || '');
        } else {
            setEditEntryId(undefined);
            setEditUserId('');
            setEditShiftId('');
            setEditHours(0);
            setEditNotes('');
            setEditStart('');
        }
    }
    function onPickShift(sid: string) {
        setEditShiftId(sid);
        const st = shiftTypes.find(s => s.id === sid);
        if (st) setEditHours(st.default_hours);
    }

    async function saveEditor() {
        // 1) Guards first
        if (!editingDay) return;
        const rr = rota || await ensureRota();
        if (!rr) return;
        if (rr.status === 'LIVE') return;
        if (!editUserId) { alert('Pick a person.'); return; }

        // 2) Build payload (include work_home_id for RLS)
        const payload = {
            rota_id: rr.id,
            day_of_month: editingDay,
            user_id: editUserId,
            shift_type_id: editShiftId || null,
            hours: Number(editHours) || 0,
            notes: editNotes?.trim() ? editNotes.trim() : null,
            start_time: editStart ? `${editStart}:00` : null,
            work_home_id: rr.home_id as string, // required by your RLS policies
        };

        // 3) Insert or update
        if (!editEntryId) {
            const ins = await supabase
                .from('rota_entries')
                .upsert(payload, { onConflict: 'rota_id,day_of_month,user_id' })
                .select('*')
                .single();

            if (ins.error) { alert(ins.error.message); return; }

            setEntries(prev => {
                const i = prev.findIndex(
                    e => e.rota_id === rr.id && e.day_of_month === editingDay && e.user_id === editUserId
                );
                if (i === -1) return [...prev, ins.data as EntryWithStart];
                const next = prev.slice();
                next[i] = ins.data as EntryWithStart;
                return next;
            });
        } else {
            const upd = await supabase
                .from('rota_entries')
                .update({
                    shift_type_id: payload.shift_type_id,
                    hours: payload.hours,
                    notes: payload.notes,
                    start_time: payload.start_time,
                    work_home_id: rr.home_id,
                })
                .eq('id', editEntryId)
                .select('*')
                .single();

            if (upd.error) { alert(upd.error.message); return; }
            setEntries(prev => prev.map(e => (e.id === editEntryId ? (upd.data as EntryWithStart) : e)));
        }

        setEditingDay(null);
    }

    async function deleteEntry(id: string) {
        if (!rota || rota.status === 'LIVE') return;
        setEntries(prev => prev.filter(e => e.id !== id));
        const { error } = await supabase.from('rota_entries').delete().eq('id', id);
        if (error) {
            alert(error.message);
            const refreshed = await supabase.from('rota_entries').select('*').eq('rota_id', rota.id);
            setEntries(((refreshed.data ?? []) as EntryWithStart[]));
        }
    }

    const requireCompany = isAdmin;
    const calendarHidden = !homeId || !month || (isAdmin && !companyId);

    const rightExtra = (
        <div className="flex items-center gap-2 justify-end" style={{ color: 'var(--ink)' }}>
            <label className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--sub)' }}>
                <input type="checkbox" checked={includeBank} onChange={e => setIncludeBank(e.target.checked)} />
                Include bank staff
            </label>
            <button disabled={!rota || rota.status === 'LIVE'} onClick={makeLive}
                className="rounded-lg px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
            >
                Make Live
            </button>
            <button disabled={!rota || rota.status === 'DRAFT'} onClick={setDraft}
                className="rounded-lg px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
            >
                Set Draft
            </button>
            {rota && (
                <span
                    className={`text-xs px-2 py-1 rounded ring-1 ${rota.status === 'LIVE'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-100 [data-orbit="1"]:bg-emerald-500/10 [data-orbit="1"]:text-emerald-200 [data-orbit="1"]:ring-emerald-400/25'
                            : 'bg-amber-50 text-amber-700 ring-amber-100 [data-orbit="1"]:bg-amber-500/10 [data-orbit="1"]:text-amber-200 [data-orbit="1"]:ring-amber-400/25'
                        }`}
                >
                    Status: {rota.status}
                </span>
            )}
        </div>
    );

    // dd/mm/yyyy formatter for KPI display
    function toUKDate(isoYmd: string): string {
        const [y, m, d] = isoYmd.split('-');
        if (!y || !m || !d) return isoYmd;
        return `${d}/${m}/${y}`;
    }

    function KpiPanel({ weekly, total }: { weekly: KpiRow[]; total: number }) {
        if (!weekly.length && total === 0) {
            return (
                <section className="rounded-xl p-4 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    <div className="text-sm" style={{ color: 'var(--sub)' }}>No hours found for this selection.</div>
                </section>
            );
        }
        return (
            <section className="rounded-xl p-4 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--ink)' }}>KPI — Hours (excl. Annual Leave)</h3>
                <div className="overflow-auto">
                    <table className="min-w-[480px] text-sm" style={{ color: 'var(--ink)' }}>
                        <thead style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)' }}>
                            <tr>
                                <th className="text-left p-2">Week</th>
                                <th className="text-right p-2">Hours</th>
                            </tr>
                        </thead>
                        <tbody>
                            {weekly.map(w => (
                                <tr key={w.week_start} style={{ borderTop: '1px solid var(--ring)' }}>
                                    <td className="p-2">{toUKDate(w.week_start)} → {toUKDate(w.week_end)}</td>
                                    <td className="p-2 text-right font-medium">{w.hours.toFixed(2)}</td>
                                </tr>
                            ))}
                            <tr style={{ borderTop: '1px solid var(--ring)', background: 'var(--nav-item-bg)' }}>
                                <td className="p-2 font-semibold">Month total</td>
                                <td className="p-2 text-right font-semibold">{total.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        );
    }

    return (
        <div className="space-y-3" style={{ color: 'var(--ink)' }}>
            <Toolbar
                companies={isAdmin ? companies : undefined}
                companyId={isAdmin ? companyId : undefined}
                setCompanyId={isAdmin ? setCompanyId : undefined}
                homes={
                    // Inject a virtual "All homes" option for Admin/Company users
                    (isAdmin || isCompany) && myHomes.length
                        ? [{ id: 'ALL', name: 'All homes', company_id: myHomes[0].company_id }, ...myHomes]
                        : myHomes
                }
                homeId={homeId}
                setHomeId={(v) => {
                    setHomeId(v);
                    // keep companyId aligned when choosing a specific home (no-op for ALL)
                    const h = myHomes.find(x => x.id === v);
                    if (h) setCompanyId(h.company_id);
                }}
                month={month}
                setMonth={setMonth}
                requireCompanyForAdmin={isAdmin}
                rightExtra={rightExtra}
            />

            {/* KPI panel always visible on Manage; excludes Annual Leave */}
            <KpiPanel weekly={kpiWeekly} total={kpiMonthTotal} />

            {/* Calendar & editing are hidden when "All homes" is selected */}
            {!isAllHomes && (
                <>
                    <CalendarGrid
                        monthISO={month}
                        hidden={calendarHidden}
                        cellRenderer={(d) => {
                            const todays = entries.filter(e => e.day_of_month === d);
                            return (
                                <div className="space-y-1">
                                    {todays.map(e => {
                                        const userId = e.user_id ?? 'unknown';
                                        const { bg, border, fg } = colorFor(userId, isDark);
                                        const code = e.shift_type_id ? codeById.get(e.shift_type_id) : undefined;
                                        const inits = initialsFor(profiles, userId);
                                        const titleText = (() => {
                                            const full = displayName(profiles, userId);
                                            const s = hhmmLocal(e.start_time ?? null);
                                            if (!s) return full;
                                            const { end, nextDay } = endTimeFromLocal(s, e.hours || 0);
                                            return `${full} · ${s}–${end}${nextDay ? ' (+1d)' : ''}`;
                                        })();

                                        return (
                                            <div
                                                key={e.id}
                                                className="rounded-lg px-2 py-1"
                                                style={{ background: bg, border: `1px solid ${border}`, color: fg }}
                                                title={titleText}
                                            >
                                                <div className="text-[12px] leading-tight truncate">
                                                    <span className="font-semibold">{inits || '??'}</span>
                                                    {code && <> · <span className="font-mono">{code}</span></>}
                                                    <> · {e.hours}h</>
                                                </div>
                                                {e.notes && (
                                                    <div className="mt-0.5 text-[11px] break-words" style={{ color: 'var(--sub)' }}>
                                                        {e.notes}
                                                    </div>
                                                )}
                                                {rota?.status !== 'LIVE' && (
                                                    <div className="mt-1 flex gap-1">
                                                        <button onClick={() => openEditor(d, e)}
                                                            className="rounded px-2 py-[2px] text-[11px] ring-1 transition"
                                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button onClick={() => deleteEntry(e.id)}
                                                            className="rounded px-2 py-[2px] text-[11px] ring-1 transition"
                                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {rota?.status !== 'LIVE' && (
                                        <button
                                            onClick={() => openEditor(d)}
                                            className="mt-1 rounded px-2 py-[2px] text-[11px] ring-1 transition"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                        >
                                            Add
                                        </button>
                                    )}
                                </div>
                            );
                        }}
                    />

                    {/* Inline editor modal */}
                    {editingDay && (
                        <div
                            className="fixed inset-0 bg-black/30 grid place-items-center z-50"
                            onClick={() => setEditingDay(null)}
                        >
                            <div
                                className="w-full max-w-md rounded-xl p-4 ring-1 shadow-xl"
                                style={{ background: 'var(--panel-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                onClick={e => e.stopPropagation()}
                            >
                                <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--ink)' }}>Day {editingDay}</h3>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Person</label>
                                        <select
                                            className="w-full rounded-lg px-3 py-2 ring-1"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            value={editUserId}
                                            onChange={e => setEditUserId(e.target.value)}
                                        >
                                            <option value="">Select person…</option>
                                            <optgroup label="Home staff">
                                                {homePeopleIds.map(uid => (
                                                    <option key={uid} value={uid}>
                                                        {displayName(profiles, uid)}
                                                    </option>
                                                ))}
                                            </optgroup>
                                            {includeBank && bankPeopleIds.length > 0 && (
                                                <optgroup label="Bank staff">
                                                    {bankPeopleIds.map(uid => (
                                                        <option key={uid} value={uid}>
                                                            {displayName(profiles, uid)}
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            )}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Start time</label>
                                        <input
                                            type="time"
                                            className="w-full rounded-lg px-3 py-2 ring-1"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            value={editStart}
                                            onChange={e => setEditStart(e.target.value)}
                                        />
                                        {editStart && (
                                            <p className="mt-1 text-xs" style={{ color: 'var(--sub)' }}>
                                                Ends at {
                                                    (() => {
                                                        const { end, nextDay } = endTimeFromLocal(editStart, editHours || 0);
                                                        return `${end}${nextDay ? ' (+1d)' : ''}`;
                                                    })()
                                                }
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Shift type</label>
                                        <select
                                            className="w-full rounded-lg px-3 py-2 ring-1"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            value={editShiftId}
                                            onChange={e => onPickShift(e.target.value)}
                                        >
                                            <option value="">(none)</option>
                                            {shiftTypes.map(s => (
                                                <option key={s.id} value={s.id}>
                                                    {s.code} — {s.label}
                                                </option>
                                            ))}
                                        </select>
                                        {shiftTypes.length === 0 && (
                                            <p className="mt-1 text-xs" style={{ color: 'var(--sub)' }}>
                                                No active shift types found. Check Rota Settings or re-activate codes.
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Hours</label>
                                        <input
                                            type="number"
                                            min={0}
                                            step="0.25"
                                            className="w-full rounded-lg px-3 py-2 ring-1"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            value={editHours}
                                            onChange={e => setEditHours(Number(e.target.value))}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Notes (optional)</label>
                                        <textarea
                                            className="w-full rounded-lg px-3 py-2 text-sm ring-1"
                                            rows={2}
                                            placeholder="e.g. Covering late at short notice"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            value={editNotes}
                                            onChange={e => setEditNotes(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="mt-4 flex justify-between items-center">
                                    <label className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--sub)' }}>
                                        <input
                                            type="checkbox"
                                            checked={includeBank}
                                            onChange={e => setIncludeBank(e.target.checked)}
                                        />
                                        Include bank staff
                                    </label>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setEditingDay(null)}
                                            className="rounded px-3 py-2 text-sm ring-1 transition"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={saveEditor}
                                            className="rounded px-3 py-2 text-sm ring-1 transition"
                                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {isAllHomes && (
                <p className="text-xs" style={{ color: 'var(--sub)' }}>
                    Viewing KPI totals across <strong>all homes</strong> this month. Select a specific home to edit rota entries.
                </p>
            )}
        </div>
    );
}


// Local YYYY-MM-DD (no UTC conversion)
function ymdLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Week start = Sunday
function weekStart(d: Date): Date {
    const x = new Date(d);
    // 0=Sun..6=Sat, so subtract day-of-week to get back to Sunday
    x.setDate(d.getDate() - d.getDay());
    x.setHours(0, 0, 0, 0);
    return x;
}

function buildWeeklyKpis(
    monthISO: string,
    rows: { day_of_month: number; hours: number; isAnnualLeave?: boolean }[]
): { weekly: KpiRow[]; monthTotal: number } {
    // Exclude Annual Leave
    const filtered = rows.filter(r => !r.isAnnualLeave && (r.hours || 0) > 0);
    if (!filtered.length) return { weekly: [], monthTotal: 0 };

    // Map each entry to an actual local date within the month
    const base = new Date(`${monthISO}T00:00:00`);
    const y = base.getFullYear(), m = base.getMonth();
    const dated = filtered.map(r => ({ date: new Date(y, m, r.day_of_month), hours: r.hours }));

    // Group by local Sunday week start
    const weekHours = new Map<string, number>(); // key = yyy-mm-dd (local)
    for (const { date, hours } of dated) {
        const ws = weekStart(date);           // local Date at the Sunday
        const key = ymdLocal(ws);             // avoid UTC toISOString()
        weekHours.set(key, (weekHours.get(key) || 0) + hours);
    }

    // Build rows as Sunday → Saturday (no clipping)
    const weekly: KpiRow[] = Array.from(weekHours.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([wsYmd, hrs]) => {
            const wsDate = new Date(wsYmd + 'T00:00:00'); // reconstruct local date
            const weDate = new Date(wsDate);
            weDate.setDate(wsDate.getDate() + 6);         // Saturday
            return {
                week_start: ymdLocal(wsDate),
                week_end: ymdLocal(weDate),
                hours: Number((hrs || 0).toFixed(2)),
            };
        });

    // Month total = sum of the (in-month) entry hours we used
    const monthTotal = Number(filtered.reduce((sum, r) => sum + (r.hours || 0), 0).toFixed(2));

    return { weekly, monthTotal };
}

/* ========= Rota Settings ========= */

const SHIFT_KINDS = [
    { value: '', label: '(none)' },
    { value: 'SLEEP', label: 'Sleep' },
    { value: 'ANNUAL_LEAVE', label: 'Annual leave' },
    { value: 'SICKNESS', label: 'Sickness' },
    { value: 'WAKING_NIGHT', label: 'Waking night' },
    { value: 'OTHER_LEAVE', label: 'Other leave' },
] as const;

function RotaSettings({ isAdmin }: { isAdmin: boolean }) {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState<string>('');
    const [list, setList] = useState<ShiftType[]>([]);
    const [code, setCode] = useState('ELS');
    const [label, setLabel] = useState('Early-Late-Sleep');
    const [defHours, setDefHours] = useState(16);
    const [kind, setKind] = useState<string>('');
    const [err, setErr] = useState<string | undefined>(undefined);

    useEffect(() => {
        (async () => {
            if (isAdmin) {
                const co = await supabase.from('companies').select('id,name').order('name');
                setCompanies(((co.data ?? []) as Company[]));
            } else {
                const cm = await supabase.from('company_memberships').select('company_id').maybeSingle();
                const cid = (cm.data?.company_id as string | undefined) ?? '';
                setCompanyId(cid);
            }
        })();
    }, [isAdmin]);

    useEffect(() => {
        (async () => {
            setErr(undefined);
            if (!companyId) { setList([]); return; }
            const st = await supabase.from('shift_types').select('*').eq('company_id', companyId).order('code');
            setList((st.data ?? []) as ShiftType[]);
        })();
    }, [companyId]);

    async function addType(e: React.FormEvent) {
        e.preventDefault(); setErr(undefined);
        if (!companyId) { setErr('Pick a company first.'); return; }
        const ins = await supabase.from('shift_types').insert({
            company_id: companyId,
            code: code.trim(),
            label: label.trim(),
            default_hours: defHours,
            kind: kind ? kind : null,
        }).select('*').single();
        if (ins.error) { setErr(ins.error.message); return; }
        setList(prev => [...prev, ins.data as ShiftType]);
        setCode(''); setLabel(''); setDefHours(0); setKind('');
    }

    async function toggleActive(id: string, is_active: boolean) {
        const upd = await supabase.from('shift_types').update({ is_active }).eq('id', id).select('*').single();
        if (!upd.error) setList(list.map(s => s.id === id ? (upd.data as ShiftType) : s));
    }

    async function saveRow(row: ShiftType, patch: Partial<ShiftType>) {
        const upd = await supabase.from('shift_types').update(patch).eq('id', row.id).select('*').single();
        if (upd.error) { alert(upd.error.message); return; }
        setList(list.map(s => s.id === row.id ? (upd.data as ShiftType) : s));
    }

    async function deleteRow(row: ShiftType) {
        const { error } = await supabase.from('shift_types').delete().eq('id', row.id);
        if (error) { alert(error.message); return; }
        setList(prev => prev.filter(s => s.id !== row.id));
    }

    return (
        <div className="space-y-4 max-w-3xl" style={{ color: 'var(--ink)' }}>
            <section className="rounded-xl p-4 space-y-3 ring-1"
                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
            >
                <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>Shift types</h2>

                {isAdmin && (
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--sub)' }}>Company</label>
                        <select
                            className="w-full max-w-sm rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={companyId}
                            onChange={e => setCompanyId(e.target.value)}
                        >
                            <option value="">Select company…</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}

                <form onSubmit={addType} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--sub)' }}>Code</label>
                        <input
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            required
                        />
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1" style={{ color: 'var(--sub)' }}>Label</label>
                        <input
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={label}
                            onChange={e => setLabel(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--sub)' }}>Default hours</label>
                        <input
                            type="number"
                            min={0}
                            step="0.25"
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={defHours}
                            onChange={e => setDefHours(Number(e.target.value))}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--sub)' }}>Category</label>
                        <select
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={kind}
                            onChange={e => setKind(e.target.value)}
                        >
                            {SHIFT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                        </select>
                    </div>
                    <div className="sm:col-span-5">
                        <button
                            className="rounded-md px-3 py-2 text-sm text-white transition disabled:opacity-50"
                            style={{ background: BRAND_GRADIENT }}
                            disabled={!companyId}
                        >
                            Add
                        </button>
                        {err && <span className="ml-3 text-sm" style={{ color: '#DC2626' }}>{err}</span>}
                    </div>
                </form>
            </section>

            <section className="rounded-xl p-0 ring-1"
                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
            >
                <div className="max-h-[28rem] overflow-auto">
                    <table className="min-w-full text-sm" style={{ color: 'var(--ink)' }}>
                        <thead className="sticky top-0"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)' }}
                        >
                            <tr>
                                <th className="text-left p-2">Code</th>
                                <th className="text-left p-2">Label</th>
                                <th className="text-left p-2">Default hours</th>
                                <th className="text-left p-2">Category</th>
                                <th className="text-left p-2">Active</th>
                                <th className="p-2 w-[160px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map(s => (
                                <EditableShiftRow
                                    key={s.id}
                                    item={s}
                                    onSave={(patch) => saveRow(s, patch)}
                                    onToggleActive={(v) => toggleActive(s.id, v)}
                                    onDelete={() => deleteRow(s)}
                                />
                            ))}
                            {(!list || list.length === 0) && (
                                <tr>
                                    <td className="p-2 text-sm" style={{ color: 'var(--sub)' }} colSpan={6}>
                                        No shift types yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function EditableShiftRow({
    item,
    onSave,
    onToggleActive,
    onDelete,
}: {
    item: ShiftType;
    onSave: (patch: Partial<ShiftType>) => Promise<void>;
    onToggleActive: (isActive: boolean) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [code, setCode] = useState(item.code);
    const [label, setLabel] = useState(item.label);
    const [hours, setHours] = useState<number>(item.default_hours);
    const [kind, setKind] = useState<string>(item.kind || '');
    const [busy, setBusy] = useState(false);

    async function save() {
        setBusy(true);
        await onSave({
            code: code.trim(),
            label: label.trim(),
            default_hours: Number(hours) || 0,
            kind: kind ? kind : null,
        });
        setBusy(false);
        setEditing(false);
    }

    return (
        <tr className="align-top" style={{ borderTop: '1px solid var(--ring)' }}>
            <td className="p-2 font-mono" style={{ color: 'var(--ink)' }}>
                {editing ? (
                    <input
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        value={code}
                        onChange={e => setCode(e.target.value)}
                    />
                ) : (
                    item.code
                )}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {editing ? (
                    <input
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        value={label}
                        onChange={e => setLabel(e.target.value)}
                    />
                ) : (
                    item.label
                )}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {editing ? (
                    <input
                        type="number"
                        min={0}
                        step="0.25"
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        value={hours}
                        onChange={e => setHours(Number(e.target.value))}
                    />
                ) : (
                    item.default_hours
                )}
            </td>
            <td className="p-2">
                {editing ? (
                    <select
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        value={kind}
                        onChange={e => setKind(e.target.value)}
                    >
                        {SHIFT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                ) : (
                    <span style={{ color: 'var(--sub)' }}>
                        {SHIFT_KINDS.find(k => k.value === (item.kind || ''))?.label || '(none)'}
                    </span>
                )}
            </td>
            <td className="p-2">
                <label className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                    <input
                        type="checkbox"
                        checked={item.is_active}
                        onChange={(e) => onToggleActive(e.target.checked)}
                    />
                    <span>{item.is_active ? 'Active' : 'Inactive'}</span>
                </label>
            </td>
            <td className="p-2">
                {!editing ? (
                    <div className="flex gap-2">
                        <button
                            onClick={() => setEditing(true)}
                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        >
                            Edit
                        </button>
                        <button
                            onClick={onDelete}
                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        >
                            Delete
                        </button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <button
                            disabled={busy}
                            onClick={save}
                            className="rounded-md px-2 py-1 text-xs ring-1 transition disabled:opacity-60"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        >
                            {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            disabled={busy}
                            onClick={() => {
                                setEditing(false);
                                setCode(item.code);
                                setLabel(item.label);
                                setHours(item.default_hours);
                                setKind(item.kind || '');
                            }}
                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        >
                            Cancel
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
}

/* Keep top-level helpers referenced if present earlier in the file
   to avoid no-unused-vars when local variants are used in components. */
void hhmm;
void endTimeFrom;

