'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

/* ========= Types (match schema.sql) ========= */

type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type Course = {
    id: string;
    company_id: string;
    name: string;
    refresher_years: number | null;
    training_type: string;
    mandatory: boolean;
    due_soon_days: number;
};

type SessionStatus = 'DRAFT' | 'SCHEDULED' | 'CANCELLED';

type Session = {
    id: string;
    company_id: string;
    course_id: string;               // required in schema
    starts_at: string;               // ISO
    ends_at: string | null;          // ISO
    confirm_deadline: string | null; // ISO
    capacity: number;                // NOT NULL in schema
    location: string | null;
    notes: string | null;
    status: SessionStatus;
    created_by: string | null;
    created_at: string;
    // expanded
    courses?: Course | null;
};

type AttendeeStatus =
    | 'INVITED'
    | 'BOOKED'
    | 'CONFIRMED'
    | 'CANCELLED'
    | 'WAITLISTED'
    | 'ATTENDED'
    | 'NO_SHOW';

type Attendee = {
    session_id: string;
    user_id: string;
    status: AttendeeStatus;
    invited_at: string | null;
    booked_at: string | null;
    confirmed_at: string | null;
    cancelled_at: string | null;
    attended_at: string | null;  // new canonical
    completed_at: string | null; // still present in schema; harmless to keep
    noshow_at: string | null;    // still present in schema; harmless to keep
};

type MyAttendeeRow = Attendee & {
    training_sessions: Session & { courses?: Course | null };
};

type MemberFromAPI = {
    id: string;
    full_name?: string | null;
    email?: string | null;
    roles: {
        bank: boolean;
        manager_homes?: { id: string; name: string }[];
        staff_home?: { id: string; name: string } | null;
        company?: boolean;
    };
};

/* ========= Page (Tabs) ========= */

