'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/** ===== Types ===== */
type Level = AppLevel;
type Company = { id: string; name: string };
type Home = { id: string; name: string; company_id: string };

type Recurrence = 'NEVER' | 'WEEKLY' | 'BIWEEKLY' | 'FOUR_WEEKLY' | 'MONTHLY' | 'YEARLY';

type Appointment = {
    id: string;
    home_id: string;
    start_date: string;
    description: string;
    recurrence: Recurrence;
    reminders_enabled: boolean;
    created_by: string;
    created_at: string;
    updated_at: string;
};

type AppointmentException = {
    id: string;
    appointment_id: string;
    skip_date: string; // ISO date
    created_by: string;
    created_at: string;
};

// Membership helper row types
type CompanyMembershipRow = { company_id: string };
type HomeMembershipRow = { home_id: string; role?: string };

/** ===== Date helpers (month grid) ===== */
function startOfMonth(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function endOfMonth(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); }
function fmtISO(d: Date) { return d.toISOString().slice(0, 10); }
function addDaysISO(iso: string, days: number) {
    const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return fmtISO(d);
}
function addMonthsISO(iso: string, months: number) {
    const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); return fmtISO(d);
}
function sameMonth(iso: string, monthDate: Date) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.getUTCFullYear() === monthDate.getUTCFullYear() && d.getUTCMonth() === monthDate.getUTCMonth();
}

/** Expand one appointment into all occurrences inside [mStart, mEnd] (inclusive) */
function expandForMonth(appt: Appointment, mStart: string, mEnd: string): string[] {
    const out: string[] = [];
    let cur = appt.start_date;

    if (appt.recurrence === 'NEVER') {
        if (cur >= mStart && cur <= mEnd) out.push(cur);
        return out;
    }

    const maxLoops = 400; // ~8 years weekly; plenty for UI
    for (let i = 0; i < maxLoops; i++) {
        if (cur > mEnd) break;
        if (cur >= mStart && cur <= mEnd) out.push(cur);

        switch (appt.recurrence) {
            case 'WEEKLY': cur = addDaysISO(cur, 7); break;
            case 'BIWEEKLY': cur = addDaysISO(cur, 14); break;
            case 'FOUR_WEEKLY': cur = addDaysISO(cur, 28); break;
            case 'MONTHLY': cur = addMonthsISO(cur, 1); break;
            case 'YEARLY': cur = addMonthsISO(cur, 12); break;
            default: return out;
        }
    }
    return out;
}

