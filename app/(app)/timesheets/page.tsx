'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

/* ===================================
   Types (matches the classic schema)
   =================================== */
type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type Company = { id: string; name: string };
type Home = { id: string; name: string; company_id: string };
type Profile = { user_id: string; full_name: string | null };

type ShiftType = {
    id: string; company_id: string; code: string; label: string;
    default_hours: number; is_active: boolean; kind: string | null;
};

type Timesheet = {
    id: string;
    home_id: string;          // per-home timesheet (even for bank users)
    user_id: string;
    month_date: string;       // YYYY-MM-01
    status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'MANAGER_SUBMITTED';
    submitted_at: string | null;
    manager_submitted_at: string | null;
};

type TSEntry = {
    id: string;
    timesheet_id: string;
    day_of_month: number;
    shift_type_id: string | null;
    hours: number;
    notes: string | null;
};

// Helpers for joined rows we read from Supabase
type RotaJoin = {
    rotas: { id: string; home_id: string; month_date: string; status: string };
    day_of_month?: number;
    shift_type_id?: string | null;
    hours?: number | null;
    user_id?: string;
};

type TimesheetWithHomeName = Timesheet & { home_name: string };

/* ===================================
   Helpers / Small UI bits
   =================================== */

// cache across renders (module-level) — intentionally unused for now
// (prefixed to satisfy no-unused-vars)
const _profileCache = new Map<string, Profile>();

const KIND_LABEL: Record<string, string> = {
    SLEEP: 'Sleep',
    ANNUAL_LEAVE: 'Annual leave',
    SICKNESS: 'Sickness',
    WAKING_NIGHT: 'Waking night',
    OTHER_LEAVE: 'Other leave',
};

function firstOfMonthLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}-01`;
}
function ym(iso: string) {
    return iso.slice(0, 7);
}

function initialsFor(list: Profile[], id: string) {
    const full = list.find(p => p.user_id === id)?.full_name?.trim();
    if (full && full.length) {
        const parts = full.split(/\s+/);
        const first = parts[0]?.[0] || '';
        const last = (parts.length > 1 ? parts[parts.length - 1]?.[0] : '') || (parts[0]?.[1] || '');
        return (first + (last || '')).toUpperCase();
    }
    return id.slice(0, 2).toUpperCase();
}

function TabBtn(
    { active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
    return (
        <button
            className={`px-4 py-2 text-sm ${active ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'}`}
            {...props}
        >
            {children}
        </button>
    );
}
function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg border p-3 text-center">
            <div className="text-xs text-gray-600 mb-1">{label}</div>
            <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
    );
}
function CalendarGrid({
    monthISO, hidden, cellRenderer,
}: { monthISO: string; hidden?: boolean; cellRenderer: (day: number) => React.ReactNode }) {
    if (hidden) return null;
    const base = new Date(`${monthISO}T00:00:00`);
    const y = base.getFullYear(), m = base.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const startDow = new Date(y, m, 1).getDay();
    const cells: (number | null)[] = [
        ...Array.from({ length: startDow }, () => null),
        ...Array.from({ length: days }, (_, i) => i + 1 as number),
    ];
    while (cells.length % 7) cells.push(null);

    const title = base.toLocaleString(undefined, { month: 'long', year: 'numeric' });

    return (
        <div className="space-y-3">
            <div className="text-lg font-semibold">{title}</div>
            <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-3">
                <div className="grid grid-cols-7 gap-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(h =>
                        <div key={h} className="text-xs font-medium text-gray-600">{h}</div>
                    )}
                    {cells.map((d, i) => (
                        <div key={i} className="min-h-28 rounded-lg border bg-white p-2 flex flex-col">
                            <div className="text-[11px] text-gray-500 font-medium">{d ?? ''}</div>
                            <div className="mt-1 space-y-1 flex-1">{d ? cellRenderer(d) : null}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
function Toolbar({
    companies, companyId, setCompanyId,
    homes, homeId, setHomeId,
    month, setMonth,
    rightExtra,
}: {
    companies?: Company[];
    companyId?: string; setCompanyId?: (v: string) => void;
    homes?: Home[]; homeId?: string; setHomeId?: (v: string) => void;
    month: string; setMonth: (v: string) => void;
    rightExtra?: React.ReactNode;
}) {
    // Detect an “All homes” sentinel (id === '')
    const hasAllHomesOption = !!homes?.some(h => h.id === '');

    return (
        <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-3 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            {companies && setCompanyId && (
                <div>
                    <label className="block text-xs text-gray-600 mb-1">Company</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={companyId || ''}
                        onChange={e => setCompanyId(e.target.value)}
                    >
                        <option value="">Select company…</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
            )}

            {homes && setHomeId && (
                <div>
                    <label className="block text-xs text-gray-600 mb-1">Home</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={homeId || ''}
                        onChange={e => setHomeId(e.target.value)}
                    >
                        {/* Only show the placeholder when there ISN'T an “All homes” item */}
                        {!hasAllHomesOption && (
                            <option value="">{homes.length ? 'Select home…' : 'No homes'}</option>
                        )}
                        {homes.map(h => (
                            <option key={h.id || 'ALL'} value={h.id}>{h.name}</option>
                        ))}
                    </select>
                </div>
            )}

            <div>
                <label className="block text-xs text-gray-600 mb-1">Month</label>
                <input
                    type="month"
                    className="w-full border rounded-lg px-3 py-2"
                    value={ym(month)}
                    onChange={e => setMonth(e.target.value + '-01')}
                />
            </div>

            <div className="sm:justify-self-end">{rightExtra}</div>
        </div>
    );
}

/* ===================================
   Root
   =================================== */
export default function TimesheetsPage() {
    const [level, setLevel] = useState<Level>('4_STAFF');
    const [tab, setTab] = useState<'MY' | 'MANAGER' | 'COMPANY'>('MY');

    useEffect(() => {
        (async () => setLevel(await getEffectiveLevel() as Level))();
    }, []);
    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';

    useEffect(() => {
        if (!(isManager || isAdmin) && tab === 'MANAGER') setTab('MY');
        if (!(isCompany || isAdmin) && tab === 'COMPANY') setTab('MY');
    }, [tab, isAdmin, isCompany, isManager]);

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-2xl font-semibold">Timesheets</h1>

            <div className="inline-flex rounded-lg border bg-white ring-1 ring-gray-50 shadow-sm overflow-hidden">
                <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>My Timesheet</TabBtn>
                {(isManager || isAdmin) && <TabBtn active={tab === 'MANAGER'} onClick={() => setTab('MANAGER')}>Manager Review</TabBtn>}
                {(isCompany || isAdmin) && <TabBtn active={tab === 'COMPANY'} onClick={() => setTab('COMPANY')}>Company Timesheets</TabBtn>}
            </div>

            {tab === 'MY' && <MyTimesheet />}
            {tab === 'MANAGER' && (isManager || isAdmin) && <ManagerReview />}
            {tab === 'COMPANY' && (isCompany || isAdmin) && <CompanyView isAdmin={isAdmin} />}
        </div>
    );
}

/* ===================================
   My Timesheet
   - House staff: per-home sheet
   - Bank staff: aggregated across homes in company
   =================================== */
function MyTimesheet() {
    const [uid, setUid] = useState<string>('');
    const [month, setMonth] = useState<string>(() => firstOfMonthLocalISO());
    const [isSaving, setIsSaving] = useState(false);

    // Identify role context for "My Timesheet" (house staff vs bank)
    const [myHomes, setMyHomes] = useState<Home[]>([]);
    const [companyId, setCompanyId] = useState<string>('');
    const [companies, setCompanies] = useState<Company[]>([]);

    // House-staff mode
    const [homeId, setHomeId] = useState<string>('');

    // Shift types (by company)
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
    const shiftMap = useMemo(() => {
        const m = new Map<string, ShiftType>();
        shiftTypes.forEach(s => m.set(s.id, s));
        return m;
    }, [shiftTypes]);

    // Editor state (used in both modes)
    const [editingDay, setEditingDay] = useState<number | null>(null);
    const [editEntryId, setEditEntryId] = useState<string | undefined>(undefined);
    const [editShiftId, setEditShiftId] = useState<string | ''>('');
    const [editHours, setEditHours] = useState<number>(0);
    const [editNotes, setEditNotes] = useState<string>('');
    // NEW: remember the original home of the entry when editing (bank mode)
    const [editOriginalHomeId, setEditOriginalHomeId] = useState<string | null>(null);

    // Aggregated (bank) view data
    const [isBankMode, setIsBankMode] = useState<boolean>(false);
    const [allHomes, setAllHomes] = useState<Home[]>([]); // all homes in my company (for editor dropdown)
    const [aggEntries, setAggEntries] = useState<(TSEntry & { home_id: string; home_name: string })[]>([]);
    const [timesheetByHome, setTimesheetByHome] = useState<Map<string, Timesheet>>(new Map());

    // House-staff per-home data
    const [ts, setTS] = useState<Timesheet | null>(null);
    const [entries, setEntries] = useState<TSEntry[]>([]);

    // Track per-entry delete in-flight (for both house + bank views)
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const setDeleting = (id: string, v: boolean) =>
        setDeletingIds(prev => {
            const s = new Set(prev);
            v ? s.add(id) : s.delete(id);
            return s;
        });

    // My initials
    const [myInits, setMyInits] = useState('ME');

    const [isFillingBank, setIsFillingBank] = useState(false);
    const [isFillingHouse, setIsFillingHouse] = useState(false);
    const [isSubmittingBank, setIsSubmittingBank] = useState(false);
    const [isSubmittingHouse, setIsSubmittingHouse] = useState(false);

    const [isDeletingAny, setIsDeletingAny] = useState(false);

    const isAutofilling = isBankMode ? isFillingBank : isFillingHouse;

    // A timesheet is editable only in DRAFT or RETURNED
    const isTSEditable = (t?: Timesheet | null) =>
        !!t && (t.status === 'DRAFT' || t.status === 'RETURNED');

    // Bank: per-home lock and overall lock
    const bankHomeLocked = (hid: string) => {
        const t = timesheetByHome.get(hid);
        return !isTSEditable(t);
    };
    // "All locked" = every timesheet in month is not editable (submitted/forwarded)
    const bankAllLocked = useMemo(() => {
        if (!timesheetByHome.size) return false; // no TS yet => allow editing
        for (const t of timesheetByHome.values()) {
            if (isTSEditable(t)) return false;
        }
        return true;
    }, [timesheetByHome]);

    // Bootstrap: who am I, what homes, which company. Detect bank mode.
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const me = data.user?.id;
            if (!me) return;
            setUid(me);

            // initials
            const prof = await supabase
                .from('profiles')
                .select('full_name')
                .eq('user_id', me)
                .maybeSingle();
            const full = prof.data?.full_name?.trim() || '';
            if (full) {
                const parts = full.split(/\s+/);
                const first = parts[0]?.[0] || '';
                const last = (parts.length > 1 ? parts[parts.length - 1]?.[0] : '') || (parts[0]?.[1] || '');
                const init = (first + (last || '')).toUpperCase();
                if (init) setMyInits(init);
            }

            // Prefer LIVE rota (RLS-safe for the current user) to discover homes + company
            const monthISO = firstOfMonthLocalISO();

            const rota = await supabase
                .from('rota_entries')
                .select('rotas!inner(id,home_id,month_date,status)')
                .eq('rotas.status', 'LIVE')
                .eq('rotas.month_date', monthISO)
                .eq('user_id', me);

            const rotaRows: RotaJoin[] = Array.isArray(rota.data) ? (rota.data as unknown as RotaJoin[]) : [];

            const rotaHomeIds = Array.from(
                new Set(
                    rotaRows
                        .map(r => r.rotas.home_id)
                        .filter((id): id is string => typeof id === 'string' && id.length > 0)
                )
            );

            let discoveredHomes: Home[] = [];
            if (rotaHomeIds.length) {
                const hs = await supabase.from('homes').select('id,name,company_id').in('id', rotaHomeIds);
                discoveredHomes = (hs.data || []) as Home[];
            }

            // Try memberships only if rota didn’t give us anything (RLS may still allow your own rows)
            // Try memberships only if rota didn’t give us anything (RLS may still allow your own rows)
            let staffHomes = discoveredHomes;

            if (!staffHomes.length) {
                const hm = await supabase
                    .from('home_memberships')
                    .select('home_id, homes!inner(id,name,company_id)')
                    .eq('user_id', me)
                    .eq('role', 'STAFF');

                // --- Type guard for Supabase join rows ---
                // --- Type guard for Supabase join rows ---
                function hasHomes(row: unknown): row is { homes: Home } {
                    if (!row || typeof row !== 'object' || !('homes' in row)) return false;
                    const h = (row as { homes?: Partial<Home> }).homes;
                    return !!h
                        && typeof h.id === 'string'
                        && typeof h.name === 'string'
                        && typeof h.company_id === 'string';
                }

                const rawHM: unknown[] = Array.isArray(hm.data) ? (hm.data as unknown[]) : [];
                const hmRows: Array<{ homes: Home }> = rawHM.filter(hasHomes);

                staffHomes = hmRows.map(({ homes }) => ({
                    id: homes.id,
                    name: homes.name,
                    company_id: homes.company_id,
                }));
            }

            setMyHomes(staffHomes);

            // Work out company
            let cid = '';
            if (staffHomes.length) {
                cid = staffHomes[0].company_id;
            } else {
                // fall back to company membership (if any)
                const cm = await supabase.from('company_memberships').select('company_id').eq('user_id', me).maybeSingle();
                cid = cm.data?.company_id || '';
            }

            if (cid) setCompanyId(cid);
            if (staffHomes.length) {
                setHomeId(staffHomes[0].id);
            }

            // Decide bank vs house: bank if no staff home OR explicit bank row in this company
            let bank = false;
            if (cid) {
                const bm = await supabase
                    .from('bank_memberships')
                    .select('user_id')
                    .eq('user_id', me)
                    .eq('company_id', cid)
                    .maybeSingle();
                bank = !!bm.data;
            }
            setIsBankMode(bank || staffHomes.length === 0);

            // admin convenience
            const lvl = await getEffectiveLevel() as Level;
            if (lvl === '1_ADMIN') {
                const co = await supabase.from('companies').select('id,name').order('name');
                setCompanies((co.data || []) as Company[]);
            }
        })();
    }, []);

    // Shift types by company + All homes (for bank editor)
    useEffect(() => {
        (async () => {
            if (!companyId) {
                setShiftTypes([]);
                setAllHomes([]);
                return;
            }

            // ✅ SECURITY DEFINER: guaranteed visibility for eligible users
            const st = await supabase.rpc('shift_types_for_ui', {
                p_company_id: companyId,
                p_include_inactive: false,
            });
            setShiftTypes(((st.data as ShiftType[]) || []) as ShiftType[]);

            // For bank editors we should also fetch homes via an RPC that respects bank/company membership
            const { data: hh } = await supabase.rpc('homes_list_for_bank_timesheet', {
                p_user_id: (await supabase.auth.getUser()).data.user?.id,
                p_company_id: companyId,
            });
            setAllHomes(((hh as Home[]) || []) as Home[]);
        })();
    }, [companyId]);

    /* ---------- HOUSE STAFF: load/create per-home timesheet + entries (fast auto-fill via RPC) ---------- */
    useEffect(() => {
        (async () => {
            if (isBankMode) return; // handled by bank block
            setTS(null);
            setEntries([]);
            if (!uid || !homeId || !month) return;

            // find or create timesheet
            const { data: tsRow, error: tsFetchError } = await supabase
                .from('timesheets')
                .select('*')
                .eq('home_id', homeId)
                .eq('user_id', uid)
                .eq('month_date', month)
                .maybeSingle();

            if (tsFetchError) {
                console.warn(tsFetchError.message);
            }

            let tsCurrent = (tsRow as Timesheet) ?? null;

            if (!tsCurrent) {
                const { data: insRow, error: insError } = await supabase
                    .from('timesheets')
                    .insert({
                        home_id: homeId,
                        user_id: uid,
                        month_date: month,
                        status: 'DRAFT',
                    })
                    .select('*')
                    .single();

                if (insError) {
                    console.warn(insError.message);
                    return;
                }

                tsCurrent = insRow as Timesheet;

                // On first creation: let the DB populate from LIVE rota in one go
                await supabase.rpc('refresh_timesheets_for_live_rota', {
                    p_home_id: homeId,
                    p_month_date: month,
                });
            }

            setTS(tsCurrent);

            // load entries
            const { data: entryRows } = await supabase
                .from('timesheet_entries')
                .select('*')
                .eq('timesheet_id', tsCurrent.id);

            setEntries((entryRows ?? []) as TSEntry[]);
        })();
    }, [isBankMode, uid, homeId, month]);


    /* ---------- BANK: aggregated timesheet across homes ---------- */
    useEffect(() => {
        (async () => {
            if (!isBankMode) return;
            setAggEntries([]);
            setTimesheetByHome(new Map());
            if (!uid || !month) return;

            // Pull LIVE rota homes for this user+month
            const live = await supabase
                .from('rota_entries')
                .select('rotas!inner(id,home_id,month_date,status)')
                .eq('rotas.month_date', month)
                .eq('rotas.status', 'LIVE')
                .eq('user_id', uid);

            const homeIds = Array.from(
                new Set<string>(
                    (Array.isArray(live.data) ? (live.data as unknown as RotaJoin[]) : [])
                        .map(r => r.rotas.home_id)
                )
            );

            // If there are rota homes, load them and set companyId from them (if not already set)
            if (homeIds.length) {
                const hs = await supabase
                    .from('homes')
                    .select('id,name,company_id')
                    .in('id', homeIds)
                    .returns<Home[]>();
                const homesList = (hs.data || []) as Home[];
                setAllHomes(homesList);

                if (!companyId) {
                    const uniqueCompanies = Array.from(new Set(homesList.map(h => h.company_id)));
                    if (uniqueCompanies.length === 1) setCompanyId(uniqueCompanies[0]);
                }
            }

            // If company is still unknown, derive from company_memberships and load all homes
            if (!companyId) {
                const cm = await supabase
                    .from('company_memberships')
                    .select('company_id')
                    .eq('user_id', uid)
                    .maybeSingle();
                const cid = cm.data?.company_id || '';
                if (cid) {
                    setCompanyId(cid);
                    const hh = await supabase
                        .from('homes')
                        .select('id,name,company_id')
                        .eq('company_id', cid)
                        .order('name')
                        .returns<Home[]>();
                    setAllHomes((hh.data || []) as Home[]);
                }
            } else {
                // SECURITY DEFINER RPC
                const { data: hh } = await supabase.rpc('homes_list_for_bank_timesheet', {
                    p_user_id: uid,
                    p_company_id: companyId,
                });
                setAllHomes(((hh as Home[]) || []) as Home[]);
            }

            // Load ALL my timesheets for this month (across homes)
            const tsAll = await supabase
                .from('timesheets')
                .select('*')
                .eq('user_id', uid)
                .eq('month_date', month)
                .returns<Timesheet[]>();

            const list = (tsAll.data || []) as Timesheet[];
            const byHome = new Map<string, Timesheet>();
            list.forEach(t => byHome.set(t.home_id, t));
            setTimesheetByHome(byHome);

            // Entries for those sheets
            const ids = list.map(t => t.id);
            const rows: (TSEntry & { home_id: string; home_name: string })[] = [];
            if (ids.length) {
                const en = await supabase
                    .from('timesheet_entries')
                    .select('*')
                    .in('timesheet_id', ids)
                    .returns<TSEntry[]>();

                // Name lookups for homes shown in the grid
                const hs2 = await supabase
                    .from('homes')
                    .select('id,name,company_id')
                    .in('id', list.map(t => t.home_id))
                    .returns<Home[]>();

                const homesMap = new Map<string, Home>();
                (hs2.data || []).forEach(h => homesMap.set(h.id, h));

                (en.data || []).forEach(e => {
                    const t = list.find(x => x.id === e.timesheet_id);
                    if (t) {
                        const h = homesMap.get(t.home_id);
                        rows.push({
                            ...(e as TSEntry),
                            home_id: t.home_id,
                            home_name: h?.name || '(home)',
                        });
                    }
                });
            }
            setAggEntries(rows);
        })();
        // We intentionally include companyId; the logic above handles both unknown and known cases.
    }, [isBankMode, uid, month, companyId]);

    // Summary (both modes)
    const summary = useMemo(() => {
        const source = isBankMode ? aggEntries : entries;
        let hours = 0, sleep = 0, al = 0, sick = 0, wn = 0, other = 0;
        for (const e of source) {
            hours += Number(e.hours) || 0;
            const kind = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.kind || null) : null;
            if (kind === 'SLEEP') sleep++;
            else if (kind === 'ANNUAL_LEAVE') al++;
            else if (kind === 'SICKNESS') sick++;
            else if (kind === 'WAKING_NIGHT') wn++;
            else if (kind === 'OTHER_LEAVE') other++;
        }
        return { hours, sleep, al, sick, wn, other };
    }, [isBankMode, entries, aggEntries, shiftMap]);

    const editable = isBankMode ? !bankAllLocked : isTSEditable(ts);

    // House view grouping
    const entriesByDay = useMemo(() => {
        const m = new Map<number, TSEntry[]>();
        for (const e of entries) {
            const arr = m.get(e.day_of_month);
            if (arr) arr.push(e); else m.set(e.day_of_month, [e]);
        }
        return m;
    }, [entries]);

    // Bank view grouping
    const aggByDay = useMemo(() => {
        const m = new Map<number, (TSEntry & { home_id: string; home_name: string })[]>();
        for (const e of aggEntries) {
            const arr = m.get(e.day_of_month);
            if (arr) arr.push(e); else m.set(e.day_of_month, [e]);
        }
        return m;
    }, [aggEntries]);

    // Open editor (house vs bank)
    function openEditor(day: number, entry?: TSEntry & { home_id?: string }) {
        if (!editable) return;
        if (isBankMode && entry?.home_id && bankHomeLocked(entry.home_id)) return;
        setEditingDay(day);
        if (entry) {
            setEditEntryId(entry.id);
            setEditShiftId(entry.shift_type_id || '');
            setEditHours(entry.hours);
            setEditNotes(entry.notes || '');
            setEditOriginalHomeId((entry as (TSEntry & { home_id?: string })).home_id ?? null);
        } else {
            setEditEntryId(undefined);
            setEditShiftId('');
            setEditHours(0);
            setEditNotes('');
            setEditOriginalHomeId(null);
        }
    }

    function onPickShift(sid: string) {
        setEditShiftId(sid);
        const st = sid ? shiftMap.get(sid) : undefined;
        if (st) setEditHours(st.default_hours);
    }

    // Save editor (BANK mode) — move/add across homes with status guard
    async function saveEditorBank(pickedHomeId: string) {
        if (isAutofilling) return;
        if (!editingDay || !uid || !pickedHomeId) return;
        if (isSaving) return;

        setIsSaving(true);
        try {
            // 1) Find or create the target home's timesheet for this user+month
            let t = timesheetByHome.get(pickedHomeId);

            if (!t) {
                // Check if it already exists in DB (another tab/session may have created it)
                const found = await supabase
                    .from('timesheets')
                    .select('*')
                    .eq('home_id', pickedHomeId)
                    .eq('user_id', uid)
                    .eq('month_date', month)
                    .maybeSingle()
                    .returns<Timesheet>();

                if (found.data) {
                    t = found.data as Timesheet;
                } else {
                    // Create a fresh, editable sheet
                    const ins = await supabase
                        .from('timesheets')
                        .insert({
                            home_id: pickedHomeId,
                            user_id: uid,
                            month_date: month,
                            status: 'DRAFT',
                        })
                        .select('*')
                        .single()
                        .returns<Timesheet>();

                    if (ins.error) {
                        console.error(ins.error.message);
                        return;
                    }
                    t = ins.data as Timesheet;
                }

                // cache/update local map
                const m = new Map(timesheetByHome);
                m.set(pickedHomeId, t);
                setTimesheetByHome(m);
            }

            // 2) Guard: only allow writes when the target sheet is editable
            const targetEditable = t.status === 'DRAFT' || t.status === 'RETURNED';
            if (!targetEditable) {
                console.warn('Target home timesheet is not editable:', t.status);
                return;
            }

            // 3) Server-side upsert with guard (same RPC as house path)
            const { data, error } = await supabase.rpc('staff_upsert_timesheet_entry_v2', {
                p_timesheet_id: t.id,
                p_home_id: pickedHomeId,
                p_day_of_month: editingDay,
                p_shift_type_id: editShiftId || null,
                p_hours: Number(editHours) || 0,
                p_notes: (editNotes?.trim() || '') || null,
            });

            if (error) {
                console.error('staff_upsert_timesheet_entry_v2:', error.message);
                return;
            }

            // 4) Merge the saved row into aggregated state (de-dup by id)
            const home = allHomes.find(h => h.id === pickedHomeId);
            const row = {
                ...(data as TSEntry),
                home_id: pickedHomeId,
                home_name: home?.name || '(home)',
            } as TSEntry & { home_id: string; home_name: string };

            setAggEntries(prev => {
                const withoutOld = editEntryId ? prev.filter(e => e.id !== editEntryId) : prev;
                const withoutDup = withoutOld.filter(e => e.id !== row.id);
                return [...withoutDup, row];
            });

            // 5) Close editor
            setEditingDay(null);
            setEditEntryId(undefined);
            setEditOriginalHomeId(null);
        } finally {
            setIsSaving(false);
        }
    }


    // Save editor (HOUSE mode) — RPC upsert + hard guard on status
    async function saveEditorHouse() {
        if (isAutofilling) return;
        if (!ts || !editingDay) return;
        if (isSaving) return;

        // Hard guard: only allow writes when the sheet is editable
        if (!(ts.status === 'DRAFT' || ts.status === 'RETURNED')) {
            console.warn('Timesheet is not editable in current status:', ts.status);
            return;
        }

        setIsSaving(true);
        try {
            const { data, error } = await supabase.rpc('staff_upsert_timesheet_entry_v2', {
                p_timesheet_id: ts.id,
                p_home_id: ts.home_id,
                p_day_of_month: editingDay,
                p_shift_type_id: editShiftId || null,
                p_hours: Number(editHours) || 0,
                p_notes: (editNotes?.trim() || '') || null,
            });

            if (error) {
                console.error('staff_upsert_timesheet_entry_v2:', error.message);
                return;
            }

            // surgical state update (no full reload)
            setEntries(prev => {
                const idx = prev.findIndex(e => e.day_of_month === editingDay);
                if (idx === -1) return [...prev, data as TSEntry];
                const next = prev.slice();
                next[idx] = data as TSEntry;
                return next;
            });

            setEditingDay(null);
            setEditEntryId(undefined);
        } finally {
            setIsSaving(false);
        }
    }

    // House delete with row-level lock detection (returns row when allowed)
    async function delEntryHouse(id: string) {
        if (isAutofilling) return;               // 🔒
        if (!(ts && (ts.status === 'DRAFT' || ts.status === 'RETURNED'))) return;
        if (isDeletingAny || deletingIds.has(id)) return;

        setDeleting(id, true);
        setIsDeletingAny(true);

        // capture just the row we remove for precise rollback
        const removed = entries.find(e => e.id === id) || null;

        // optimistic remove using FUNCTIONAL update (no captured prev)
        setEntries(curr => curr.filter(e => e.id !== id));

        const { error } = await supabase
            .from('timesheet_entries')
            .delete({ count: 'exact' })
            .eq('id', id);

        if (error) {
            console.warn('Delete failed, restoring:', error.message);
            if (removed) {
                // rollback only this row; keep others intact
                setEntries(curr => {
                    // if row already back for any reason, don't duplicate
                    if (curr.some(e => e.id === removed.id)) return curr;
                    // re-insert; keep original ordering (by day) if you want
                    const next = [...curr, removed];
                    next.sort((a, b) => a.day_of_month - b.day_of_month || a.id.localeCompare(b.id));
                    return next;
                });
            }
        }

        setDeleting(id, false);
        setIsDeletingAny(false);
    }

    // Bank delete: check parent timesheet status for the specific home
    async function delEntryBank(id: string) {
        if (isAutofilling) return;
        const entry = aggEntries.find(e => e.id === id);
        if (!entry) return;

        const parent = timesheetByHome.get(entry.home_id);
        const canEdit = parent && (parent.status === 'DRAFT' || parent.status === 'RETURNED');
        if (!canEdit || isDeletingAny || deletingIds.has(id)) return;

        setDeleting(id, true);
        setIsDeletingAny(true);

        // snapshot only this row for rollback
        const removed = entry;

        // optimistic remove via FUNCTIONAL update
        setAggEntries(curr => curr.filter(e => e.id !== id));

        const { error } = await supabase
            .from('timesheet_entries')
            .delete({ count: 'exact' })
            .eq('id', id);

        if (error) {
            console.warn('Delete failed, restoring:', error.message);
            // put just this row back (avoid duplicates)
            setAggEntries(curr => {
                if (curr.some(e => e.id === removed.id)) return curr;
                const next = [...curr, removed];
                next.sort((a, b) =>
                    a.day_of_month - b.day_of_month ||
                    a.home_name.localeCompare(b.home_name) ||
                    a.id.localeCompare(b.id)
                );
                return next;
            });
        }

        setDeleting(id, false);
        setIsDeletingAny(false);
    }

    // Submit
    async function submitHouse() {
        if (!month) return;
        setIsSubmittingHouse(true);
        try {
            const { error } = await supabase.rpc('submit_my_timesheets_month', {
                p_month_date: month,
            });
            if (error) {
                console.error(error.message);
                return;
            }

            // refresh current per-home sheet + entries
            if (homeId && uid) {
                const { data: tsData, error: tsErr } = await supabase
                    .from('timesheets')
                    .select('*')
                    .eq('home_id', homeId)
                    .eq('user_id', uid)
                    .eq('month_date', month)
                    .maybeSingle();

                if (tsErr) console.warn(tsErr.message);

                const ts = (tsData ?? null) as Timesheet | null;
                setTS(ts);

                if (ts) {
                    const { data: entriesData, error: eErr } = await supabase
                        .from('timesheet_entries')
                        .select('*')
                        .eq('timesheet_id', ts.id)
                        .returns<TSEntry[]>();

                    if (eErr) console.warn(eErr.message);
                    setEntries(entriesData ?? []);
                }
            }
        } finally {
            setIsSubmittingHouse(false);
        }
    }


    async function submitBank() {
        if (!month) return;
        setIsSubmittingBank(true);
        try {
            const { error } = await supabase.rpc('submit_my_timesheets_month', {
                p_month_date: month,
            });
            if (error) {
                console.error(error.message);
                return;
            }

            // Get all timesheets for this user/month
            const tsAll = await supabase
                .from('timesheets')
                .select('*')
                .eq('user_id', uid)
                .eq('month_date', month);

            const tsList: Timesheet[] = Array.isArray(tsAll.data) ? (tsAll.data as Timesheet[]) : [];

            // Build map: home_id -> timesheet
            setTimesheetByHome(() => {
                const m = new Map<string, Timesheet>();
                for (const t of tsList) {
                    if (t?.home_id) m.set(t.home_id, t);
                }
                return m;
            });

            const ids: string[] = tsList.map(t => t.id).filter(Boolean);
            if (!ids.length) {
                setAggEntries([]);
                return;
            }

            // Load entries + home names
            const [enRes, hs2Res] = await Promise.all([
                supabase.from('timesheet_entries').select('*').in('timesheet_id', ids),
                supabase.from('homes').select('id,name,company_id').in('id', tsList.map(t => t.home_id).filter(Boolean)),
            ]);

            const enData: TSEntry[] = Array.isArray(enRes.data) ? (enRes.data as TSEntry[]) : [];
            const homesData: Home[] = Array.isArray(hs2Res.data) ? (hs2Res.data as Home[]) : [];

            const hmap = new Map<string, Home>();
            for (const h of homesData) {
                if (h?.id) hmap.set(h.id, h);
            }

            const rows: (TSEntry & { home_id: string; home_name: string })[] = [];
            for (const e of enData) {
                const parent = tsList.find(x => x.id === e.timesheet_id);
                if (!parent) continue; // defensive: entry without parent
                const home = hmap.get(parent.home_id);
                rows.push({
                    ...e,
                    home_id: parent.home_id,
                    home_name: home?.name ?? '(home)',
                });
            }

            setAggEntries(rows);
        } finally {
            setIsSubmittingBank(false);
        }
    }


    // ---- FAST RPC: Auto-fill (bank) ----
    async function autoFillBankFromLive() {
        if (!isBankMode || !uid || !month) return;
        setIsFillingBank(true);
        try {
            // Try signature A: (p_user_id, p_month_date)
            let { error } = await supabase.rpc('refresh_bank_timesheet_for_user_month', {
                p_user_id: uid,
                p_month_date: month,
            });

            // If that fails due to a signature/parameter mismatch, try signature B
            if (error) {
                const looksLikeSignatureIssue =
                    /no parameter|missing required|named.*does not exist|schema mismatch|function .* does not exist/i.test(
                        error.message || ''
                    );

                if (looksLikeSignatureIssue) {
                    ({ error } = await supabase.rpc('refresh_bank_timesheet_for_user_month', {
                        p_user: uid,
                        p_month: month,
                    }));
                }

                if (error) {
                    console.error('refresh_bank_timesheet_for_user_month:', error.message);
                    // Final safety net: client-side reconstruction
                    await clientFallbackAutofillFromLive();
                    await reloadBankAggregated();
                    return;
                }
            }

            // Success → refresh UI from DB
            await reloadBankAggregated();
        } finally {
            setIsFillingBank(false);
        }
    }

    // factor the reloading logic you already have into a re-usable function
    async function reloadBankAggregated() {
        if (!uid || !month) return;

        // Timesheets for this user/month
        const tsAll = await supabase
            .from('timesheets')
            .select('*')
            .eq('user_id', uid)
            .eq('month_date', month);

        const tsList: Timesheet[] = Array.isArray(tsAll.data) ? (tsAll.data as Timesheet[]) : [];

        // Map home_id -> timesheet (defensive about nulls)
        setTimesheetByHome(() => {
            const m = new Map<string, Timesheet>();
            for (const t of tsList) {
                if (t?.home_id) m.set(t.home_id, t);
            }
            return m;
        });

        const ids = tsList.map(t => t.id).filter(Boolean);
        if (!ids.length) {
            setAggEntries([]);
            return;
        }

        // Load entries + homes
        const [enRes, hsRes] = await Promise.all([
            supabase.from('timesheet_entries').select('*').in('timesheet_id', ids),
            supabase.from('homes').select('id,name,company_id').in('id', tsList.map(t => t.home_id).filter(Boolean)),
        ]);

        const enData: TSEntry[] = Array.isArray(enRes.data) ? (enRes.data as TSEntry[]) : [];
        const homesData: Home[] = Array.isArray(hsRes.data) ? (hsRes.data as Home[]) : [];

        const hmap = new Map<string, Home>();
        for (const h of homesData) {
            if (h?.id) hmap.set(h.id, h);
        }

        const rows: (TSEntry & { home_id: string; home_name: string })[] = [];
        for (const e of enData) {
            const parent = tsList.find(x => x.id === e.timesheet_id);
            if (!parent) continue; // safety: entry without parent
            const home = hmap.get(parent.home_id);
            rows.push({
                ...e,
                home_id: parent.home_id,
                home_name: home?.name ?? '(home)',
            });
        }

        setAggEntries(rows);
    }

    // Narrow unknown rows from Supabase to RotaJoin
    function hasRotasHomeId(row: unknown): row is RotaJoin {
        return !!row && typeof (row as { rotas?: { home_id?: unknown } }).rotas?.home_id === 'string';
    }

    async function clientFallbackAutofillFromLive() {
        if (!uid || !month) return;

        // 1) Pull my LIVE rota across all homes this month
        const live = await supabase
            .from('rota_entries')
            .select('day_of_month, shift_type_id, hours, rotas!inner(home_id, month_date, status)')
            .eq('rotas.month_date', month)
            .eq('rotas.status', 'LIVE')
            .eq('user_id', uid);

        const liveRowsUnknown: unknown[] = Array.isArray(live.data) ? live.data : [];
        const liveRows: RotaJoin[] = liveRowsUnknown.filter(hasRotasHomeId);

        const items = liveRows.map(x => ({
            home_id: x.rotas.home_id,
            day: Number(x.day_of_month ?? 0) || 0,
            shift_type_id: (x.shift_type_id ?? null) as string | null,
            hours: Number(x.hours ?? 0) || 0,
        }));

        if (!items.length) return; // nothing scheduled

        // Group by home
        const byHome = new Map<string, typeof items>();
        items.forEach(it => {
            const arr = byHome.get(it.home_id) || [];
            arr.push(it);
            byHome.set(it.home_id, arr);
        });

        // 2) Ensure a timesheet per home (DRAFT) and upsert entries via RPC
        const nextMap = new Map(timesheetByHome);

        for (const [hid, arr] of byHome) {
            // find or create sheet
            let t = nextMap.get(hid);

            if (!t) {
                const found = await supabase
                    .from('timesheets')
                    .select('*')
                    .eq('home_id', hid)
                    .eq('user_id', uid)
                    .eq('month_date', month)
                    .maybeSingle();

                if (found.data) {
                    t = found.data as Timesheet;
                } else {
                    const ins = await supabase
                        .from('timesheets')
                        .insert({ home_id: hid, user_id: uid, month_date: month, status: 'DRAFT' })
                        .select('*')
                        .single();

                    if (ins.error || !ins.data) {
                        console.warn('Create timesheet failed:', ins.error?.message || 'unknown error');
                        continue;
                    }
                    t = ins.data as Timesheet;
                }

                nextMap.set(hid, t);
            }

            // Upsert each day via the same RPC used by the editors
            for (const it of arr) {
                const { error } = await supabase.rpc('staff_upsert_timesheet_entry_v2', {
                    p_timesheet_id: t.id,
                    p_home_id: hid,
                    p_day_of_month: it.day,
                    p_shift_type_id: it.shift_type_id,
                    p_hours: it.hours,
                    p_notes: null,
                });
                if (error) console.warn('upsert entry failed:', error.message);
            }
        }

        // Single state update (prevents render thrash/races)
        setTimesheetByHome(nextMap);

        // 3) Reload aggregated rows from DB
        await reloadBankAggregated();
    }


    // ---- FAST RPC: Auto-fill (house) ----
    async function autoFillHouseFromLive() {
        if (isBankMode || !homeId || !month) return;
        setIsFillingHouse(true);
        try {
            const { error } = await supabase.rpc('refresh_timesheets_for_live_rota', {
                p_home_id: homeId,
                p_month_date: month,
            });
            if (error) {
                console.error('refresh_timesheets_for_live_rota:', error.message);
                return;
            }

            // Ensure current timesheet & reload entries
            let current = ts;

            if (!current) {
                const found = await supabase
                    .from('timesheets')
                    .select('*')
                    .eq('home_id', homeId)
                    .eq('user_id', uid)
                    .eq('month_date', month)
                    .maybeSingle();

                const tsRow = (found.data ?? null) as Timesheet | null;
                if (tsRow) current = tsRow;
                setTS(current || null);
            }

            if (current) {
                const e = await supabase
                    .from('timesheet_entries')
                    .select('*')
                    .eq('timesheet_id', current.id);

                const entryRows: TSEntry[] = Array.isArray(e.data) ? (e.data as TSEntry[]) : [];
                setEntries(entryRows);
            }
        } finally {
            setIsFillingHouse(false);
        }
    }

    const rightExtra = (
        <div className="flex items-center gap-2 justify-end">
            {isBankMode ? (
                <>
                    <button
                        onClick={autoFillBankFromLive}
                        disabled={isFillingBank}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                    >
                        {isFillingBank ? <>⏳ Autofilling…</> : 'Auto-fill from LIVE rota'}
                    </button>
                    <button
                        onClick={submitBank}
                        disabled={isSubmittingBank || bankAllLocked || aggEntries.length === 0}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                    >
                        {isSubmittingBank ? <>⏳ Submitting…</> : 'Submit my timesheet'}
                    </button>
                </>
            ) : (
                <>
                    <span
                        className={`text-xs px-2 py-1 rounded ring-1 ${ts?.status === 'DRAFT' || ts?.status === 'RETURNED'
                                ? 'bg-amber-50 text-amber-700 ring-amber-100'
                                : ts?.status === 'SUBMITTED'
                                    ? 'bg-indigo-50 text-indigo-700 ring-indigo-100'
                                    : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                            }`}
                    >
                        Status: {ts?.status || '—'}
                    </span>
                    <button
                        onClick={autoFillHouseFromLive}
                        disabled={isFillingHouse}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                    >
                        {isFillingHouse ? <>⏳ Autofilling…</> : 'Auto-fill from LIVE rota'}
                    </button>
                    <button
                        disabled={isSubmittingHouse || !(ts && (ts.status === 'DRAFT' || ts.status === 'RETURNED')) || !entries.length}
                        onClick={submitHouse}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                    >
                        {isSubmittingHouse ? <>⏳ Submitting…</> : 'Submit timesheet'}
                    </button>
                </>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            {/* Guidance */}
            <div className="rounded-lg border bg-white p-3 text-sm text-gray-700">
                {isBankMode
                    ? 'This aggregated timesheet is auto-filled from any live rotas you were scheduled on. Check and adjust the hours and pick the home for added shifts if needed, then submit — each home manager will receive their portion.'
                    : 'This timesheet is auto-filled from the live rota. Please check and edit any shifts or hours to reflect reality. Once submitted, you can&apos;t edit unless a manager sends it back.'
                }
            </div>

            {/* Toolbar */}
            {isBankMode ? (
                <Toolbar
                    month={month}
                    setMonth={setMonth}
                    rightExtra={rightExtra}
                />
            ) : (
                <Toolbar
                    homes={myHomes}
                    homeId={homeId}
                    setHomeId={setHomeId}
                    month={month}
                    setMonth={setMonth}
                    rightExtra={rightExtra}
                />
            )}

            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <Stat label="Total hours" value={summary.hours.toFixed(2)} />
                <Stat label="Sleep" value={summary.sleep} />
                <Stat label="Annual leave" value={summary.al} />
                <Stat label="Sickness" value={summary.sick} />
                <Stat label="Waking night" value={summary.wn} />
                <Stat label="Other leave" value={summary.other} />
            </div>

            {/* Edits lock notice */}
            {isAutofilling && (
                <div className="rounded-md border p-2 text-xs bg-amber-50 text-amber-800">
                    Autofill is running… edits are temporarily disabled.
                </div>
            )}
            {/* Calendars */}
            {isBankMode ? (
                <CalendarGrid
                    monthISO={month}
                    cellRenderer={(d) => {
                        const todays = aggByDay.get(d) || [];
                        return (
                            <div className="space-y-1">
                                {todays.length === 0 ? (
                                    <div className="text-xs text-gray-400">—</div>
                                ) : todays.map(e => {
                                    const code = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.code || '') : '';
                                    const kind = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.kind || null) : null;
                                    return (
                                        <div key={e.id} className="rounded-lg border bg-gray-50 p-2 text-[12px]">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-semibold">{myInits}</span>
                                                {code && <span className="font-mono font-semibold">{code}</span>}
                                                <span>{e.hours}h</span>
                                                <span className="text-gray-700">· {e.home_name}</span>
                                                {kind && <span className="text-gray-600">· {KIND_LABEL[kind] || kind}</span>}
                                            </div>
                                            <div className="mt-1 flex gap-1">
                                                <button
                                                    onClick={() => openEditor(d, e)}
                                                    disabled={isAutofilling || bankHomeLocked(e.home_id)}
                                                    className="rounded border px-2 py-[2px] text-[11px] hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => delEntryBank(e.id)}
                                                    disabled={isAutofilling || isDeletingAny || deletingIds.has(e.id) || bankHomeLocked(e.home_id)}
                                                    className="rounded border px-2 py-[2px] text-[11px] hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    {(isAutofilling || isDeletingAny || deletingIds.has(e.id)) ? '⏳ Deleting…' : 'Delete'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                <button
                                    onClick={() => openEditor(d)}
                                    disabled={isAutofilling || bankAllLocked}
                                    className="mt-1 rounded border px-2 py-[2px] text-[11px] hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    Add
                                </button>
                            </div>
                        );
                    }}
                />
            ) : (
                <CalendarGrid
                    monthISO={month}
                    hidden={!homeId}
                    cellRenderer={(d) => {
                        const todays = entriesByDay.get(d) || [];
                        return (
                            <div className="space-y-1">
                                {todays.length === 0 ? (
                                    <div className="text-xs text-gray-400">—</div>
                                ) : todays.map(e => {
                                    const code = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.code || '') : '';
                                    const kind = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.kind || null) : null;
                                    return (
                                        <div key={e.id} className="rounded-lg border bg-gray-50 p-2 text-[12px]">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-semibold">{myInits}</span>
                                                {code && <span className="font-mono font-semibold">{code}</span>}
                                                <span>{e.hours}h</span>
                                                {kind && <span className="text-gray-600">· {KIND_LABEL[kind] || kind}</span>}
                                            </div>
                                            {(ts?.status === 'DRAFT' || ts?.status === 'RETURNED') && (
                                                <div className="mt-1 flex gap-1">
                                                    <button
                                                        onClick={() => openEditor(d, e)}
                                                        disabled={isAutofilling}
                                                        className="rounded border px-2 py-[2px] text-[11px] hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => delEntryHouse(e.id)}
                                                        disabled={isAutofilling || isDeletingAny || deletingIds.has(e.id)}
                                                        className="rounded border px-2 py-[2px] text-[11px] hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                    >
                                                        {(isAutofilling || isDeletingAny || deletingIds.has(e.id)) ? '⏳ Deleting…' : 'Delete'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {(ts?.status === 'DRAFT' || ts?.status === 'RETURNED') && (
                                    <button
                                        onClick={() => openEditor(d)}
                                        disabled={isAutofilling}
                                        className="mt-1 rounded border px-2 py-[2px] text-[11px] hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        Add
                                    </button>
                                )}
                            </div>
                        );
                    }}
                />
            )}

            {/* Modal editor */}
            {editingDay && (
                <div className="fixed inset-0 bg-black/30 grid place-items-center z-50" onClick={() => setEditingDay(null)}>
                    <div className="w-full max-w-md rounded-xl border bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold mb-3">Day {editingDay}</h3>
                        <div className="space-y-3">
                            {/* Bank users can pick home */}
                            {isBankMode && (
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">Home</label>
                                    <select id="bank-home-pick" className="w-full border rounded-lg px-3 py-2" defaultValue={editOriginalHomeId || ''}>
                                        <option value="">Select home…</option>
                                        {allHomes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                    </select>
                                    <p className="text-[11px] text-gray-500 mt-1">Pick where you worked this shift.</p>
                                </div>
                            )}
                            <div>
                                <label className="block text-xs text-gray-600 mb-1">Shift type</label>
                                <select className="w-full border rounded-lg px-3 py-2" value={editShiftId} onChange={e => onPickShift(e.target.value)}>
                                    <option value="">(none)</option>
                                    {shiftTypes.map(s => <option key={s.id} value={s.id}>{s.code} — {s.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-600 mb-1">Hours</label>
                                <input type="number" min={0} step="0.25" className="w-full border rounded-lg px-3 py-2" value={editHours} onChange={e => setEditHours(Number(e.target.value))} />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-600 mb-1">Notes (optional)</label>
                                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
                            </div>
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                onClick={() => { if (!isSaving) setEditingDay(null); }}
                                disabled={isSaving}
                                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                Cancel
                            </button>

                            {isBankMode ? (
                                <button
                                    onClick={() => {
                                        if (isSaving) return;
                                        const sel = (document.getElementById('bank-home-pick') as HTMLSelectElement | null);
                                        const picked = sel?.value || '';
                                        if (!picked) { alert('Pick a home for this shift.'); return; }
                                        void saveEditorBank(picked);
                                    }}
                                    disabled={isSaving}
                                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isSaving ? '⏳ Saving…' : 'Save'}
                                </button>
                            ) : (
                                <button
                                    onClick={() => { if (!isSaving) void saveEditorHouse(); }}
                                    disabled={isSaving}
                                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isSaving ? '⏳ Saving…' : 'Save'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ===================================
   Manager Review (with missing list)
   =================================== */
function ManagerReview() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState<string>('');
    const [homes, setHomes] = useState<Home[]>([]);
    const [homeId, setHomeId] = useState<string>('');
    const [month, setMonth] = useState<string>(() => firstOfMonthLocalISO());

    const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
    const [entriesByTS, setEntriesByTS] = useState<Map<string, TSEntry[]>>(new Map());
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
    const [profilesById, setProfilesById] = useState<Map<string, Profile>>(new Map());
    const [loadingSubmitted, setLoadingSubmitted] = useState(false);

    const shiftMap = useMemo(() => {
        const m = new Map<string, ShiftType>();
        shiftTypes.forEach(s => m.set(s.id, s));
        return m;
    }, [shiftTypes]);

    const [editTS, setEditTS] = useState<Timesheet | null>(null);

    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const me = data.user?.id;
            if (!me) return;

            const lvl = (await getEffectiveLevel()) as Level;

            if (lvl === '1_ADMIN') {
                const co = await supabase.from('companies').select('id,name').order('name');
                const companiesData: Company[] = Array.isArray(co.data) ? (co.data as Company[]) : [];
                setCompanies(companiesData);
                return;
            }

            if (lvl === '3_MANAGER') {
                const hm = await supabase
                    .from('home_memberships')
                    .select('home_id, homes!inner(id,name,company_id)')
                    .eq('user_id', me)
                    .eq('role', 'MANAGER');

                // Type guard for rows that include a valid `homes` object
                function hasHomes(
                    row: unknown
                ): row is { homes: { id: string; name: string; company_id: string } } {
                    if (!row || typeof row !== 'object') return false;
                    const h = (row as Record<string, unknown>).homes;
                    if (!h || typeof h !== 'object') return false;
                    const hh = h as Record<string, unknown>;
                    return (
                        typeof hh.id === 'string' &&
                        typeof hh.name === 'string' &&
                        typeof hh.company_id === 'string'
                    );
                }

                const rawHM: unknown[] = Array.isArray(hm.data) ? (hm.data as unknown[]) : [];
                const list: Home[] = rawHM
                    .filter(hasHomes)
                    .map((r) => ({
                        id: r.homes.id,
                        name: r.homes.name,
                        company_id: r.homes.company_id,
                    }));

                setHomes(list);
                if (list.length) {
                    setCompanyId(list[0].company_id);
                    setHomeId(list[0].id);
                }
            }
        })();
    }, []);


    useEffect(() => {
        (async () => {
            if (!companyId) {
                // Don't nuke manager’s homes; only clear for admins
                if (companies.length) setHomes([]);
                setShiftTypes([]);
                return;
            }

            // Admin: load all homes in the company
            if (companies.length) {
                const h = await supabase
                    .from('homes')
                    .select('id,name,company_id')
                    .eq('company_id', companyId)
                    .order('name');

                const homesData: Home[] = Array.isArray(h.data) ? (h.data as Home[]) : [];
                setHomes(homesData);
            }

            // Everyone needs shift types
            const st = await supabase
                .from('shift_types')
                .select('*')
                .eq('company_id', companyId);

            const shiftTypesData: ShiftType[] = Array.isArray(st.data) ? (st.data as ShiftType[]) : [];
            setShiftTypes(shiftTypesData);
        })();
    }, [companyId, companies.length]);

    async function loadSubmitted() {
        setLoadingSubmitted(true);
        setTimesheets([]);
        setEntriesByTS(new Map());
        setProfilesById(new Map());

        if (!homeId || !month) {
            setLoadingSubmitted(false);
            return;
        }

        // Staff-submitted sheets (directly on this home)
        const staff = await supabase
            .from('timesheets')
            .select('id, user_id, month_date, status, home_id')
            .eq('home_id', homeId)
            .eq('month_date', month)
            .eq('status', 'SUBMITTED');

        // Bank-submitted for this home via review join
        const bank = await supabase
            .from('timesheet_home_reviews')
            .select('timesheets!inner(id, user_id, month_date, status, home_id)')
            .eq('home_id', homeId)
            .eq('status', 'SUBMITTED')
            .eq('timesheets.month_date', month);

        const listA: Timesheet[] = Array.isArray(staff.data) ? (staff.data as unknown as Timesheet[]) : [];

        // Safely extract the joined timesheet rows
        const listB: Timesheet[] = Array.isArray(bank.data)
            ? (bank.data as unknown[])
                .map((row) => {
                    if (row && typeof row === 'object' && 'timesheets' in row) {
                        const ts = (row as { timesheets?: unknown }).timesheets;
                        if (ts && typeof ts === 'object' && ts !== null && 'id' in ts) {
                            return ts as Timesheet;
                        }
                    }
                    return null;
                })
                .filter((t): t is Timesheet => t !== null)
            : [];

        // De-dup by id
        const byId = new Map<string, Timesheet>([...listA, ...listB].map((t) => [t.id, t]));
        const rows: Timesheet[] = Array.from(byId.values());
        setTimesheets(rows);

        // Pull entries (only this home's portion) + profiles for those users
        const ids = rows.map((t) => t.id);
        const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

        const [en, prof] = await Promise.all([
            ids.length
                ? supabase
                    .from('timesheet_entries')
                    .select('*')
                    .in('timesheet_id', ids)
                    .eq('home_id', homeId)
                : Promise.resolve({ data: [] as TSEntry[] }),
            userIds.length
                ? supabase
                    .from('profiles')
                    .select('user_id, full_name')
                    .in('user_id', userIds)
                : Promise.resolve({ data: [] as Profile[] }),
        ]);

        // Build entries map by timesheet_id
        const map = new Map<string, TSEntry[]>();
        const enRows: TSEntry[] = Array.isArray(en.data) ? (en.data as unknown as TSEntry[]) : [];
        enRows.forEach((e) => {
            if (!map.has(e.timesheet_id)) map.set(e.timesheet_id, []);
            map.get(e.timesheet_id)!.push(e);
        });
        setEntriesByTS(map);

        // Build profiles map
        const profRows: Profile[] = Array.isArray(prof.data) ? (prof.data as unknown as Profile[]) : [];
        const m = new Map<string, Profile>();
        profRows.forEach((p) => m.set(p.user_id, p));
        setProfilesById(m);

        setLoadingSubmitted(false);
    }

    useEffect(() => { void loadSubmitted(); }, [homeId, month]);

    // Build LIVE rota snapshot for mismatch flags
    const [rotaByUserDay, setRotaByUserDay] = useState<
        Map<string, Map<number, { shift_type_id: string | null, hours: number }>>
    >(new Map());
    useEffect(() => {
        (async () => {
            setRotaByUserDay(new Map());
            if (!homeId || !month) return;

            const rota = await supabase
                .from('rota_entries')
                .select('day_of_month, shift_type_id, hours, user_id, rotas!inner(id,home_id,month_date,status)')
                .eq('rotas.home_id', homeId)
                .eq('rotas.month_date', month)
                .eq('rotas.status', 'LIVE');

            const byUser = new Map<string, Map<number, { shift_type_id: string | null; hours: number }>>();

            const rows = Array.isArray(rota.data) ? (rota.data as unknown[]) : [];
            for (const row of rows) {
                const o = row as Record<string, unknown>;

                const userId = typeof o.user_id === 'string' ? (o.user_id as string) : null;
                const day =
                    typeof o.day_of_month === 'number'
                        ? (o.day_of_month as number)
                        : Number.isFinite(Number(o.day_of_month))
                            ? Number(o.day_of_month)
                            : NaN;
                const shift =
                    o.shift_type_id === null || typeof o.shift_type_id === 'string'
                        ? (o.shift_type_id as string | null)
                        : null;
                const hours =
                    typeof o.hours === 'number'
                        ? (o.hours as number)
                        : Number.isFinite(Number(o.hours))
                            ? Number(o.hours)
                            : 0;

                if (!userId || !Number.isFinite(day)) continue;

                if (!byUser.has(userId)) byUser.set(userId, new Map());
                byUser.get(userId)!.set(day, { shift_type_id: shift, hours: Number(hours) || 0 });
            }

            setRotaByUserDay(byUser);
        })();
    }, [homeId, month]);

    function calcSummary(ts: Timesheet) {
        const rows = entriesByTS.get(ts.id) || [];
        let hours = 0, sleep = 0, al = 0, sick = 0, wn = 0, other = 0;
        for (const e of rows) {
            hours += Number(e.hours) || 0;
            const kind = e.shift_type_id ? shiftMap.get(e.shift_type_id)?.kind : null;
            if (kind === 'SLEEP') sleep++;
            else if (kind === 'ANNUAL_LEAVE') al++;
            else if (kind === 'SICKNESS') sick++;
            else if (kind === 'WAKING_NIGHT') wn++;
            else if (kind === 'OTHER_LEAVE') other++;
        }
        return { hours, sleep, al, sick, wn, other };
    }
    function mismatchesFor(ts: Timesheet): number {
        const rows = entriesByTS.get(ts.id) || [];
        const rotaDays = rotaByUserDay.get(ts.user_id) || new Map();
        const tsByDay = new Map<number, { shift_type_id: string | null, hours: number }>();
        rows.forEach(e => tsByDay.set(e.day_of_month, { shift_type_id: e.shift_type_id, hours: Number(e.hours) || 0 }));
        const days = new Set<number>([...tsByDay.keys(), ...rotaDays.keys()]);
        let mismatches = 0;
        for (const d of days) {
            const a = tsByDay.get(d), b = rotaDays.get(d);
            if ((!a && b) || (a && !b)) { mismatches++; continue; }
            if (a && b) {
                const sameShift = (a.shift_type_id || null) === (b.shift_type_id || null);
                const sameHours = Math.abs((a.hours || 0) - (b.hours || 0)) < 0.001;
                if (!sameShift || !sameHours) mismatches++;
            }
        }
        return mismatches;
    }

    async function sendBack(rowTS: Timesheet) {
        const { error } = await supabase.rpc('manager_return_home', {
            p_timesheet_id: rowTS.id,
            p_home_id: homeId,
        });
        if (error) { alert(error.message); return; }

        setTimesheets(prev => prev.filter(x => x.id !== rowTS.id));
        setEntriesByTS(prev => { const m = new Map(prev); m.delete(rowTS.id); return m; });
        await loadMissing(); // keep the missing panel in sync
    }

    const [confirmAll, setConfirmAll] = useState(false);
    const [progress, setProgress] = useState<{ total_required: number; submitted_count: number } | null>(null);

    async function loadManagerProgress() {
        if (!homeId || !month) return setProgress(null);
        const { data, error } = await supabase.rpc('manager_home_submission_counts', {
            p_home_id: homeId,
            p_month: month,
        });
        if (error) { console.warn(error.message); setProgress(null); return; }
        setProgress(data as { total_required: number; submitted_count: number });
    }
    useEffect(() => { void loadManagerProgress(); }, [homeId, month]);

    async function submitAll() {
        const rows = timesheets.filter(t => t.status === 'SUBMITTED');
        if (!rows.length) { alert('No submitted timesheets to forward.'); return; }

        if (progress && progress.submitted_count < progress.total_required && !confirmAll) {
            setConfirmAll(true);
            return;
        }

        // Approve this home for each timesheet → triggers will promote the parent when all homes are done
        const ids = rows.map(t => t.id);
        const results = await Promise.all(ids.map(id =>
            supabase.rpc('manager_submit_home', {
                p_timesheet_id: id,
                p_home_id: homeId,
            })
        ));
        const err = results.find(r => (r as { error?: { message: string } }).error);
        if (err && 'error' in err && err.error) { alert(err.error.message); return; }

        setConfirmAll(false);
        await loadSubmitted();
        await loadManagerProgress();
        await loadMissing();
    }

    const rightExtra = (
        <div className="flex items-center gap-3 justify-end">
            <button onClick={submitAll} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                Submit all to company
            </button>
        </div>
    );

    /* ---------- NEW: Missing submissions (this home only) ---------- */
    const [missingUsers, setMissingUsers] = useState<string[]>([]);
    const [missingProfiles, setMissingProfiles] = useState<Map<string, Profile>>(new Map());
    const [loadingMissing, setLoadingMissing] = useState(false);

    async function loadMissing() {
        setMissingUsers([]);
        setMissingProfiles(new Map());
        if (!homeId || !month) return;

        setLoadingMissing(true);
        try {
            // Small helpers (no `any`)
            const isObj = (v: unknown): v is Record<string, unknown> =>
                typeof v === 'object' && v !== null;

            const hasUserId = (v: unknown): v is { user_id: string } =>
                isObj(v) && typeof v.user_id === 'string';

            const isProfileRow = (v: unknown): v is Profile =>
                isObj(v) &&
                typeof v.user_id === 'string' &&
                (typeof v.full_name === 'string' || v.full_name === null);

            // Everyone scheduled on LIVE rota at this home this month
            const rota = await supabase
                .from('rota_entries')
                .select('user_id, rotas!inner(id,home_id,month_date,status)')
                .eq('rotas.home_id', homeId)
                .eq('rotas.month_date', month)
                .eq('rotas.status', 'LIVE');

            const rotaRows: unknown[] = Array.isArray(rota.data) ? rota.data : [];
            const required = Array.from(
                new Set(rotaRows.filter(hasUserId).map(r => r.user_id))
            );

            if (!required.length) {
                setMissingUsers([]);
                return;
            }

            // Who has submitted for this home?
            const ts = await supabase
                .from('timesheets')
                .select('user_id')
                .eq('home_id', homeId)
                .eq('month_date', month)
                .in('status', ['SUBMITTED', 'MANAGER_SUBMITTED']);

            const tsRows: unknown[] = Array.isArray(ts.data) ? ts.data : [];
            const submittedSet = new Set<string>(
                tsRows.filter(hasUserId).map(r => r.user_id)
            );

            const missing = required.filter(u => !submittedSet.has(u));
            setMissingUsers(missing);

            // Load names for missing folks
            if (missing.length) {
                const prof = await supabase
                    .from('profiles')
                    .select('user_id, full_name')
                    .in('user_id', missing);

                const profRows: unknown[] = Array.isArray(prof.data) ? prof.data : [];
                const m = new Map<string, Profile>();
                for (const row of profRows) {
                    if (isProfileRow(row)) {
                        m.set(row.user_id, row);
                    }
                }
                setMissingProfiles(m);
            } else {
                setMissingProfiles(new Map());
            }
        } finally {
            setLoadingMissing(false);
        }
    }
    useEffect(() => { void loadMissing(); }, [homeId, month]);

    return (
        <div className="space-y-4">
            <Toolbar
                companies={companies.length ? companies : undefined}
                companyId={companies.length ? companyId : undefined}
                setCompanyId={companies.length ? setCompanyId : undefined}
                homes={homes}
                homeId={homeId}
                setHomeId={setHomeId}
                month={month}
                setMonth={setMonth}
                rightExtra={rightExtra}
            />

            {/* Progress + Missing banner */}
            {(progress || loadingMissing) && (
                <div className="rounded-md border p-3 text-sm mb-2">
                    {progress ? (
                        <>
                            <div><strong>Submissions (this home):</strong> {progress.submitted_count} / {progress.total_required}</div>
                            {confirmAll && progress.submitted_count < progress.total_required && (
                                <div className="mt-1 text-amber-700">
                                    Not everyone has submitted. Click “Submit all to company” again to confirm.
                                </div>
                            )}

                            {/* Missing list */}
                            <div className="mt-2">
                                <div className="font-medium mb-1">Missing submissions</div>
                                {loadingMissing ? (
                                    <div className="text-gray-600">⏳ Checking…</div>
                                ) : (
                                    <>
                                        {missingUsers.length === 0 ? (
                                            <div className="text-emerald-700">All scheduled staff have submitted for this home.</div>
                                        ) : (
                                            <ul className="space-y-1">
                                                {missingUsers.map(uid => {
                                                    const p = missingProfiles.get(uid);
                                                    const display = p?.full_name || uid.slice(0, 8);
                                                    const inits = initialsFor(Array.from(missingProfiles.values()), uid);
                                                    return (
                                                        <li key={uid} className="flex items-center gap-2">
                                                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                                                                {inits}
                                                            </span>
                                                            <span>{display}</span>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="text-gray-600">⏳ Loading progress…</div>
                    )}
                </div>
            )}

            <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="text-left p-2">Person</th>
                            <th className="text-left p-2">Status</th>
                            <th className="text-left p-2">Hours</th>
                            <th className="text-left p-2">Sleep</th>
                            <th className="text-left p-2">Annual leave</th>
                            <th className="text-left p-2">Sickness</th>
                            <th className="text-left p-2">Waking night</th>
                            <th className="text-left p-2">Other leave</th>
                            <th className="text-left p-2">Rota match</th>
                            <th className="p-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {timesheets.map(ts => {
                            const prof = profilesById.get(ts.user_id);
                            const displayName = prof?.full_name ?? 'Loading…';
                            const inits = initialsFor(prof ? [prof] : [], ts.user_id);
                            const s = calcSummary(ts);
                            const mismatchCount = mismatchesFor(ts);

                            return (
                                <tr key={ts.id} className="border-t">
                                    <td className="p-2">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold" title={displayName}>
                                                {inits}
                                            </span>
                                            <span className="truncate max-w-[180px]">{displayName}</span>
                                        </div>
                                    </td>
                                    <td className="p-2">{ts.status}</td>
                                    <td className="p-2">{s.hours.toFixed(2)}</td>
                                    <td className="p-2">{s.sleep}</td>
                                    <td className="p-2">{s.al}</td>
                                    <td className="p-2">{s.sick}</td>
                                    <td className="p-2">{s.wn}</td>
                                    <td className="p-2">{s.other}</td>
                                    <td className="p-2">
                                        {mismatchCount > 0 ? (
                                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ring-1 bg-rose-50 text-rose-700 ring-rose-100" title="Timesheet differs from the live rota">
                                                ⚠️ {mismatchCount} day{mismatchCount === 1 ? '' : 's'}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ring-1 bg-emerald-50 text-emerald-700 ring-emerald-100">
                                                ✓ Matches rota
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => setEditTS(ts)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">View/Edit</button>
                                            <button onClick={() => { void sendBack(ts); }} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">Send back</button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {loadingSubmitted && (
                            <tr>
                                <td className="p-2 text-sm text-gray-600" colSpan={10}>
                                    ⏳ Loading submitted timesheets…
                                </td>
                            </tr>
                        )}

                        {(!loadingSubmitted && !timesheets.length) && (
                            <tr>
                                <td className="p-2 text-sm text-gray-500" colSpan={10}>
                                    No submitted timesheets yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {editTS && (
                <ManagerTimesheetEditor
                    ts={editTS}
                    onClose={() => setEditTS(null)}
                    onChanged={() => { void loadSubmitted(); void loadManagerProgress(); void loadMissing(); }}
                />
            )}
        </div>
    );
}

function ManagerTimesheetEditor({
    ts, onClose, onChanged,
}: {
    ts: Timesheet;
    onClose: () => void;
    onChanged: () => void;
}) {
    const [entries, setEntries] = useState<TSEntry[]>([]);
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
    const [person, setPerson] = useState<Profile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const shiftMap = useMemo(() => {
        const m = new Map<string, ShiftType>();
        shiftTypes.forEach(s => m.set(s.id, s));
        return m;
    }, [shiftTypes]);

    const [liveByDay, setLiveByDay] = useState<Map<number, { shift_type_id: string | null, hours: number }>>(new Map());

    // editor
    const editable = ts.status === 'SUBMITTED';
    const [editingDay, setEditingDay] = useState<number | null>(null);
    const [editShiftId, setEditShiftId] = useState<string | ''>('');
    const [editHours, setEditHours] = useState<number>(0);
    const [editEntryId, setEditEntryId] = useState<string | undefined>(undefined);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const setDeleting = (id: string, v: boolean) =>
        setDeletingIds(prev => {
            const s = new Set(prev);
            v ? s.add(id) : s.delete(id);
            return s;
        });

    // REPLACE the existing reloadAll() with this version
    async function reloadAll() {
        // --- Type guards (no 'any') ---
        const isObj = (v: unknown): v is Record<string, unknown> =>
            typeof v === 'object' && v !== null;

        const isNullableString = (v: unknown): v is string | null =>
            typeof v === 'string' || v === null;

        const isTSEntry = (v: unknown): v is TSEntry => {
            if (!isObj(v)) return false;
            return (
                typeof v.id === 'string' &&
                typeof v.timesheet_id === 'string' &&
                typeof v.day_of_month === 'number' &&
                typeof v.hours === 'number' &&
                ('shift_type_id' in v ? isNullableString(v.shift_type_id) : true) &&
                ('notes' in v ? isNullableString(v.notes) : true) &&
                ('home_id' in v ? isNullableString(v.home_id) : true)
            );
        };

        const isShiftType = (v: unknown): v is ShiftType => {
            if (!isObj(v)) return false;
            return (
                typeof v.id === 'string' &&
                typeof v.code === 'string' &&
                typeof v.label === 'string' &&
                typeof v.default_hours === 'number' &&
                typeof v.is_active === 'boolean' &&
                ('kind' in v ? isNullableString(v.kind) : true)
            );
        };

        const isProfile = (v: unknown): v is Profile => {
            if (!isObj(v)) return false;
            const full = 'full_name' in v ? (v as Record<string, unknown>).full_name : undefined;
            return typeof v.user_id === 'string' && (typeof full === 'string' || full === null || typeof full === 'undefined');
        };

        const isRotaRow = (v: unknown): v is { day_of_month: number; shift_type_id: string | null; hours: number } => {
            if (!isObj(v)) return false;
            const sid = 'shift_type_id' in v ? (v as Record<string, unknown>).shift_type_id : undefined;
            return (
                typeof v.day_of_month === 'number' &&
                (typeof sid === 'string' || sid === null) &&
                typeof v.hours === 'number'
            );
        };

        try {
            setIsLoading(true);

            const [entriesRes, shiftTypeLoad, profRes, rotaRes] = await Promise.all([
                supabase
                    .from('timesheet_entries')
                    .select('id,day_of_month,shift_type_id,hours,notes,home_id,timesheet_id')
                    .eq('timesheet_id', ts.id)
                    .or(`home_id.eq.${ts.home_id},home_id.is.null`),

                (async () => {
                    const h = await supabase
                        .from('homes')
                        .select('company_id')
                        .eq('id', ts.home_id)
                        .single();

                    const companyId =
                        isObj(h.data) && typeof h.data.company_id === 'string' ? (h.data.company_id as string) : null;

                    if (companyId) {
                        const rpc = await supabase.rpc('shift_types_for_ui', {
                            p_company_id: companyId,
                            p_include_inactive: false,
                        });
                        if (!rpc.error && Array.isArray(rpc.data)) return rpc;
                    }

                    if (companyId) {
                        return await supabase
                            .from('shift_types')
                            .select('*')
                            .eq('company_id', companyId)
                            .eq('is_active', true);
                    }

                    return { data: [] };
                })(),

                supabase
                    .from('profiles')
                    .select('user_id, full_name')
                    .eq('user_id', ts.user_id)
                    .maybeSingle(),

                supabase
                    .from('rota_entries')
                    .select(
                        'day_of_month, shift_type_id, hours, user_id, rotas!inner(home_id, month_date, status)'
                    )
                    .eq('rotas.home_id', ts.home_id)
                    .eq('rotas.month_date', ts.month_date)
                    .eq('rotas.status', 'LIVE')
                    .eq('user_id', ts.user_id),
            ]);

            // Entries
            const entriesRaw = Array.isArray(entriesRes.data) ? entriesRes.data : [];
            const entryRows: TSEntry[] = entriesRaw.filter(isTSEntry);
            if (entriesRes.error) {
                console.warn('timesheet_entries load error:', entriesRes.error.message);
            }
            setEntries(entryRows);

            // Shift types
            const stUnknown = isObj(shiftTypeLoad) && 'data' in shiftTypeLoad ? (shiftTypeLoad as { data?: unknown }).data : undefined;
            const shiftTypesData: ShiftType[] = Array.isArray(stUnknown) ? stUnknown.filter(isShiftType) : [];
            setShiftTypes(shiftTypesData);

            // Person profile
            const profData = (profRes && (profRes as { data?: unknown }).data) ?? null;
            const personRow = isProfile(profData) ? (profData as Profile) : null;
            setPerson(personRow);

            // LIVE rota
            const rotaUnknown = (rotaRes && (rotaRes as { data?: unknown }).data) ?? [];
            const rotaRows: Array<{ day_of_month: number; shift_type_id: string | null; hours: number }> =
                Array.isArray(rotaUnknown)
                    ? rotaUnknown
                        .map(r => {
                            if (!isObj(r)) return null;
                            const row = {
                                day_of_month: Number((r as Record<string, unknown>).day_of_month),
                                shift_type_id:
                                    (typeof (r as Record<string, unknown>).shift_type_id === 'string'
                                        ? (r as Record<string, unknown>).shift_type_id
                                        : (r as Record<string, unknown>).shift_type_id === null
                                            ? null
                                            : null),
                                hours: Number((r as Record<string, unknown>).hours ?? 0),
                            };
                            return isRotaRow(row) ? row : null;
                        })
                        .filter((x): x is { day_of_month: number; shift_type_id: string | null; hours: number } => x !== null)
                    : [];

            const liveMap = new Map<number, { shift_type_id: string | null; hours: number }>();
            for (const r of rotaRows) {
                liveMap.set(r.day_of_month, { shift_type_id: r.shift_type_id, hours: r.hours });
            }
            setLiveByDay(liveMap);
        } finally {
            setIsLoading(false);
        }
    }


    useEffect(() => { void reloadAll(); }, [ts.id, ts.home_id, ts.user_id, ts.month_date]);

    const displayName = person?.full_name || ts.user_id.slice(0, 8);
    const inits = initialsFor(person ? [person] : [], ts.user_id);

    function openEditor(day: number, entry?: TSEntry) {
        if (!editable) return;
        setEditingDay(day);
        if (entry) {
            setEditEntryId(entry.id);
            setEditShiftId(entry.shift_type_id || '');
            setEditHours(entry.hours);
        } else {
            setEditEntryId(undefined);
            setEditShiftId('');
            setEditHours(0);
        }
    }
    function onPickShift(sid: string) {
        setEditShiftId(sid);
        const st = sid ? shiftMap.get(sid) : undefined;
        if (st) setEditHours(st.default_hours);
    }

    async function saveEditor() {
        if (!editingDay) return;

        if (editEntryId) {
            // manager-safe RPC to update an existing entry
            const { error } = await supabase.rpc('manager_update_tentry_v2', {
                p_entry_id: editEntryId,
                p_shift_type_id: editShiftId || null,
                p_hours: Number(editHours) || 0,
            });
            if (error) { alert(error.message); return; }

            // surgical state update
            setEntries(prev => {
                const idx = prev.findIndex(e => e.id === editEntryId);
                if (idx === -1) return prev;
                const next = prev.slice();
                next[idx] = { ...next[idx], shift_type_id: editShiftId || null, hours: Number(editHours) || 0 } as TSEntry;
                return next;
            });
        } else {
            // insert a new row for this day/home
            const ins = await supabase.from('timesheet_entries').insert({
                timesheet_id: ts.id,
                home_id: ts.home_id,
                day_of_month: editingDay,
                shift_type_id: editShiftId || null,
                hours: Number(editHours) || 0,
            }).select('id,timesheet_id,home_id,day_of_month,shift_type_id,hours,notes').single();

            if (ins.error) { alert(ins.error.message); return; }
            setEntries(prev => [...prev, ins.data as TSEntry]);
        }

        setEditingDay(null);
        onChanged(); // keep parent progress/missing in sync
    }

    async function delEntry(id: string) {
        if (!editable || deletingIds.has(id)) return;

        setDeleting(id, true);

        // optimistic remove
        const prev = entries;
        setEntries(prev.filter(e => e.id !== id));

        const { error } = await supabase
            .from('timesheet_entries')
            .delete({ count: 'exact' })
            .eq('id', id);

        if (error) {
            // rollback on failure
            alert(error.message);
            setEntries(prev);
        } else {
            onChanged(); // keep parent progress/missing in sync
        }

        setDeleting(id, false);
    }

    return (
        <div className="fixed inset-0 bg-black/30 grid place-items-center z-50" onClick={onClose}>
            <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold" title={displayName}>
                            {inits}
                        </span>
                        <h3 className="text-base font-semibold truncate">{displayName}</h3>
                        <span className="ml-2 text-xs px-2 py-1 rounded ring-1 bg-indigo-50 text-indigo-700 ring-indigo-100">
                            Status: {ts.status}
                        </span>
                    </div>
                    <button onClick={onClose} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Close</button>
                </div>

                {isLoading ? (
                    <div className="rounded-md border p-3 text-sm text-gray-700">
                        ⏳ Loading data…
                    </div>
                ) : (
                    <CalendarGrid
                        monthISO={ts.month_date}
                        cellRenderer={(d) => {
                            const todays = entries.filter(e => e.day_of_month === d);
                            return (
                                <div className="space-y-1">
                                    {todays.length === 0 ? (
                                        <div className="text-xs text-gray-400">—</div>
                                    ) : todays.map(e => {
                                        const code = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.code || '') : '';
                                        const kind = e.shift_type_id ? (shiftMap.get(e.shift_type_id)?.kind || null) : null;

                                        // mismatch flag
                                        const live = liveByDay.get(d);
                                        const mismatch = (() => {
                                            if (!live && (e.shift_type_id || e.hours)) return true;
                                            if (live) {
                                                const sameShift = (live.shift_type_id || null) === (e.shift_type_id || null);
                                                const sameHours = Math.abs((live.hours || 0) - (Number(e.hours) || 0)) < 0.001;
                                                return !(sameShift && sameHours);
                                            }
                                            return false;
                                        })();

                                        return (
                                            <div
                                                key={e.id}
                                                className={`rounded-lg border p-2 text-[12px] ${mismatch ? 'bg-rose-50 border-rose-200' : 'bg-gray-50'}`}
                                                title={mismatch ? 'Does not match live rota' : undefined}
                                            >
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
                                                        {inits}
                                                    </span>
                                                    {code && <span className="font-mono font-semibold">{code}</span>}
                                                    <span>{e.hours}h</span>
                                                    {kind && <span className="text-gray-600">· {KIND_LABEL[kind] || kind}</span>}
                                                    {mismatch && <span className="text-rose-700 text-xs">• mismatch</span>}
                                                </div>
                                                {editable && (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        <button
                                                            onClick={() => openEditor(d, e)}
                                                            disabled={isLoading}
                                                            className="rounded border px-2 py-[2px] text-[11px] hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => { void delEntry(e.id); }}
                                                            disabled={isLoading || deletingIds.has(e.id)}
                                                            className="rounded border px-2 py-[2px] text-[11px] hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                        >
                                                            {deletingIds.has(e.id) ? '⏳ Deleting…' : 'Delete'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {editable && (
                                        <button
                                            onClick={() => openEditor(d)}
                                            disabled={isLoading}
                                            className="mt-1 rounded border px-2 py-[2px] text-[11px] hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            Add
                                        </button>
                                    )}
                                </div>
                            );
                        }}
                    />
                )}

                {/* EDITOR OVERLAY (modal) */}
                {editingDay && (
                    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50" onClick={(e) => { e.stopPropagation(); setEditingDay(null); }}>
                        <div className="w-full max-w-md rounded-xl border bg-white p-4 shadow-xl" onClick={e => e.stopPropagation()}>
                            <h4 className="text-sm font-semibold mb-3">Edit day {editingDay}</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="sm:col-span-2">
                                    <label className="block text-xs text-gray-600 mb-1">Shift type</label>
                                    <select className="w-full border rounded-lg px-3 py-2" value={editShiftId} onChange={e => onPickShift(e.target.value)}>
                                        <option value="">(none)</option>
                                        {shiftTypes.map(s => <option key={s.id} value={s.id}>{s.code} — {s.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">Hours</label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.25"
                                        className="w-full border rounded-lg px-3 py-2"
                                        value={editHours}
                                        onChange={e => setEditHours(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                                <button onClick={() => setEditingDay(null)} className="rounded border px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
                                <button onClick={() => { void saveEditor(); }} className="rounded border px-3 py-2 text-sm hover:bg-gray-50">Save</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ===================================
   Company Timesheets (with progress)
   =================================== */
function CompanyView({ isAdmin }: { isAdmin: boolean }) {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState<string>('');
    const [homes, setHomes] = useState<Home[]>([]);
    const [homeId, setHomeId] = useState<string>(''); // optional filter
    const [month, setMonth] = useState<string>(() => firstOfMonthLocalISO());

    const [timesheets, setTimesheets] = useState<TimesheetWithHomeName[]>([]);
    const [entriesByTS, setEntriesByTS] = useState<Map<string, TSEntry[]>>(new Map());
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const shiftMap = useMemo(() => {
        const m = new Map<string, ShiftType>();
        shiftTypes.forEach(s => m.set(s.id, s));
        return m;
    }, [shiftTypes]);

    // Users who belong to ANY home in this company (decides House vs Bank at USER level)
    const [companyMemberUsers, setCompanyMemberUsers] = useState<Set<string>>(new Set());
    const [membershipsLoaded, setMembershipsLoaded] = useState(false);

    // Company-wide submission progress
    const [progress, setProgress] = useState<{ total_required: number; submitted_count: number; manager_count: number } | null>(null);
    const [missing, setMissing] = useState<{ user_id: string; missing_home_ids: string[] }[]>([]);
    const [profilesMap, setProfilesMap] = useState<Map<string, Profile>>(new Map());
    const [loadingProgress, setLoadingProgress] = useState(false);

    // bootstrap company scope
    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            const me = data.user?.id; if (!me) return;
            if (isAdmin) {
                const co = await supabase.from('companies').select('id,name').order('name');
                setCompanies((co.data || []) as Company[]);
            } else {
                const cm = await supabase.from('company_memberships').select('company_id').eq('user_id', me).maybeSingle();
                const cid = cm.data?.company_id || '';
                setCompanyId(cid);
            }
        })();
    }, [isAdmin]);

    // Load homes + timesheets + entries + profiles; THEN classify house/bank via RPC (RLS-safe)
    useEffect(() => {
        (async () => {
            setMembershipsLoaded(false);

            if (!companyId) {
                setHomes([]);
                setTimesheets([]);
                setEntriesByTS(new Map());
                setProfiles([]);
                setCompanyMemberUsers(new Set());
                setShiftTypes([]);
                setMembershipsLoaded(true);
                return;
            }

            // 1) Homes in this company (RLS-safe via RPC)
            const homesRes = await supabase.rpc('homes_list_company_all', { p_company_id: companyId });
            const homeList: Home[] = Array.isArray(homesRes.data)
                ? homesRes.data.map(h => ({ id: h.id, name: h.name, company_id: h.company_id }))
                : [];
            setHomes(homeList);

            // 2) Manager-submitted timesheets for month (optionally filtered by home)
            const visibleHomeIds = homeId ? [homeId] : homeList.map(x => x.id);
            const ts = await supabase
                .from('timesheets')
                .select('*, homes!inner(name)')
                .eq('month_date', month)
                .in('home_id', visibleHomeIds.length ? visibleHomeIds : ['00000000-0000-0000-0000-000000000000'])
                .eq('status', 'MANAGER_SUBMITTED');

            const rows: TimesheetWithHomeName[] = Array.isArray(ts.data)
                ? ts.data.map(x => ({
                    id: x.id,
                    home_id: x.home_id,
                    user_id: x.user_id,
                    month_date: x.month_date,
                    status: x.status,
                    submitted_at: x.submitted_at ?? null,
                    manager_submitted_at: x.manager_submitted_at ?? null,
                    home_name: x.homes?.name ?? '(home)',
                }))
                : [];
            setTimesheets(rows);

            // 3) Entries per timesheet
            const ids = rows.map(t => t.id);
            if (ids.length) {
                const enRes = await supabase.from('timesheet_entries').select('*').in('timesheet_id', ids);
                const enData: TSEntry[] = Array.isArray(enRes.data) ? (enRes.data as TSEntry[]) : [];
                const map = new Map<string, TSEntry[]>();
                enData.forEach(e => {
                    if (!map.has(e.timesheet_id)) map.set(e.timesheet_id, []);
                    map.get(e.timesheet_id)!.push(e);
                });
                setEntriesByTS(map);
            } else {
                setEntriesByTS(new Map());
            }

            // 4) Names for the rows' users
            const userIds = Array.from(new Set(rows.map(r => r.user_id)));
            if (userIds.length) {
                const profRes = await supabase.from('profiles').select('user_id, full_name').in('user_id', userIds);
                const profs: Profile[] = Array.isArray(profRes.data) ? (profRes.data as Profile[]) : [];
                setProfiles(profs);
            } else {
                setProfiles([]);
            }

            // 5) Shift types for summary kinds
            const stRes = await supabase.from('shift_types').select('*').eq('company_id', companyId);
            const stData: ShiftType[] = Array.isArray(stRes.data) ? (stRes.data as ShiftType[]) : [];
            setShiftTypes(stData);

            // 6) RLS-safe classification: which of THESE users belong to ANY home in THIS company?
            if (userIds.length) {
                const mapRes = await supabase.rpc('staff_home_map_for_company_users', {
                    p_company_id: companyId,
                    p_user_ids: userIds,
                });
                const memberUsers = new Set<string>(
                    Array.isArray(mapRes.data) ? mapRes.data.map((x: { user_id: string }) => x.user_id) : []
                );
                setCompanyMemberUsers(memberUsers);
            } else {
                setCompanyMemberUsers(new Set());
            }

            setMembershipsLoaded(true);
        })();
    }, [companyId, homeId, month]);

    // Company-wide progress across ALL homes in the company for the month
    useEffect(() => {
        (async () => {
            setProgress(null);
            setMissing([]);
            setProfilesMap(new Map());
            if (!companyId || !month || !homes.length) return;

            // type guards
            type RotaUserJoin = { user_id: string; rotas: { home_id: string } };
            const isRotaUserJoin = (row: unknown): row is RotaUserJoin => {
                if (typeof row !== 'object' || row === null) return false;
                const r = row as { user_id?: unknown; rotas?: unknown };
                if (typeof r.user_id !== 'string') return false;
                if (typeof r.rotas !== 'object' || r.rotas === null) return false;
                const rotas = r.rotas as { home_id?: unknown };
                return typeof rotas.home_id === 'string';
            };

            type TSRow = { user_id: string; home_id: string; status: Timesheet['status'] };
            const isTSRow = (row: unknown): row is TSRow => {
                if (typeof row !== 'object' || row === null) return false;
                const r = row as { user_id?: unknown; home_id?: unknown; status?: unknown };
                return (
                    typeof r.user_id === 'string' &&
                    typeof r.home_id === 'string' &&
                    (r.status === 'DRAFT' ||
                        r.status === 'SUBMITTED' ||
                        r.status === 'RETURNED' ||
                        r.status === 'MANAGER_SUBMITTED')
                );
            };

            setLoadingProgress(true);
            try {
                const homeIds = homes.map(h => h.id);

                // LIVE rota across company homes for the month
                const rota = await supabase
                    .from('rota_entries')
                    .select('user_id, rotas!inner(home_id, month_date, status)')
                    .eq('rotas.month_date', month)
                    .eq('rotas.status', 'LIVE')
                    .in('rotas.home_id', homeIds);

                const requiredByUser = new Map<string, Set<string>>();
                const rotaRows: unknown[] = Array.isArray(rota.data) ? rota.data : [];
                rotaRows.filter(isRotaUserJoin).forEach(r => {
                    const set = requiredByUser.get(r.user_id) ?? new Set<string>();
                    set.add(r.rotas.home_id);
                    requiredByUser.set(r.user_id, set);
                });
                const totalRequired = requiredByUser.size;

                if (!totalRequired) {
                    setProgress({ total_required: 0, submitted_count: 0, manager_count: 0 });
                    setMissing([]);
                    setProfilesMap(new Map());
                    setLoadingProgress(false);
                    return;
                }

                // All timesheets for those homes/month
                const tsRes = await supabase
                    .from('timesheets')
                    .select('user_id, home_id, status')
                    .eq('month_date', month)
                    .in('home_id', homeIds);

                const submittedByUser = new Map<string, Set<string>>();
                const managerByUser = new Map<string, Set<string>>();

                const tsRows: unknown[] = Array.isArray(tsRes.data) ? tsRes.data : [];
                tsRows.filter(isTSRow).forEach(t => {
                    if (t.status === 'SUBMITTED' || t.status === 'MANAGER_SUBMITTED') {
                        const set = submittedByUser.get(t.user_id) ?? new Set<string>();
                        set.add(t.home_id);
                        submittedByUser.set(t.user_id, set);
                    }
                    if (t.status === 'MANAGER_SUBMITTED') {
                        const set = managerByUser.get(t.user_id) ?? new Set<string>();
                        set.add(t.home_id);
                        managerByUser.set(t.user_id, set);
                    }
                });

                // Counts + who is missing
                let submittedCount = 0, managerCount = 0;
                const missingList: { user_id: string; missing_home_ids: string[] }[] = [];
                requiredByUser.forEach((requiredHomes, userId) => {
                    const subHomes = submittedByUser.get(userId) ?? new Set<string>();
                    const mgrHomes = managerByUser.get(userId) ?? new Set<string>();

                    const missingHomes = Array.from(requiredHomes).filter(h => !subHomes.has(h));
                    if (missingHomes.length === 0) submittedCount++;

                    const allMgr = Array.from(requiredHomes).every(h => mgrHomes.has(h));
                    if (allMgr) managerCount++;

                    if (missingHomes.length) missingList.push({ user_id: userId, missing_home_ids: missingHomes });
                });

                setProgress({ total_required: totalRequired, submitted_count: submittedCount, manager_count: managerCount });
                setMissing(missingList);

                // Names/initials for the required cohort
                const allUserIds = Array.from(requiredByUser.keys());
                if (allUserIds.length) {
                    const profRes = await supabase
                        .from('profiles')
                        .select('user_id, full_name')
                        .in('user_id', allUserIds);

                    const profRows: unknown[] = Array.isArray(profRes.data) ? profRes.data : [];
                    const m = new Map<string, Profile>();
                    profRows.forEach(row => {
                        const r = row as Partial<Profile>;
                        if (typeof r.user_id === 'string') {
                            m.set(r.user_id, { user_id: r.user_id, full_name: typeof r.full_name === 'string' ? r.full_name : null });
                        }
                    });
                    setProfilesMap(m);
                } else {
                    setProfilesMap(new Map());
                }
            } finally {
                setLoadingProgress(false);
            }
        })();
    }, [companyId, month, homes]);


    function calcSummary(ts: Timesheet) {
        const rows = entriesByTS.get(ts.id) || [];
        let hours = 0, sleep = 0, al = 0, sick = 0, wn = 0, other = 0;
        for (const e of rows) {
            hours += Number(e.hours) || 0;
            const kind = e.shift_type_id ? shiftMap.get(e.shift_type_id)?.kind : null;
            if (kind === 'SLEEP') sleep++;
            else if (kind === 'ANNUAL_LEAVE') al++;
            else if (kind === 'SICKNESS') sick++;
            else if (kind === 'WAKING_NIGHT') wn++;
            else if (kind === 'OTHER_LEAVE') other++;
        }
        return { hours, sleep, al, sick, wn, other };
    }

    const nameFor = (id: string) =>
        profiles.find(p => p.user_id === id)?.full_name
        || profilesMap.get(id)?.full_name
        || id.slice(0, 8);

    async function adminDelete(ts: Timesheet) {
        if (!isAdmin) return;
        if (!confirm('Delete this timesheet (and its entries)?')) return;
        const del = await supabase.from('timesheets').delete().eq('id', ts.id);
        if (del.error) { alert(del.error.message); return; }
        setTimesheets(prev => prev.filter(x => x.id !== ts.id));
        setEntriesByTS(prev => { const m = new Map(prev); m.delete(ts.id); return m; });
    }

    // Homes list for the toolbar (prepend "All homes" option)
    const toolbarHomes: Home[] = [{ id: '', name: 'All homes', company_id: companyId }, ...homes];

    // ---- Aggregate “bank” rows by USER (only for users with NO membership in the company) ----
    type BankAgg = {
        user_id: string;
        hours: number; sleep: number; al: number; sick: number; wn: number; other: number;
    };

    const bankAggByUser = useMemo(() => {
        if (!membershipsLoaded) return new Map<string, BankAgg>();
        const agg = new Map<string, BankAgg>();
        for (const t of timesheets) {
            // Skip anyone who belongs to ANY home in the company
            if (companyMemberUsers.has(t.user_id)) continue;

            const rows = entriesByTS.get(t.id) || [];
            let hours = 0, sleep = 0, al = 0, sick = 0, wn = 0, other = 0;
            for (const e of rows) {
                hours += Number(e.hours) || 0;
                const kind = e.shift_type_id ? shiftMap.get(e.shift_type_id)?.kind : null;
                if (kind === 'SLEEP') sleep++;
                else if (kind === 'ANNUAL_LEAVE') al++;
                else if (kind === 'SICKNESS') sick++;
                else if (kind === 'WAKING_NIGHT') wn++;
                else if (kind === 'OTHER_LEAVE') other++;
            }

            const prev = agg.get(t.user_id) || { user_id: t.user_id, hours: 0, sleep: 0, al: 0, sick: 0, wn: 0, other: 0 };
            agg.set(t.user_id, {
                user_id: t.user_id,
                hours: prev.hours + hours,
                sleep: prev.sleep + sleep,
                al: prev.al + al,
                sick: prev.sick + sick,
                wn: prev.wn + wn,
                other: prev.other + other,
            });
        }
        return agg;
    }, [timesheets, entriesByTS, shiftMap, companyMemberUsers, membershipsLoaded]);

    return (
        <div className="space-y-4">
            <Toolbar
                companies={isAdmin ? companies : undefined}
                companyId={isAdmin ? companyId : undefined}
                setCompanyId={isAdmin ? setCompanyId : undefined}
                homes={toolbarHomes}
                homeId={homeId}
                setHomeId={setHomeId}
                month={month}
                setMonth={setMonth}
            />

            {/* Company-wide progress banner */}
            {progress && (
                <div className="rounded-md border p-3 text-sm">
                    {progress.total_required === 0 ? (
                        <div className="text-gray-600">No LIVE rota entries for this company in the selected month.</div>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-x-6 gap-y-1">
                                <div><strong>Staff scheduled this period:</strong> {progress.total_required}</div>
                                <div><strong>Submitted to managers:</strong> {progress.submitted_count} / {progress.total_required}</div>
                                <div><strong>Manager forwarded:</strong> {progress.manager_count} / {progress.total_required}</div>
                                {loadingProgress && <div>⏳ updating…</div>}
                            </div>

                            {missing.length > 0 && (
                                <div className="mt-2">
                                    <div className="font-medium mb-1">Missing submissions</div>
                                    <ul className="space-y-1">
                                        {missing.slice(0, 12).map(m => {
                                            const profList = Array.from(profilesMap.values());
                                            const inits = initialsFor(profList, m.user_id);
                                            const display = nameFor(m.user_id);
                                            return (
                                                <li key={m.user_id} className="flex items-center gap-2 flex-wrap">
                                                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                                                        {inits}
                                                    </span>
                                                    <span className="mr-1">{display}</span>
                                                    <span className="text-gray-500">· Missing:</span>
                                                    {m.missing_home_ids.map(hid => (
                                                        <span
                                                            key={hid}
                                                            className="text-xs px-2 py-0.5 rounded ring-1 bg-rose-50 text-rose-700 ring-rose-100"
                                                        >
                                                            {homes.find(h => h.id === hid)?.name || 'Home'}
                                                        </span>
                                                    ))}
                                                </li>
                                            );
                                        })}
                                        {missing.length > 12 && (
                                            <li className="text-xs text-gray-600">
                                                …and {missing.length - 12} more.
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Company table */}
            <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="text-left p-2">Home</th>
                            <th className="text-left p-2">User</th>
                            <th className="text-left p-2">Status</th>
                            <th className="text-left p-2">Hours</th>
                            <th className="text-left p-2">Sleep</th>
                            <th className="text-left p-2">Annual leave</th>
                            <th className="text-left p-2">Sickness</th>
                            <th className="text-left p-2">Waking night</th>
                            <th className="text-left p-2">Other leave</th>
                            {isAdmin && <th className="p-2">Admin</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {/* House members: any user who belongs to at least one home in the company */}
                        {membershipsLoaded &&
                            timesheets.filter(t => companyMemberUsers.has(t.user_id)).map(t => {
                                const s = calcSummary(t);
                                return (
                                    <tr key={t.id} className="border-t">
                                        <td className="p-2">{t.home_name}</td>
                                        <td className="p-2">
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                                                    {initialsFor(profiles, t.user_id)}
                                                </span>
                                                <span>{nameFor(t.user_id)}</span>
                                            </div>
                                        </td>
                                        <td className="p-2">{t.status}</td>
                                        <td className="p-2">{s.hours.toFixed(2)}</td>
                                        <td className="p-2">{s.sleep}</td>
                                        <td className="p-2">{s.al}</td>
                                        <td className="p-2">{s.sick}</td>
                                        <td className="p-2">{s.wn}</td>
                                        <td className="p-2">{s.other}</td>
                                        {isAdmin && (
                                            <td className="p-2">
                                                <button onClick={() => { void adminDelete(t); }} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">Delete</button>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}

                        {/* Bank users: exactly one aggregated row per user across homes (labelled “Bank staff”) */}
                        {[...bankAggByUser.values()].map(agg => (
                            <tr key={`BANK_${agg.user_id}`} className="border-t">
                                <td className="p-2">Bank staff</td>
                                <td className="p-2">
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                                            {initialsFor(profiles, agg.user_id)}
                                        </span>
                                        <span>{nameFor(agg.user_id)}</span>
                                    </div>
                                </td>
                                <td className="p-2">MANAGER_SUBMITTED</td>
                                <td className="p-2">{agg.hours.toFixed(2)}</td>
                                <td className="p-2">{agg.sleep}</td>
                                <td className="p-2">{agg.al}</td>
                                <td className="p-2">{agg.sick}</td>
                                <td className="p-2">{agg.wn}</td>
                                <td className="p-2">{agg.other}</td>
                                {isAdmin && <td className="p-2" />}
                            </tr>
                        ))}

                        {(!timesheets.length) && (
                            <tr>
                                <td className="p-2 text-sm text-gray-500" colSpan={isAdmin ? 10 : 9}>
                                    No manager-submitted timesheets for this selection.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