export default function BookingsPage() {
    const [level, setLevel] = useState<Level>('4_STAFF');
    const [loadingLevel, setLoadingLevel] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const lvl = await getEffectiveLevel();
                setLevel((lvl as Level) || '4_STAFF');
            } finally {
                setLoadingLevel(false);
            }
        })();
    }, []);

    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';
    const canManage = isAdmin || isCompany || isManager;

    type Tab = 'MY' | 'SESSIONS' | 'SETTINGS';
    const [tab, setTab] = useState<Tab>('MY');

    useEffect(() => {
        if (!canManage && tab !== 'MY') setTab('MY');
    }, [canManage, tab]);

    if (loadingLevel) {
        return (
            <div className="p-6">
                <div className="h-6 w-40 rounded bg-gray-100 mb-4 animate-pulse" />
                <div className="h-9 w-[520px] max-w-full rounded bg-gray-100 animate-pulse" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-2xl font-semibold">Training bookings</h1>

            {/* Tabs */}
            <div className="inline-flex rounded-lg border bg-white ring-1 ring-gray-50 shadow-sm overflow-hidden">
                <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>My bookings</TabBtn>
                {canManage && <TabBtn active={tab === 'SESSIONS'} onClick={() => setTab('SESSIONS')}>Sessions</TabBtn>}
                {canManage && <TabBtn active={tab === 'SETTINGS'} onClick={() => setTab('SETTINGS')}>Settings</TabBtn>}
            </div>

            {tab === 'MY' && <MyBookings />}
            {tab === 'SESSIONS' && canManage && (
                <SessionsAdmin isAdmin={isAdmin} isCompany={isCompany} isManager={isManager} />
            )}
            {tab === 'SETTINGS' && canManage && <SettingsSection />}
        </div>
    );
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

/* ========================= Helpers ========================= */

// Finds a single company_id for the current user (admin: first company; company role: their company; manager: via first managed home)
async function resolveCompanyIdForUser(uid: string, role: Level): Promise<string | null> {
    if (role === '1_ADMIN') {
        const co = await supabase.from('companies').select('id').order('created_at').limit(1);
        return co.data?.[0]?.id ?? null;
    }
    if (role === '2_COMPANY') {
        const cm = await supabase.from('company_memberships').select('company_id').eq('user_id', uid).maybeSingle();
        return cm.data?.company_id ?? null;
    }
    if (role === '3_MANAGER') {
        const mh = await supabase.from('home_memberships').select('home_id').eq('user_id', uid).eq('role', 'MANAGER');
        const firstHome = mh.data?.[0]?.home_id;
        if (!firstHome) return null;
        const h = await supabase.from('homes').select('company_id').eq('id', firstHome).maybeSingle();
        return h.data?.company_id ?? null;
    }
    // staff: try via company_memberships or home then home->company
    const cm = await supabase.from('company_memberships').select('company_id').eq('user_id', uid).maybeSingle();
    if (cm.data?.company_id) return cm.data.company_id;
    const hm = await supabase.from('home_memberships').select('home_id').eq('user_id', uid).limit(1).maybeSingle();
    if (hm.data?.home_id) {
        const h = await supabase.from('homes').select('company_id').eq('id', hm.data.home_id).maybeSingle();
        return h.data?.company_id ?? null;
    }
    return null;
}

// Try to pull a directory (has emails) used by People page
async function getPeopleDirectoryMap(): Promise<
    Map<string, { full_name: string | null; email: string | null }>
> {
    const map = new Map<string, { full_name: string | null; email: string | null }>();
    try {
        const res = await fetch('/api/self/members/list', { method: 'GET' });
        if (!res.ok) return map;
        const data = await res.json();
        const members = (data?.members || []) as Array<{ id: string; full_name?: string | null; email?: string | null }>;
        for (const m of members) {
            map.set(m.id, { full_name: m.full_name ?? null, email: m.email ?? null });
        }
        return map;
    } catch {
        return map;
    }
}

// Fallback: get names from profiles (no email there in your schema)
async function getProfilesNameMap(ids: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (!ids.length) return map;
    const q = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
    if (!q.error) {
        (q.data || []).forEach((p: { user_id: string; full_name: string | null }) => map.set(p.user_id, p.full_name ?? null));
    }
    return map;
}

function fmtWhen(start?: string | null, end?: string | null) {
    if (!start) return '—';
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const date = s.toLocaleDateString();
    const st = s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const et = e ? e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `${date}, ${st}${et ? ` – ${et}` : ''}`;
}

function isPendingStatus(s: AttendeeStatus) {
    return s === 'INVITED' || s === 'BOOKED' || s === 'WAITLISTED';
}

function displayStatus(s: AttendeeStatus) {
    return s === 'CANCELLED' ? 'Removed' : s;
}
function rowTone(s: AttendeeStatus) {
    if (s === 'CONFIRMED') return 'bg-emerald-50';
    if (s === 'CANCELLED') return 'bg-rose-50';
    if (s === 'INVITED' || s === 'BOOKED' || s === 'WAITLISTED') return 'bg-yellow-50';
    return '';
}

/* ========================= MY — Book / decline (no popups) ========================= */

function MyBookings() {
    const [uid, setUid] = useState<string | null>(null);
    const [rows, setRows] = useState<MyAttendeeRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // staged action per session: 'confirm' | 'decline' | 'cancel' | undefined
    const [pendingAction, setPendingAction] = useState<Record<string, 'confirm' | 'decline' | 'cancel' | undefined>>({});

    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            setUid(u.user?.id ?? null);
        })();
    }, []);

    useEffect(() => {
        (async () => {
            if (!uid) return;
            setLoading(true);
            setErr(null);
            try {
                const res = await supabase
                    .from('training_session_attendees')
                    .select('*, training_sessions(*, courses(name))')
                    .eq('user_id', uid);
                if (res.error) throw res.error;
                setRows((res.data as unknown as MyAttendeeRow[]) || []);
            } catch (e) {
                const msg = (e as { message?: string })?.message ?? 'Failed to load';
                setErr(msg);
            } finally {
                setLoading(false);
            }
        })();
    }, [uid]);

    const upcoming = useMemo(() => {
        const now = Date.now();
        return rows
            .filter(r =>
                r.training_sessions?.starts_at &&
                new Date(r.training_sessions.starts_at).getTime() >= now
            )
            .sort((a, b) => (a.training_sessions.starts_at || '').localeCompare(b.training_sessions.starts_at || ''));
    }, [rows]);

    const history = useMemo(() => {
        const now = Date.now();
        return rows
            .filter(r => !r.training_sessions?.starts_at || new Date(r.training_sessions.starts_at).getTime() < now)
            .sort((a, b) => (b.training_sessions.starts_at || '').localeCompare(a.training_sessions.starts_at || ''));
    }, [rows]);

    async function reload() {
        if (!uid) return;
        const fresh = await supabase
            .from('training_session_attendees')
            .select('*, training_sessions(*, courses(name))')
            .eq('user_id', uid);
        if (!fresh.error) setRows((fresh.data as unknown as MyAttendeeRow[]) || []);
    }

    // Decline booking (with param fallback p_session -> p_session_id)
    async function decline(session_id: string) {
        const res1 = await supabase.rpc('cancel_my_training_booking', { p_session: session_id });
        if (res1.error) {
            const res2 = await supabase.rpc('cancel_my_training_booking', { p_session_id: session_id });
            if (res2.error) { alert(res2.error.message); return; }
        }
        setPendingAction(p => ({ ...p, [session_id]: undefined }));
        await reload();
    }


    // Confirm place (try p_session first, then p_session_id)
    async function confirmPlace(session_id: string) {
        const res1 = await supabase.rpc('confirm_my_training_booking', { p_session: session_id });
        if (res1.error) {
            const res2 = await supabase.rpc('confirm_my_training_booking', { p_session_id: session_id });
            if (res2.error) { alert(res2.error.message); return; }
        }
        setPendingAction(p => ({ ...p, [session_id]: undefined }));
        await reload();
    }


    async function cancelAttendance(session_id: string) {
        // same RPC as decline; try both param names for compatibility
        const res1 = await supabase.rpc('cancel_my_training_booking', { p_session: session_id });
        if (res1.error) {
            const res2 = await supabase.rpc('cancel_my_training_booking', { p_session_id: session_id });
            if (res2.error) { alert(res2.error.message); return; }
        }
        setPendingAction(p => ({ ...p, [session_id]: undefined }));
        await reload();
    }


    if (loading) return <p>Loading…</p>;

    return (
        <div className="space-y-6">
            {/* Upcoming */}
            <section className="rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm p-4">
                <h2 className="text-base font-semibold mb-2">Upcoming</h2>
                {upcoming.length === 0 ? (
                    <p className="text-sm text-gray-600">No upcoming bookings.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-gray-600">
                                <tr>
                                    <th className="text-left p-2">Course</th>
                                    <th className="text-left p-2">When</th>
                                    <th className="text-left p-2">Where</th>
                                    <th className="text-left p-2">Status</th>
                                    <th className="p-2 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {upcoming.map(a => {
                                    const s = a.training_sessions;
                                    return (
                                        <tr key={a.session_id} className={`border-t ${rowTone(a.status)}`}>
                                            <td className="p-2">{s?.courses?.name || '—'}</td>
                                            <td className="p-2">
                                                {fmtWhen(s?.starts_at, s?.ends_at)}
                                                {s?.confirm_deadline ? <div className="text-xs text-gray-600">Confirm by {new Date(s.confirm_deadline).toLocaleDateString()}</div> : null}
                                            </td>
                                            <td className="p-2">{s?.location || '—'}</td>
                                            <td className="p-2">{displayStatus(a.status)}</td>
                                            <td className="p-2 text-center">
                                                <div className="inline-flex items-center gap-2">
                                                    {/* Pending (INVITED/BOOKED/WAITLISTED) → show Confirm + Decline */}
                                                    {!pendingAction[a.session_id] && isPendingStatus(a.status) && (
                                                        <>
                                                            <button
                                                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: 'confirm' }))}
                                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                            >
                                                                Confirm
                                                            </button>
                                                            <button
                                                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: 'decline' }))}
                                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                            >
                                                                Decline
                                                            </button>
                                                        </>
                                                    )}

                                                    {/* Already CONFIRMED → show Cancel attendance */}
                                                    {!pendingAction[a.session_id] && a.status === 'CONFIRMED' && (
                                                        <button
                                                            onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: 'cancel' }))}
                                                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                        >
                                                            Cancel attendance
                                                        </button>
                                                    )}

                                                    {/* Staged: Confirm */}
                                                    {pendingAction[a.session_id] === 'confirm' && (
                                                        <>
                                                            <button
                                                                onClick={() => confirmPlace(a.session_id)}
                                                                className="rounded px-2 py-1 text-xs text-white bg-emerald-600 hover:bg-emerald-700"
                                                            >
                                                                Confirm
                                                            </button>
                                                            <button
                                                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: undefined }))}
                                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}

                                                    {/* Staged: Decline */}
                                                    {pendingAction[a.session_id] === 'decline' && (
                                                        <>
                                                            <button
                                                                onClick={() => decline(a.session_id)}
                                                                className="rounded px-2 py-1 text-xs text-white bg-rose-600 hover:bg-rose-700"
                                                            >
                                                                Decline
                                                            </button>
                                                            <button
                                                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: undefined }))}
                                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}

                                                    {/* Staged: Cancel attendance (for CONFIRMED) */}
                                                    {pendingAction[a.session_id] === 'cancel' && (
                                                        <>
                                                            <button
                                                                onClick={() => cancelAttendance(a.session_id)}
                                                                className="rounded px-2 py-1 text-xs text-white bg-rose-600 hover:bg-rose-700"
                                                            >
                                                                Cancel attendance
                                                            </button>
                                                            <button
                                                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: undefined }))}
                                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>

                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
            </section>

            {/* History */}
            <section className="rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm p-4">
                <h2 className="text-base font-semibold mb-2">History</h2>
                {history.length === 0 ? (
                    <p className="text-sm text-gray-600">No past sessions.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 text-gray-600">
                                <tr>
                                    <th className="text-left p-2">Course</th>
                                    <th className="text-left p-2">When</th>
                                    <th className="text-left p-2">Where</th>
                                    <th className="text-left p-2">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(a => {
                                    const s = a.training_sessions;
                                    return (
                                        <tr key={a.session_id} className={`border-t ${rowTone(a.status)}`}>
                                            <td className="p-2">{s?.courses?.name || '—'}</td>
                                            <td className="p-2">{fmtWhen(s?.starts_at, s?.ends_at)}</td>
                                            <td className="p-2">{s?.location || '—'}</td>
                                            <td className="p-2">{displayStatus(a.status)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}

/* ========================= SESSIONS — Create/manage + invite ========================= */

function SessionsAdmin({
    isAdmin, isCompany, isManager
}: { isAdmin: boolean; isCompany: boolean; isManager: boolean }) {
    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');

    const [companyId, setCompanyId] = useState<string>('');
    const [companyName, setCompanyName] = useState<string>('');

    const [sessions, setSessions] = useState<(Session & { courses?: Course | null })[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [counts, setCounts] = useState<Record<string, { confirmed: number; pending: number; waitlist: number }>>({});

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // Filters
    const [q, setQ] = useState('');
    const [from, setFrom] = useState<string>(''); // date
    const [to, setTo] = useState<string>('');     // date

    // Create modal
    const [openNew, setOpenNew] = useState(false);
    const [form, setForm] = useState<{
        course_id: string;
        date: string;
        start_time: string;
        end_time: string;
        confirm_deadline: string;
        capacity: number | '';
        location: string;
        notes: string;
    }>({
        course_id: '',
        date: '',
        start_time: '',
        end_time: '',
        confirm_deadline: '',
        capacity: '',
        location: '',
        notes: '',
    });
    const [saving, setSaving] = useState(false);

    // Invite modal
    const [inviteOpen, setInviteOpen] = useState<null | Session>(null);
    type Person = { id: string; name: string; home_id?: string | null; is_bank?: boolean };
    const [homes, setHomes] = useState<{ id: string; name: string }[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [inviteSelected, setInviteSelected] = useState<string[]>([]);
    const homesById = useMemo(() => {
        const m = new Map<string, string>();
        homes.forEach(h => m.set(h.id, h.name));
        return m;
    }, [homes]);

    // inline delete confirmation (no popups)
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    const [flash, setFlash] = useState<string | null>(null);

    // who am i + level
    useEffect(() => {
        (async () => {
            const [{ data: u }, lvl] = await Promise.all([supabase.auth.getUser(), getEffectiveLevel()]);
            setUid(u.user?.id ?? null);
            setLevel((lvl as Level) || '4_STAFF');
        })();
    }, []);

    // load company scope + sessions + invite list (company-only)
    useEffect(() => {
        (async () => {
            if (!uid) return;
            setLoading(true);
            setErr(null);
            try {
                const cid = await resolveCompanyIdForUser(uid, level);
                if (cid) {
                    setCompanyId(cid);
                    const co = await supabase.from('companies').select('name').eq('id', cid).maybeSingle();
                    if (!co.error) setCompanyName(co.data?.name || cid);
                }

                if (cid) {
                    const cr = await supabase.from('courses').select('*').eq('company_id', cid).order('name');
                    if (!cr.error) setCourses((cr.data as unknown as Course[]) || []);
                }

                await loadSessions(cid || null);

                if (isAdmin || isCompany) {
                    // === COMPANY VIEW ===
                    const h = await supabase
                        .from('homes')
                        .select('id,name')
                        .eq('company_id', cid || '');
                    const companyHomes = ((h.data as unknown as { id: string; name: string }[]) || []).map(x => ({ id: x.id, name: x.name }));
                    setHomes(companyHomes);
                    const companyHomeIds = new Set(companyHomes.map(x => x.id));

                    // 2) Try directory (same source as People page)
                    const dirRes = await fetch('/api/self/members/list');
                    if (dirRes.ok) {
                        const data = await dirRes.json();
                        const members = (data?.members || []) as MemberFromAPI[];
                        const filtered = members.filter(m => {
                            const staffIn = m.roles.staff_home?.id && companyHomeIds.has(m.roles.staff_home.id);
                            const managerIn = (m.roles.manager_homes || []).some(hh => companyHomeIds.has(hh.id));
                            const bankIn = !!m.roles.bank;
                            return staffIn || managerIn || bankIn;
                        });

                        const ps: Person[] = filtered.map(m => ({
                            id: m.id,
                            name: m.full_name || m.email || m.id.slice(0, 8),
                            home_id: m.roles.staff_home?.id || m.roles.manager_homes?.[0]?.id || null,
                            is_bank: !!m.roles.bank,
                        }));
                        setPeople(ps);
                    } else {
                        // 3) Fallback: RPC already scoped to company
                        const roster = await supabase.rpc('list_company_people', { p_company_id: cid || '' });
                        const ps: Person[] =
                            (roster.data as unknown as Array<{ user_id: string; full_name: string | null; home_id: string | null; is_bank: boolean }> | null)?.map((r) => ({
                                id: r.user_id,
                                name: r.full_name || r.user_id.slice(0, 8),
                                home_id: r.home_id,
                                is_bank: r.is_bank,
                            })) ?? [];
                        setPeople(ps);
                    }
                } else if (isManager && uid) {
                    // === MANAGER VIEW ===
                    const mh = await supabase
                        .from('home_memberships')
                        .select('home_id')
                        .eq('user_id', uid)
                        .eq('role', 'MANAGER');

                    const managedHomeIds = (mh.data as unknown as Array<{ home_id: string }> | null)?.map(x => x.home_id) ?? [];

                    const h = await supabase
                        .from('homes')
                        .select('id,name')
                        .in('id', managedHomeIds);

                    setHomes(((h.data as unknown as { id: string; name: string }[]) || []).map(x => ({ id: x.id, name: x.name })));

                    let ps: Person[] = [];
                    try {
                        const dirRes = await fetch('/api/self/members/list');
                        if (dirRes.ok) {
                            const data = await dirRes.json();
                            const members = (data?.members || []) as MemberFromAPI[];
                            const mset = new Set(managedHomeIds);

                            const filtered = members.filter(m =>
                                (m.roles.staff_home?.id && mset.has(m.roles.staff_home.id)) ||
                                (m.roles.manager_homes || []).some(hh => mset.has(hh.id))
                            );

                            ps = filtered.map(m => ({
                                id: m.id,
                                name: m.full_name || m.email || m.id.slice(0, 8),
                                home_id: m.roles.staff_home?.id || m.roles.manager_homes?.[0]?.id || null,
                                is_bank: false,
                            }));
                        } else {
                            const hm2 = await supabase
                                .from('home_memberships')
                                .select('user_id, home_id, role')
                                .in('home_id', managedHomeIds);

                            const rows = (hm2.data as unknown as Array<{ user_id: string; home_id: string; role: string }> | null) ?? [];
                            const ids = Array.from(new Set(rows.map(r => r.user_id)));
                            const nameMap = await getProfilesNameMap(ids);

                            const seen = new Set<string>();
                            ps = [];
                            for (const r of rows) {
                                if (seen.has(r.user_id)) continue;
                                seen.add(r.user_id);
                                ps.push({
                                    id: r.user_id,
                                    name: nameMap.get(r.user_id) || r.user_id.slice(0, 8),
                                    home_id: r.home_id,
                                    is_bank: false,
                                });
                            }
                        }
                    } catch {
                        // ignore
                    }

                    // Always allow inviting myself (explicit requirement)
                    if (!ps.some(p => p.id === uid)) {
                        ps.unshift({ id: uid, name: 'Me', home_id: managedHomeIds[0] || null, is_bank: false });
                    }

                    setPeople(ps);
                }
            } catch (e) {
                const msg = (e as { message?: string })?.message ?? 'Failed to load';
                setErr(msg);
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid, level]);

    async function loadSessions(cid: string | null) {
        let qy = supabase
            .from('training_sessions')
            .select('*, courses(*)')
            .order('starts_at', { ascending: true });

        if (cid) qy = qy.eq('company_id', cid);
        if (from) qy = qy.gte('starts_at', from);
        if (to) qy = qy.lte('starts_at', to);

        const r = await qy;
        if (!r.error) {
            const list = (r.data as unknown as (Session & { courses?: Course | null })[]) || [];
            setSessions(list);
            await loadCounts(list.map((s) => s.id));
        }
    }

    async function loadCounts(sessionIds: string[]) {
        if (sessionIds.length === 0) {
            setCounts({});
            return;
        }
        const att = await supabase
            .from('training_session_attendees')
            .select('session_id,status')
            .in('session_id', sessionIds);
        if (att.error) return;

        const next: typeof counts = {};
        (att.data as unknown as Array<{ session_id: string; status: AttendeeStatus }> | null)?.forEach(a => {
            const sid = a.session_id;
            if (!next[sid]) next[sid] = { confirmed: 0, pending: 0, waitlist: 0 };
            if (a.status === 'CONFIRMED') next[sid].confirmed++;
            else if (a.status === 'WAITLISTED') next[sid].waitlist++;
            else if (a.status === 'INVITED' || a.status === 'BOOKED') next[sid].pending++;
        });
        setCounts(next);
    }

    const {
        upcomingFiltered,
        pastFiltered
    } = useMemo(() => {
        const query = q.trim().toLowerCase();
        let items = [...sessions];

        if (query) {
            items = items.filter(s =>
                (s.courses?.name || '').toLowerCase().includes(query) ||
                (s.location || '').toLowerCase().includes(query)
            );
        }

        const now = Date.now();

        const upcoming = items
            .filter(s => s.starts_at && new Date(s.starts_at).getTime() >= now)
            .sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || ''));

        const past = items
            .filter(s => !s.starts_at || new Date(s.starts_at).getTime() < now)
            .sort((a, b) => (b.starts_at || '').localeCompare(a.starts_at || ''));

        return { upcomingFiltered: upcoming, pastFiltered: past };
    }, [sessions, q]);

    async function openCreate() {
        setForm({
            course_id: '',
            date: '',
            start_time: '',
            end_time: '',
            confirm_deadline: '',
            capacity: '',
            location: '',
            notes: '',
        });
        setOpenNew(true);
    }

    async function createSession(e: React.FormEvent) {
        e.preventDefault();
        if (!companyId) return alert('No company in scope.');
        if (!form.course_id) return alert('Pick a course.');
        if (!form.date || !form.start_time) return alert('Pick date and start time.');
        if (form.capacity === '' || Number(form.capacity) <= 0) return alert('Capacity must be a positive number (schema requires it).');

        setSaving(true);
        try {
            const starts_at = new Date(`${form.date}T${form.start_time}:00`).toISOString();
            const ends_at = form.end_time ? new Date(`${form.date}T${form.end_time}:00`).toISOString() : null;
            const confirm_deadline = form.confirm_deadline ? new Date(`${form.confirm_deadline}T23:59:59`).toISOString() : null;

            const ins = await supabase.from('training_sessions').insert({
                company_id: companyId,
                course_id: form.course_id,
                starts_at,
                ends_at,
                confirm_deadline,
                capacity: Number(form.capacity),
                location: form.location || null,
                notes: form.notes || null,
                status: 'SCHEDULED',
            }).select('id').single();
            if (ins.error) throw ins.error;

            setOpenNew(false);
            await loadSessions(companyId);
        } catch (e) {
            alert((e as { message?: string })?.message || 'Failed to create session');
        } finally {
            setSaving(false);
        }
    }

    // Delete with inline confirmation
    async function deleteSessionFinal(id: string) {
        const { error } = await supabase.from('training_sessions').delete().eq('id', id);
        if (error) { alert(error.message); return; }
        setPendingDelete(null);
        await loadSessions(companyId);
    }

    async function viewRosterCSV(session: Session) {
        const att = await supabase
            .from('training_session_attendees')
            .select('*')
            .eq('session_id', session.id);

        if (att.error) {
            alert(att.error.message);
            return;
        }

        const rawAtt = (att.data as unknown as Attendee[]) || [];
        const ids = Array.from(new Set(rawAtt.map((a) => a.user_id)));

        // 1) Directory (names + emails)
        const directory = await getPeopleDirectoryMap();

        // 2) Fallback names from profiles (email not in profiles schema)
        const missingForNames = ids.filter(id => !directory.get(id)?.full_name);
        const nameFallback = await getProfilesNameMap(missingForNames);

        const rows = rawAtt.map((a) => {
            const d = directory.get(a.user_id);
            const full_name = (d?.full_name ?? nameFallback.get(a.user_id)) || '';
            const email = d?.email || '';

            return {
                SessionId: session.id,
                Course: session.courses?.name || '',
                StartsAt: session.starts_at,
                EndsAt: session.ends_at || '',
                Location: session.location || '',
                UserId: a.user_id,
                Name: full_name,
                Email: email,
                Status: a.status,
                InvitedAt: a.invited_at || '',
                BookedAt: a.booked_at || '',
                ConfirmedAt: a.confirmed_at || '',
                CancelledAt: a.cancelled_at || '',
                AttendedAt: a.attended_at || '',
                CompletedAt: a.completed_at || '',
                NoShowAt: a.noshow_at || '',
            };
        });

        const header = Object.keys(rows[0] || {
            SessionId: '', Course: '', StartsAt: '', EndsAt: '', Location: '',
            UserId: '', Name: '', Email: '', Status: '',
            InvitedAt: '', BookedAt: '', ConfirmedAt: '', CancelledAt: '',
            AttendedAt: '', CompletedAt: '', NoShowAt: '',
        });

        const csv = [
            header.join(','),
            ...rows.map(r => header.map(h => `"${String((r as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(',')),
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_roster_${session.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function openInvite(s: Session) {
        setInviteSelected([]);
        setInviteOpen(s);
    }

    async function sendInvites() {
        if (!inviteOpen || inviteSelected.length === 0) return;

        const { data, error } = await supabase.rpc('invite_to_training_session_v2', {
            p_session: inviteOpen.id,
            p_user_ids: inviteSelected,
        });

        if (error) {
            alert('Invite failed: ' + (error.message || String(error)));
            return;
        }

        const a = (data as Record<string, unknown> | null)?.['attendees_inserted'] as number | undefined ?? 0;
        const r = (data as Record<string, unknown> | null)?.['reinvited'] as number | undefined ?? 0;
        const n = (data as Record<string, unknown> | null)?.['notifications'] as number | undefined ?? 0;

        setFlash(`Invites sent: ${n} (new ${a}${r ? `, reinvited ${r}` : ''})`);
        // auto clear after 4s
        window.setTimeout(() => setFlash(null), 4000);

        setInviteOpen(null);
        await loadSessions(companyId);
    }

    if (loading) return <p>Loading…</p>;

    return (
        <div className="space-y-4">

            {/* small inline success banner */}
            {flash && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
                    {flash}
                </div>
            )}

            {/* Filters + actions */}
            <div className="rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm p-3">
                <div className="grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div className="md:col-span-3">
                        <label className="block text-xs text-gray-600 mb-1">Search</label>
                        <input
                            className="w-full border rounded-lg px-3 py-2"
                            value={q}
                            onChange={e => setQ(e.target.value)}
                            placeholder="Course or location"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">From (date)</label>
                        <input type="date" className="w-full border rounded-lg px-3 py-2" value={from} onChange={e => setFrom(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-600 mb-1">To (date)</label>
                        <input type="date" className="w-full border rounded-lg px-3 py-2" value={to} onChange={e => setTo(e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Company</label>
                        <div className="flex gap-2">
                            <input className="w-full border rounded-lg px-3 py-2" value={companyName || companyId} readOnly />
                            <button onClick={() => loadSessions(companyId)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                                Refresh
                            </button>
                        </div>
                    </div>
                    <div className="md:col-span-1 flex md:justify-end">
                        <button onClick={openCreate} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 w-full md:w-auto">
                            New session
                        </button>
                    </div>
                </div>
                {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
            </div>
            {/* Upcoming sessions table */}
            <div className="overflow-x-auto rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="text-left p-2">Course</th>
                            <th className="text-left p-2">When</th>
                            <th className="text-left p-2">Where</th>
                            <th className="text-left p-2">Capacity</th>
                            <th className="text-left p-2">Confirmed</th>
                            <th className="text-left p-2">Pending</th>
                            <th className="text-left p-2">Waitlist</th>
                            <th className="p-2 text-center">Actions</th>
                            <th className="p-2">Roster</th>
                        </tr>
                    </thead>
                    <tbody>
                        {upcomingFiltered.map(s => {
                            const c = counts[s.id] || { confirmed: 0, pending: 0, waitlist: 0 };
                            const deleting = pendingDelete === s.id;
                            return (
                                <tr key={s.id} className="border-t">
                                    <td className="p-2">{s.courses?.name || '—'}</td>
                                    <td className="p-2">
                                        {fmtWhen(s.starts_at, s.ends_at)}
                                        {s.confirm_deadline ? (
                                            <div className="text-xs text-gray-600">
                                                Confirm by {new Date(s.confirm_deadline).toLocaleDateString()}
                                            </div>
                                        ) : null}
                                    </td>
                                    <td className="p-2">{s.location || '—'}</td>
                                    <td className="p-2">{s.capacity}</td>
                                    <td className="p-2">{c.confirmed}</td>
                                    <td className="p-2">{c.pending}</td>
                                    <td className="p-2">{c.waitlist}</td>
                                    <td className="p-2 text-center">
                                        <div className="inline-flex items-center gap-2">
                                            {!deleting ? (
                                                <>
                                                    <button onClick={() => viewRosterCSV(s)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
                                                        Export CSV
                                                    </button>
                                                    <button onClick={() => openInvite(s)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
                                                        Invite
                                                    </button>
                                                    <button onClick={() => setPendingDelete(s.id)} className="rounded border border-rose-300 text-rose-700 px-2 py-1 text-xs hover:bg-rose-50">
                                                        Delete
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button onClick={() => deleteSessionFinal(s.id)} className="rounded px-2 py-1 text-xs text-white bg-rose-600 hover:bg-rose-700">
                                                        Delete
                                                    </button>
                                                    <button onClick={() => setPendingDelete(null)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
                                                        Cancel
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-2">
                                        <RosterButton session={s} onChanged={() => { void loadSessions(companyId); }} />
                                    </td>
                                </tr>
                            );
                        })}
                        {upcomingFiltered.length === 0 && (
                            <tr>
                                <td colSpan={9} className="p-3 text-sm text-gray-600">
                                    No upcoming sessions.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Past sessions (scrollable box) */}
            <div className="rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm">
                <div className="flex items-center justify-between px-3 py-2">
                    <h3 className="text-sm font-semibold">Past sessions</h3>
                    <span className="text-xs text-gray-600">
                        {pastFiltered.length} {pastFiltered.length === 1 ? 'session' : 'sessions'}
                    </span>
                </div>

                {/* cap the height; scroll inside */}
                <div className="max-h-96 overflow-y-auto border-t">
                    <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50 text-gray-600">
                            <tr>
                                <th className="text-left p-2">Course</th>
                                <th className="text-left p-2">When</th>
                                <th className="text-left p-2">Where</th>
                                <th className="text-left p-2">Capacity</th>
                                <th className="text-left p-2">Confirmed</th>
                                <th className="text-left p-2">Pending</th>
                                <th className="text-left p-2">Waitlist</th>
                                <th className="p-2">Roster</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pastFiltered.map(s => {
                                const c = counts[s.id] || { confirmed: 0, pending: 0, waitlist: 0 };
                                return (
                                    <tr key={s.id} className="border-t">
                                        <td className="p-2">{s.courses?.name || '—'}</td>
                                        <td className="p-2">{fmtWhen(s.starts_at, s.ends_at)}</td>
                                        <td className="p-2">{s.location || '—'}</td>
                                        <td className="p-2">{s.capacity}</td>
                                        <td className="p-2">{c.confirmed}</td>
                                        <td className="p-2">{c.pending}</td>
                                        <td className="p-2">{c.waitlist}</td>
                                        <td className="p-2">
                                            <RosterButton session={s} onChanged={() => { void loadSessions(companyId); }} />
                                        </td>
                                    </tr>
                                );
                            })}
                            {pastFiltered.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="p-3 text-sm text-gray-600">
                                        No past sessions match your filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create modal */}
            {openNew && (
                <Modal title="Create training session" onClose={() => setOpenNew(false)}>
                    <form onSubmit={createSession} className="space-y-3">
                        <div>
                            <label className="block text-sm mb-1">Course</label>
                            <select
                                className="w-full border rounded-lg px-3 py-2"
                                value={form.course_id}
                                onChange={e => setForm({ ...form, course_id: e.target.value })}
                                required
                            >
                                <option value="">Select…</option>
                                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-sm mb-1">Date</label>
                                <input
                                    type="date"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={form.date}
                                    onChange={e => setForm({ ...form, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Start time</label>
                                <input
                                    type="time"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={form.start_time}
                                    onChange={e => setForm({ ...form, start_time: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">End time (optional)</label>
                                <input
                                    type="time"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={form.end_time}
                                    onChange={e => setForm({ ...form, end_time: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Confirm by (optional)</label>
                                <input
                                    type="date"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={form.confirm_deadline}
                                    onChange={e => setForm({ ...form, confirm_deadline: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm mb-1">Capacity</label>
                                <input
                                    type="number"
                                    min={1}
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={form.capacity}
                                    onChange={e =>
                                        setForm({
                                            ...form,
                                            capacity: e.target.value === '' ? '' : Number(e.target.value),
                                        })
                                    }
                                    placeholder="e.g., 30"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Location</label>
                                <input
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={form.location}
                                    onChange={e => setForm({ ...form, location: e.target.value })}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Notes</label>
                            <textarea
                                className="w-full border rounded-lg px-3 py-2"
                                rows={3}
                                value={form.notes}
                                onChange={e => setForm({ ...form, notes: e.target.value })}
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                disabled={saving}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                            >
                                {saving ? 'Creating…' : 'Create session'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpenNew(false)}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Invite modal */}
            {inviteOpen && (
                <Modal
                    title={`Invite to: ${inviteOpen.courses?.name || 'Session'}`}
                    onClose={() => setInviteOpen(null)}
                >
                    <div className="space-y-3">
                        <PeoplePicker
                            people={people}
                            homesById={homesById}
                            selected={inviteSelected}
                            onChange={setInviteSelected}
                            placeholder="Search staff & managers…"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => void sendInvites()}
                                disabled={inviteSelected.length === 0}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                            >
                                Send invites ({inviteSelected.length})
                            </button>
                            <button
                                onClick={() => setInviteOpen(null)}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Close
                            </button>
                        </div>
                        <p className="text-xs text-gray-600">
                            Invites create <code>INVITED</code> rows. Staff/managers confirm via “My bookings”.
                            Capacity is enforced on confirm; extras go to waitlist.
                        </p>
                    </div>
                </Modal>
            )}
        </div>
    );
}

/* === Roster drawer (confirmed attendees only; names + emails; no popups) === */

function RosterButton({
    session,
    onChanged,
}: {
    session: Session;
    onChanged: () => void;
}) {
    type RosterRow = Attendee & { full_name?: string | null; email?: string | null };
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<RosterRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // staged remove by user_id
    const [stagedRemove, setStagedRemove] = useState<Record<string, boolean>>({});

    async function load() {
        setLoading(true);
        setErr(null);
        try {
            // Only show confirmed attendees
            const att = await supabase
                .from('training_session_attendees')
                .select('session_id,user_id,status,confirmed_at,invited_at,booked_at,cancelled_at,attended_at,completed_at,noshow_at')
                .eq('session_id', session.id)
                .eq('status', 'CONFIRMED');

            if (att.error) throw att.error;

            const list = (att.data as unknown as Attendee[]) || [];
            const ids = Array.from(new Set(list.map(a => a.user_id)));

            // 1) Directory (email + name)
            const directory = await getPeopleDirectoryMap();

            // 2) Fallback names from profiles
            const missingForNames = ids.filter(id => !directory.get(id)?.full_name);
            const nameFallback = await getProfilesNameMap(missingForNames);

            const merged: RosterRow[] = list.map(a => {
                const d = directory.get(a.user_id);
                return {
                    ...a,
                    full_name: (d?.full_name ?? nameFallback.get(a.user_id)) ?? null,
                    email: d?.email ?? null,
                };
            });

            setRows(merged);
            setStagedRemove({});
        } catch (e) {
            const msg = (e as { message?: string })?.message ?? 'Failed to load roster';
            setErr(msg);
        } finally {
            setLoading(false);
        }
    }

    async function removeFinal(user_id: string) {
        const { error } = await supabase
            .from('training_session_attendees')
            .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
            .eq('session_id', session.id)
            .eq('user_id', user_id);
        if (error) {
            alert(error.message);
            return;
        }
        await load();
        onChanged();
    }

    return (
        <>
            <button
                onClick={async () => {
                    setOpen(true);
                    await load();
                }}
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
            >
                View roster
            </button>
            {open && (
                <Modal title={`Roster — ${session.courses?.name || ''}`} onClose={() => setOpen(false)}>
                    {loading ? (
                        <p>Loading…</p>
                    ) : (
                        <div className="space-y-3">
                            <div className="overflow-x-auto rounded border">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50 text-gray-600">
                                        <tr>
                                            <th className="text-left p-2">Name</th>
                                            <th className="text-left p-2">Email</th>
                                            <th className="text-left p-2">Status</th>
                                            <th className="p-2 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(a => {
                                            const isStaged = stagedRemove[a.user_id];
                                            return (
                                                <tr key={`${a.session_id}-${a.user_id}`} className="border-t">
                                                    <td className="p-2">{a.full_name || a.user_id.slice(0, 8)}</td>
                                                    <td className="p-2">{a.email || '—'}</td>
                                                    <td className="p-2">{a.status}</td>
                                                    <td className="p-2 text-center">
                                                        <div className="inline-flex items-center gap-2">
                                                            {!isStaged ? (
                                                                <button
                                                                    onClick={() => setStagedRemove(p => ({ ...p, [a.user_id]: true }))}
                                                                    className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                                >
                                                                    Remove
                                                                </button>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={() => void removeFinal(a.user_id)}
                                                                        className="rounded px-2 py-1 text-xs text-white bg-rose-600 hover:bg-rose-700"
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setStagedRemove(p => ({ ...p, [a.user_id]: false }))}
                                                                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {rows.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="p-3 text-sm text-gray-600">
                                                    No confirmed attendees yet.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {err && <div className="text-sm text-rose-600">{err}</div>}
                            <div className="text-xs text-gray-600">
                                Removing sets <code>CANCELLED</code>. Your waitlist promotion trigger (if any) will take care of upgrades.
                            </div>
                        </div>
                    )}
                </Modal>
            )}
        </>
    );
}

/* ========================= SETTINGS — monitored courses (unchanged) ========================= */

function SettingsSection() {
    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');

    const [companyId, setCompanyId] = useState<string>('');
    const [companyName, setCompanyName] = useState<string>('');

    // All company courses
    const [courses, setCourses] = useState<Course[]>([]);

    // Monitored cohort courses: course_id -> group_size
    const [cohort, setCohort] = useState<Record<string, number>>({});

    // UI state
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    // Add form
    const [addCourseId, setAddCourseId] = useState<string>('');
    const [addGroupSize, setAddGroupSize] = useState<number | ''>(10);
    const [adding, setAdding] = useState(false);

    // Row-level states
    const [rowSaving, setRowSaving] = useState<Record<string, boolean>>({});
    const [rowErr, setRowErr] = useState<Record<string, string | null>>({});
    const [rowOk, setRowOk] = useState<Record<string, string | null>>({});

    // Delete confirm
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    /* ===== Suggested groups state (NEW) ===== */
    type SuggestedGroup = {
        company_id: string;
        course_id: string;
        group_num: number;
        earliest_due: string | null;
        latest_due: string | null;
        user_ids: string[];
        count: number;
    };

    const [suggested, setSuggested] = useState<SuggestedGroup[]>([]);
    const [sgLoading, setSgLoading] = useState(false);
    const [sgErr, setSgErr] = useState<string | null>(null);

    // create-session modal for a selected suggestion
    const [createOpen, setCreateOpen] = useState<null | SuggestedGroup>(null);
    const [createSaving, setCreateSaving] = useState(false);
    const [createForm, setCreateForm] = useState<{
        date: string;
        time: string;
        location: string;
        capacity: number | '';
        confirmDays: number | '';
    }>({
        date: '',
        time: '10:00',
        location: '',
        capacity: '',
        confirmDays: '',
    });

    useEffect(() => {
        (async () => {
            const [{ data: u }, lvl] = await Promise.all([supabase.auth.getUser(), getEffectiveLevel()]);
            setUid(u.user?.id ?? null);
            setLevel((lvl as Level) || '4_STAFF');
        })();
    }, []);

    useEffect(() => {
        (async () => {
            if (!uid) return;
            setLoading(true);
            setErr(null);
            setOk(null);
            try {
                // Scope
                const cid = await resolveCompanyIdForUser(uid, level);
                if (!cid) throw new Error('No company in scope.');
                setCompanyId(cid);

                // Company name
                const co = await supabase.from('companies').select('name').eq('id', cid).maybeSingle();
                if (!co.error) setCompanyName(co.data?.name || cid);

                // All courses
                const cr = await supabase.from('courses').select('*').eq('company_id', cid).order('name');
                if (cr.error) throw cr.error;
                setCourses((cr.data as unknown as Course[]) || []);

                // Monitored course settings (company-level)
                const ms = await supabase
                    .from('training_monitored_courses')
                    .select('course_id, is_monitored, threshold, suggest_capacity, lookahead_days')
                    .eq('company_id', cid);

                if (ms.error && (ms.error as { code?: string }).code !== '42P01') throw ms.error;

                const monitoredByCourse = new Map<
                    string,
                    { is_monitored: boolean; threshold: number | null; suggest_capacity: number | null; lookahead_days: number | null }
                >();
                (ms.data as unknown as Array<{
                    course_id: string;
                    is_monitored: boolean | null;
                    threshold: number | null;
                    suggest_capacity: number | null;
                    lookahead_days: number | null;
                }> | null)?.forEach(r => {
                    monitoredByCourse.set(r.course_id, {
                        is_monitored: !!r.is_monitored,
                        threshold: r.threshold ?? null,
                        suggest_capacity: r.suggest_capacity ?? null,
                        lookahead_days: r.lookahead_days ?? null,
                    });
                });

                setCohort(
                    Object.fromEntries(
                        Array.from(monitoredByCourse.entries()).map(([cid2, v]) => [cid2, v.suggest_capacity ?? 10]),
                    ),
                );

                /* ---- Suggestions loader (ALL suggestions, no monitored/course filter) ---- */
                setSgLoading(true);
                setSgErr(null);
                try {
                    const sRes = await supabase
                        .from('training_demand_groups_v2')
                        .select('*')
                        .eq('company_id', cid)
                        .order('earliest_due', { ascending: true });

                    let rows: SuggestedGroup[] = [];
                    if ((sRes.error as { code?: string } | null)?.code === '42P01') {
                        const old = await supabase.from('training_demand_groups_v').select('*').eq('company_id', cid);
                        if (!old.error) {
                            rows = ((old.data as unknown[]) || [])
                                .sort((a, b) => {
                                    const ad = (a as { earliest_due?: string | null }).earliest_due || '';
                                    const bd = (b as { earliest_due?: string | null }).earliest_due || '';
                                    return ad.localeCompare(bd) ||
                                        String((a as { course_id: string }).course_id).localeCompare(
                                            String((b as { course_id: string }).course_id),
                                        );
                                })
                                .map((r, i) => ({
                                    company_id: (r as { company_id: string }).company_id,
                                    course_id: (r as { course_id: string }).course_id,
                                    group_num: i + 1,
                                    earliest_due: (r as { earliest_due?: string | null }).earliest_due ?? null,
                                    latest_due: (r as { latest_due?: string | null }).latest_due ?? null,
                                    user_ids: ((r as { user_ids?: string[] | null }).user_ids ?? []) as string[],
                                    count: Number((r as { count?: number | null }).count ?? 0),
                                })) as SuggestedGroup[];
                        } else {
                            setSuggested([]);
                            setSgErr((old.error as { message?: string }).message ?? 'Failed to load suggestions');
                        }
                    } else if (!sRes.error) {
                        rows = (sRes.data as unknown as SuggestedGroup[]) || [];
                    } else {
                        setSuggested([]);
                        setSgErr((sRes.error as { message?: string }).message ?? 'Failed to load suggestions');
                    }

                    setSuggested(rows);
                } finally {
                    setSgLoading(false);
                }
            } catch (e) {
                const msg = (e as { message?: string })?.message ?? 'Failed to load settings';
                setErr(msg);
            } finally {
                setLoading(false);
            }
        })();
    }, [uid, level]);

    function availableCoursesForAdd() {
        const monitored = new Set(Object.keys(cohort));
        return courses.filter(c => !monitored.has(c.id));
    }

    function setRowBusy(course_id: string, busy: boolean) {
        setRowSaving(prev => ({ ...prev, [course_id]: busy }));
    }
    function setRowMessage(course_id: string, okMsg?: string | null, errMsg?: string | null) {
        setRowOk(prev => ({ ...prev, [course_id]: okMsg || null }));
        setRowErr(prev => ({ ...prev, [course_id]: errMsg || null }));
        if (okMsg) setTimeout(() => setRowOk(prev => ({ ...prev, [course_id]: null })), 1800);
    }

    async function tryRebuild(course_id: string, group_size: number) {
        let r = await supabase.rpc('rebuild_training_cohorts_for_course', {
            p_company_id: companyId,
            p_course_id: course_id,
            p_group_size: group_size,
        } as unknown);
        if (!('error' in r) || !r.error) return;

        r = await supabase.rpc('build_training_cohorts', {
            p_company_id: companyId,
            p_course_id: course_id,
            p_group_size: group_size,
        } as unknown);
        // swallow errors
    }

    async function tryClear(course_id: string) {
        await supabase.rpc('clear_training_cohorts_for_course', {
            p_company_id: companyId,
            p_course_id: course_id,
        } as unknown);
    }

    async function addMonitoredCourse() {
        if (!companyId || !addCourseId || addGroupSize === '' || Number(addGroupSize) < 2) {
            setOk(null);
            setErr('Pick a course and a group size (≥ 2).');
            return;
        }
        setAdding(true);
        setErr(null);
        setOk(null);
        try {
            const size = Number(addGroupSize);

            const up = await supabase
                .from('training_monitored_courses')
                .upsert(
                    {
                        company_id: companyId,
                        course_id: addCourseId,
                        is_monitored: true,
                        threshold: size,
                        suggest_capacity: size,
                    },
                    { onConflict: 'company_id,course_id' },
                );

            if ((up.error as { code?: string } | null)?.code && up.error?.code !== '42P01') throw up.error;

            setCohort(prev => ({ ...prev, [addCourseId]: size }));

            await tryRebuild(addCourseId, size);

            setAddCourseId('');
            setAddGroupSize(10);
            setOk('Monitored course added & cohorts built.');
        } catch (e) {
            setErr((e as { message?: string })?.message ?? 'Failed to add monitored course');
        } finally {
            setAdding(false);
        }
    }

    async function saveRow(course_id: string) {
        const group_size = Math.max(2, Number(cohort[course_id]) || 10);
        setRowBusy(course_id, true);
        setRowMessage(course_id, null, null);
        try {
            const up = await supabase
                .from('training_monitored_courses')
                .upsert(
                    {
                        company_id: companyId,
                        course_id,
                        is_monitored: true,
                        suggest_capacity: group_size,
                        threshold: group_size,
                    },
                    { onConflict: 'company_id,course_id' },
                );
            if ((up.error as { code?: string } | null)?.code && up.error?.code !== '42P01') throw up.error;

            await tryRebuild(course_id, group_size);
            setRowMessage(course_id, 'Saved & rebuilt.');
        } catch (e) {
            setRowMessage(course_id, null, (e as { message?: string })?.message ?? 'Failed to save');
        } finally {
            setRowBusy(course_id, false);
        }
    }

    async function deleteRowFinal(course_id: string) {
        setRowBusy(course_id, true);
        setRowMessage(course_id, null, null);
        try {
            const del = await supabase
                .from('training_monitored_courses')
                .delete()
                .eq('company_id', companyId)
                .eq('course_id', course_id);
            if ((del.error as { code?: string } | null)?.code && del.error?.code !== '42P01') throw del.error;

            await tryClear(course_id);

            setCohort(prev => {
                const next = { ...prev };
                delete next[course_id];
                return next;
            });
            setPendingDelete(null);
            setRowMessage(course_id, 'Deleted.');
        } catch (e) {
            setRowMessage(course_id, null, (e as { message?: string })?.message ?? 'Failed to delete');
        } finally {
            setRowBusy(course_id, false);
        }
    }

    function openCreateFromSuggestion(sg: SuggestedGroup) {
        let datePref = '';
        if (sg.earliest_due) {
            const d = new Date(sg.earliest_due);
            d.setDate(d.getDate() - 14);
            datePref = d.toISOString().slice(0, 10);
        }
        setCreateForm({
            date: datePref,
            time: '10:00',
            location: '',
            capacity: '',
            confirmDays: '',
        });
        setCreateOpen(sg);
    }

    async function createSessionFromSuggestion() {
        if (!createOpen) return;
        if (!companyId) return alert('No company in scope.');
        if (!createForm.date || !createForm.time) return alert('Pick date and time.');

        setCreateSaving(true);
        try {
            const starts_at = new Date(`${createForm.date}T${createForm.time}:00`).toISOString();
            const { error } = await supabase.rpc('create_training_session_for_group', {
                p_company_id: companyId,
                p_course_id: createOpen.course_id,
                p_group_num: createOpen.group_num,
                p_starts_at: starts_at,
                p_location: createForm.location || null,
                p_capacity: createForm.capacity === '' ? null : Number(createForm.capacity),
                p_confirm_days: createForm.confirmDays === '' ? null : Number(createForm.confirmDays),
            } as unknown);

            if (error) throw error;

            setCreateOpen(null);
            setSgLoading(true);
            const sRes = await supabase
                .from('training_demand_groups_v2')
                .select('*')
                .eq('company_id', companyId)
                .order('earliest_due', { ascending: true });
            if (!sRes.error) setSuggested((sRes.data as unknown as SuggestedGroup[]) || []);
            setSgLoading(false);

            alert('Session created and invites sent.');
        } catch (e) {
            alert((e as { message?: string })?.message ?? 'Failed to create session');
        } finally {
            setCreateSaving(false);
        }
    }

    if (loading) return <p>Loading…</p>;

    const addChoices = availableCoursesForAdd();
    const suggestedFiltered = suggested; // no client-side filtering

    return (
        <section className="space-y-4">
            {/* ===== Monitored courses (existing) ===== */}
            <div className="rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm p-4">
                <h2 className="text-base font-semibold mb-2">Monitored courses (cohorts)</h2>

                <div className="text-xs text-gray-600 mb-3">
                    Company:&nbsp;<span className="font-medium">{companyName || companyId}</span>
                </div>

                {/* Add new monitored course */}
                <div className="mb-3 flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="sm:w-80">
                        <label className="block text-xs text-gray-600 mb-1">Course</label>
                        <select
                            className="w-full border rounded-lg px-3 py-2"
                            value={addCourseId}
                            onChange={e => setAddCourseId(e.target.value)}
                        >
                            <option value="">Select…</option>
                            {addChoices.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="sm:w-40">
                        <label className="block text-xs text-gray-600 mb-1">Group size</label>
                        <input
                            type="number"
                            min={2}
                            className="w-full border rounded-lg px-3 py-2"
                            value={addGroupSize}
                            onChange={e => setAddGroupSize(e.target.value === '' ? '' : Number(e.target.value))}
                            placeholder="e.g., 10"
                        />
                    </div>
                    <div>
                        <button
                            onClick={() => void addMonitoredCourse()}
                            disabled={adding || !addCourseId || addGroupSize === '' || Number(addGroupSize) < 2}
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                        >
                            {adding ? 'Adding…' : 'Add monitored course'}
                        </button>
                    </div>
                </div>

                {/* List */}
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr>
                                <th className="text-left p-2">Course</th>
                                <th className="text-left p-2">Group size</th>
                                <th className="p-2 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.keys(cohort).length === 0 && (
                                <tr>
                                    <td colSpan={3} className="p-3 text-sm text-gray-600">
                                        No monitored courses yet.
                                    </td>
                                </tr>
                            )}
                            {Object.entries(cohort).map(([course_id, group_size]) => {
                                const c = courses.find(x => x.id === course_id);
                                const deleting = pendingDelete === course_id;
                                return (
                                    <tr key={course_id} className="border-t">
                                        <td className="p-2">{c?.name || course_id}</td>
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                min={2}
                                                className="w-28 border rounded px-2 py-1"
                                                value={group_size}
                                                onChange={e =>
                                                    setCohort(prev => ({
                                                        ...prev,
                                                        [course_id]:
                                                            e.target.value === ''
                                                                ? 2
                                                                : Math.max(2, Number(e.target.value) || 2),
                                                    }))
                                                }
                                            />
                                        </td>
                                        <td className="p-2 text-center">
                                            <div className="inline-flex items-center gap-2">
                                                {!deleting ? (
                                                    <>
                                                        <button
                                                            onClick={() => void saveRow(course_id)}
                                                            disabled={!!rowSaving[course_id]}
                                                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60"
                                                        >
                                                            {rowSaving[course_id] ? 'Saving…' : 'Update'}
                                                        </button>
                                                        <button
                                                            onClick={() => setPendingDelete(course_id)}
                                                            className="rounded border border-rose-300 text-rose-700 px-2 py-1 text-xs hover:bg-rose-50"
                                                        >
                                                            Delete
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => void deleteRowFinal(course_id)}
                                                            className="rounded px-2 py-1 text-xs text-white bg-rose-600 hover:bg-rose-700"
                                                        >
                                                            Delete
                                                        </button>
                                                        <button
                                                            onClick={() => setPendingDelete(null)}
                                                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                            {/* Row messages */}
                                            {rowErr[course_id] && (
                                                <div className="mt-1 text-xs text-rose-600">
                                                    {rowErr[course_id]}
                                                </div>
                                            )}
                                            {rowOk[course_id] && (
                                                <div className="mt-1 text-xs text-emerald-700">
                                                    {rowOk[course_id]}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Page-level messages */}
                <div className="mt-3 flex gap-2">
                    {err && <span className="text-sm text-rose-600">{err}</span>}
                    {ok && <span className="text-sm text-emerald-700">{ok}</span>}
                </div>

                <p className="mt-3 text-xs text-gray-600">
                    Adding or updating a monitored course will immediately rebuild cohorts. When a user’s{' '}
                    <em>training completion date</em> changes, we recommend a small DB trigger that calls the rebuild RPC for the
                    relevant course so groups stay fresh automatically.
                </p>
            </div>

            {/* ===== Suggested booking groups (NEW) ===== */}
            <div className="rounded-xl border bg-white ring-1 ring-gray-50 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold">Suggested booking groups</h2>
                </div>

                {sgErr && <div className="mb-2 text-sm text-rose-600">{sgErr}</div>}

                <div className="overflow-x-auto rounded-xl border bg-white ring-1 ring-gray-50">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr>
                                <th className="text-left p-2">Course</th>
                                <th className="text-left p-2">Group</th>
                                <th className="text-left p-2">People</th>
                                <th className="text-left p-2">Due window</th>
                                <th className="p-2 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sgLoading ? (
                                <tr>
                                    <td colSpan={5} className="p-3 text-sm text-gray-600">
                                        Loading…
                                    </td>
                                </tr>
                            ) : suggestedFiltered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-3 text-sm text-gray-600">
                                        No suggested groups.
                                    </td>
                                </tr>
                            ) : (
                                suggestedFiltered.map(sg => {
                                    const course = courses.find(c => c.id === sg.course_id);
                                    const name = course?.name || sg.course_id;
                                    const win = [
                                        sg.earliest_due ? new Date(sg.earliest_due).toLocaleDateString() : '—',
                                        sg.latest_due ? new Date(sg.latest_due).toLocaleDateString() : '—',
                                    ].join(' → ');
                                    return (
                                        <tr key={`${sg.course_id}-${sg.group_num}`} className="border-t">
                                            <td className="p-2">{name}</td>
                                            <td className="p-2">#{sg.group_num}</td>
                                            <td className="p-2">{sg.count}</td>
                                            <td className="p-2">{win}</td>
                                            <td className="p-2 text-center">
                                                <button
                                                    onClick={() => openCreateFromSuggestion(sg)}
                                                    className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                                >
                                                    Create session
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="mt-3 text-xs text-gray-600">
                    Groups are ordered by earliest due date. Use “Create session” to schedule and invite the whole group in one step.
                </p>
            </div>

            {/* ===== Create-from-suggestion modal (NEW) ===== */}
            {createOpen && (
                <Modal
                    title={`Create session — ${courses.find(c => c.id === createOpen.course_id)?.name || 'Course'}`}
                    onClose={() => setCreateOpen(null)}
                >
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-sm mb-1">Date</label>
                                <input
                                    type="date"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={createForm.date}
                                    onChange={e => setCreateForm({ ...createForm, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Time</label>
                                <input
                                    type="time"
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={createForm.time}
                                    onChange={e => setCreateForm({ ...createForm, time: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Capacity (optional)</label>
                                <input
                                    type="number"
                                    min={1}
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={createForm.capacity}
                                    onChange={e =>
                                        setCreateForm({
                                            ...createForm,
                                            capacity: e.target.value === '' ? '' : Number(e.target.value),
                                        })
                                    }
                                    placeholder="Leave blank to use suggested"
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Confirm days (optional)</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="w-full border rounded-lg px-3 py-2"
                                    value={createForm.confirmDays}
                                    onChange={e =>
                                        setCreateForm({
                                            ...createForm,
                                            confirmDays: e.target.value === '' ? '' : Number(e.target.value),
                                        })
                                    }
                                    placeholder="Blank = default"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm mb-1">Location</label>
                            <input
                                className="w-full border rounded-lg px-3 py-2"
                                value={createForm.location}
                                onChange={e => setCreateForm({ ...createForm, location: e.target.value })}
                                placeholder="e.g., Training Room"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => void createSessionFromSuggestion()}
                                disabled={createSaving}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                            >
                                {createSaving ? 'Creating…' : 'Create session & invite'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreateOpen(null)}
                                className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                        <p className="text-xs text-gray-600">
                            Confirm-by date is computed from defaults/overrides unless you set “Confirm days”.
                        </p>
                    </div>
                </Modal>
            )}
        </section>
    );
}

/* ========================= Small UI pieces ========================= */

function Modal({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 z-[200]">
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />
            <div className="absolute inset-0 grid place-items-center p-4">
                <div className="w-full max-w-2xl rounded-2xl border bg-white shadow-lg ring-1 ring-gray-50 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-base font-semibold">{title}</h3>
                        <button
                            onClick={onClose}
                            className="rounded-lg p-1 hover:bg-gray-50"
                            aria-label="Close"
                            type="button"
                        >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={2}>
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}

/* PeoplePicker (search + chips) */

function PeoplePicker({
    people,
    homesById,
    selected,
    onChange,
    placeholder = 'Search people…',
    disabled = false,
}: {
    people: { id: string; name: string; home_id?: string | null; is_bank?: boolean }[];
    homesById: Map<string, string>;
    selected: string[];
    onChange: (ids: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
}) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);

    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const list = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base = q ? people.filter(p => (p.name || '').toLowerCase().includes(q)) : people;
        return base.filter(p => !selectedSet.has(p.id)).slice(0, 50);
    }, [people, query, selectedSet]);

    function add(id: string) {
        onChange([...selected, id]);
        setQuery('');
        setOpen(false);
    }
    function remove(id: string) {
        onChange(selected.filter(x => x !== id));
    }

    return (
        <div className="space-y-2">
            {/* chips */}
            <div className="flex flex-wrap gap-2">
                {selected.map(id => {
                    const p = people.find(x => x.id === id);
                    const label = p ? p.name : id.slice(0, 8);
                    const ctx = p?.home_id ? homesById.get(p.home_id) : p?.is_bank ? 'Bank staff' : '—';
                    return (
                        <span key={id} className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs">
                            <span className="font-medium">{label}</span>
                            <span className="text-gray-500">({ctx || '—'})</span>
                            <button
                                type="button"
                                className="rounded border px-1"
                                onClick={() => remove(id)}
                                disabled={disabled}
                            >
                                ×
                            </button>
                        </span>
                    );
                })}
                {selected.length === 0 && <span className="text-xs text-gray-500">No one selected yet.</span>}
            </div>

            {/* input + dropdown */}
            <div className="relative max-w-lg">
                <input
                    disabled={disabled}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder={placeholder}
                    value={query}
                    onChange={e => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => requestAnimationFrame(() => setOpen(false))}
                    onKeyDown={e => {
                        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true);
                        if (!open) return;
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlight(h => Math.min(h + 1, list.length - 1));
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlight(h => Math.max(h - 1, 0));
                        }
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            if (list[highlight]) add(list[highlight].id);
                        }
                        if (e.key === 'Escape') {
                            setOpen(false);
                        }
                    }}
                />
                {open && list.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border bg-white shadow-lg ring-1 ring-gray-200 max-h-64 overflow-auto">
                        {list.map((p, i) => (
                            <button
                                key={p.id}
                                type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => add(p.id)}
                                className={`w-full text-left px-3 py-2 text-sm ${i === highlight ? 'bg-indigo-50' : 'hover:bg-gray-50'
                                    }`}
                            >
                                <div className="font-medium text-gray-900">{p.name}</div>
                                <div className="text-xs text-gray-500">
                                    {p.home_id ? homesById.get(p.home_id) : p.is_bank ? 'Bank staff' : '—'}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}


