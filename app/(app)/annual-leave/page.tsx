'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

/* =========================
   Types
   ========================= */
type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

// Brand gradient (same as Payslips)
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

type LeaveRule = {
    id: string; company_id: string; name: string;
    unit: 'HOURS' | 'DAYS';
    annual_allowance: number;
    applies_to: 'ALL' | 'STAFF' | 'BANK' | 'MANAGER';
    is_active: boolean;
};

type ShiftType = { id: string; code: string; label: string; default_hours: number; kind?: string | null };

type LeaveSettings = {
    company_id: string;
    tax_year_start_month: number;
    carryover_limit: number | null;
    require_manager_approval: boolean;
    unit?: 'HOURS' | 'DAYS';
    rota_shift_type_id?: string | null;
    rota_shift?: { id: string; code: string; label: string; default_hours: number; kind?: string | null } | null;
};

type EntitlementSummary = {
    unit: 'HOURS' | 'DAYS';
    total: number;
    used: number;
    pending: number;
    remaining: number;
};

type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CANCEL_REQUESTED';

type LeaveRequest = {
    id: string;
    user_id: string;
    company_id: string;
    home_id: string | null;
    starts_on: string;
    ends_on: string;
    amount: number;
    unit: 'HOURS' | 'DAYS';
    status: LeaveStatus;
    reason: string | null;
    created_at: string;
    decided_by: string | null;
    decided_at: string | null;
    notes: string | null;
};

/* =========================
   Small UI helpers (Payslips look)
   ========================= */

// Section wrapper
function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section
            className="rounded-xl shadow-sm ring-1 p-4 space-y-3"
            style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
        >
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
            {children}
        </section>
    );
}

