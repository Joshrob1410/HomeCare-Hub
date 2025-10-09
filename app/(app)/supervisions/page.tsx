'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/* =========================
   Types
   ========================= */

type Level = AppLevel;

type Supervision = {
    id: string;
    company_id: string;
    home_id: string | null;
    supervisor_id: string;
    supervisee_id: string;
    scheduled_for: string;
    status: 'DRAFT' | 'ISSUED' | 'SIGNED' | 'CANCELLED';
    notes: string | null;
    created_at: string;
    updated_at: string;
};

type SupervisionV = Supervision & {
    supervisee_name?: string | null;
    supervisor_name?: string | null;
    home_name?: string | null;
};

type Home = { id: string; name: string; company_id: string };
type Person = { id: string; name: string; home_id?: string | null };

type QuestionType = 'SINGLE' | 'MULTI' | 'TEXT';
type FormQuestion = {
    id?: string;
    order_index: number;
    label: string;
    type: QuestionType;
    options: string[]; // [] for TEXT
    required: boolean;
};

// For editor where questions always have an ID
type FormQuestionWithId = Omit<FormQuestion, 'id'> & { id: string };

type FormMeta = {
    id: string;
    company_id: string;
    name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

type AnswerValue = string | string[] | null;

type AnswerUpsert = {
    supervision_id: string;
    question_id: string;
    answer_text: string | null;
    answer_multi: string[] | null;
};

/* Utilities */

function fmtLocalDateTimeInput(d = new Date()) {
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function chipTone(status: Supervision['status']) {
    switch (status) {
        case 'SIGNED':
            return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
        case 'ISSUED':
            return 'bg-amber-50 text-amber-700 ring-amber-100';
        case 'DRAFT':
            return 'bg-slate-50 text-slate-700 ring-slate-100';
        default:
            return 'bg-rose-50 text-rose-700 ring-rose-100';
    }
}

/* =========================
   Page
   ========================= */

export default function SupervisionsPage() {
    const [level, setLevel] = useState<Level>('4_STAFF');

    // Who am I?
    const [uid, setUid] = useState<string | null>(null);

    // Role flags
    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';
    const isStaff = level === '4_STAFF';

    // Position flags (client-side derived)
    const [isTeamLeader, setIsTeamLeader] = useState<boolean>(false);

    // Active tab
    const [tab, setTab] = useState<'MY' | 'START' | 'ACTIVE' | 'FORMS'>('MY');

    // If we just created a draft, flip to ACTIVE
    const [forceShowActive, setForceShowActive] = useState(false);

    useEffect(() => {
        (async () => {
            const [lvl, { data: u }] = await Promise.all([getEffectiveLevel(), supabase.auth.getUser()]);
            setLevel((lvl as Level) || '4_STAFF');
            setUid(u.user?.id ?? null);

            // Am I a Team Leader at any home? (role STAFF + staff_subrole TEAM_LEADER)
            if (u.user?.id) {
                const hm = await supabase
                    .from('home_memberships')
                    .select('id')
                    .eq('user_id', u.user.id)
                    .eq('role', 'STAFF')
                    .eq('staff_subrole', 'TEAM_LEADER')
                    .limit(1);
                setIsTeamLeader(Boolean(hm.data && hm.data.length));
            }
        })();
    }, []);

    // Who can see Start Supervision?
    const canStart = isAdmin || isCompany || isManager || (isStaff && isTeamLeader);

    // If user cannot see START and tab was there, redirect to MY
    useEffect(() => {
        if (!canStart && tab === 'START') setTab('MY');
    }, [canStart, tab]);

    return (
        <div className="p-6 space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Supervisions</h1>
                    <p className="text-sm text-gray-600">View, start, and manage supervisions.</p>
                </div>
            </header>

            <div className="inline-flex rounded-lg border bg-white ring-1 ring-gray-50 shadow-sm overflow-hidden">
                <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>
                    My Supervisions
                </TabBtn>
                {canStart && (
                    <TabBtn active={tab === 'START'} onClick={() => setTab('START')}>
                        Start Supervision
                    </TabBtn>
                )}
                <TabBtn active={tab === 'ACTIVE'} onClick={() => setTab('ACTIVE')}>
                    Active Supervisions
                </TabBtn>
                {(isAdmin || isCompany) && (
                    <TabBtn active={tab === 'FORMS'} onClick={() => setTab('FORMS')}>
                        Form Builder
                    </TabBtn>
                )}
            </div>

            {tab === 'MY' && <MySupervisions />}
            {tab === 'START' && canStart && (
                <StartSupervision
                    isTeamLeader={isTeamLeader}
                    canPickBank={isAdmin || isCompany}
                    onCreatedDraft={() => {
                        setForceShowActive(true);
                        setTab('ACTIVE');
                    }}
                />
            )}
            {tab === 'ACTIVE' && (
                <ActiveSupervisions forceReveal={forceShowActive} onHandled={() => setForceShowActive(false)} />
            )}
            {tab === 'FORMS' && (isAdmin || isCompany) && <FormBuilder />}
        </div>
    );
}

function TabBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
    const { active, children, ...rest } = props;
    return (
        <button
            className={`px-4 py-2 text-sm ${active ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'}`}
            {...rest}
        >
            {children}
        </button>
    );
}

/* =========================
   MY (Supervisee) view
   ========================= */

function MySupervisions() {
    const [uid, setUid] = useState<string | null>(null);

    // Pending my approval (I'm the supervisee, ISSUED)
    const [pending, setPending] = useState<SupervisionV[]>([]);
    const [pendingOpen, setPendingOpen] = useState<SupervisionV | null>(null);

    // Completed for me (I'm supervisee, SIGNED)
    const [cForMe, setCForMe] = useState<SupervisionV[]>([]);
    const [forMePage, setForMePage] = useState(0);

    // Completed by me (I'm supervisor, SIGNED)
    const [cByMe, setCByMe] = useState<SupervisionV[]>([]);
    const [byMePage, setByMePage] = useState(0);

    const PAGE = 5;

    async function loadAll(me: string, forMeOffset = 0, byMeOffset = 0) {
        // Pending
        const p = await supabase
            .from('supervisions_v')
            .select('*')
            .eq('supervisee_id', me)
            .eq('status', 'ISSUED')
            .order('scheduled_for', { ascending: false });
        if (!p.error) setPending((p.data as SupervisionV[]) ?? []);

        // Completed FOR me
        const fm = await supabase
            .from('supervisions_v')
            .select('*')
            .eq('supervisee_id', me)
            .eq('status', 'SIGNED')
            .order('scheduled_for', { ascending: false })
            .range(forMeOffset, forMeOffset + PAGE - 1);
        if (!fm.error) setCForMe((fm.data as SupervisionV[]) ?? []);

        // Completed BY me
        const bm = await supabase
            .from('supervisions_v')
            .select('*')
            .eq('supervisor_id', me)
            .eq('status', 'SIGNED')
            .order('scheduled_for', { ascending: false })
            .range(byMeOffset, byMeOffset + PAGE - 1);
        if (!bm.error) setCByMe((bm.data as SupervisionV[]) ?? []);
    }

    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const me = u?.user?.id ?? null;
            setUid(me);
            if (me) await loadAll(me, 0, 0);
        })();
    }, []);

    if (!uid) return <p>Loading…</p>;

    return (
        <div className="space-y-6">
            {/* PENDING MY APPROVAL */}
            <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50">
                <div className="p-3 border-b">
                    <h3 className="text-sm font-semibold">Pending my approval</h3>
                    <p className="text-xs text-gray-500">These have been submitted to you for acceptance.</p>
                </div>
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                            <tr>
                                <th className="text-left p-2">When</th>
                                <th className="text-left p-2">Supervisor</th>
                                <th className="text-left p-2">Status</th>
                                <th className="p-2">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pending.map((r) => (
                                <tr key={r.id} className="border-t">
                                    <td className="p-2">{new Date(r.scheduled_for).toLocaleString()}</td>
                                    <td className="p-2">{r.supervisor_name || r.supervisor_id.slice(0, 8)}</td>
                                    <td className="p-2">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ring-1 ${chipTone(
                                                r.status
                                            )}`}
                                        >
                                            {r.status === 'ISSUED' ? 'SUBMITTED' : r.status}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        <button
                                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                            onClick={() => setPendingOpen(r)}
                                        >
                                            Review
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {pending.length === 0 && (
                                <tr>
                                    <td className="p-4 text-gray-500" colSpan={4}>
                                        Nothing pending.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* COMPLETED FOR ME (SIGNED) with pagination */}
            <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50">
                <div className="p-3 border-b flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold">Completed supervisions (for me)</h3>
                        <p className="text-xs text-gray-500">You were the supervisee.</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60"
                            disabled={forMePage === 0}
                            onClick={async () => {
                                const next = Math.max(0, forMePage - 1);
                                setForMePage(next);
                                await loadAll(uid, next * PAGE, byMePage * PAGE);
                            }}
                        >
                            Prev
                        </button>
                        <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={async () => {
                                const next = forMePage + 1;
                                setForMePage(next);
                                await loadAll(uid, next * PAGE, byMePage * PAGE);
                            }}
                        >
                            Next
                        </button>
                    </div>
                </div>
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                            <tr>
                                <th className="text-left p-2">Date</th>
                                <th className="text-left p-2">Supervisor</th>
                                <th className="text-left p-2">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cForMe.map((r) => (
                                <tr key={r.id} className="border-t">
                                    <td className="p-2">{new Date(r.scheduled_for).toLocaleString()}</td>
                                    <td className="p-2">{r.supervisor_name || r.supervisor_id.slice(0, 8)}</td>
                                    <td className="p-2">{r.status}</td>
                                </tr>
                            ))}
                            {cForMe.length === 0 && (
                                <tr>
                                    <td className="p-4 text-gray-500" colSpan={3}>
                                        No items on this page.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* COMPLETED BY ME (SIGNED) with pagination */}
            <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50">
                <div className="p-3 border-b flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold">Previously completed supervisions (by me)</h3>
                        <p className="text-xs text-gray-500">You were the supervisor. Read-only.</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60"
                            disabled={byMePage === 0}
                            onClick={async () => {
                                const next = Math.max(0, byMePage - 1);
                                setByMePage(next);
                                await loadAll(uid, forMePage * PAGE, next * PAGE);
                            }}
                        >
                            Prev
                        </button>
                        <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={async () => {
                                const next = byMePage + 1;
                                setByMePage(next);
                                await loadAll(uid, forMePage * PAGE, next * PAGE);
                            }}
                        >
                            Next
                        </button>
                    </div>
                </div>
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                            <tr>
                                <th className="text-left p-2">Date</th>
                                <th className="text-left p-2">Supervisee</th>
                                <th className="text-left p-2">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cByMe.map((r) => (
                                <tr key={r.id} className="border-t">
                                    <td className="p-2">{new Date(r.scheduled_for).toLocaleString()}</td>
                                    <td className="p-2">{r.supervisee_name || r.supervisee_id.slice(0, 8)}</td>
                                    <td className="p-2">{r.status}</td>
                                </tr>
                            ))}
                            {cByMe.length === 0 && (
                                <tr>
                                    <td className="p-4 text-gray-500" colSpan={3}>
                                        No items on this page.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* REVIEW MODAL (read-only + Accept) */}
            {pendingOpen && (
                <SupervisionEditor
                    supervision={pendingOpen}
                    onClose={() => setPendingOpen(null)}
                    onSubmitted={() => {
                        /* noop in this view */
                    }}
                    readOnly
                    canAccept
                    onAccepted={async () => {
                        setPendingOpen(null);
                        await loadAll(uid, forMePage * PAGE, byMePage * PAGE);
                    }}
                />
            )}
        </div>
    );
}

/* =========================
   START (create DRAFT)
   ========================= */

function StartSupervision({
    isTeamLeader,
    canPickBank,
    onCreatedDraft,
}: {
    isTeamLeader: boolean;
    canPickBank: boolean;
    onCreatedDraft: () => void;
}) {
    const [companyId, setCompanyId] = useState<string>('');
    const [homeId, setHomeId] = useState<string>('');
    const [homes, setHomes] = useState<Home[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [bankPeople, setBankPeople] = useState<Person[]>([]);
    const [superviseeId, setSuperviseeId] = useState<string>(''); // home pick
    const [bankSuperviseeId, setBankSuperviseeId] = useState<string>(''); // bank pick
    const [scheduledFor, setScheduledFor] = useState<string>(fmtLocalDateTimeInput());
    const [loading, setLoading] = useState(true);
    const [lockingHome, setLockingHome] = useState<boolean>(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setErr(null);

            // Determine company
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id || '';
            if (!me) {
                setLoading(false);
                return;
            }

            // Get company via membership or manager home → company fallback
            let cid = '';
            const cm = await supabase
                .from('company_memberships')
                .select('company_id')
                .eq('user_id', me)
                .maybeSingle();
            if (cm.data?.company_id) cid = cm.data.company_id;

            if (!cid) {
                const hmMgr = await supabase
                    .from('home_memberships')
                    .select('home_id')
                    .eq('user_id', me)
                    .limit(1)
                    .maybeSingle();
                const hid = hmMgr.data?.home_id;
                if (hid) {
                    const h = await supabase.from('homes').select('company_id').eq('id', hid).single();
                    if (h.data?.company_id) cid = h.data.company_id;
                }
            }
            setCompanyId(cid);

            // Homes visible for this user
            if (cid) {
                const lvl = await getEffectiveLevel();
                const asLevel = (lvl as Level) || '4_STAFF';
                if (asLevel === '1_ADMIN' || asLevel === '2_COMPANY') {
                    const h = await supabase.from('homes').select('id,name,company_id').eq('company_id', cid).order('name');
                    setHomes(((h.data as Home[]) || []));
                } else if (asLevel === '3_MANAGER') {
                    // Managers: ONLY homes they are a manager of
                    const myHomes = await supabase
                        .from('home_memberships')
                        .select('home_id')
                        .eq('user_id', me)
                        .eq('role', 'MANAGER');
                    const ids = Array.from(
                        new Set(((myHomes.data as { home_id: string }[] | null) ?? []).map((r) => r.home_id))
                    );
                    if (ids.length) {
                        const h = await supabase.from('homes').select('id,name,company_id').in('id', ids).order('name');
                        setHomes(((h.data as Home[]) || []));
                    } else {
                        setHomes([]);
                    }
                } else {
                    // Staff (non-TL): no homes; TL handled below (locked home)
                    setHomes([]);
                }
            } else {
                setHomes([]);
            }

            // If Team Leader, lock to their current home (pick first)
            if (isTeamLeader) {
                const my = await supabase
                    .from('home_memberships')
                    .select('home_id')
                    .eq('user_id', me)
                    .eq('role', 'STAFF')
                    .eq('staff_subrole', 'TEAM_LEADER')
                    .limit(1);
                const hid = my.data?.[0]?.home_id || '';
                if (hid) {
                    setHomeId(hid);
                    setLockingHome(true);
                }
            }

            setLoading(false);
        })();
    }, [isTeamLeader]);

    // Load candidates (HOME + BANK) when home or company changes
    useEffect(() => {
        (async () => {
            if (!companyId && !homeId) {
                setPeople([]);
                setBankPeople([]);
                return;
            }
            const { data, error } = await supabase.rpc('list_supervision_candidates', {
                p_home_id: homeId || null,
                p_company_id: companyId || null,
            });
            if (error) {
                console.error(error);
                setPeople([]);
                setBankPeople([]);
                return;
            }

            type CandidateRow = {
                user_id: string;
                full_name: string | null;
                source: 'HOME' | 'BANK';
            };

            const rows = (data as CandidateRow[]) || [];
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;

            const homeList: Person[] = rows
                .filter((r) => r.source === 'HOME' && r.user_id !== me)
                .map((r) => ({
                    id: r.user_id,
                    name: r.full_name || String(r.user_id).slice(0, 8),
                    home_id: homeId || null,
                }));

            const bankList: Person[] = rows
                .filter((r) => r.source === 'BANK' && r.user_id !== me)
                .map((r) => ({
                    id: r.user_id,
                    name: r.full_name || String(r.user_id).slice(0, 8),
                    home_id: null,
                }));

            setPeople(homeList);
            setBankPeople(bankList);

            // if the currently selected supervisee is no longer in list, clear it
            if (superviseeId && !homeList.find((p) => p.id === superviseeId)) setSuperviseeId('');
            if (bankSuperviseeId && !bankList.find((p) => p.id === bankSuperviseeId)) setBankSuperviseeId('');
        })();
    }, [homeId, companyId, superviseeId, bankSuperviseeId]);

    async function createDraft() {
        try {
            setErr(null);
            const pickedHome = !!superviseeId;
            const pickedBank = !!bankSuperviseeId;

            if (pickedHome && pickedBank) {
                setErr('Pick one: either a Home member or a Bank staff member — not both.');
                return;
            }
            const chosen = bankSuperviseeId || superviseeId;

            if (!companyId || !chosen || !scheduledFor) {
                setErr('Pick a supervisee (Home or Bank) and date/time.');
                return;
            }
            const { data: u } = await supabase.auth.getUser();
            const supervisor = u.user?.id;
            if (!supervisor) return;

            const ins = await supabase.from('supervisions').insert({
                company_id: companyId,
                home_id: homeId || null, // may be null if using bank staff
                supervisor_id: supervisor,
                supervisee_id: chosen,
                scheduled_for: scheduledFor,
                status: 'DRAFT',
                notes: null,
            });
            if (ins.error) throw ins.error;

            onCreatedDraft();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Failed to create supervision.';
            setErr(message);
        }
    }

    if (loading) return <p>Loading…</p>;

    return (
        <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-4 space-y-3">
            <h2 className="text-base font-semibold">Start a supervision</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                    <label className="block text-sm mb-1">Home</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50"
                        value={homeId}
                        onChange={(e) => setHomeId(e.target.value)}
                        disabled={lockingHome}
                    >
                        <option value="">— Select —</option>
                        {homes.map((h) => (
                            <option key={h.id} value={h.id}>
                                {h.name}
                            </option>
                        ))}
                    </select>
                    {lockingHome && <p className="text-[11px] text-gray-500 mt-1">As a Team Leader, your home is fixed.</p>}
                </div>
                <div className="sm:col-span-2">
                    <label className="block text-sm mb-1">Home member (staff or manager)</label>
                    <select
                        className="w-full border rounded-lg px-3 py-2"
                        value={superviseeId}
                        onChange={(e) => {
                            const v = e.target.value;
                            setSuperviseeId(v);
                            if (v) setBankSuperviseeId(''); // enforce mutual exclusivity
                        }}
                        disabled={!!bankSuperviseeId} // disable if bank is selected
                    >
                        <option value="">— Pick person —</option>
                        {people.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                    {!!bankSuperviseeId && (
                        <p className="text-[11px] text-amber-700 mt-1">Bank staff selected; clear it to pick a home member.</p>
                    )}
                </div>
                {canPickBank && (
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1">Bank staff (company-wide)</label>
                        <select
                            className="w-full border rounded-lg px-3 py-2"
                            value={bankSuperviseeId}
                            onChange={(e) => {
                                const v = e.target.value;
                                setBankSuperviseeId(v);
                                if (v) setSuperviseeId(''); // enforce mutual exclusivity
                            }}
                            disabled={!!superviseeId} // disable if home member is selected
                        >
                            <option value="">— (optional) Pick bank person —</option>
                            {bankPeople.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                        <p className="text-[11px] text-gray-500 mt-1">
                            You can pick bank staff regardless of the selected home. You cannot pick both a bank staff member and a home
                            member.
                        </p>
                        {!!superviseeId && (
                            <p className="text-[11px] text-amber-700 mt-1">
                                Home member selected; clear it to pick a bank staff member.
                            </p>
                        )}
                    </div>
                )}
                <div>
                    <label className="block text-sm mb-1">Scheduled for</label>
                    <input
                        type="datetime-local"
                        className="w-full border rounded-lg px-3 py-2"
                        value={scheduledFor}
                        onChange={(e) => setScheduledFor(e.target.value)}
                    />
                </div>
                <div className="sm:col-span-4">
                    <button onClick={createDraft} className="rounded border px-3 py-2 text-sm hover:bg-gray-50">
                        Create
                    </button>
                    {err && <span className="ml-3 text-sm text-rose-600">{err}</span>}
                </div>
            </div>
        </div>
    );
}

/* =========================
   ACTIVE (drafts/issued by me)
   ========================= */

function ActiveSupervisions({
    forceReveal,
    onHandled,
}: {
    forceReveal?: boolean;
    onHandled?: () => void;
}) {
    const [rows, setRows] = useState<SupervisionV[]>([]);
    const [loading, setLoading] = useState(true);

    const [openId, setOpenId] = useState<string | null>(null); // editor open for this supervision

    useEffect(() => {
        (async () => {
            setLoading(true);
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id || '';
            if (!me) {
                setRows([]);
                setLoading(false);
                return;
            }

            // Active = not SIGNED, not CANCELLED
            const list = await supabase
                .from('supervisions_v')
                .select('*')
                .eq('supervisor_id', me)
                .not('status', 'in', ['("SIGNED")', '("CANCELLED")'])
                .order('scheduled_for', { ascending: false });

            if (!list.error) setRows(((list.data as SupervisionV[]) || []));
            else setRows([]);
            setLoading(false);

            if (forceReveal && list.data && list.data.length && onHandled) onHandled();
        })();
    }, [forceReveal, onHandled]);

    if (loading) return <p>Loading…</p>;

    const selected = rows.find((r) => r.id === openId) || null;

    return (
        <div className="space-y-4">
            <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50">
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                            <tr>
                                <th className="text-left p-2">When</th>
                                <th className="text-left p-2">Home</th>
                                <th className="text-left p-2">Supervisee</th>
                                <th className="text-left p-2">Status</th>
                                <th className="p-2">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-t">
                                    <td className="p-2">{new Date(r.scheduled_for).toLocaleString()}</td>
                                    <td className="p-2">{r.home_name ?? '—'}</td>
                                    <td className="p-2">{r.supervisee_name ?? r.supervisee_id.slice(0, 8)}</td>
                                    <td className="p-2">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ring-1 ${chipTone(
                                                r.status
                                            )}`}
                                        >
                                            {r.status === 'ISSUED' ? 'SUBMITTED' : r.status}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        {r.status === 'DRAFT' ? (
                                            <button
                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                onClick={() => setOpenId(r.id)}
                                            >
                                                Begin / Resume
                                            </button>
                                        ) : r.status === 'ISSUED' ? (
                                            <div className="flex gap-2">
                                                <button
                                                    className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                    onClick={() => setOpenId(r.id)} // opens read-only view
                                                >
                                                    View
                                                </button>
                                                <button
                                                    className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                    onClick={async () => {
                                                        try {
                                                            const back = await supabase
                                                                .from('supervisions')
                                                                .update({ status: 'DRAFT' })
                                                                .eq('id', r.id);
                                                            if (back.error) throw back.error;

                                                            // Refresh list
                                                            const { data: u } = await supabase.auth.getUser();
                                                            const me = u.user?.id || '';
                                                            const list = await supabase
                                                                .from('supervisions_v')
                                                                .select('*')
                                                                .eq('supervisor_id', me)
                                                                .not('status', 'in', ['("SIGNED")', '("CANCELLED")'])
                                                                .order('scheduled_for', { ascending: false });
                                                            if (!list.error) setRows(((list.data as SupervisionV[]) || []));
                                                        } catch (e: unknown) {
                                                            const msg = e instanceof Error ? e.message : 'Failed to withdraw.';
                                                            alert(msg);
                                                        }
                                                    }}
                                                >
                                                    Withdraw to edit
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-gray-500 text-xs">—</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr>
                                    <td className="p-4 text-gray-500" colSpan={5}>
                                        No active supervisions.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selected && (
                <SupervisionEditor
                    supervision={selected}
                    onClose={() => setOpenId(null)}
                    onSubmitted={async () => {
                        setOpenId(null);
                        // reload list ...
                        const { data: u } = await supabase.auth.getUser();
                        const me = u.user?.id || '';
                        const list = await supabase
                            .from('supervisions_v')
                            .select('*')
                            .eq('supervisor_id', me)
                            .not('status', 'in', ['("SIGNED")', '("CANCELLED")'])
                            .order('scheduled_for', { ascending: false });
                        if (!list.error) setRows(((list.data as SupervisionV[]) || []));
                    }}
                    // NEW: lock when not a draft
                    readOnly={selected.status !== 'DRAFT'}
                />
            )}
        </div>
    );
}

/* =========================
   Supervision Form Editor (Begin/Resume)
   ========================= */

function SupervisionEditor({
    supervision,
    onClose,
    onSubmitted,
    readOnly = false, // NEW
    canAccept = false, // NEW (only for supervisee view)
    onAccepted, // NEW (callback after accept)
}: {
    supervision: SupervisionV;
    onClose: () => void;
    onSubmitted: () => void;
    readOnly?: boolean;
    canAccept?: boolean;
    onAccepted?: () => void;
}) {
    const [companyId, setCompanyId] = useState<string>('');
    const [form, setForm] = useState<FormMeta | null>(null);
    const [questions, setQuestions] = useState<FormQuestionWithId[]>([]);
    const [answers, setAnswers] = useState<Map<string, AnswerValue>>(new Map()); // question_id -> value(s)

    const [err, setErr] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Fetch active form for the supervision's company
    useEffect(() => {
        (async () => {
            setErr(null);
            try {
                // Determine company id (prefer supervision.company_id)
                const cid = supervision.company_id;
                setCompanyId(cid);

                // Active form
                const f = await supabase
                    .from('supervision_forms')
                    .select('*')
                    .eq('company_id', cid)
                    .eq('is_active', true)
                    .limit(1)
                    .single();

                if (f.error || !f.data) {
                    setForm(null);
                    setQuestions([]);
                    setErr('No active supervision form found for this company.');
                    return;
                }
                setForm(f.data as FormMeta);

                const qs = await supabase
                    .from('supervision_form_questions')
                    .select('*')
                    .eq('form_id', f.data.id)
                    .order('order_index', { ascending: true });

                if (qs.error) throw qs.error;

                const mapped: FormQuestionWithId[] = ((qs.data as Array<{
                    id: string;
                    order_index: number;
                    label: string;
                    type: QuestionType;
                    options: string[] | null;
                    required: boolean | null;
                }>) || []).map((q) => ({
                    id: q.id,
                    order_index: q.order_index,
                    label: q.label,
                    type: (q.type as QuestionType) || 'TEXT',
                    options: (q.options as string[] | null) ?? [],
                    required: Boolean(q.required),
                }));
                setQuestions(mapped);

                // Load previous answers if table exists
                const a = await supabase.from('supervision_answers').select('*').eq('supervision_id', supervision.id);

                if (!a.error && a.data) {
                    const m = new Map<string, AnswerValue>();
                    (a.data as Array<{
                        question_id: string | null;
                        answer_text: string | null;
                        answer_multi: string[] | null;
                    }>).forEach((row) => {
                        if (row.question_id && (row.answer_text || row.answer_multi)) {
                            m.set(row.question_id, row.answer_multi ?? row.answer_text ?? '');
                        }
                    });
                    setAnswers(m);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : 'Failed to load form.';
                setErr(message);
            }
        })();
    }, [supervision]);

    function setAnswer(qid: string, val: AnswerValue) {
        setAnswers((prev) => {
            const m = new Map(prev);
            m.set(qid, val);
            return m;
        });
    }

    async function upsertAnswers(statusAfter: 'DRAFT' | 'ISSUED') {
        if (!form) return;
        // Upsert each answer (table optional)
        for (const q of questions) {
            const val = answers.get(q.id);
            const payload: AnswerUpsert = {
                supervision_id: supervision.id,
                question_id: q.id,
                answer_text: q.type === 'TEXT' ? ((val as string | null) ?? null) : null,
                answer_multi: q.type !== 'TEXT' ? (Array.isArray(val) ? (val as string[]) : val ? [val as string] : []) : null,
            };
            // `onConflict` typing is not exposed by supabase-js; cast arguments object to unknown
            await supabase.from('supervision_answers').upsert(payload as unknown as Record<string, unknown>, {
                onConflict: 'supervision_id,question_id',
            } as unknown as undefined);
        }
        await supabase.from('supervisions').update({ status: statusAfter }).eq('id', supervision.id);
    }

    async function saveDraft() {
        if (!form) return;
        setSaving(true);
        setErr(null);
        try {
            await upsertAnswers('DRAFT');
            onClose();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Failed to save draft (ensure tables exist).';
            setErr(message);
        } finally {
            setSaving(false);
        }
    }

    async function submit() {
        if (!form) return;
        setSaving(true);
        setErr(null);
        try {
            // Basic required validation
            for (const q of questions) {
                if (q.required) {
                    const v = answers.get(q.id);
                    if (q.type === 'TEXT') {
                        if (!v || !String(v).trim()) throw new Error(`Please answer: ${q.label}`);
                    } else if (q.type === 'SINGLE') {
                        if (!v) throw new Error(`Please choose an answer for: ${q.label}`);
                    } else if (q.type === 'MULTI') {
                        if (!Array.isArray(v) || v.length === 0) throw new Error(`Please choose at least one for: ${q.label}`);
                    }
                }
            }

            await upsertAnswers('ISSUED');

            onClose();
            onSubmitted();
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Failed to submit supervision.';
            setErr(message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-4">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-base font-semibold">
                        Supervision: {supervision.supervisee_name ?? supervision.supervisee_id.slice(0, 8)}
                    </h3>
                    <p className="text-xs text-gray-500">
                        Scheduled for {new Date(supervision.scheduled_for).toLocaleString()}
                    </p>
                </div>
                <button onClick={onClose} className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50">
                    Close
                </button>
            </div>

            {!form ? (
                <p className="mt-3 text-sm text-gray-600">{err || 'No active form found.'}</p>
            ) : (
                <div className="mt-4 space-y-4">
                    {questions.map((q) => (
                        <div key={q.id} className="border rounded-lg p-3">
                            <label className="block text-sm font-medium mb-2">
                                {q.label} {q.required && <span className="text-rose-600">*</span>}
                            </label>

                            {q.type === 'TEXT' && (
                                <textarea
                                    className="w-full border rounded-lg px-3 py-2"
                                    rows={3}
                                    value={(answers.get(q.id) as string) ?? ''}
                                    disabled={readOnly}
                                    onChange={(e) => setAnswer(q.id, e.target.value)}
                                />
                            )}

                            {q.type === 'SINGLE' && (
                                <select
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={(answers.get(q.id) as string) ?? ''}
                                    disabled={readOnly}
                                    onChange={(e) => setAnswer(q.id, e.target.value)}
                                >
                                    <option value="">— Select —</option>
                                    {q.options.map((opt, i) => (
                                        <option key={i} value={opt}>
                                            {opt}
                                        </option>
                                    ))}
                                </select>
                            )}

                            {q.type === 'MULTI' && (
                                <div className="flex flex-wrap gap-2">
                                    {q.options.map((opt, i) => {
                                        const picked: string[] = (answers.get(q.id) as string[]) || [];
                                        const checked = picked.includes(opt);
                                        return (
                                            <label
                                                key={i}
                                                className={`inline-flex items-center gap-2 border rounded-lg px-3 py-1 text-sm ${checked ? 'bg-indigo-50 border-indigo-200' : ''
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={readOnly}
                                                    onChange={() => {
                                                        const next = new Set(picked);
                                                        if (checked) next.delete(opt);
                                                        else next.add(opt);
                                                        setAnswer(q.id, Array.from(next));
                                                    }}
                                                />
                                                <span>{opt}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))}

                    {err && <p className="text-sm text-rose-600">{err}</p>}

                    {readOnly ? (
                        <div className="flex gap-2">
                            {canAccept && supervision.status === 'ISSUED' && (
                                <button
                                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                                    onClick={async () => {
                                        try {
                                            const { data: u } = await supabase.auth.getUser();
                                            const me = u.user?.id;
                                            if (!me) return;

                                            // Record the supervisee signoff
                                            const ins = await supabase
                                                .from('supervision_signoffs')
                                                .insert({ supervision_id: supervision.id, signed_by: me });
                                            if (ins.error) throw ins.error;

                                            // Finalize
                                            const fin = await supabase
                                                .from('supervisions')
                                                .update({ status: 'SIGNED' })
                                                .eq('id', supervision.id);
                                            if (fin.error) throw fin.error;

                                            onClose();
                                            onAccepted && onAccepted();
                                        } catch (e: unknown) {
                                            const msg = e instanceof Error ? e.message : 'Failed to accept supervision.';
                                            alert(msg);
                                        }
                                    }}
                                >
                                    Accept &amp; Sign
                                </button>
                            )}
                            <button className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={onClose}>
                                Close
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                                onClick={saveDraft}
                                disabled={saving}
                            >
                                {saving ? 'Saving…' : 'Save draft'}
                            </button>
                            <button
                                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                                onClick={submit}
                                disabled={saving}
                            >
                                {saving ? 'Submitting…' : 'Submit'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* =========================
   Form Builder (Admins + Company access)
   ========================= */

function FormBuilder() {
    const [companyId, setCompanyId] = useState<string>('');
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
    const [forms, setForms] = useState<FormMeta[]>([]);
    const [name, setName] = useState<string>('');

    const [qs, setQs] = useState<FormQuestion[]>([
        { order_index: 1, label: 'How are things going?', type: 'TEXT', options: [], required: true },
    ]);
    const [err, setErr] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    // Load my company and companies (if admin)
    useEffect(() => {
        (async () => {
            setLoading(true);
            setErr(null);
            try {
                const [lvl, { data: u }] = await Promise.all([getEffectiveLevel(), supabase.auth.getUser()]);
                const me = u.user?.id || '';

                const isAdmin = (lvl as Level) === '1_ADMIN';

                if (isAdmin) {
                    const co = await supabase.from('companies').select('id,name').order('name');
                    setCompanies(((co.data as { id: string; name: string }[]) || []));
                    if (!companyId && co.data?.[0]?.id) setCompanyId(co.data[0].id);
                } else {
                    // company via membership
                    const cm = await supabase
                        .from('company_memberships')
                        .select('company_id')
                        .eq('user_id', me)
                        .maybeSingle();
                    const cid = cm.data?.company_id || '';
                    setCompanyId(cid);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [companyId]);

    // List forms when company changes
    useEffect(() => {
        (async () => {
            if (!companyId) {
                setForms([]);
                return;
            }
            const f = await supabase
                .from('supervision_forms')
                .select('*')
                .eq('company_id', companyId)
                .order('created_at', { ascending: false });

            if (!f.error) setForms(((f.data as FormMeta[]) || []));
            else setForms([]);
        })();
    }, [companyId]);

    function addQuestion() {
        const nextIndex = (qs[qs.length - 1]?.order_index || 0) + 1;
        setQs([...qs, { order_index: nextIndex, label: '', type: 'TEXT', options: [], required: false }]);
    }
    function delQuestion(idx: number) {
        setQs(qs.filter((_, i) => i !== idx).map((q, i) => ({ ...q, order_index: i + 1 })));
    }
    function updQuestion(idx: number, patch: Partial<FormQuestion>) {
        setQs(qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
    }

    async function saveForm() {
        if (!companyId || !name.trim()) {
            setErr('Enter a name and choose a company.');
            return;
        }
        setSaving(true);
        setErr(null);
        try {
            const f = await supabase
                .from('supervision_forms')
                .insert({
                    company_id: companyId,
                    name: name.trim(),
                    is_active: false,
                })
                .select('*')
                .single();

            if (f.error) throw f.error;

            // Save questions
            for (const q of qs) {
                const row: {
                    form_id: string;
                    order_index: number;
                    label: string;
                    type: QuestionType;
                    options: string[];
                    required: boolean;
                } = {
                    form_id: f.data.id,
                    order_index: q.order_index,
                    label: q.label || '',
                    type: q.type,
                    options: q.type === 'TEXT' ? [] : q.options,
                    required: q.required,
                };
                const ins = await supabase.from('supervision_form_questions').insert(row);
                if (ins.error) throw ins.error;
            }

            // refresh
            const list = await supabase
                .from('supervision_forms')
                .select('*')
                .eq('company_id', companyId)
                .order('created_at', { ascending: false });
            if (!list.error) setForms(((list.data as FormMeta[]) || []));

            setName('');
            setQs([{ order_index: 1, label: 'How are things going?', type: 'TEXT', options: [], required: true }]);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Failed to save form (ensure tables exist).';
            setErr(message);
        } finally {
            setSaving(false);
        }
    }

    async function setActive(formId: string) {
        if (!companyId) return;
        // Set selected active, unset others
        await supabase.from('supervision_forms').update({ is_active: false }).eq('company_id', companyId);
        const upd = await supabase
            .from('supervision_forms')
            .update({ is_active: true })
            .eq('id', formId)
            .select('*')
            .single();
        if (!upd.error) {
            const list = await supabase
                .from('supervision_forms')
                .select('*')
                .eq('company_id', companyId)
                .order('created_at', { ascending: false });
            if (!list.error) setForms(((list.data as FormMeta[]) || []));
        }
    }

    if (loading) return <p>Loading…</p>;

    return (
        <div className="space-y-4">
            <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-4">
                <h2 className="text-base font-semibold">Create supervision form</h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <div className="sm:col-span-1">
                        <label className="block text-sm mb-1">Company</label>
                        {companies.length > 0 ? (
                            <select
                                className="w-full border rounded-lg px-3 py-2"
                                value={companyId}
                                onChange={(e) => setCompanyId(e.target.value)}
                            >
                                {companies.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input className="w-full border rounded-lg px-3 py-2 bg-gray-50" value="(Your company)" readOnly />
                        )}
                    </div>
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1">Form name</label>
                        <input
                            className="w-full border rounded-lg px-3 py-2"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Standard Supervision v1"
                        />
                    </div>
                </div>

                <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Questions</h3>
                        <button onClick={addQuestion} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
                            Add question
                        </button>
                    </div>

                    <div className="space-y-2">
                        {qs.map((q, idx) => (
                            <div key={idx} className="border rounded-lg p-3">
                                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                                    <div className="sm:col-span-4">
                                        <label className="block text-sm mb-1">Question text</label>
                                        <input
                                            className="w-full border rounded-lg px-3 py-2"
                                            value={q.label}
                                            onChange={(e) => updQuestion(idx, { label: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm mb-1">Type</label>
                                        <select
                                            className="w-full border rounded-lg px-3 py-2"
                                            value={q.type}
                                            onChange={(e) =>
                                                updQuestion(idx, {
                                                    type: e.target.value as QuestionType,
                                                    options: e.target.value === 'TEXT' ? [] : q.options,
                                                })
                                            }
                                        >
                                            <option value="TEXT">Written answer</option>
                                            <option value="SINGLE">Single select</option>
                                            <option value="MULTI">Multi select</option>
                                        </select>
                                    </div>
                                    <div className="flex items-end">
                                        <label className="inline-flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={q.required}
                                                onChange={(e) => updQuestion(idx, { required: e.target.checked })}
                                            />
                                            <span>Required</span>
                                        </label>
                                    </div>
                                </div>

                                {q.type !== 'TEXT' && (
                                    <div className="mt-2">
                                        <label className="block text-sm mb-1">Options</label>
                                        <OptionsEditor options={q.options} onChange={(opts) => updQuestion(idx, { options: opts })} />
                                    </div>
                                )}

                                <div className="mt-2">
                                    <button
                                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                        onClick={() => delQuestion(idx)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div>
                        <button
                            onClick={saveForm}
                            className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Save form'}
                        </button>
                        {err && <span className="ml-3 text-sm text-rose-600">{err}</span>}
                    </div>
                </div>
            </section>

            <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50">
                <div className="p-4">
                    <h2 className="text-base font-semibold">Existing forms</h2>
                </div>
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10">
                            <tr>
                                <th className="text-left p-2">Name</th>
                                <th className="text-left p-2">Active</th>
                                <th className="p-2 w-[180px]">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {forms.map((f) => (
                                <tr key={f.id} className="border-t">
                                    <td className="p-2">{f.name}</td>
                                    <td className="p-2">{f.is_active ? 'Yes' : 'No'}</td>
                                    <td className="p-2">
                                        {!f.is_active ? (
                                            <button
                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                onClick={() => setActive(f.id)}
                                            >
                                                Set active
                                            </button>
                                        ) : (
                                            <span className="text-gray-500 text-xs">Current active</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {(!forms || forms.length === 0) && (
                                <tr>
                                    <td className="p-4 text-gray-500" colSpan={3}>
                                        No forms yet.
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

function OptionsEditor({
    options,
    onChange,
}: {
    options: string[];
    onChange: (opts: string[]) => void;
}) {
    const [val, setVal] = useState('');
    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <input
                    className="flex-1 border rounded-lg px-3 py-2"
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    placeholder="Add option…"
                />
                <button
                    type="button"
                    className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => {
                        const v = val.trim();
                        if (!v) return;
                        if (!options.includes(v)) onChange([...options, v]);
                        setVal('');
                    }}
                >
                    Add
                </button>
            </div>
            <div className="flex flex-wrap gap-2">
                {options.map((o, i) => (
                    <span
                        key={i}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs bg-gray-50"
                    >
                        {o}
                        <button
                            type="button"
                            className="text-gray-500 hover:text-gray-900"
                            onClick={() => onChange(options.filter((x) => x !== o))}
                            aria-label="Remove option"
                        >
                            ×
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );
}