/** Day label */
function dmy(iso: string) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** ===== Page ===== */
export default function Page() {
    const [view, setView] = useState<
        | { status: 'loading' }
        | { status: 'signed_out' }
        | {
            status: 'ready';
            level: Level;
            uid: string;
            companies: Company[];
            homes: Home[];
            selectedCompanyId: string | null;
            selectedHomeId: string | null;
        }
    >({ status: 'loading' });

    const isAdmin = view.status === 'ready' && view.level === '1_ADMIN';
    const isCompany = view.status === 'ready' && view.level === '2_COMPANY';
    const isManager = view.status === 'ready' && view.level === '3_MANAGER';
    const canChooseCompany = isAdmin;
    const canChooseHome = isAdmin || isCompany || isManager;

    /** month being shown */
    const [monthDate, setMonthDate] = useState<Date>(() => startOfMonth(new Date()));
    const monthStartISO = fmtISO(startOfMonth(monthDate));
    const monthEndISO = fmtISO(endOfMonth(monthDate));

    /** appointments raw + expanded for the grid */
    const [appts, setAppts] = useState<Appointment[]>([]);
    const [exceptions, setExceptions] = useState<AppointmentException[]>([]);
    const [loading, setLoading] = useState(false);
    const [sendingReminders, setSendingReminders] = useState(false);

    /** add/edit modal */
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<Appointment | null>(null);
    const [occurrenceISO, setOccurrenceISO] = useState<string | null>(null); // which instance was clicked
    const [formDate, setFormDate] = useState<string>(fmtISO(new Date()));
    const [formDesc, setFormDesc] = useState('');
    const [formRec, setFormRec] = useState<Recurrence>('NEVER');
    const [formRem, setFormRem] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmRow, setConfirmRow] = useState<'none' | 'this' | 'series'>('none'); // inline confirmation UI

    // NEW (inline banner instead of alert popups)
    const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    // In the browser, setTimeout returns a number; using window.setTimeout keeps types simple.
    const noticeTimerRef = useRef<number | null>(null);

    function pushNotice(text: string, type: 'success' | 'error' | 'info' = 'info') {
        setNotice({ type, text });
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3000);
    }
    // cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        };
    }, []);

    /** ===== Load session + scope (companies/homes) ===== */
    useEffect(() => {
        (async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;
            if (!session) { setView({ status: 'signed_out' }); return; }
            const uid = session.user.id;
            const lvl = await getEffectiveLevel();

            // load scope similar to your Budgets page
            let companies: Company[] = [];
            let homes: Home[] = [];

            if (lvl === '1_ADMIN') {
                const [{ data: cs }, { data: hs }] = await Promise.all([
                    supabase.from('companies').select('id,name').order('name'),
                    supabase.from('homes').select('id,name,company_id').order('name'),
                ]);
                companies = (cs ?? []) as Company[];
                homes = (hs ?? []) as Home[];
            } else if (lvl === '2_COMPANY') {
                const { data: cm } = await supabase
                    .from('company_memberships')
                    .select('company_id')
                    .eq('user_id', uid);
                const companyRows = (cm ?? []) as CompanyMembershipRow[];
                const cids = companyRows.map(r => r.company_id);

                if (cids.length) {
                    const [{ data: cs }, { data: hs }] = await Promise.all([
                        supabase.from('companies').select('id,name').in('id', cids).order('name'),
                        supabase.from('homes').select('id,name,company_id').in('company_id', cids).order('name'),
                    ]);
                    companies = (cs ?? []) as Company[];
                    homes = (hs ?? []) as Home[];
                }
            } else if (lvl === '3_MANAGER') {
                const { data: hm } = await supabase
                    .from('home_memberships')
                    .select('home_id')
                    .eq('user_id', uid)
                    .eq('role', 'MANAGER');

                const homeRows = (hm ?? []) as HomeMembershipRow[];
                const hids = homeRows.map(r => r.home_id);

                if (hids.length) {
                    const { data: hs } = await supabase
                        .from('homes')
                        .select('id,name,company_id')
                        .in('id', hids)
                        .order('name');

                    homes = (hs ?? []) as Home[];

                    const cids = Array.from(new Set(homes.map(h => h.company_id)));
                    if (cids.length) {
                        const { data: cs } = await supabase
                            .from('companies')
                            .select('id,name')
                            .in('id', cids)
                            .order('name');
                        companies = (cs ?? []) as Company[];
                    }
                }
            } else {
                // Staff: just their single home
                const { data: hm } = await supabase
                    .from('home_memberships')
                    .select('home_id')
                    .eq('user_id', uid)
                    .limit(1)
                    .maybeSingle();

                const hid = (hm ? (hm as HomeMembershipRow).home_id : null);

                let hs: Home[] = [];
                let cs: Company[] = [];

                if (hid) {
                    const { data: h } = await supabase
                        .from('homes')
                        .select('id,name,company_id')
                        .eq('id', hid)
                        .single();

                    if (h) {
                        const home = h as Home;
                        hs = [home];

                        const { data: c } = await supabase
                            .from('companies')
                            .select('id,name')
                            .eq('id', home.company_id)
                            .single();

                        if (c) cs = [c as Company];
                    }
                }
                homes = hs;
                companies = cs;
            }

            // defaults
            let selectedCompanyId: string | null = companies[0]?.id ?? null;
            let selectedHomeId: string | null = null;
            if (lvl === '1_ADMIN' || lvl === '2_COMPANY') {
                const firstHome = homes.find(h => h.company_id === selectedCompanyId) ?? homes[0];
                selectedHomeId = firstHome?.id ?? null;
            } else {
                selectedHomeId = homes[0]?.id ?? null;
                selectedCompanyId = selectedHomeId ? (homes.find(h => h.id === selectedHomeId)?.company_id ?? null) : null;
            }

            setView({ status: 'ready', level: lvl as Level, uid, companies, homes, selectedCompanyId, selectedHomeId });
        })();
    }, []);

    /** Reload appointments when month/home changes */
    // Narrow once, then use the narrowed values inside the callback and deps
    const viewStatus = view.status;
    const selectedHomeId = viewStatus === 'ready' ? view.selectedHomeId : null;

    const loadAppointments = useCallback(async () => {
        if (viewStatus !== 'ready' || !selectedHomeId) return;
        setLoading(true);

        const from = fmtISO(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 1, 1)));
        const to = fmtISO(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 2, 0)));

        const [{ data: ap }, { data: ex }] = await Promise.all([
            supabase
                .from('appointments')
                .select('*')
                .eq('home_id', selectedHomeId)
                .lte('start_date', to),
            supabase
                .from('appointment_exceptions')
                .select('*')
                .gte('skip_date', from)
                .lte('skip_date', to),
        ]);

        setAppts(((ap ?? []) as unknown as Appointment[]));
        setExceptions(((ex ?? []) as unknown as AppointmentException[]));
        setLoading(false);
    }, [viewStatus, selectedHomeId, monthDate]);

    useEffect(() => { void loadAppointments(); }, [loadAppointments]);

    /** Derived: month grid (Mon-Sun) + events by day */
    const days = useMemo(() => {
        // grid from Monday before 1st through Sunday after end
        const start = startOfMonth(monthDate);
        const end = endOfMonth(monthDate);
        const startDay = (start.getUTCDay() + 6) % 7; // Monday=0
        const gridStart = new Date(start); gridStart.setUTCDate(gridStart.getUTCDate() - startDay);
        const endDay = (end.getUTCDay() + 6) % 7; // Monday=0
        const gridEnd = new Date(end); gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - endDay));

        const all: { iso: string; inMonth: boolean }[] = [];
        const cur = new Date(gridStart);
        while (cur <= gridEnd) {
            all.push({ iso: fmtISO(cur), inMonth: sameMonth(fmtISO(cur), monthDate) });
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return all;
    }, [monthDate]);

    const eventsByDay = useMemo(() => {
        const map = new Map<string, Appointment[]>();
        const mStart = monthStartISO, mEnd = monthEndISO;

        // Build quick lookup of skipped dates per appointment
        const excMap = new Map<string, Set<string>>();
        for (const ex of exceptions) {
            const set = excMap.get(ex.appointment_id) ?? new Set<string>();
            set.add(ex.skip_date);
            excMap.set(ex.appointment_id, set);
        }

        for (const a of appts) {
            let dates = expandForMonth(a, mStart, mEnd);
            const skips = excMap.get(a.id);
            if (skips) dates = dates.filter(d => !skips.has(d));

            for (const iso of dates) {
                const arr = map.get(iso) ?? [];
                arr.push(a);
                map.set(iso, arr);
            }
        }
        map.forEach(arr => arr.sort((x, y) => x.description.localeCompare(y.description)));
        return map;
    }, [appts, exceptions, monthStartISO, monthEndISO]);

    /** Form helpers */
    function openCreateFor(iso?: string) {
        setEditing(null);
        setFormDate(iso || fmtISO(new Date()));
        setFormDesc('');
        setFormRec('NEVER');
        setFormRem(false);
        setShowForm(true);
    }
    function openEdit(a: Appointment, occurrenceISO?: string) {
        setEditing(a);
        setOccurrenceISO(occurrenceISO ?? null);
        setFormDate(occurrenceISO || a.start_date);
        setFormDesc(a.description);
        setFormRec(a.recurrence);
        setFormRem(a.reminders_enabled);
        setConfirmRow('none');
        setShowForm(true);
    }

    function closeForm() { setShowForm(false); }

    /** Create/Update/Delete */
    async function saveForm(e: React.FormEvent) {
        e.preventDefault();
        if (view.status !== 'ready' || !view.selectedHomeId) return;
        setSaving(true);
        try {
            if (!editing) {
                const insertPayload: Omit<Appointment, 'id' | 'created_at' | 'updated_at'> = {
                    home_id: view.selectedHomeId,
                    start_date: formDate,
                    description: formDesc.trim() || 'Untitled',
                    recurrence: formRec,
                    reminders_enabled: formRem,
                    created_by: view.uid,
                };

                const ins = await supabase.from('appointments').insert(insertPayload).select('*').single();
                if (ins.error) throw ins.error;

                // 🔔 Fire reminders only when a brand-new appointment is created.
                await sendRemindersNow(fmtISO(new Date()));
            } else {
                const upd = await supabase.from('appointments').update({
                    start_date: formDate,
                    description: formDesc.trim() || 'Untitled',
                    recurrence: formRec,
                    reminders_enabled: formRem,
                }).eq('id', editing.id);
                if (upd.error) throw upd.error;

                // ❌ No reminder trigger on edit
            }

            closeForm();
            await loadAppointments();
            pushNotice('Saved', 'success');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Save failed';
            pushNotice(msg, 'error');
        } finally {
            setSaving(false);
        }
    }

    // Delete just this occurrence by writing an exception for the clicked day
    async function deleteOccurrence(a: Appointment) {
        if (!occurrenceISO) return; // safety
        const excPayload: { appointment_id: string; skip_date: string; created_by?: string } = {
            appointment_id: a.id,
            skip_date: occurrenceISO,
        };
        if (view.status === 'ready') excPayload.created_by = view.uid;

        const ins = await supabase.from('appointment_exceptions').insert(excPayload);
        if (ins.error) { pushNotice(ins.error.message, 'error'); return; }
        setShowForm(false);
        await loadAppointments();
    }

    // Delete entire series (row) including reminders
    async function deleteSeries(a: Appointment) {
        const del = await supabase.from('appointments').delete().eq('id', a.id);
        if (del.error) { pushNotice(del.error.message, 'error'); return; }
        setShowForm(false);
        await loadAppointments();
    }

    /** Trigger reminders now (calls RPC; SQL handles de-duplication) */
    async function sendRemindersNow(runISO?: string) {
        if (sendingReminders) return;
        setSendingReminders(true);
        try {
            const iso = runISO ?? fmtISO(new Date());
            const { error } = await supabase.rpc('send_appointment_reminders', { p_run_date: iso });
            if (error) throw error;
            // Silent success; no popup
        } catch (err) {
            // Silent failure; optionally log for debugging
            console.error('sendRemindersNow failed', err);
        } finally {
            setSendingReminders(false);
        }
    }

    /** Homes list for selected company (admin/company) */
    const hv_status = view.status;
    const hv_level = hv_status === 'ready' ? view.level : null;
    const hv_homes = hv_status === 'ready' ? view.homes : ([] as Home[]);
    const hv_companyId = hv_status === 'ready' ? view.selectedCompanyId : null;

    const homesForCompany = useMemo(() => {
        if (hv_status !== 'ready') return [] as Home[];
        if (hv_level === '1_ADMIN') {
            if (!hv_companyId) return hv_homes;
            return hv_homes.filter(h => h.company_id === hv_companyId);
        }
        return hv_homes;
    }, [hv_status, hv_level, hv_homes, hv_companyId]);

    if (view.status === 'loading') return <div className="p-4">Loading…</div>;
    if (view.status === 'signed_out') return null;

    return (
        <div className="p-4 md:p-6 space-y-4 [color-scheme:light]">
            <div className="flex flex-wrap items-end gap-3">
                {/* NEW: inline banner (no popups) */}
                {notice && (
                    <div
                        className={`rounded-md px-3 py-2 text-sm border ${notice.type === 'error'
                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                            : notice.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                            }`}
                    >
                        {notice.text}
                    </div>
                )}

                <h1 className="text-2xl font-semibold mr-auto">Appointments</h1>

                {canChooseCompany && (
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Company</label>
                        <select
                            className="border rounded-md px-2 py-2 text-sm bg-white"
                            value={view.selectedCompanyId ?? ''}
                            onChange={e => {
                                const id = e.target.value || null;
                                setView(v => v.status !== 'ready' ? v : { ...v, selectedCompanyId: id, selectedHomeId: null });
                            }}
                        >
                            {view.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                )}

                {canChooseHome && (
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Home</label>
                        <select
                            className="border rounded-md px-2 py-2 text-sm bg-white"
                            value={view.selectedHomeId ?? ''}
                            onChange={e => {
                                const id = e.target.value || null;
                                setView(v => v.status !== 'ready' ? v : { ...v, selectedHomeId: id });
                            }}
                        >
                            {homesForCompany.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <button
                        className="h-9 w-9 inline-flex items-center justify-center rounded-md border bg-white active:scale-[0.98]"
                        onClick={() => setMonthDate(d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)))}
                        title="Previous month"
                    >←</button>
                    <div className="text-sm min-w-[140px] text-center">
                        {monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                    </div>
                    <button
                        className="h-9 w-9 inline-flex items-center justify-center rounded-md border bg-white active:scale-[0.98]"
                        onClick={() => setMonthDate(d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))}
                        title="Next month"
                    >→</button>
                    <button
                        className="inline-flex items-center rounded-md border px-2 py-2 text-xs bg-white active:scale-[0.98]"
                        onClick={() => setMonthDate(startOfMonth(new Date()))}
                    >Today</button>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        className="inline-flex items-center rounded-md bg-indigo-600 text-white text-sm px-3 py-2 hover:bg-indigo-700 active:scale-[0.99]"
                        onClick={() => openCreateFor(fmtISO(new Date()))}
                        disabled={!view.selectedHomeId}
                    >
                        Add appointment
                    </button>
                </div>

            </div>

            {/* Calendar grid */}
            <div className="border rounded-xl overflow-hidden bg-white">
                <div className="grid grid-cols-7 text-xs bg-gray-50">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d =>
                        <div key={d} className="px-2 py-2 font-medium text-gray-700 border-b">{d}</div>
                    )}
                </div>
                <div className="grid grid-cols-7 gap-px bg-gray-200">
                    {days.map(({ iso, inMonth }) => {
                        const list = eventsByDay.get(iso) || [];
                        return (
                            <div key={iso} className={`bg-white p-2 min-h-[96px] ${inMonth ? '' : 'opacity-50'}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[11px] text-gray-600">{dmy(iso)}</div>
                                    {inMonth && view.selectedHomeId && (
                                        <button
                                            className="text-[11px] px-1.5 py-0.5 rounded border bg-white hover:bg-gray-50"
                                            onClick={() => openCreateFor(iso)}
                                            title="Add here"
                                        >＋</button>
                                    )}
                                </div>

                                <div className="space-y-1">
                                    {list.map(a => (
                                        <button
                                            key={`${a.id}-${iso}`}
                                            onClick={() => openEdit(a, iso)}
                                            className="block w-full text-left text-[12px] px-2 py-1 rounded border bg-indigo-50 hover:bg-indigo-100"
                                            title="Edit"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate">{a.description}</span>
                                                <span className="text-[10px] text-indigo-700">{a.recurrence === 'NEVER' ? '' : a.recurrence.toLowerCase()}</span>
                                            </div>
                                            <div className="text-[10px] text-gray-600">
                                                Reminders: {a.reminders_enabled ? 'On' : 'Off'}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {loading && <div className="p-3 text-sm text-gray-700">Loading…</div>}
            </div>

            {/* Add/Edit modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-3">
                    <div className="bg-white rounded-xl p-4 w-[560px] max-w-[92vw] shadow-lg">
                        <h3 className="text-lg font-semibold mb-3">{editing ? 'Edit appointment' : 'Add appointment'}</h3>
                        <form onSubmit={saveForm} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-gray-700 mb-1">Date</label>
                                <input
                                    type="date"
                                    className="border rounded-md px-2 py-2 text-sm w-full bg-white"
                                    value={formDate}
                                    onChange={e => setFormDate(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-700 mb-1">Recurring?</label>
                                <select
                                    className="border rounded-md px-2 py-2 text-sm w-full bg-white"
                                    value={formRec}
                                    onChange={e => setFormRec(e.target.value as Recurrence)}
                                >
                                    <option value="NEVER">Never</option>
                                    <option value="WEEKLY">Weekly</option>
                                    <option value="BIWEEKLY">Bi-weekly</option>
                                    <option value="FOUR_WEEKLY">Every 4 weeks</option>
                                    <option value="MONTHLY">Monthly</option>
                                    <option value="YEARLY">Yearly</option>
                                </select>
                            </div>

                            <div className="sm:col-span-2">
                                <label className="block text-xs text-gray-700 mb-1">Description</label>
                                <input
                                    type="text"
                                    className="border rounded px-2 py-2 text-sm w-full bg-white"
                                    value={formDesc}
                                    onChange={e => setFormDesc(e.target.value)}
                                    placeholder="e.g., Dentist, Review meeting…"
                                    required
                                />
                            </div>

                            <div className="sm:col-span-2 flex items-center gap-3 mt-1">
                                {/* iOS-style toggle */}
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={formRem}
                                    onClick={() => setFormRem(v => !v)}
                                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${formRem ? 'bg-green-500' : 'bg-gray-300'}`}
                                >
                                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${formRem ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                                <span className="text-sm">Reminders</span>
                                <span className="text-xs text-gray-600">
                                    Sends notifications to Staff and Managers: 7 days before, the day before, and on the day.
                                </span>
                            </div>

                            {/* Danger zone (inline, no popups) */}
                            {editing && (
                                <div className="sm:col-span-2 mt-2 p-3 rounded-lg border border-rose-200 bg-rose-50">
                                    <div className="text-sm font-medium text-rose-800 mb-2">Delete</div>

                                    {/* Row 1: delete this occurrence only */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                                        <div className="text-sm text-rose-900">
                                            Delete <span className="font-medium">this occurrence</span>
                                            {occurrenceISO ? <> ({new Date(occurrenceISO + 'T00:00:00Z').toLocaleDateString('en-GB')})</> : ''}.
                                        </div>
                                        {occurrenceISO ? (
                                            confirmRow === 'this' ? (
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white"
                                                        onClick={() => deleteOccurrence(editing)}
                                                    >
                                                        Confirm delete this occurrence
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-3 py-1.5 text-sm rounded-md border bg-white"
                                                        onClick={() => setConfirmRow('none')}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 text-sm rounded-md border bg-white text-rose-700"
                                                    onClick={() => setConfirmRow('this')}
                                                >
                                                    Delete this occurrence
                                                </button>
                                            )
                                        ) : (
                                            <span className="text-xs text-rose-700">Open from a calendar day to target a single occurrence.</span>
                                        )}
                                    </div>

                                    <div className="h-px bg-rose-200 my-2" />

                                    {/* Row 2: delete the whole series */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                                        <div className="text-sm text-rose-900">
                                            Delete the <span className="font-medium">entire series</span> (all future occurrences) and its reminder setting.
                                        </div>
                                        {confirmRow === 'series' ? (
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white"
                                                    onClick={() => deleteSeries(editing)}
                                                >
                                                    Confirm delete series
                                                </button>
                                                <button
                                                    type="button"
                                                    className="px-3 py-1.5 text-sm rounded-md border bg-white"
                                                    onClick={() => setConfirmRow('none')}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                className="px-3 py-1.5 text-sm rounded-md border bg-white text-rose-700"
                                                onClick={() => setConfirmRow('series')}
                                            >
                                                Delete entire series
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Standard footer */}
                            <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
                                <button type="button" className="px-3 py-2 text-sm rounded-md border bg-white" onClick={closeForm}>
                                    Close
                                </button>
                                <button className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700" disabled={saving}>
                                    {saving ? 'Saving…' : (editing ? 'Save changes' : 'Add')}
                                </button>
                            </div>

                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