// Payslips-style tab button
function TabBtn(
    { active, children, ...props }:
        React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
    return (
        <button
            className="px-3 py-1.5 rounded-md ring-1 transition"
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

// Format ISO date as dd/mm/yyyy
function formatDMY(iso: string) {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB');
}

function Stat({
    label,
    value,
    helper,
    tone = 'default',
}: {
    label: string;
    value: string | number;
    helper?: string;
    tone?: 'default' | 'positive' | 'warning' | 'danger' | 'muted';
}) {
    const toneValue =
        tone === 'positive' ? 'text-emerald-700' :
            tone === 'warning' ? 'text-amber-700' :
                tone === 'danger' ? 'text-rose-700' :
                    tone === 'muted' ? 'text-slate-700' :
                        'text-slate-900';

    const toneCard =
        tone === 'positive' ? 'bg-emerald-50 ring-emerald-50' :
            tone === 'warning' ? 'bg-amber-50 ring-amber-50' :
                tone === 'danger' ? 'bg-rose-50 ring-rose-50' :
                    tone === 'muted' ? 'bg-gray-50 ring-gray-100' :
                        'bg-white ring-gray-50';

    return (
        <div className={`rounded-lg border p-3 shadow-sm ring-1 ${toneCard}`}>
            <div className="text-xs text-gray-600">{label}</div>
            <div className={`text-xl font-semibold tabular-nums ${toneValue}`}>{value}</div>
            {helper && <div className="text-xs text-gray-500 mt-1">{helper}</div>}
        </div>
    );
}

/* =========================
   Root page
   ========================= */
export default function AnnualLeavePage() {
    const [level, setLevel] = useState<Level>('4_STAFF');
    const [tab, setTab] = useState<'MY' | 'MANAGE' | 'SETTINGS'>('MY');

    useEffect(() => { (async () => setLevel(await getEffectiveLevel() as Level))(); }, []);
    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';

    const showManage = isCompany || isManager || isAdmin;
    const showSettings = isCompany || isAdmin;

    useEffect(() => {
        if (!showManage && tab === 'MANAGE') setTab('MY');
        if (!showSettings && tab === 'SETTINGS') setTab('MY');
    }, [showManage, showSettings, tab]);

    return (
        <div className="p-6 space-y-6" style={{ color: 'var(--ink)' }}>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Annual leave</h1>

            {/* Payslips-style tabs */}
            <div className="flex gap-2">
                <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>My leave</TabBtn>
                {showManage && <TabBtn active={tab === 'MANAGE'} onClick={() => setTab('MANAGE')}>Manage</TabBtn>}
                {showSettings && <TabBtn active={tab === 'SETTINGS'} onClick={() => setTab('SETTINGS')}>Settings</TabBtn>}
            </div>

            {tab === 'MY' && <MyLeave isManager={isManager} />}
            {tab === 'MANAGE' && showManage && <ManageLeave />}
            {tab === 'SETTINGS' && showSettings && <LeaveSettingsTab isAdmin={isAdmin} />}

            {/* Orbit-only select fixes (same block as Payslips) */}
            <style jsx global>{`
        [data-orbit="1"] select,
        [data-orbit="1"] input[type="number"],
        [data-orbit="1"] input[type="date"] {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        [data-orbit="1"] select option {
          color: var(--ink);
          background-color: #0b1221;
        }
        @-moz-document url-prefix() {
          [data-orbit="1"] select option {
            background-color: #0b1221;
          }
        }
        [data-orbit="1"] select:where(:not(:disabled)) { opacity: 1; }
      `}</style>
        </div>
    );
}

/* =========================
   My Leave (staff + managers)
   ========================= */
function MyLeave({ isManager }: { isManager: boolean }) {
    const [summary, setSummary] = useState<EntitlementSummary | null>(null);
    const [myRequests, setMyRequests] = useState<LeaveRequest[]>([]);
    const [busy, setBusy] = useState(false);

    // managers: days; staff: hours
    const requestUnit: 'HOURS' | 'DAYS' = isManager ? 'DAYS' : 'HOURS';

    // form state
    const [starts, setStarts] = useState('');
    const [ends, setEnds] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [reason, setReason] = useState('');

    // per-person day hours (for ≈ hours helper when managers request in days)
    const [dayHours, setDayHours] = useState<number>(7.5);

    // Auto-fill days for managers
    useEffect(() => {
        if (!isManager) return;
        if (!starts || !ends) return;
        const a = new Date(starts + 'T00:00:00');
        const b = new Date(ends + 'T00:00:00');
        if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return;
        const days = Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        setAmount((prev) => (prev === '' || Number(prev) === days ? days : prev));
    }, [isManager, starts, ends]);

    useEffect(() => {
        (async () => {
            // Entitlement summary
            const sum = await supabase.rpc('leave_my_summary');
            if (!sum.error) {
                const row = Array.isArray(sum.data) ? sum.data[0] : sum.data;
                setSummary(row ? (row as EntitlementSummary) : { unit: 'HOURS', total: 0, used: 0, pending: 0, remaining: 0 });
            } else {
                setSummary({ unit: 'HOURS', total: 0, used: 0, pending: 0, remaining: 0 });
            }

            // Optional: manager day-hours for ≈ display
            if (isManager) {
                const dh = await supabase.rpc('leave_my_day_hours');
                if (!dh.error && dh.data) setDayHours(Number(dh.data));
            }

            // My requests list
            const req = await supabase.rpc('leave_my_requests');
            if (!req.error) setMyRequests((req.data || []) as LeaveRequest[]);
        })();
    }, [isManager]);

    const cmpDate = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();
    const datesOK = !!starts && !!ends && cmpDate(ends, starts) >= 0;
    const amountOK = amount !== '' && Number(amount) > 0;
    const canSubmit = datesOK && amountOK;

    async function submitRequest() {
        if (!canSubmit) return;
        setBusy(true);
        const { data, error } = await supabase.rpc('leave_request_create', {
            p_starts: starts,
            p_ends: ends,
            p_amount: Number(amount),
            p_unit: requestUnit,
            p_reason: reason?.trim() || null
        });
        setBusy(false);
        if (error) { alert(error.message); return; }
        setStarts(''); setEnds(''); setAmount(''); setReason('');
        setMyRequests([data as LeaveRequest, ...myRequests]);

        // refresh summary so Remaining reflects new pending immediately
        const sum = await supabase.rpc('leave_my_summary');
        if (!sum.error) {
            const row = Array.isArray(sum.data) ? sum.data[0] : sum.data;
            setSummary(row ? (row as EntitlementSummary) : { unit: 'HOURS', total: 0, used: 0, pending: 0, remaining: 0 });
        }
    }

    // NEW: owner actions
    async function cancelMyPending(r: LeaveRequest) {
        const { error } = await supabase.rpc('leave_request_cancel_self', { p_request: r.id });
        if (error) { alert(error.message); return; }
        setMyRequests(prev => prev.filter(x => x.id !== r.id));
        const sum = await supabase.rpc('leave_my_summary');
        if (!sum.error) {
            const row = Array.isArray(sum.data) ? sum.data[0] : sum.data;
            setSummary(row as EntitlementSummary);
        }
    }

    async function requestCancellation(r: LeaveRequest, cancelReason?: string) {
        const { error } = await supabase.rpc('leave_request_request_cancellation', {
            p_request: r.id,
            p_reason: cancelReason || null
        });
        if (error) { alert(error.message); return; }
        setMyRequests(prev => prev.map(x => x.id === r.id ? { ...x, status: 'CANCEL_REQUESTED' } : x));
    }

    const approxHours = requestUnit === 'DAYS' && amount ? (Number(amount) * dayHours).toFixed(2) : null;

    return (
        <div className="space-y-4 max-w-4xl">
            <Section title="Entitlement">
                {!summary ? (
                    <p className="text-sm text-gray-600">Entitlement isn’t configured yet.</p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(() => {
                            const unit = (summary?.unit || 'HOURS').toLowerCase();
                            const total = Number(summary?.total ?? 0);
                            const used = Number(summary?.used ?? 0);
                            const pending = Number(summary?.pending ?? 0);
                            const remainingDisplay = Number(summary?.remaining ?? Math.max(0, total - used - pending));

                            return (
                                <>
                                    <Stat label="Remaining" value={`${remainingDisplay} ${unit}`} tone="positive" />
                                    <Stat label="Used" value={`${used} ${unit}`} tone="danger" />
                                    <Stat label="Pending" value={`${pending} ${unit}`} tone="warning" />
                                    <Stat label="Yearly entitlement" value={`${total} ${unit}`} tone="muted" />
                                </>
                            );
                        })()}
                    </div>
                )}
            </Section>

            <Section title="Request leave">
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Starts</label>
                        <input
                            type="date"
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={starts}
                            onChange={e => setStarts(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Ends</label>
                        <input
                            type="date"
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={ends}
                            onChange={e => setEnds(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">
                            Amount ({requestUnit.toLowerCase()}){requestUnit === 'DAYS' && ' (0.5 allowed)'}
                        </label>
                        <input
                            type="number"
                            min={0}
                            step={requestUnit === 'DAYS' ? 0.5 : 0.25}
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={amount}
                            onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        />
                        {requestUnit === 'DAYS' && amount !== '' && (
                            <p className="mt-1 text-xs text-gray-600">≈ {approxHours} hours (at {dayHours}h/day)</p>
                        )}
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Reason (optional)</label>
                        <input
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="e.g. Annual holiday"
                        />
                    </div>

                    <div className="sm:col-span-6">
                        <button
                            disabled={busy || !canSubmit}
                            onClick={submitRequest}
                            className="rounded-md px-3 py-2 text-sm text-white disabled:opacity-60"
                            style={{ background: BRAND_GRADIENT, borderColor: 'var(--ring-strong)' }}
                        >
                            {busy ? 'Sending…' : 'Submit request'}
                        </button>
                    </div>
                </div>

                <p className="mt-2 text-xs text-gray-500">
                    {isManager
                        ? 'Managers request in days; company approval required.'
                        : 'Requests go to your home’s manager for approval.'}
                </p>
            </Section>

            <Section title="My requests">
                <RequestsTable
                    rows={myRequests}
                    showUser={false}
                    infoMode="my-rejection-notes"
                    onCancelPending={(r) => cancelMyPending(r)}
                    onRequestCancel={(r, reason) => requestCancellation(r, reason)}
                />
            </Section>
        </div>
    );
}
/* =========================
   Manage (approvals + manager overrides)
   ========================= */
function ManageLeave() {
    const [level, setLevel] = useState<Level>('4_STAFF');
    const [homes, setHomes] = useState<{ id: string; name: string; company_id: string }[]>([]);
    const [homeId, setHomeId] = useState('');

    // approvals
    const [pending, setPending] = useState<LeaveRequest[]>([]);
    const [busy, setBusy] = useState(false);
    const [conflicts, setConflicts] = useState<Record<string, string[]>>({});

    // calendar
    const [calOpen, setCalOpen] = useState(false);
    const [calMonth, setCalMonth] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    });
    const [calendarEvents, setCalendarEvents] = useState<
        { user_id: string; full_name: string | null; start_date: string; end_date: string; status: LeaveStatus }[]
    >([]);

    // overrides (manager)
    type Person = { user_id: string; full_name: string | null };
    const [people, setPeople] = useState<Person[]>([]);
    type OvRow = { unit: 'HOURS' | 'DAYS'; opening_remaining: number };
    const [overrides, setOverrides] = useState<Map<string, OvRow>>(new Map());
    const [ovDraft, setOvDraft] = useState<Map<string, { unit: 'HOURS' | 'DAYS'; remaining: string }>>(new Map());
    const [ovBusy, setOvBusy] = useState<string | null>(null);
    const [showOverrides, setShowOverrides] = useState(false);

    const canSeeAllHomes = level === '1_ADMIN' || level === '2_COMPANY';
    const isManager = level === '3_MANAGER' || canSeeAllHomes;

    useEffect(() => {
        (async () => setLevel((await getEffectiveLevel()) as Level))();
    }, []);

    // homes visible to this user
    useEffect(() => {
        (async () => {
            const rpc = await supabase.rpc('homes_list_for_ui', { p_company_id: null });
            setHomes(((rpc.data || []) as { id: string; name: string; company_id: string }[]));
            if (!homeId && rpc.data && rpc.data[0]) setHomeId(rpc.data[0].id);
        })();
    }, []);

    // pending + conflicts for selected home
    useEffect(() => {
        (async () => {
            const { data, error } = await supabase.rpc('leave_pending_for_manager', { p_home: homeId || null });
            if (!error) setPending((data || []) as LeaveRequest[]);
            if (homeId) {
                const cf = await supabase.rpc('leave_conflicts_for_pending', { p_home: homeId });
                if (!cf.error) setConflicts((cf.data || {}) as Record<string, string[]>);
            } else {
                setConflicts({});
            }
        })();
    }, [homeId]);

    // people + overrides
    useEffect(() => {
        (async () => {
            setPeople([]); setOverrides(new Map()); setOvDraft(new Map());
            if (!homeId || !isManager) return;

            const staff = await supabase.rpc('home_staff_for_ui', { p_home_id: homeId, include_bank: true });
            const ids: string[] = ((staff.data || []) as { user_id: string }[]).map(x => x.user_id);
            if (!ids.length) return;

            const prof = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
            const plist: Person[] = (prof.data || []).map((p: { user_id: string; full_name: string | null }) => ({
                user_id: p.user_id, full_name: p.full_name
            })) as Person[];
            setPeople(plist);

            const ov = await supabase.rpc('leave_overrides_for_home', { p_home: homeId });
            const map = new Map<string, OvRow>();
            (ov.data || []).forEach((row: { user_id: string; unit: 'HOURS' | 'DAYS'; opening_remaining: number }) => {
                map.set(row.user_id, { unit: row.unit, opening_remaining: Number(row.opening_remaining) });
            });
            setOverrides(map);

            const d = new Map<string, { unit: 'HOURS' | 'DAYS'; remaining: string }>();
            ids.forEach((id) => {
                const cur = map.get(id);
                d.set(id, { unit: (cur?.unit ?? 'HOURS') as 'HOURS' | 'DAYS', remaining: cur ? String(cur.opening_remaining) : '' });
            });
            setOvDraft(d);
        })();
    }, [homeId, isManager]);

    // approve / reject WITHOUT popup; notes inline
    async function decideWithReason(request: LeaveRequest, decision: 'APPROVED' | 'REJECTED', notes?: string) {
        setBusy(true);
        const res = await supabase.rpc('leave_manager_decide', {
            p_request: request.id,
            p_decision: decision,
            p_notes: (notes?.trim()?.length ? notes!.trim() : null),
        });
        if (res.error) { setBusy(false); alert(res.error.message); return; }

        try { await loadCalendar(); } catch { /* noop */ }

        setBusy(false);
        setPending(prev => prev.filter(r => r.id !== request.id));
    }

    // calendar loaders
    async function loadCalendar() {
        if (!homeId) { setCalendarEvents([]); return; }
        const { data, error } = await supabase.rpc('leave_calendar_for_home_month', {
            p_home: homeId,
            p_month: calMonth,
        });
        if (!error) setCalendarEvents(((data || []) as { user_id: string; full_name: string | null; start_date: string; end_date: string; status: LeaveStatus }[]));
    }
    useEffect(() => { if (calOpen) loadCalendar(); }, [calOpen, calMonth, homeId]);

    // overrides save/clear
    async function saveOverride(userId: string) {
        if (!homeId) return;
        const draft = ovDraft.get(userId);
        if (!draft) return;
        const amount = draft.remaining === '' ? NaN : Number(draft.remaining);
        if (!Number.isFinite(amount) || amount < 0) { alert('Enter a non-negative number.'); return; }
        setOvBusy(userId);
        try {
            const { error } = await supabase.rpc('leave_override_upsert_manager', {
                p_home: homeId,
                p_user: userId,
                p_unit: draft.unit,
                p_remaining: amount,
            });
            if (error) throw error;
            const next = new Map(overrides);
            next.set(userId, { unit: draft.unit, opening_remaining: amount });
            setOverrides(next);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to save override';
            alert(msg);
        } finally {
            setOvBusy(null);
        }
    }

    async function clearOverride(userId: string) {
        if (!homeId) return;
        setOvBusy(userId);
        try {
            const { error } = await supabase.rpc('leave_override_clear_manager', {
                p_home: homeId,
                p_user: userId,
            });
            if (error) throw error;
            const next = new Map(overrides);
            next.delete(userId);
            setOverrides(next);
            const d = new Map(ovDraft);
            const cur = d.get(userId);
            d.set(userId, { unit: (cur?.unit ?? 'HOURS') as 'HOURS' | 'DAYS', remaining: '' });
            setOvDraft(d);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to clear override';
            alert(msg);
        } finally {
            setOvBusy(null);
        }
    }

    return (
        <div className="space-y-4 max-w-5xl">
            <Section title="Filters">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Home</label>
                        <select
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={homeId}
                            onChange={(e) => setHomeId(e.target.value)}
                        >
                            <option value="">{canSeeAllHomes ? 'All homes' : 'Select home'}</option>
                            {homes.map((h) => (
                                <option key={h.id} value={h.id}>{h.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="sm:col-span-2 flex items-end justify-end">
                        <button
                            onClick={() => setCalOpen(true)}
                            className="rounded-md px-3 py-2 text-sm ring-1 disabled:opacity-60"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            disabled={!homeId}
                        >
                            View calendar
                        </button>
                    </div>
                </div>
            </Section>

            <Section title="Pending approvals">
                {pending.length === 0 ? (
                    <p className="text-sm text-gray-600">No pending requests.</p>
                ) : (
                    <RequestsTable
                        rows={pending}
                        showUser
                        busy={busy}
                        conflicts={conflicts}
                        showDecisionNotes
                        onApprove={(r, notes) => decideWithReason(r, 'APPROVED', notes)}
                        onReject={(r, notes) => decideWithReason(r, 'REJECTED', notes)}
                    />
                )}
            </Section>

            {/* Collapsible overrides */}
            {isManager && (
                <Section title="Entitlement overrides (current tax year)">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-600">Set a person’s opening balance for the current tax year. Approvals will deduct from this balance.</p>
                        <button
                            className="rounded-md px-3 py-1.5 text-sm ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            onClick={() => setShowOverrides((v) => !v)}
                        >
                            {showOverrides ? 'Hide' : 'Manage overrides'}
                        </button>
                    </div>

                    {showOverrides && (
                        <>
                            {!homeId ? (
                                <p className="mt-3 text-sm text-gray-600">Select a home to manage overrides.</p>
                            ) : people.length === 0 ? (
                                <p className="mt-3 text-sm text-gray-600">No people found for this home.</p>
                            ) : (
                                <div className="max-h-[28rem] overflow-auto mt-3">
                                    <table className="min-w-full text-sm">
                                        <thead
                                            className="sticky top-0 text-gray-600"
                                            style={{ background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                                        >
                                            <tr>
                                                <th className="text-left p-2">Person</th>
                                                <th className="text-left p-2">Unit</th>
                                                <th className="text-left p-2">Remaining now</th>
                                                <th className="text-left p-2 w-[180px]">Actions</th>
                                                <th className="text-left p-2">Active</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {people.map((p) => {
                                                const cur = overrides.get(p.user_id) || null;
                                                const draft = ovDraft.get(p.user_id) || { unit: 'HOURS' as const, remaining: '' };
                                                return (
                                                    <tr key={p.user_id} className="border-t align-top">
                                                        <td className="p-2">{p.full_name?.trim() || p.user_id.slice(0, 8)}</td>
                                                        <td className="p-2">
                                                            <select
                                                                className="rounded px-2 py-1 text-sm ring-1"
                                                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                                value={draft.unit}
                                                                onChange={(e) => {
                                                                    const next = new Map(ovDraft);
                                                                    next.set(p.user_id, { ...draft, unit: e.target.value as 'HOURS' | 'DAYS' });
                                                                    setOvDraft(next);
                                                                }}
                                                            >
                                                                <option value="HOURS">Hours</option>
                                                                <option value="DAYS">Days</option>
                                                            </select>
                                                        </td>
                                                        <td className="p-2">
                                                            <input
                                                                className="w-full rounded px-2 py-1 text-sm ring-1"
                                                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                                type="number"
                                                                min={0}
                                                                step={draft.unit === 'DAYS' ? 0.5 : 0.25}
                                                                placeholder={draft.unit === 'DAYS' ? 'e.g. 14' : 'e.g. 56'}
                                                                value={draft.remaining}
                                                                onChange={(e) => {
                                                                    const next = new Map(ovDraft);
                                                                    next.set(p.user_id, { ...draft, remaining: e.target.value });
                                                                    setOvDraft(next);
                                                                }}
                                                            />
                                                        </td>
                                                        <td className="p-2">
                                                            <div className="flex gap-2">
                                                                <button
                                                                    className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                                    disabled={ovBusy === p.user_id || draft.remaining === ''}
                                                                    onClick={() => saveOverride(p.user_id)}
                                                                >
                                                                    {ovBusy === p.user_id ? 'Saving…' : cur ? 'Update' : 'Save'}
                                                                </button>
                                                                {cur && (
                                                                    <button
                                                                        className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                                        disabled={ovBusy === p.user_id}
                                                                        onClick={() => clearOverride(p.user_id)}
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-2 text-xs text-gray-600">{cur ? `${cur.opening_remaining} ${cur.unit.toLowerCase()}` : '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </Section>
            )}

            {calOpen && (
                <LeaveCalendarModal
                    monthISO={calMonth}
                    setMonthISO={setCalMonth}
                    events={calendarEvents}
                    onClose={() => setCalOpen(false)}
                    onReload={loadCalendar}
                />
            )}
        </div>
    );
}

/* =========================
   Requests table (shared)
   ========================= */
function RequestsTable({
    rows,
    showUser,
    onApprove,
    onReject,
    onCancelPending,
    onRequestCancel,
    busy,
    conflicts,
    showDecisionNotes,
    infoMode = 'manager-conflicts',
}: {
    rows: LeaveRequest[];
    showUser?: boolean;
    onApprove?: (r: LeaveRequest, notes?: string) => void;
    onReject?: (r: LeaveRequest, notes?: string) => void;
    onCancelPending?: (r: LeaveRequest) => void;
    onRequestCancel?: (r: LeaveRequest, reason?: string) => void;
    busy?: boolean;
    conflicts?: Record<string, string[]>;
    showDecisionNotes?: boolean;
    infoMode?: 'manager-conflicts' | 'my-rejection-notes';
}) {
    const [profiles, setProfiles] = useState<{ user_id: string; full_name: string | null }[]>([]);
    const [notesById, setNotesById] = useState<Record<string, string>>({});

    const userName = (id: string) => {
        const p = profiles.find((x) => x.user_id === id)?.full_name;
        return p && p.trim().length ? p : id.slice(0, 8);
    };

    useEffect(() => {
        (async () => {
            if (!showUser || rows.length === 0) return;
            const ids = Array.from(new Set(rows.map((r) => r.user_id)));
            if (ids.length === 0) return;
            const { data } = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
            setProfiles(((data || []) as { user_id: string; full_name: string | null }[]));
        })();
    }, [rows, showUser]);

    const hasActions = Boolean(onApprove || onReject || onCancelPending || onRequestCancel);

    return (
        <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full text-sm">
                <thead
                    className="sticky top-0 text-gray-600"
                    style={{ background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                >
                    <tr>
                        {showUser && <th className="text-left p-2">Person</th>}
                        <th className="text-left p-2">Dates</th>
                        <th className="text-left p-2">Amount</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Info</th>
                        {hasActions && <th className="p-2 w-[320px]">Actions</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => {
                        const note = notesById[r.id] ?? '';
                        const setNote = (v: string) => setNotesById((s) => ({ ...s, [r.id]: v }));

                        const pill =
                            r.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' :
                                (r.status === 'PENDING' || r.status === 'CANCEL_REQUESTED') ? 'bg-amber-50 text-amber-700 ring-amber-100' :
                                    r.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 ring-rose-100' :
                                        'bg-slate-50 text-slate-700 ring-slate-100';

                        return (
                            <tr key={r.id} className="border-t align-top">
                                {showUser && <td className="p-2">{userName(r.user_id)}</td>}
                                <td className="p-2">{formatDMY(r.starts_on)} → {formatDMY(r.ends_on)}</td>
                                <td className="p-2">{r.amount} {r.unit.toLowerCase()}</td>
                                <td className="p-2">
                                    <span className={`text-xs px-2 py-1 rounded ring-1 ${pill}`}>
                                        {r.status}
                                    </span>
                                </td>

                                {/* INFO CELL */}
                                <td className="p-2">
                                    {infoMode === 'manager-conflicts' ? (
                                        conflicts?.[r.id]?.length ? (
                                            <div className="text-xs text-rose-700">
                                                Conflict: {conflicts[r.id].join(', ')} already off
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-500">&nbsp;</div>
                                        )
                                    ) : r.status === 'REJECTED' && r.notes?.trim() ? (
                                        <div className="text-xs text-rose-700">{r.notes.trim()}</div>
                                    ) : (
                                        <div className="text-xs text-gray-500">&nbsp;</div>
                                    )}
                                </td>

                                {hasActions && (
                                    <td className="p-2">
                                        {/* Manager notes OR staff cancel-reason */}
                                        {((showDecisionNotes && (onApprove || onReject)) || (onRequestCancel && r.status === 'APPROVED')) && (
                                            <div className="mb-2">
                                                <input
                                                    className="w-full rounded px-2 py-1 text-xs ring-1"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                    placeholder={(onApprove || onReject) ? "Decision note (optional)" : "Reason (optional)"}
                                                    value={note}
                                                    onChange={(e) => setNote(e.target.value)}
                                                />
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-2">
                                            {onApprove && (
                                                <button
                                                    disabled={busy}
                                                    onClick={() => onApprove(r, note)}
                                                    className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                >
                                                    Approve
                                                </button>
                                            )}
                                            {onReject && (
                                                <button
                                                    disabled={busy}
                                                    onClick={() => onReject(r, note)}
                                                    className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                >
                                                    Reject
                                                </button>
                                            )}

                                            {onCancelPending && r.status === 'PENDING' && (
                                                <button
                                                    onClick={() => onCancelPending(r)}
                                                    className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                            {onRequestCancel && r.status === 'APPROVED' && (
                                                <button
                                                    onClick={() => onRequestCancel(r, note)}
                                                    className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                >
                                                    Request cancellation
                                                </button>
                                            )}
                                            {r.status === 'CANCEL_REQUESTED' && !onApprove && !onReject && (
                                                <div className="text-xs text-gray-600">Cancellation requested</div>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                    {rows.length === 0 && (
                        <tr>
                            <td
                                className="p-2 text-sm text-gray-500"
                                colSpan={
                                    (hasActions ? 1 : 0) + 4 + (showUser ? 1 : 0)
                                }
                            >
                                No requests.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

/* =========================
   Calendar modal (per home/month)
   ========================= */
function LeaveCalendarModal({
    monthISO,
    setMonthISO,
    events,
    onClose,
    onReload
}: {
    monthISO: string;
    setMonthISO: (v: string) => void;
    events: { user_id: string; full_name: string | null; start_date: string; end_date: string; status: LeaveStatus }[];
    onClose: () => void;
    onReload: () => void;
}) {
    function nextMonth(delta: number) {
        const d = new Date(`${monthISO}T00:00:00`);
        d.setMonth(d.getMonth() + delta);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
        setMonthISO(iso);
    }

    const base = new Date(`${monthISO}T00:00:00`);
    const year = base.getFullYear(), month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const byDay: Record<number, { name: string; status: LeaveStatus }[]> = {};
    for (let d = 1; d <= daysInMonth; d++) byDay[d] = [];

    const shown = events.filter(ev => ev.status !== 'REJECTED' && ev.status !== 'CANCELLED');

    shown.forEach(ev => {
        const s = new Date(ev.start_date);
        const e = new Date(ev.end_date);
        for (let d = 1; d <= daysInMonth; d++) {
            const cur = new Date(year, month, d);
            const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
            const endDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
            if (cur >= startDay && cur <= endDay) {
                byDay[d].push({ name: (ev.full_name?.trim() || ev.user_id.slice(0, 8)), status: ev.status });
            }
        }
    });

    return (
        <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center" onClick={onClose}>
            <div
                className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-2xl border p-4 shadow-xl"
                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--ring)' }}>
                    <h3 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>Annual leave</h3>
                    <div className="flex items-center gap-2 h-10">
                        <button
                            className="rounded-md px-2 py-1 text-sm ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            onClick={() => nextMonth(-1)}
                            aria-label="Previous month"
                        >
                            &larr;
                        </button>

                        <div className="w-[12rem]">
                            <input
                                type="month"
                                className="rounded px-2 py-1 text-sm ring-1 tabular-nums w-full"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={`${year}-${String(month + 1).padStart(2, '0')}`}
                                onChange={e => setMonthISO(`${e.target.value}-01`)}
                            />
                        </div>

                        <button
                            className="rounded-md px-2 py-1 text-sm ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            onClick={() => nextMonth(1)}
                            aria-label="Next month"
                        >
                            &rarr;
                        </button>

                        <div className="ml-2 hidden sm:flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                <span className="inline-block h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-200" /> Approved
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                                <span className="inline-block h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-200" /> Pending / Cancel requested
                            </span>
                        </div>

                        <button
                            className="ml-2 rounded-md px-3 py-1.5 text-sm ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            onClick={onReload}
                        >
                            Reload
                        </button>
                        <button
                            className="rounded-md px-3 py-1.5 text-sm ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            onClick={onClose}
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="rounded-xl shadow-sm ring-1 p-3" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    <div className="grid grid-cols-7 gap-2">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(h =>
                            <div key={h} className="text-xs font-medium text-gray-600">{h}</div>
                        )}

                        {/* Always render 6 weeks to lock height */}
                        {(() => {
                            const startDow = new Date(year, month, 1).getDay();
                            let cells: (number | null)[] = Array.from({ length: startDow }, () => null);
                            for (let i = 1; i <= daysInMonth; i++) cells.push(i);
                            while (cells.length < 42) cells.push(null);
                            if (cells.length > 42) cells = cells.slice(0, 42);

                            return cells.map((d, i) => (
                                <div key={i} className="h-28 rounded-lg border p-2 flex flex-col"
                                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}>
                                    <div className="text-[11px] text-gray-500 font-medium">{d ?? ''}</div>
                                    <div className="mt-1 space-y-1 flex-1 overflow-auto">
                                        {d && byDay[d].length === 0 && <div className="text-xs text-gray-300">—</div>}
                                        {d && byDay[d].map((ev, idx) => {
                                            const cls =
                                                ev.status === 'APPROVED' ? 'bg-emerald-50 ring-1 ring-emerald-100' :
                                                    (ev.status === 'PENDING' || ev.status === 'CANCEL_REQUESTED') ? 'bg-amber-50 ring-1 ring-amber-100' :
                                                        'bg-slate-50 ring-1 ring-slate-100';
                                            return (
                                                <div key={idx} className={`rounded px-2 py-1 text-[12px] leading-tight ${cls}`}>
                                                    {ev.name}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* =========================
   Settings (admin-only company picker; show company name for others)
   ========================= */
function LeaveSettingsTab({ isAdmin }: { isAdmin: boolean }) {
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
    const [companyId, setCompanyId] = useState('');
    const [companyName, setCompanyName] = useState<string>('');
    const [settings, setSettings] = useState<LeaveSettings | null>(null);
    const [rules, setRules] = useState<LeaveRule[]>([]);
    const [busy, setBusy] = useState(false);

    // Inline "Add rule" form
    const [newRuleName, setNewRuleName] = useState('');
    const [newRuleUnit, setNewRuleUnit] = useState<'HOURS' | 'DAYS'>('HOURS');
    const [newRuleApplies, setNewRuleApplies] = useState<'ALL' | 'STAFF' | 'BANK' | 'MANAGER'>('ALL');
    const [newRuleAmount, setNewRuleAmount] = useState<number | ''>('');

    // Assignments state
    type Person = { user_id: string; full_name: string | null };
    const [homes, setHomes] = useState<{ id: string; name: string; company_id: string }[]>([]);
    const [assignHomeId, setAssignHomeId] = useState('');
    const [people, setPeople] = useState<Person[]>([]);
    const [assignments, setAssignments] = useState<Map<string, string | null>>(new Map());
    const [assignBusy, setAssignBusy] = useState<string | null>(null);

    // Overrides state
    type OverrideRow = { user_id: string; unit: 'HOURS' | 'DAYS'; opening_remaining: number };
    const [overrides, setOverrides] = useState<Map<string, OverrideRow>>(new Map());
    const [ovDraft, setOvDraft] = useState<Map<string, { unit: 'HOURS' | 'DAYS'; remaining: string }>>(new Map());
    const [ovBusy, setOvBusy] = useState<string | null>(null);

    // Shift types (rota link)
    const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);

    function currentTaxYearStartISO(): string {
        const m = settings?.tax_year_start_month ?? 4;
        const now = new Date();
        const thisYearStart = new Date(now.getFullYear(), m - 1, 1);
        const year = now < thisYearStart ? now.getFullYear() - 1 : now.getFullYear();
        return `${year}-${String(m).padStart(2, '0')}-01`;
    }

    // Load company context
    useEffect(() => {
        (async () => {
            if (isAdmin) {
                const co = await supabase.from('companies').select('id,name').order('name');
                setCompanies(((co.data || []) as { id: string; name: string }[]));
                if (co.data && co.data[0] && !companyId) setCompanyId(co.data[0].id);
            } else {
                const { data: u } = await supabase.auth.getUser();
                const myCompany = await supabase
                    .from('company_memberships')
                    .select('company_id')
                    .eq('user_id', u.user?.id)
                    .maybeSingle();
                const cid = myCompany.data?.company_id || '';
                setCompanyId(cid);
                if (cid) {
                    const co = await supabase.from('companies').select('name').eq('id', cid).maybeSingle();
                    setCompanyName(co.data?.name || '');
                }
            }
        })();
    }, [isAdmin]);

    // Load settings + rules for company
    useEffect(() => {
        (async () => {
            if (!companyId) {
                setSettings(null); setRules([]); setCompanyName('');
                setHomes([]); setPeople([]); setAssignments(new Map()); setShiftTypes([]);
                return;
            }
            if (isAdmin) {
                const co = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
                setCompanyName(co.data?.name || '');
            }
            const s = await supabase.rpc('leave_settings_get', { p_company: companyId });
            if (!s.error) setSettings(s.data as LeaveSettings);

            const r = await supabase.rpc('leave_rules_for_company', { p_company: companyId });
            if (!r.error) setRules((r.data || []) as LeaveRule[]);

            // homes for assignments
            const rpcHomes = await supabase.rpc('homes_list_for_ui', { p_company_id: companyId });
            setHomes(((rpcHomes.data || []) as { id: string; name: string; company_id: string }[]));
            if (!assignHomeId && rpcHomes.data && rpcHomes.data[0]) setAssignHomeId(rpcHomes.data[0].id);

            // shift types (for rota link)
            const st = await supabase.rpc('shift_types_for_ui', { p_company_id: companyId, p_include_inactive: false });
            if (!st.error) {
                setShiftTypes((st.data || []) as ShiftType[]);
            } else {
                const q = await supabase
                    .from('shift_types')
                    .select('id, code, label, default_hours, kind')
                    .eq('company_id', companyId)
                    .eq('is_active', true);
                if (!q.error) setShiftTypes((q.data || []) as ShiftType[]);
            }
        })();
    }, [companyId, isAdmin]);

    // Load people for selected home + assignments + overrides
    useEffect(() => {
        (async () => {
            setPeople([]); setAssignments(new Map()); setOverrides(new Map()); setOvDraft(new Map());
            if (!assignHomeId || !companyId) return;

            const staff = await supabase.rpc('home_staff_for_ui', { p_home_id: assignHomeId, include_bank: true });
            const ids: string[] = ((staff.data || []) as { user_id: string }[]).map(x => x.user_id);
            if (!ids.length) return;

            const prof = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
            const plist: Person[] = (prof.data || []).map((p: { user_id: string; full_name: string | null }) => ({
                user_id: p.user_id, full_name: p.full_name
            })) as Person[];
            setPeople(plist);

            const map = new Map<string, string | null>();
            const ur = await supabase
                .from('leave_user_rules')
                .select('user_id, rule_id')
                .eq('company_id', companyId)
                .in('user_id', ids);
            (ur.data || []).forEach((row: { user_id: string; rule_id: string | null }) => map.set(row.user_id, row.rule_id));
            setAssignments(map);

            const ov = await supabase.rpc('leave_overrides_for_home', { p_home: assignHomeId });
            const ovMap = new Map<string, OverrideRow>();
            (ov.data || []).forEach((row: { user_id: string; unit: 'HOURS' | 'DAYS'; opening_remaining: number }) => {
                ovMap.set(row.user_id, { user_id: row.user_id, unit: row.unit, opening_remaining: Number(row.opening_remaining) });
            });
            setOverrides(ovMap);

            const draftMap = new Map<string, { unit: 'HOURS' | 'DAYS'; remaining: string }>();
            ids.forEach((id) => {
                const cur = ovMap.get(id);
                draftMap.set(id, { unit: (cur?.unit ?? 'HOURS') as 'HOURS' | 'DAYS', remaining: cur ? String(cur.opening_remaining) : '' });
            });
            setOvDraft(draftMap);
        })();
    }, [assignHomeId, companyId, settings?.tax_year_start_month]);

    // Save settings (April fixed)
    async function saveSettings(patch: Partial<LeaveSettings>) {
        if (!companyId) return;
        setBusy(true);
        const { data, error } = await supabase.rpc('leave_settings_upsert', {
            p_company: companyId,
            p_tax_month: 4,
            p_unit: settings?.unit ?? 'HOURS',
            p_carry: patch.carryover_limit ?? settings?.carryover_limit ?? null,
            p_require_mgr: patch.require_manager_approval ?? settings?.require_manager_approval ?? true,
            p_rota_shift: ('rota_shift_type_id' in patch ? patch.rota_shift_type_id : settings?.rota_shift_type_id) ?? null,
        });
        setBusy(false);
        if (error) { alert(error.message); return; }
        setSettings(data as LeaveSettings);
    }

    // Add rule inline
    async function addRuleInline(e: React.FormEvent) {
        e.preventDefault();
        if (!companyId) return;
        if (!newRuleName.trim()) { alert('Enter a rule name.'); return; }
        if (newRuleAmount === '' || Number(newRuleAmount) <= 0) { alert('Enter a positive amount.'); return; }

        setBusy(true);
        const { data, error } = await supabase.rpc('leave_rule_create', {
            p_company: companyId,
            p_name: newRuleName.trim(),
            p_unit: newRuleUnit,
            p_annual: Number(newRuleAmount),
            p_applies: newRuleApplies,
        });
        setBusy(false);
        if (error) { alert(error.message); return; }
        setRules(prev => [...prev, data as LeaveRule]);
        setNewRuleName(''); setNewRuleAmount(''); setNewRuleUnit('HOURS'); setNewRuleApplies('ALL');
    }

    async function toggleRuleActive(rule: LeaveRule, v: boolean) {
        const { error } = await supabase.rpc('leave_rule_toggle_active', { p_rule: rule.id, p_active: v });
        if (error) { alert(error.message); return; }
        setRules(rules.map((r) => (r.id === rule.id ? { ...r, is_active: v } : r)));
    }

    // Set/clear assignment for a person
    async function setPersonRule(userId: string, ruleId: string | '') {
        if (!companyId) return;
        setAssignBusy(userId);
        try {
            if (!ruleId) {
                await supabase.from('leave_user_rules').delete().eq('user_id', userId).eq('company_id', companyId);
                const next = new Map(assignments);
                next.set(userId, null);
                setAssignments(next);
            } else {
                const { error } = await supabase
                    .from('leave_user_rules')
                    .upsert(
                        { user_id: userId, company_id: companyId, rule_id: ruleId },
                        { onConflict: 'user_id,company_id' }
                    );
                if (error) throw error;
                const next = new Map(assignments);
                next.set(userId, ruleId);
                setAssignments(next);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to save assignment';
            alert(msg);
        } finally {
            setAssignBusy(null);
        }
    }

    // Save override (company-level)
    async function saveOverride(userId: string) {
        if (!companyId) return;
        const draft = ovDraft.get(userId);
        if (!draft) return;
        const amount = draft.remaining === '' ? NaN : Number(draft.remaining);
        if (!Number.isFinite(amount) || amount < 0) { alert('Enter a non-negative number.'); return; }
        setOvBusy(userId);
        try {
            const { error } = await supabase.rpc('leave_override_upsert', {
                p_user: userId,
                p_company: companyId,
                p_unit: draft.unit,
                p_remaining: amount,
            });
            if (error) throw error;
            const next = new Map(overrides);
            next.set(userId, { user_id: userId, unit: draft.unit, opening_remaining: amount });
            setOverrides(next);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to save override';
            alert(msg);
        } finally {
            setOvBusy(null);
        }
    }

    // Clear override (revert to rule)
    async function clearOverride(userId: string) {
        if (!companyId) return;
        setOvBusy(userId);
        try {
            const { error } = await supabase.rpc('leave_override_clear', {
                p_user: userId,
                p_company: companyId,
            });
            if (error) throw error;
            const next = new Map(overrides);
            next.delete(userId);
            setOverrides(next);
            const d = new Map(ovDraft);
            const cur = d.get(userId);
            d.set(userId, { unit: (cur?.unit ?? 'HOURS') as 'HOURS' | 'DAYS', remaining: '' });
            setOvDraft(d);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to clear override';
            alert(msg);
        } finally {
            setOvBusy(null);
        }
    }

    return (
        <div className="space-y-4 max-w-6xl">
            <Section title="Company">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-sm mb-1">Company</label>
                        {isAdmin ? (
                            <select
                                className="w-full rounded-md px-2 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={companyId}
                                onChange={(e) => setCompanyId(e.target.value)}
                            >
                                <option value="">Select company…</option>
                                {companies.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                            </select>
                        ) : (
                            <input
                                className="w-full rounded-md px-2 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={companyName || '—'}
                                disabled
                            />
                        )}
                    </div>
                </div>
            </Section>

            <Section title="Tax year & approvals">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Tax year start</label>
                        <input
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value="April (fixed)"
                            disabled
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Carryover limit (hours)</label>
                        <input
                            type="number"
                            min={0}
                            step={0.5}
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={settings?.carryover_limit ?? ''}
                            placeholder="none"
                            onChange={(e) =>
                                saveSettings({ carryover_limit: e.target.value === '' ? null : Number(e.target.value) })
                            }
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Require manager approval</label>
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={settings?.require_manager_approval ?? true}
                                onChange={(e) => saveSettings({ require_manager_approval: e.target.checked })}
                            />
                            Yes, approval required
                        </label>
                    </div>

                    {/* Link to rota shift type */}
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Link to rota shift type</label>
                        <select
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={settings?.rota_shift_type_id ?? ''}
                            onChange={async (e) => {
                                const v: string | null = e.target.value ? e.target.value : null;
                                await saveSettings({ rota_shift_type_id: v });
                            }}
                            disabled={!companyId}
                        >
                            <option value="">Not linked</option>
                            {shiftTypes
                                .slice()
                                .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
                                .map(st => (
                                    <option key={st.id} value={st.id}>
                                        {st.code} — {st.label}
                                    </option>
                                ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                            When linked, approved leave is auto-added to the rota using this code.
                        </p>
                    </div>
                </div>

                <p className="mt-2 text-xs text-gray-500">
                    Rules define allowances in <b>hours</b> or <b>days</b> per tax year (April–March).
                </p>
            </Section>

            <Section title="Entitlement rules">
                <form onSubmit={addRuleInline} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1">Rule name</label>
                        <input
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            placeholder='e.g. "Standard" or "Manager"'
                            value={newRuleName}
                            onChange={(e) => setNewRuleName(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm mb-1">Unit</label>
                        <select
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={newRuleUnit}
                            onChange={(e) => setNewRuleUnit(e.target.value as 'HOURS' | 'DAYS')}
                        >
                            <option value="HOURS">Hours</option>
                            <option value="DAYS">Days</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm mb-1">Applies to</label>
                        <select
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={newRuleApplies}
                            onChange={(e) => setNewRuleApplies(e.target.value as 'ALL' | 'STAFF' | 'BANK' | 'MANAGER')}
                        >
                            <option value="ALL">All</option>
                            <option value="STAFF">Staff</option>
                            <option value="BANK">Bank</option>
                            <option value="MANAGER">Manager</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm mb-1">Amount</label>
                        <input
                            type="number"
                            min={0}
                            step={0.5}
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            placeholder="e.g. 112 or 28"
                            value={newRuleAmount}
                            onChange={(e) => setNewRuleAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        />
                    </div>

                    <div className="sm:col-span-1">
                        <button
                            disabled={busy || !companyId}
                            className="w-full rounded-md px-3 py-2 text-sm text-white disabled:opacity-60"
                            style={{ background: BRAND_GRADIENT }}
                            type="submit"
                        >
                            {busy ? 'Adding…' : 'Add rule'}
                        </button>
                    </div>
                </form>

                <div className="max-h-[28rem] overflow-auto mt-3">
                    <table className="min-w-full text-sm">
                        <thead
                            className="sticky top-0 text-gray-600"
                            style={{ background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                        >
                            <tr>
                                <th className="text-left p-2">Name</th>
                                <th className="text-left p-2">Applies to</th>
                                <th className="text-left p-2">Unit</th>
                                <th className="text-left p-2">Amount / year</th>
                                <th className="text-left p-2">Active</th>
                                <th className="p-2 w-[120px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map((r) => (
                                <tr key={r.id} className="border-t">
                                    <td className="p-2">{r.name}</td>
                                    <td className="p-2">{r.applies_to}</td>
                                    <td className="p-2">{r.unit}</td>
                                    <td className="p-2">{r.annual_allowance}</td>
                                    <td className="p-2">
                                        <label className="inline-flex items-center gap-2 text-sm">
                                            <input type="checkbox" checked={r.is_active} onChange={(e) => toggleRuleActive(r, e.target.checked)} />
                                            <span>{r.is_active ? 'Active' : 'Inactive'}</span>
                                        </label>
                                    </td>
                                    <td className="p-2">
                                        <button
                                            className="rounded px-2 py-1 text-xs ring-1"
                                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                            onClick={() => alert('Edit coming soon')}
                                        >
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {rules.length === 0 && (
                                <tr>
                                    <td className="p-2 text-sm text-gray-500" colSpan={6}>No rules yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Section>

            {/* Assignments */}
            <Section title="Assignments">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">Home</label>
                        <select
                            className="w-full rounded-md px-2 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={assignHomeId}
                            onChange={(e) => setAssignHomeId(e.target.value)}
                        >
                            <option value="">{homes.length ? 'Select home…' : 'No homes'}</option>
                            {homes.map((h) => (<option key={h.id} value={h.id}>{h.name}</option>))}
                        </select>
                    </div>
                </div>

                <div className="mt-3 max-h-[28rem] overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead
                            className="sticky top-0 text-gray-600"
                            style={{ background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                        >
                            <tr>
                                <th className="text-left p-2">Person</th>
                                <th className="text-left p-2 w-[280px]">Rule</th>
                                <th className="text-left p-2">Override (current year)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {people.map((p) => {
                                const currentRule = assignments.get(p.user_id) || null;
                                const ov = overrides.get(p.user_id) || null;
                                const draft = ovDraft.get(p.user_id) || { unit: 'HOURS' as const, remaining: '' };

                                return (
                                    <tr key={p.user_id} className="border-t align-top">
                                        <td className="p-2">{p.full_name?.trim() || p.user_id.slice(0, 8)}</td>

                                        <td className="p-2">
                                            <select
                                                className="w-full rounded px-2 py-1 text-sm ring-1"
                                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                value={currentRule || ''}
                                                onChange={(e) => setPersonRule(p.user_id, e.target.value)}
                                                disabled={assignBusy === p.user_id}
                                            >
                                                <option value="">(Use company default)</option>
                                                {rules.filter(r => r.is_active).map((r) => (
                                                    <option key={r.id} value={r.id}>
                                                        {r.name} — {r.annual_allowance} {r.unit.toLowerCase()}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="mt-1 text-[11px] text-gray-500">
                                                {assignBusy === p.user_id ? 'Saving…' : currentRule ? 'Explicit rule' : 'Default by role'}
                                            </div>
                                        </td>

                                        <td className="p-2">
                                            <div className="grid grid-cols-3 gap-2 items-end">
                                                <div>
                                                    <label className="block text-[11px] text-gray-600 mb-1">Unit</label>
                                                    <select
                                                        className="rounded px-2 py-1 text-sm ring-1"
                                                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                        value={draft.unit}
                                                        onChange={(e) => {
                                                            const next = new Map(ovDraft);
                                                            next.set(p.user_id, { ...draft, unit: e.target.value as 'HOURS' | 'DAYS' });
                                                            setOvDraft(next);
                                                        }}
                                                    >
                                                        <option value="HOURS">Hours</option>
                                                        <option value="DAYS">Days</option>
                                                    </select>
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="block text-[11px] text-gray-600 mb-1">Remaining now</label>
                                                    <input
                                                        className="w-full rounded px-2 py-1 text-sm ring-1"
                                                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                        type="number"
                                                        min={0}
                                                        step={draft.unit === 'DAYS' ? 0.5 : 0.25}
                                                        placeholder={draft.unit === 'DAYS' ? 'e.g. 14' : 'e.g. 56'}
                                                        value={draft.remaining}
                                                        onChange={(e) => {
                                                            const next = new Map(ovDraft);
                                                            next.set(p.user_id, { ...draft, remaining: e.target.value });
                                                            setOvDraft(next);
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="mt-2 flex gap-2">
                                                <button
                                                    className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                    disabled={ovBusy === p.user_id || draft.remaining === ''}
                                                    onClick={() => saveOverride(p.user_id)}
                                                >
                                                    {ovBusy === p.user_id ? 'Saving…' : ov ? 'Update override' : 'Save override'}
                                                </button>
                                                {ov && (
                                                    <button
                                                        className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                        disabled={ovBusy === p.user_id}
                                                        onClick={() => clearOverride(p.user_id)}
                                                    >
                                                        Clear
                                                    </button>
                                                )}
                                            </div>

                                            <div className="mt-1 text-[11px] text-gray-500">
                                                {ov
                                                    ? `Active: ${ov.opening_remaining} ${ov.unit.toLowerCase()} (applies since ${formatDMY(currentTaxYearStartISO())})`
                                                    : 'No override — entitlement from rule'}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {people.length === 0 && (
                                <tr>
                                    <td className="p-2 text-sm text-gray-500" colSpan={3}>No people found for this home.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="mt-2 text-xs text-gray-500">
                    “Default” uses the first active rule that matches the person’s role (Manager/Bank/Staff) or the ALL rule if present.
                    Set a specific rule here to override the default for an individual. Use the <b>Override</b> to set each person’s
                    current remaining entitlement for the ongoing tax year (useful when adopting mid-year).
                </p>
            </Section>
        </div>
    );
}
