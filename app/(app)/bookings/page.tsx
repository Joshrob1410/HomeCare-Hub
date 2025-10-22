'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

/* ========= Types (match schema.sql) ========= */

type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type Course = {
  id: string;
  company_id: string;
  name: string;
  refresher_years: number | null;
  training_type: string; // e.g., 'ELearning' | 'InPerson'
  mandatory: boolean;
  due_soon_days: number;
};

type SessionStatus = 'PUBLISHED' | 'CANCELLED' | 'DRAFT'; // PUBLISHED is what booking RPCs target

type Session = {
  id: string;
  company_id: string;
  course_id: string;
  starts_at: string;               // ISO
  ends_at: string | null;          // ISO
  confirm_deadline: string | null; // ISO
  capacity: number;
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
  attended_at: string | null;
  completed_at: string | null;
  noshow_at: string | null;
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

/* ========= Theme ========= */

const BRAND_GRADIENT =
  'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

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

    // NEW: admins and company can see Settings
    const canSeeSettings = isAdmin || isCompany;


  type Tab = 'MY' | 'SESSIONS' | 'TRACKING' | 'SETTINGS';
  const [tab, setTab] = useState<Tab>('MY');

    useEffect(() => {
        if (!canManage && tab === 'TRACKING') setTab('MY');   // staff can’t open Tracking
        if (!canSeeSettings && tab === 'SETTINGS') setTab('MY'); // staff/company rules for Settings
    }, [canManage, canSeeSettings, tab]);



  if (loadingLevel) {
    return (
      <div className="p-6" style={{ color: 'var(--sub)' }}>
        <div className="h-6 w-40 rounded mb-4 animate-pulse" style={{ background: 'var(--nav-item-bg)' }} />
        <div className="h-9 w-[520px] max-w-full rounded animate-pulse" style={{ background: 'var(--nav-item-bg)' }} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" style={{ color: 'var(--ink)' }}>
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Training bookings</h1>

      {/* Tabs */}
          <div className="flex gap-2">
              <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>My bookings</TabBtn>
              <TabBtn active={tab === 'SESSIONS'} onClick={() => setTab('SESSIONS')}>Sessions</TabBtn>
              {canManage && <TabBtn active={tab === 'TRACKING'} onClick={() => setTab('TRACKING')}>Tracking & Create Sessions</TabBtn>}
              {canSeeSettings && <TabBtn active={tab === 'SETTINGS'} onClick={() => setTab('SETTINGS')}>Settings</TabBtn>}
          </div>


      {tab === 'MY' && <MyBookings />}
      {tab === 'SESSIONS' && (
        <PublicSessions
          isAdmin={isAdmin}
          isCompany={isCompany}
          isManager={isManager}
        />
      )}
      {tab === 'TRACKING' && canManage && <TrackingTab isCompany={isCompany} isManager={isManager} />}
          {tab === 'SETTINGS' && canSeeSettings && <SettingsSection />}

      {/* Orbit-native control fixes */}
      <style jsx global>{`
        /* ===== MyBookings row tones (color cells, not <tr>) ===== */
tr.booking-row--confirmed > td { background-color: #ecfdf5; }   /* light */
tr.booking-row--cancelled > td { background-color: #fff1f2; }   /* light */
tr.booking-row--pending  > td { background-color: #fffbeb; }    /* light */

/* Orbit overrides: darker, calmer tints */
[data-orbit='1'] tr.booking-row--confirmed > td { background-color: rgba(16,185,129,0.18); }  /* emerald */
[data-orbit='1'] tr.booking-row--cancelled > td { background-color: rgba(244,63,94,0.16); }   /* rose */
[data-orbit='1'] tr.booking-row--pending  > td { background-color: rgba(234,179,8,0.14); }    /* amber */

      `}</style>
    </div>
  );
}

function TabBtn(
  { active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
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

/* ========================= Helpers ========================= */

// Company scoping (admin → first company)
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
  const cm = await supabase.from('company_memberships').select('company_id').eq('user_id', uid).maybeSingle();
  if (cm.data?.company_id) return cm.data.company_id;
  const hm = await supabase.from('home_memberships').select('home_id').eq('user_id', uid).limit(1).maybeSingle();
  if (hm.data?.home_id) {
    const h = await supabase.from('homes').select('company_id').eq('id', hm.data.home_id).maybeSingle();
    return h.data?.company_id ?? null;
  }
  return null;
}

// Directory (names + emails) from People API (fallback to profiles)
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
    if (s === 'CONFIRMED') return 'booking-row--confirmed';
    if (s === 'CANCELLED') return 'booking-row--cancelled';
    if (s === 'INVITED' || s === 'BOOKED' || s === 'WAITLISTED') return 'booking-row--pending';
    return '';
}




/* ========= Priority suggestions ========= */

type PriorityCandidate = {
    user_id: string;
    next_due_date: string | null;
    status: 'OVERDUE' | 'DUE_SOON';
    score: number;      // for sorting
    reason: string;     // human-readable (e.g., "Overdue by 12 days")
};

async function getPriorityCandidates(opts: {
    companyId: string | null;
    courseId: string | null;
    sessionId: string;              // exclude already on this session
    visibleUserIds: string[];       // restrict to who the caller is allowed to invite
}): Promise<PriorityCandidate[]> {
    const { companyId, courseId, sessionId, visibleUserIds } = opts;
    if (!companyId || !courseId || visibleUserIds.length === 0) return [];

    // 1) Pull people already attached to this session (any status except CANCELLED)
    const att = await supabase
        .from('training_session_attendees')
        .select('user_id,status')
        .eq('session_id', sessionId);

    const attached = new Set<string>(
        ((att.data as Array<{ user_id: string; status: AttendeeStatus }> | null) ?? [])
            .filter(a => a.status !== 'CANCELLED')
            .map(a => a.user_id)
    );

    // 2) Pull due data for the course
    const due = await supabase
        .from('training_records_v')
        .select('user_id, company_id, course_id, next_due_date, status')
        .eq('company_id', companyId)
        .eq('course_id', courseId)
        .in('status', ['OVERDUE', 'DUE_SOON']);

    if (due.error) return [];

    const now = Date.now();
    const visible = new Set(visibleUserIds);

    const list: PriorityCandidate[] =
        ((due.data as Array<{ user_id: string; next_due_date: string | null; status: 'OVERDUE' | 'DUE_SOON' }> | null) ?? [])
            .filter(r => visible.has(r.user_id) && !attached.has(r.user_id))
            .map(r => {
                const t = r.next_due_date ? new Date(r.next_due_date).getTime() : null;
                const days = t ? Math.round((t - now) / (1000 * 60 * 60 * 24)) : null; // negative => overdue
                const overdueDays = days !== null ? Math.max(0, -days) : 0;

                // Scoring: OVERDUE outranks DUE_SOON; deeper overdue outranks shallower
                const score =
                    (r.status === 'OVERDUE' ? 2000 : 1000) +
                    (r.status === 'OVERDUE' ? overdueDays : -(days ?? 9999));

                const reason =
                    r.status === 'OVERDUE'
                        ? `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`
                        : `Due in ${Math.max(0, days ?? 0)} day${Math.max(0, days ?? 0) === 1 ? '' : 's'}`;

                return { user_id: r.user_id, next_due_date: r.next_due_date, status: r.status, score, reason };
            })
            .sort((a, b) => b.score - a.score);

    return list;
}



/* ========================= MY — Book / decline ========================= */

function MyBookings() {
  const [uid, setUid] = useState<string | null>(null);
  const [rows, setRows] = useState<MyAttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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

  async function decline(session_id: string) {
    const res1 = await supabase.rpc('cancel_my_training_booking', { p_session: session_id });
    if (res1.error) {
      const res2 = await supabase.rpc('cancel_my_training_booking', { p_session_id: session_id });
      if (res2.error) { alert(res2.error.message); return; }
    }
    setPendingAction(p => ({ ...p, [session_id]: undefined }));
    await reload();
  }

  async function confirmPlace(session_id: string, confirm_deadline?: string | null) {
    if (confirm_deadline && new Date(confirm_deadline).getTime() < Date.now()) {
      alert('The confirm-by date has passed for this session.');
      return;
    }
      const res = await supabase.rpc('confirm_my_training_booking', { p_session_id: session_id });
      if (res.error) { alert(res.error.message); return; }
    setPendingAction(p => ({ ...p, [session_id]: undefined }));
    await reload();
  }

  async function cancelAttendance(session_id: string) {
    const res1 = await supabase.rpc('cancel_my_training_booking', { p_session: session_id });
    if (res1.error) {
      const res2 = await supabase.rpc('cancel_my_training_booking', { p_session_id: session_id });
      if (res2.error) { alert(res2.error.message); return; }
    }
    setPendingAction(p => ({ ...p, [session_id]: undefined }));
    await reload();
  }

    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

  return (
    <div className="space-y-6">
      {/* Upcoming */}
      <section
        className="rounded-lg p-4 ring-1"
        style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
      >
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--ink)' }}>Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--sub)' }}>No upcoming bookings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr
                  className="text-xs"
                  style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                >
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
                    <tr key={a.session_id} className={`border-t ${rowTone(a.status)}`} style={{ borderColor: 'var(--ring)' }}>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{s?.courses?.name || '—'}</td>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>
                        {fmtWhen(s?.starts_at, s?.ends_at)}
                        {s?.confirm_deadline ? (
                          <div className="text-xs" style={{ color: 'var(--sub)' }}>
                            Confirm by {new Date(s.confirm_deadline).toLocaleDateString()}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{s?.location || '—'}</td>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{displayStatus(a.status)}</td>
                      <td className="p-2 text-center">
                        <div className="inline-flex items-center gap-2">
                          {!pendingAction[a.session_id] && isPendingStatus(a.status) && (
                            <>
                              <button
                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: 'confirm' }))}
                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: 'decline' }))}
                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                              >
                                Decline
                              </button>
                            </>
                          )}

                          {!pendingAction[a.session_id] && a.status === 'CONFIRMED' && (
                            <button
                              onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: 'cancel' }))}
                              className="rounded-md px-2 py-1 text-xs ring-1 transition"
                              style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            >
                              Cancel attendance
                            </button>
                          )}

                          {pendingAction[a.session_id] === 'confirm' && (
                            <>
                              <button
                                onClick={() => confirmPlace(a.session_id, a.training_sessions?.confirm_deadline)}
                                className="rounded-md px-2 py-1 text-xs text-white transition"
                                style={{ background: BRAND_GRADIENT }}
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: undefined }))}
                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                              >
                                Cancel
                              </button>
                            </>
                          )}

                          {pendingAction[a.session_id] === 'decline' && (
                            <>
                              <button
                                onClick={() => decline(a.session_id)}
                                className="rounded-md px-2 py-1 text-xs text-white transition"
                                style={{ background: '#DC2626' }}
                              >
                                Decline
                              </button>
                              <button
                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: undefined }))}
                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                              >
                                Cancel
                              </button>
                            </>
                          )}

                          {pendingAction[a.session_id] === 'cancel' && (
                            <>
                              <button
                                onClick={() => cancelAttendance(a.session_id)}
                                className="rounded-md px-2 py-1 text-xs text-white transition"
                                style={{ background: '#DC2626' }}
                              >
                                Cancel attendance
                              </button>
                              <button
                                onClick={() => setPendingAction(p => ({ ...p, [a.session_id]: undefined }))}
                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
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
        {err && <p className="mt-2 text-sm" style={{ color: '#F87171' }}>{err}</p>}
      </section>

      {/* History */}
      <section
        className="rounded-lg p-4 ring-1"
        style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
      >
        <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--ink)' }}>History</h2>
        {history.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--sub)' }}>No past sessions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr
                  className="text-xs"
                  style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                >
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
                    <tr key={a.session_id} className={`border-t ${rowTone(a.status)}`} style={{ borderColor: 'var(--ring)' }}>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{s?.courses?.name || '—'}</td>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{fmtWhen(s?.starts_at, s?.ends_at)}</td>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{s?.location || '—'}</td>
                      <td className="p-2" style={{ color: 'var(--ink)' }}>{displayStatus(a.status)}</td>
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

/* ========================= SESSIONS (everyone) ========================= */

/* ========================= SESSIONS (everyone) ========================= */

function PublicSessions({
    isAdmin,
    isCompany,
    isManager,
}: { isAdmin: boolean; isCompany: boolean; isManager: boolean }) {
    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');

    const [companyId, setCompanyId] = useState<string>('');
    const [companyName, setCompanyName] = useState<string>('');

    const [sessions, setSessions] = useState<(Session & { courses?: Course | null })[]>([]);
    const [counts, setCounts] = useState<
        Record<
            string,
            {
                confirmed: number;
                pending: number;
                waitlist: number; // kept for internal calc but not shown anymore
                priority: number;
                used: number; // priority INVITED/BOOKED/CONFIRMED + non-priority CONFIRMED
            }
        >
    >({});

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [q, setQ] = useState('');
    const [from, setFrom] = useState<string>('');
    const [to, setTo] = useState<string>('');

    // Invite modal (for managers/company/admin — staff can’t)
    const [inviteOpen, setInviteOpen] = useState<null | Session>(null);
    type Person = { id: string; name: string; home_id?: string | null; is_bank?: boolean };
    const [homes, setHomes] = useState<{ id: string; name: string }[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [inviteSelected, setInviteSelected] = useState<string[]>([]);
    const [flash, setFlash] = useState<string | null>(null);

    // Force-place (company + manager + admin — staff can’t)
    const [forceOpen, setForceOpen] = useState<null | Session>(null);
    const [forceUser, setForceUser] = useState<string>('');
    const [placing, setPlacing] = useState(false);

    // Roster
    const [rosterOpen, setRosterOpen] = useState<null | Session>(null);
    type RosterRow = { user_id: string; name: string; status: AttendeeStatus; source?: string | null };
    const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
    const [rosterStats, setRosterStats] = useState<{
        capacity: number;
        priorityHolds: number;
        confirmedNonPriority: number;
        generalRemaining: number;
    } | null>(null);

    const [priority, setPriority] = useState<PriorityCandidate[]>([]);

    // Delete state (company/admin only — staff can’t)
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    /* ------------ identity & scope ------------ */

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
            try {
                const cid = await resolveCompanyIdForUser(uid, level);
                if (cid) {
                    setCompanyId(cid);
                    const co = await supabase.from('companies').select('name').eq('id', cid).maybeSingle();
                    if (!co.error) setCompanyName(co.data?.name || cid);
                }

                await loadSessions(cid || null);

                // Homes + people list for invite/force/labels
                if (cid) {
                    const h = await supabase.from('homes').select('id,name').eq('company_id', cid);
                    const companyHomes = ((h.data as unknown as { id: string; name: string }[]) || []).map((x) => ({
                        id: x.id,
                        name: x.name,
                    }));
                    setHomes(companyHomes);

                    const ps = await buildPeopleList({
                        companyId: cid,
                        currentUserId: uid,
                        scope: isManager && !isAdmin && !isCompany ? 'MANAGER' : 'COMPANY',
                        managerHomeIds: isManager ? await getManagerHomeIds(uid) : [],
                        companyHomeIds: companyHomes.map((x) => x.id),
                    });
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

    /* ------------ priority suggestions for the invite modal ------------ */

    useEffect(() => {
        if (!inviteOpen || !companyId || people.length === 0) {
            setPriority([]);
            return;
        }
        const visibleIds = people.map((p) => p.id);
        getPriorityCandidates({
            companyId,
            courseId: inviteOpen.course_id,
            sessionId: inviteOpen.id,
            visibleUserIds: visibleIds,
        })
            .then(setPriority)
            .catch(() => setPriority([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inviteOpen, companyId, people]);

    /* ------------ loaders ------------ */

    async function loadSessions(cid: string | null) {
        let qy = supabase
            .from('training_sessions')
            .select('*, courses(*)')
            .eq('status', 'PUBLISHED')
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

    useEffect(() => {
        void loadSessions(companyId || null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to, companyId]);

    async function loadCounts(sessionIds: string[]) {
        if (sessionIds.length === 0) {
            setCounts({});
            return;
        }
        const att = await supabase
            .from('training_session_attendees')
            .select('session_id,status,source')
            .in('session_id', sessionIds);
        if (att.error) return;

        const next: typeof counts = {};
        const rows =
            ((att.data as unknown) as Array<{ session_id: string; status: AttendeeStatus; source?: string | null }>) ?? [];

        for (const a of rows) {
            const sid = a.session_id;
            if (!next[sid]) next[sid] = { confirmed: 0, pending: 0, waitlist: 0, priority: 0, used: 0 };

            const src = (a.source ?? '').trim().toUpperCase();
            const isPriority = src === 'PRIORITY';

            // regular buckets
            if (a.status === 'CONFIRMED') next[sid].confirmed++;
            else if ((a.status === 'INVITED' || a.status === 'BOOKED') && !isPriority) next[sid].pending++;

            // priority holds (INVITED / BOOKED / CONFIRMED) consume capacity
            if (isPriority && (a.status === 'INVITED' || a.status === 'BOOKED' || a.status === 'CONFIRMED')) {
                next[sid].priority++;
                next[sid].used++;
            } else if (a.status === 'CONFIRMED') {
                // non-priority confirmed consumes capacity
                next[sid].used++;
            }
            // WAITLISTED / CANCELLED do not consume capacity (we no longer show waitlist)
        }

        setCounts(next);
    }

    /* ------------ helpers for capacity rules with reserved priority ------------ */

    async function getSessionCapacityAndStats(session: Session) {
        const att = await supabase
            .from('training_session_attendees')
            .select('status,source')
            .eq('session_id', session.id);

        if (att.error) throw att.error;

        const rows = (att.data as Array<{ status: AttendeeStatus; source?: string | null }>) || [];

        const priorityHolds = rows.filter(
            (r) =>
                (r.source || '').toUpperCase() === 'PRIORITY' &&
                (r.status === 'INVITED' || r.status === 'BOOKED' || r.status === 'CONFIRMED'),
        ).length;

        const confirmedNonPriority = rows.filter(
            (r) => r.status === 'CONFIRMED' && (r.source || '').toUpperCase() !== 'PRIORITY',
        ).length;

        const capacity = session.capacity || 0;
        const generalRemaining = Math.max(0, capacity - priorityHolds - confirmedNonPriority);

        return { capacity, priorityHolds, confirmedNonPriority, generalRemaining };
    }

    async function getAttendeeRow(sessionId: string, userId: string) {
        const r = await supabase
            .from('training_session_attendees')
            .select('session_id,user_id,status,source')
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .maybeSingle();
        if (r.error && r.status !== 406) throw r.error;
        return (r.data as (Attendee & { source?: string | null }) | null) ?? null;
    }

    /* ------------ roster loader ------------ */

    async function loadRoster(session: Session) {
        const [rowsRes, stats] = await Promise.all([
            supabase.from('training_session_attendees').select('user_id,status,source').eq('session_id', session.id),
            getSessionCapacityAndStats(session),
        ]);

        if (!rowsRes.error) {
            const raw =
                ((rowsRes.data as unknown) as Array<{ user_id: string; status: AttendeeStatus; source?: string | null }>) || [];
            const withNames: RosterRow[] = raw.map((r) => {
                const person = people.find((p) => p.id === r.user_id);
                return {
                    user_id: r.user_id,
                    name: person?.name || r.user_id, // full name if available; no truncation
                    status: r.status,
                    source: r.source,
                };
            });
            // Sort: confirmed first, then pending (booked/invited), then anything else
            withNames.sort((a, b) => {
                const rank = (x: RosterRow) =>
                    x.status === 'CONFIRMED' ? 0 : x.status === 'BOOKED' ? 1 : x.status === 'INVITED' ? 2 : 3;
                return rank(a) - rank(b);
            });
            setRosterRows(withNames);
        } else {
            setRosterRows([]);
        }
        setRosterStats(stats);
    }

    useEffect(() => {
        if (rosterOpen) void loadRoster(rosterOpen);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rosterOpen, people]);

    /* ------------ claim / invite / force place ------------ */

    async function claimSpot(session: Session) {
        try {
            const { data } = await supabase.auth.getUser();
            const me = data.user?.id;
            if (!me) return alert('Not signed in.');

            // Is this user already marked as PRIORITY?
            const existing = await getAttendeeRow(session.id, me);
            const isPriority = (existing?.source || '').toUpperCase() === 'PRIORITY';

            const nowIso = new Date().toISOString();

            if (isPriority) {
                // Always allow: consumes a reserved seat
                const up = await supabase.from('training_session_attendees').upsert(
                    {
                        session_id: session.id,
                        user_id: me,
                        status: 'CONFIRMED',
                        booked_at: nowIso,
                        confirmed_at: nowIso,
                        source: 'PRIORITY',
                    } as unknown,
                    { onConflict: 'session_id,user_id' },
                );
                if (up.error) throw up.error;
                setFlash('Your priority place has been confirmed.');
                setTimeout(() => setFlash(null), 3500);
                await loadSessions(companyId);
                return;
            }

            // Non-priority: confirm only if a general seat is available
            const { generalRemaining } = await getSessionCapacityAndStats(session);
            if (generalRemaining > 0) {
                const up = await supabase.from('training_session_attendees').upsert(
                    {
                        session_id: session.id,
                        user_id: me,
                        status: 'CONFIRMED',
                        booked_at: nowIso,
                        confirmed_at: nowIso,
                        source: 'SELF',
                    } as unknown,
                    { onConflict: 'session_id,user_id' },
                );
                if (up.error) throw up.error;
                setFlash('Spot claimed — you’re confirmed.');
                setTimeout(() => setFlash(null), 3500);
                await loadSessions(companyId);
            } else {
                // No general seats left → waitlist (we don't show it, but behavior remains)
                const up = await supabase.from('training_session_attendees').upsert(
                    {
                        session_id: session.id,
                        user_id: me,
                        status: 'WAITLISTED',
                        booked_at: nowIso,
                        source: 'SELF',
                    } as unknown,
                    { onConflict: 'session_id,user_id' },
                );
                if (up.error) throw up.error;
                setFlash('Session is full — you’ve been added to the waitlist.');
                setTimeout(() => setFlash(null), 3500);
                await loadSessions(companyId);
            }
        } catch (e) {
            alert((e as { message?: string })?.message ?? 'Failed to claim spot');
        }
    }

    async function sendInvites() {
        if (!inviteOpen || inviteSelected.length === 0) return;

        // Block invites when full (used >= capacity)
        const usedNow = counts[inviteOpen.id]?.used ?? 0;
        const capNow = inviteOpen.capacity ?? 0;
        if (usedNow >= capNow) {
            alert('Session is full — no more invites can be sent.');
            setInviteOpen(null);
            return;
        }

        // Invite everyone selected
        const res = await supabase.rpc('invite_to_training_session_v2', {
            p_session: inviteOpen.id,
            p_user_ids: inviteSelected,
        });
        if (res.error) {
            alert('Invite failed: ' + (res.error.message || String(res.error)));
            return;
        }

        // Tag the *suggested* ones as PRIORITY so they reserve capacity
        const suggestedIds = new Set(priority.map((p) => p.user_id));
        const priorityInvitees = inviteSelected.filter((id) => suggestedIds.has(id));
        if (priorityInvitees.length > 0) {
            await supabase
                .from('training_session_attendees')
                .update({ source: 'PRIORITY' })
                .eq('session_id', inviteOpen.id)
                .in('user_id', priorityInvitees);
        }

        const n = ((res.data as Record<string, unknown> | null)?.['notifications'] as number | undefined) ?? 0;
        setFlash(`Invites sent: ${n}${priorityInvitees.length ? ` • ${priorityInvitees.length} priority` : ''}`);
        setInviteOpen(null);
        setInviteSelected([]);
        setTimeout(() => setFlash(null), 4000);
        await loadSessions(companyId);
    }

    async function forcePlace() {
        if (!forceOpen || !forceUser) return;
        try {
            // Block force place when full (used >= capacity)
            const usedNow = counts[forceOpen.id]?.used ?? 0;
            const capNow = forceOpen.capacity ?? 0;
            if (usedNow >= capNow) {
                alert('Session is full — cannot force place.');
                setForceOpen(null);
                return;
            }

            // If the target is PRIORITY they’re allowed even if only reserved spots remain
            const existing = await getAttendeeRow(forceOpen.id, forceUser);
            const isPriority = (existing?.source || '').toUpperCase() === 'PRIORITY';

            const { generalRemaining } = await getSessionCapacityAndStats(forceOpen);
            if (!isPriority && generalRemaining <= 0) {
                alert('This session is at general capacity. Only reserved priority places remain.');
                return;
            }

            const nowIso = new Date().toISOString();
            const up = await supabase
                .from('training_session_attendees')
                .upsert(
                    {
                        session_id: forceOpen.id,
                        user_id: forceUser,
                        status: 'CONFIRMED',
                        booked_at: nowIso,
                        confirmed_at: nowIso,
                        source: isPriority ? 'PRIORITY' : 'COMPANY',
                    } as unknown,
                    { onConflict: 'session_id,user_id' },
                );
            if (up.error) throw up.error;

            // 🔔 Notify the placed user
            try {
                const placerId = uid ?? (await supabase.auth.getUser()).data.user?.id ?? null;
                if (!placerId) throw new Error('No current user');

                const courseTitle = forceOpen.courses?.name ?? 'Training';
                const startsAt = forceOpen.starts_at ? new Date(forceOpen.starts_at) : null;
                const title = startsAt
                    ? `${courseTitle} — ${startsAt.toLocaleString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                    })}`
                    : courseTitle;

                const { error: notifErr } = await supabase.from('notifications').insert([
                    {
                        kind: 'TRAINING_SESSION_INVITED',
                        recipient_id: forceUser,
                        message: `You have been placed on this training session: ${title}`,
                        link: '/bookings',
                        payload: { session_id: forceOpen.id } as unknown,
                        created_by: placerId,
                    },
                ]);

                if (notifErr) {
                    console.error('Notification insert failed:', notifErr);
                }
            } catch (e) {
                console.error('Notification block error:', e);
            }

            setFlash('Placed into session.');
            setForceOpen(null);
            setForceUser('');
            setTimeout(() => setFlash(null), 3500);
            await loadSessions(companyId);
        } catch (e) {
            alert((e as { message?: string })?.message ?? 'Failed to place');
        } finally {
            setPlacing(false);
        }
    }

    // Company-only removal from a session roster
    async function removeFromSession(session: Session, userId: string) {
        if (!isCompany) return; // only company users can remove
        const yes = confirm('Remove this person from this session?');
        if (!yes) return;

        const del = await supabase
            .from('training_session_attendees')
            .delete()
            .eq('session_id', session.id)
            .eq('user_id', userId);

        if (del.error) {
            alert(del.error.message || 'Failed to remove');
            return;
        }

        setFlash('Removed from session.');
        setTimeout(() => setFlash(null), 3000);

        await Promise.all([loadRoster(session), loadSessions(companyId)]);
    }

    /* ------------ UI derivations ------------ */

    const { upcomingFiltered, pastFiltered } = useMemo(() => {
        const query = q.trim().toLowerCase();
        let items = [...sessions];

        if (query) {
            items = items.filter(
                (s) =>
                    (s.courses?.name || '').toLowerCase().includes(query) ||
                    (s.location || '').toLowerCase().includes(query),
            );
        }

        const now = Date.now();
        const upcoming = items
            .filter((s) => s.starts_at && new Date(s.starts_at).getTime() >= now)
            .sort((a, b) => (a.starts_at || '').localeCompare(b.starts_at || ''));

        const past = items
            .filter((s) => !s.starts_at || new Date(s.starts_at).getTime() < now)
            .sort((a, b) => (b.starts_at || '').localeCompare(a.starts_at || ''));

        return { upcomingFiltered: upcoming, pastFiltered: past };
    }, [sessions, q]);

    /* ------------ small roster item component (full name + actions below) ------------ */
    const RosterItem = ({
        name,
        badge,
        onRemove,
    }: {
        name: string;
        badge: React.ReactNode;
        onRemove?: () => void;
    }) => (
        <li
            className="rounded-md px-2 py-1 ring-1"
            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
        >
            <div className="font-medium whitespace-normal break-words" title={name}>
                {name}
            </div>
            <div className="mt-1 flex items-center gap-2">
                {badge}
                {isCompany && onRemove && (
                    <button
                        onClick={onRemove}
                        className="rounded px-1.5 py-0.5 text-[10px] ring-1 transition"
                        style={{ background: 'var(--nav-item-bg)', borderColor: '#fecaca', color: '#b91c1c' }}
                        type="button"
                        title="Remove from this session"
                    >
                        Remove
                    </button>
                )}
            </div>
        </li>
    );

    // inside PublicSessions component
    async function deleteSessionFinal(id: string) {
        const { error } = await supabase.from('training_sessions').delete().eq('id', id);
        if (error) {
            alert(error.message);
            return;
        }
        setPendingDelete(null);
        await loadSessions(companyId || null);
    }


    /* ------------ render ------------ */

    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

    return (
        <div className="space-y-4" style={{ color: 'var(--ink)' }}>
            {flash && (
                <div
                    className="rounded-md px-3 py-2 text-sm ring-1"
                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                >
                    <span className="text-emerald-700 [data-orbit='1']:text-emerald-200">{flash}</span>
                </div>
            )}

            {/* Filters */}
            <div className="rounded-lg p-3 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <div className="grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
                    <div className="md:col-span-3">
                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                            Search
                        </label>
                        <input
                            className="w-full rounded-md px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Course or location"
                        />
                    </div>
                    <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                            From
                        </label>
                        <input
                            type="date"
                            className="w-full rounded-md px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                            To
                        </label>
                        <input
                            type="date"
                            className="w-full rounded-md px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                            Company
                        </label>
                        <div className="flex gap-2">
                            <input
                                className="w-full rounded-md px-3 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={companyName || companyId}
                                readOnly
                            />
                            <button
                                onClick={() => void loadSessions(companyId)}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                type="button"
                            >
                                Refresh
                            </button>
                        </div>
                    </div>
                </div>
                {err && (
                    <p className="mt-2 text-sm" style={{ color: '#F87171' }}>
                        {err}
                    </p>
                )}
            </div>

            {/* Upcoming sessions (no waitlist column) */}
            <div className="overflow-x-auto rounded-lg ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <table className="min-w-full text-sm">
                    <thead>
                        <tr
                            className="text-xs"
                            style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                        >
                            <th className="text-left p-2">Course</th>
                            <th className="text-left p-2">When</th>
                            <th className="text-left p-2">Where</th>
                            <th className="text-left p-2">Capacity</th>
                            <th className="text-left p-2">Priority</th>
                            <th className="text-left p-2">Confirmed</th>
                            <th className="text-left p-2">Pending</th>
                            <th className="p-2 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {upcomingFiltered.map((s) => {
                            const c = counts[s.id] || { confirmed: 0, pending: 0, waitlist: 0, priority: 0, used: 0 };
                            const canDelete = isAdmin || isCompany;
                            const deleting = pendingDelete === s.id;

                            const total = s.capacity ?? 0;
                            const used = c.used ?? 0;
                            const isFull = used >= total;

                            return (
                                <tr key={s.id} className="border-t" style={{ borderColor: 'var(--ring)' }}>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {s.courses?.name || '—'}
                                    </td>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {fmtWhen(s.starts_at, s.ends_at)}
                                        {s.confirm_deadline ? (
                                            <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                                Confirm by {new Date(s.confirm_deadline).toLocaleDateString()}
                                            </div>
                                        ) : null}
                                    </td>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {s.location || '—'}
                                    </td>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {used}/{total}
                                    </td>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {c.priority}
                                    </td>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {c.confirmed}
                                    </td>
                                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                                        {c.pending}
                                    </td>
                                    <td className="p-2 text-center">
                                        <div className="inline-flex items-center gap-2">
                                            <button
                                                onClick={() => void claimSpot(s)}
                                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                type="button"
                                            >
                                                Claim spot
                                            </button>

                                            {(isAdmin || isCompany || isManager) && (
                                                <button
                                                    onClick={() => setInviteOpen(s)}
                                                    disabled={isFull}
                                                    title={isFull ? 'Session is full — no more invites' : 'Invite people'}
                                                    className="rounded-md px-2 py-1 text-xs ring-1 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                    type="button"
                                                >
                                                    Invite…
                                                </button>
                                            )}

                                            {/* View roster */}
                                            <button
                                                onClick={() => setRosterOpen(s)}
                                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                title="View roster"
                                                type="button"
                                            >
                                                View roster
                                            </button>

                                            {(isAdmin || isCompany || isManager) && (
                                                <button
                                                    onClick={() => setForceOpen(s)}
                                                    disabled={isFull}
                                                    title={isFull ? 'Session is full — cannot force place' : 'Place someone directly into this session'}
                                                    className="rounded-md px-2 py-1 text-xs ring-1 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                                    style={{ background: 'var(--nav-item-bg)', borderColor: '#fde68a', color: '#92400e' }}
                                                    type="button"
                                                >
                                                    Force place
                                                </button>
                                            )}

                                            {canDelete &&
                                                (deleting ? (
                                                    <>
                                                        <button
                                                            onClick={() => void deleteSessionFinal(s.id)}
                                                            className="rounded-md px-2 py-1 text-xs text-white transition"
                                                            style={{ background: '#DC2626' }}
                                                            type="button"
                                                        >
                                                            Confirm delete
                                                        </button>
                                                        <button
                                                            onClick={() => setPendingDelete(null)}
                                                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                            type="button"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => setPendingDelete(s.id)}
                                                        className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                        style={{ background: 'var(--nav-item-bg)', borderColor: '#fecaca', color: '#b91c1c' }}
                                                        type="button"
                                                    >
                                                        Delete
                                                    </button>
                                                ))}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {upcomingFiltered.length === 0 && (
                            <tr>
                                <td colSpan={8} className="p-3 text-sm" style={{ color: 'var(--sub)' }}>
                                    No upcoming sessions.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Past sessions (no waitlist column) */}
            <div className="rounded-lg ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <div className="flex items-center justify-between px-3 py-2" style={{ color: 'var(--ink)' }}>
                    <h3 className="text-sm font-semibold">Past sessions</h3>
                    <span className="text-xs" style={{ color: 'var(--sub)' }}>
                        {pastFiltered.length} {pastFiltered.length === 1 ? 'session' : 'sessions'}
                    </span>
                </div>
                <div className="max-h-96 overflow-y-auto border-t" style={{ borderColor: 'var(--ring)' }}>
                    <table className="min-w-full text-sm">
                        <thead className="sticky top-0">
                            <tr
                                className="text-xs"
                                style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                            >
                                <th className="text-left p-2">Course</th>
                                <th className="text-left p-2">When</th>
                                <th className="text-left p-2">Where</th>
                                <th className="text-left p-2">Capacity</th>
                                <th className="text-left p-2">Priority</th>
                                <th className="text-left p-2">Confirmed</th>
                                <th className="text-left p-2">Pending</th>
                                {(isAdmin || isCompany) && <th className="p-2 text-center">Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {pastFiltered.map((s) => {
                                const c = counts[s.id] || { confirmed: 0, pending: 0, waitlist: 0, priority: 0, used: 0 };
                                const canDelete = isAdmin || isCompany;
                                const deleting = pendingDelete === s.id;
                                const total = s.capacity ?? 0;
                                const used = c.used ?? 0;

                                return (
                                    <tr key={s.id} className="border-t" style={{ borderColor: 'var(--ring)' }}>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {s.courses?.name || '—'}
                                        </td>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {fmtWhen(s.starts_at, s.ends_at)}
                                        </td>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {s.location || '—'}
                                        </td>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {used}/{total}
                                        </td>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {c.priority}
                                        </td>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {c.confirmed}
                                        </td>
                                        <td className="p-2" style={{ color: 'var(--ink)' }}>
                                            {c.pending}
                                        </td>
                                        {(isAdmin || isCompany) && (
                                            <td className="p-2 text-center">
                                                {canDelete &&
                                                    (deleting ? (
                                                        <div className="inline-flex items-center gap-2">
                                                            <button
                                                                onClick={() => void deleteSessionFinal(s.id)}
                                                                className="rounded-md px-2 py-1 text-xs text-white transition"
                                                                style={{ background: '#DC2626' }}
                                                                type="button"
                                                            >
                                                                Confirm delete
                                                            </button>
                                                            <button
                                                                onClick={() => setPendingDelete(null)}
                                                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                                type="button"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setPendingDelete(s.id)}
                                                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                            style={{ background: 'var(--nav-item-bg)', borderColor: '#fecaca', color: '#b91c1c' }}
                                                            type="button"
                                                        >
                                                            Delete
                                                        </button>
                                                    ))}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                            {pastFiltered.length === 0 && (
                                <tr>
                                    <td colSpan={isAdmin || isCompany ? 8 : 7} className="p-3 text-sm" style={{ color: 'var(--sub)' }}>
                                        No past sessions match your filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Invite modal */}
            {inviteOpen && (
                <Modal title={`Invite to: ${inviteOpen.courses?.name || 'Session'}`} onClose={() => setInviteOpen(null)}>
                    <div className="space-y-3" style={{ color: 'var(--ink)' }}>
                        {/* Priority suggestions */}
                        {priority.length > 0 && (
                            <div
                                className="rounded-lg p-2 ring-1 mb-2"
                                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-xs font-medium" style={{ color: 'var(--sub)' }}>
                                        Suggested (needs this most)
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() =>
                                                setInviteSelected((prev) => {
                                                    const ids = priority.slice(0, Math.min(priority.length, 10)).map((p) => p.user_id);
                                                    return Array.from(new Set([...prev, ...ids]));
                                                })
                                            }
                                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                            type="button"
                                        >
                                            Add top {Math.min(priority.length, 10)}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {priority.slice(0, 12).map((sug) => {
                                        const person = people.find((p) => p.id === sug.user_id);
                                        const label = person?.name || sug.user_id;
                                        const selected = inviteSelected.includes(sug.user_id);
                                        return (
                                            <button
                                                key={sug.user_id}
                                                onClick={() =>
                                                    setInviteSelected((prev) =>
                                                        prev.includes(sug.user_id) ? prev.filter((x) => x !== sug.user_id) : [...prev, sug.user_id],
                                                    )
                                                }
                                                title={sug.reason}
                                                className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ring-1 transition"
                                                style={{
                                                    background: selected ? 'var(--nav-item-bg)' : 'var(--panel-bg)',
                                                    color: 'var(--ink)',
                                                    borderColor: selected ? 'var(--ring-strong)' : 'var(--ring)',
                                                }}
                                                type="button"
                                            >
                                                <span className="font-medium">{label}</span>
                                                <span style={{ color: 'var(--sub)' }}>• {sug.reason}</span>
                                                <span className="rounded px-1 ring-1" style={{ borderColor: 'var(--ring)', color: 'var(--sub)' }}>
                                                    {sug.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}
                                                </span>
                                                <span className="text-sm">{selected ? '−' : '+'}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* People picker */}
                        <PeoplePicker
                            people={people}
                            homesById={new Map(homes.map((h) => [h.id, h.name]))}
                            selected={inviteSelected}
                            onChange={setInviteSelected}
                            placeholder="Search staff & managers…"
                            solidOverlay
                            constrainToViewport
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => void sendInvites()}
                                disabled={inviteSelected.length === 0}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                type="button"
                            >
                                Send invites ({inviteSelected.length})
                            </button>
                            <button
                                onClick={() => setInviteOpen(null)}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                type="button"
                            >
                                Close
                            </button>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--sub)' }}>
                            Invites create <code>INVITED</code> rows. Suggested people are tagged as <code>PRIORITY</code> and reserve places.
                        </p>
                    </div>
                </Modal>
            )}

            {/* Force-place modal (company & managers & admin) */}
            {forceOpen && (isAdmin || isCompany || isManager) && (
                <Modal title={`Place into: ${forceOpen.courses?.name || 'Session'}`} onClose={() => setForceOpen(null)}>
                    <div className="space-y-3" style={{ color: 'var(--ink)' }}>
                        <p className="text-sm" style={{ color: 'var(--sub)' }}>
                            This will add the person directly as <strong>CONFIRMED</strong>. General capacity is respected; priority invitees can still be
                            placed if only reserved spots remain.
                        </p>
                        <PeoplePicker
                            people={people}
                            homesById={new Map(homes.map((h) => [h.id, h.name]))}
                            selected={forceUser ? [forceUser] : []}
                            onChange={(ids) => setForceUser(ids[0] || '')}
                            placeholder="Search person to place…"
                            solidOverlay
                            constrainToViewport
                        />
                        {isManager && uid && !people.some((p) => p.id === uid) && (
                            <button
                                onClick={() => setForceUser(uid)}
                                className="rounded-md px-2 py-1 text-xs ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                type="button"
                            >
                                Place myself
                            </button>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={() => void forcePlace()}
                                disabled={!forceUser || placing}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                type="button"
                            >
                                {placing ? 'Placing…' : 'Place into session'}
                            </button>
                            <button
                                onClick={() => setForceOpen(null)}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                type="button"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Roster modal */}
            {rosterOpen && (
                <Modal title={`Roster: ${rosterOpen.courses?.name || 'Session'}`} onClose={() => setRosterOpen(null)}>
                    <div className="space-y-4" style={{ color: 'var(--ink)' }}>
                        {/* Capacity visual */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--sub)' }}>
                                <span>
                                    {rosterStats
                                        ? `Capacity: ${rosterStats.confirmedNonPriority + rosterStats.priorityHolds}/${rosterStats.capacity}`
                                        : 'Capacity'}
                                </span>
                                {rosterStats && <span>{rosterStats.generalRemaining} general remaining</span>}
                            </div>
                            <div
                                className="w-full h-3 rounded-full ring-1 overflow-hidden"
                                style={{ borderColor: 'var(--ring)', background: 'var(--nav-item-bg)' }}
                            >
                                {(() => {
                                    const cap = rosterStats?.capacity ?? 0;
                                    const conf = rosterStats?.confirmedNonPriority ?? 0;
                                    const pri = rosterStats?.priorityHolds ?? 0;
                                    const confPct = cap > 0 ? (conf / cap) * 100 : 0;
                                    const priPct = cap > 0 ? (pri / cap) * 100 : 0;
                                    return (
                                        <div className="h-full w-full relative">
                                            <div
                                                className="absolute left-0 top-0 h-full"
                                                style={{ width: `${confPct}%`, background: '#10B981' }}
                                                title={`Confirmed (non-priority): ${conf}`}
                                            />
                                            <div
                                                className="absolute top-0 h-full"
                                                style={{ left: `${confPct}%`, width: `${priPct}%`, background: '#047857' }}
                                                title={`Priority holds: ${pri}`}
                                            />
                                        </div>
                                    );
                                })()}
                            </div>
                            <div className="flex gap-4 text-xs" style={{ color: 'var(--sub)' }}>
                                <span className="inline-flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#10B981' }} />
                                    Confirmed
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#047857' }} />
                                    Priority
                                </span>
                            </div>
                        </div>

                        {/* Columns: Confirmed (non-priority) • Priority • Pending */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* Confirmed (non-priority) */}
                            <div className="rounded-lg ring-1 p-2" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-semibold" style={{ color: 'var(--sub)' }}>
                                        Confirmed
                                    </h4>
                                    <span className="text-xs" style={{ color: 'var(--sub)' }}>
                                        {rosterRows.filter((r) => r.status === 'CONFIRMED' && (r.source || '').toUpperCase() !== 'PRIORITY').length}
                                    </span>
                                </div>
                                <ul className="space-y-1">
                                    {rosterRows
                                        .filter((r) => r.status === 'CONFIRMED' && (r.source || '').toUpperCase() !== 'PRIORITY')
                                        .map((r) => (
                                            <RosterItem
                                                key={r.user_id}
                                                name={r.name}
                                                badge={
                                                    <span className="text-[10px] rounded px-1" style={{ color: 'white', background: '#10B981' }}>
                                                        CONFIRMED
                                                    </span>
                                                }
                                                onRemove={() => void removeFromSession(rosterOpen!, r.user_id)}
                                            />
                                        ))}
                                    {rosterRows.filter((r) => r.status === 'CONFIRMED' && (r.source || '').toUpperCase() !== 'PRIORITY').length === 0 && (
                                        <li className="text-xs" style={{ color: 'var(--sub)' }}>
                                            None
                                        </li>
                                    )}
                                </ul>
                            </div>

                            {/* Priority (holds) */}
                            <div className="rounded-lg ring-1 p-2" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-semibold" style={{ color: 'var(--sub)' }}>
                                        Priority
                                    </h4>
                                    <span className="text-xs" style={{ color: 'var(--sub)' }}>
                                        {
                                            rosterRows.filter(
                                                (r) =>
                                                    (r.source || '').toUpperCase() === 'PRIORITY' &&
                                                    (r.status === 'INVITED' || r.status === 'BOOKED' || r.status === 'CONFIRMED'),
                                            ).length
                                        }
                                    </span>
                                </div>
                                <ul className="space-y-1">
                                    {rosterRows
                                        .filter(
                                            (r) =>
                                                (r.source || '').toUpperCase() === 'PRIORITY' &&
                                                (r.status === 'INVITED' || r.status === 'BOOKED' || r.status === 'CONFIRMED'),
                                        )
                                        .map((r) => (
                                            <RosterItem
                                                key={r.user_id}
                                                name={r.name}
                                                badge={
                                                    <span className="text-[10px] rounded px-1" style={{ background: '#047857', color: 'white' }}>
                                                        PRIORITY
                                                    </span>
                                                }
                                                onRemove={() => void removeFromSession(rosterOpen!, r.user_id)}
                                            />
                                        ))}
                                    {rosterRows.filter(
                                        (r) =>
                                            (r.source || '').toUpperCase() === 'PRIORITY' &&
                                            (r.status === 'INVITED' || r.status === 'BOOKED' || r.status === 'CONFIRMED'),
                                    ).length === 0 && (
                                            <li className="text-xs" style={{ color: 'var(--sub)' }}>
                                                None
                                            </li>
                                        )}
                                </ul>
                            </div>

                            {/* Pending (non-priority invited/booked) */}
                            <div className="rounded-lg ring-1 p-2" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-semibold" style={{ color: 'var(--sub)' }}>
                                        Pending
                                    </h4>
                                    <span className="text-xs" style={{ color: 'var(--sub)' }}>
                                        {
                                            rosterRows.filter(
                                                (r) => (r.status === 'INVITED' || r.status === 'BOOKED') && (r.source || '').toUpperCase() !== 'PRIORITY',
                                            ).length
                                        }
                                    </span>
                                </div>
                                <ul className="space-y-1">
                                    {rosterRows
                                        .filter((r) => (r.status === 'INVITED' || r.status === 'BOOKED') && (r.source || '').toUpperCase() !== 'PRIORITY')
                                        .map((r) => {
                                            const isInvited = r.status === 'INVITED';
                                            const badgeStyle = isInvited
                                                ? { background: '#F59E0B', color: '#1F2937' } // amber
                                                : { background: '#93C5FD', color: '#1E3A8A' }; // blue
                                            return (
                                                <RosterItem
                                                    key={r.user_id}
                                                    name={r.name}
                                                    badge={
                                                        <span className="text-[10px] rounded px-1" style={badgeStyle}>
                                                            {(r.status as string).toUpperCase()}
                                                        </span>
                                                    }
                                                    onRemove={() => void removeFromSession(rosterOpen!, r.user_id)}
                                                />
                                            );
                                        })}
                                    {rosterRows.filter(
                                        (r) => (r.status === 'INVITED' || r.status === 'BOOKED') && (r.source || '').toUpperCase() !== 'PRIORITY',
                                    ).length === 0 && (
                                            <li className="text-xs" style={{ color: 'var(--sub)' }}>
                                                None
                                            </li>
                                        )}
                                </ul>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                onClick={() => setRosterOpen(null)}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                type="button"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}



/* ---------- tiny helpers used above ---------- */

async function getManagerHomeIds(userId: string): Promise<string[]> {
    const mh = await supabase.from('home_memberships').select('home_id').eq('user_id', userId).eq('role', 'MANAGER');
    return ((mh.data as Array<{ home_id: string }> | null) ?? []).map((x) => x.home_id);
}

async function buildPeopleList(opts: {
    companyId: string;
    currentUserId: string;
    scope: 'COMPANY' | 'MANAGER';
    managerHomeIds: string[];
    companyHomeIds: string[];
}): Promise<Array<{ id: string; name: string; home_id?: string | null; is_bank?: boolean }>> {
    const { companyId, currentUserId, scope, managerHomeIds, companyHomeIds } = opts;

    // First try the members API (best names + roles)
    try {
        const res = await fetch('/api/self/members/list');
        if (res.ok) {
            const data = (await res.json()) as { members?: MemberFromAPI[] };
            const members = data.members ?? [];
            const companyHomeSet = new Set(companyHomeIds);
            let filtered: MemberFromAPI[];

            if (scope === 'MANAGER') {
                const myHomes = new Set(managerHomeIds);
                filtered = members.filter(
                    (m) =>
                        (m.roles.staff_home?.id && myHomes.has(m.roles.staff_home.id)) ||
                        (m.roles.manager_homes || []).some((hh) => myHomes.has(hh.id)),
                );
            } else {
                filtered = members.filter((m) => {
                    const staffIn = m.roles.staff_home?.id && companyHomeSet.has(m.roles.staff_home.id);
                    const managerIn = (m.roles.manager_homes || []).some((hh) => companyHomeSet.has(hh.id));
                    const bankIn = !!m.roles.bank;
                    return staffIn || managerIn || bankIn;
                });
            }

            const ps: Array<{ id: string; name: string; home_id?: string | null; is_bank?: boolean }> = filtered.map((m) => ({
                id: m.id,
                name: m.full_name || m.email || m.id.slice(0, 8),
                home_id: m.roles.staff_home?.id || m.roles.manager_homes?.[0]?.id || null,
                is_bank: !!m.roles.bank,
            }));

            if (!ps.some((p) => p.id === currentUserId)) ps.unshift({ id: currentUserId, name: 'Me', home_id: null, is_bank: false });

            return ps;
        }
    } catch {
        /* fall through */
    }

    // Fallback: build from memberships + People API + profiles
    const [cm, hm] = await Promise.all([
        supabase.from('company_memberships').select('user_id').eq('company_id', companyId),
        supabase.from('home_memberships').select('user_id,home_id').in('home_id', companyHomeIds),
    ]);
    const ids = new Set<string>([
        ...(((cm.data as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id)),
        ...(((hm.data as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id)),
    ]);
    const directory = await getPeopleDirectoryMap().catch(
        () => new Map<string, { full_name: string | null; email: string | null }>(),
    );
    const missing = Array.from(ids).filter((id) => !(directory.get(id)?.full_name));
    const fallbackNames = await getProfilesNameMap(missing).catch(() => new Map<string, string | null>());

    const homeMap = new Map<string, string | null>();
    ((hm.data as Array<{ user_id: string; home_id: string }> | null) ?? []).forEach((r) => {
        if (!homeMap.has(r.user_id)) homeMap.set(r.user_id, r.home_id);
    });

    const out: Array<{ id: string; name: string; home_id?: string | null; is_bank?: boolean }> = Array.from(ids).map((id) => {
        const d = directory.get(id);
        const name = d?.full_name || fallbackNames.get(id) || d?.email || id.slice(0, 8);
        return { id, name, home_id: homeMap.get(id) ?? null, is_bank: false };
    });

    if (!out.some((p) => p.id === currentUserId)) out.unshift({ id: currentUserId, name: 'Me', home_id: null, is_bank: false });

    // Nice UX: sort by name
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}



/* ========================= CREATE (managers/company/admin) ========================= */

function SessionsCreate({
  isAdmin, isCompany, isManager
}: { isAdmin: boolean; isCompany: boolean; isManager: boolean }) {
  const [uid, setUid] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>('4_STAFF');

  const [companyId, setCompanyId] = useState<string>('');
  const [companyName, setCompanyName] = useState<string>('');

  const [sessions, setSessions] = useState<(Session & { courses?: Course | null })[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
    const [counts, setCounts] = useState<
        Record<string, { confirmed: number; pending: number; waitlist: number; priority: number; used: number }>
    >({});

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

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

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

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

        // Invite list
        if (isAdmin || isCompany) {
          const h = await supabase
            .from('homes')
            .select('id,name')
            .eq('company_id', cid || '');
          const companyHomes = ((h.data as unknown as { id: string; name: string }[]) || []).map(x => ({ id: x.id, name: x.name }));
          setHomes(companyHomes);

          const dirRes = await fetch('/api/self/members/list');
          if (dirRes.ok) {
            const data = await dirRes.json();
            const members = (data?.members || []) as MemberFromAPI[];
            const companyHomeIds = new Set(companyHomes.map(x => x.id));
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
          }
        } else if (isManager && uid) {
          const mh = await supabase
            .from('home_memberships')
            .select('home_id')
            .eq('user_id', uid)
            .eq('role', 'MANAGER');
          const managedHomeIds = (mh.data as unknown as Array<{ home_id: string }> | null)?.map(x => x.home_id) ?? [];

          const h = await supabase.from('homes').select('id,name').in('id', managedHomeIds);
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
            }
          } catch { /* ignore */ }
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

    useEffect(() => {
        void loadSessions(companyId || null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to, companyId]);


    async function loadCounts(sessionIds: string[]) {
        if (sessionIds.length === 0) {
            setCounts({});
            return;
        }
        const att = await supabase
            .from('training_session_attendees')
            .select('session_id,status,source')
            .in('session_id', sessionIds);
        if (att.error) return;

        const next: typeof counts = {};
        const rows =
            ((att.data as unknown) as Array<{ session_id: string; status: AttendeeStatus; source?: string | null }>) ?? [];

        for (const a of rows) {
            const sid = a.session_id;
            if (!next[sid]) next[sid] = { confirmed: 0, pending: 0, waitlist: 0, priority: 0, used: 0 };

            const src = (a.source ?? '').trim().toUpperCase();
            const isPriority = src === 'PRIORITY';

            // regular buckets
            if (a.status === 'CONFIRMED') next[sid].confirmed++;
            else if (a.status === 'WAITLISTED') next[sid].waitlist++;
            else if ((a.status === 'INVITED' || a.status === 'BOOKED') && !isPriority) next[sid].pending++;
            //                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            //                     exclude PRIORITY rows from the pending count

            // priority holds reserve capacity (invited/booked/confirmed, not waitlisted/cancelled)
            if (isPriority && a.status !== 'CANCELLED' && a.status !== 'WAITLISTED') {
                next[sid].priority++;
            }
        }

        setCounts(next);
    }


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
    if (form.capacity === '' || Number(form.capacity) <= 0) return alert('Capacity must be a positive number.');

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
        status: 'PUBLISHED', // IMPORTANT for booking RPCs
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

    if (att.error) { alert(att.error.message); return; }

    const rawAtt = (att.data as unknown as Attendee[]) || [];
    const ids = Array.from(new Set(rawAtt.map((a) => a.user_id)));

    const directory = await getPeopleDirectoryMap();
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

    // Replace your existing sendInvitesFromRow in SessionsCreate with this:
    async function sendInvitesFromRow() {
        if (!inviteOpen || inviteSelected.length === 0) return;

        // Block invites when full (priority holds + confirmed consume capacity)
        const c = counts[inviteOpen.id] || { priority: 0, confirmed: 0 };
        const usedNow = (c.priority ?? 0) + (c.confirmed ?? 0);
        const capNow = inviteOpen.capacity ?? 0;
        if (usedNow >= capNow) {
            alert('Session is full — no more invites can be sent.');
            setInviteOpen(null);
            return;
        }

        // Invite the selected people
        const res = await supabase.rpc('invite_to_training_session_v2', {
            p_session: inviteOpen.id,
            p_user_ids: inviteSelected,
        });
        if (res.error) {
            alert('Invite failed: ' + (res.error.message || String(res.error)));
            return;
        }

        const n = ((res.data as Record<string, unknown> | null)?.['notifications'] as number | undefined) ?? 0;
        setFlash(`Invites sent: ${n}`);
        setInviteOpen(null);
        setInviteSelected([]);
        setTimeout(() => setFlash(null), 4000);
        await loadSessions(companyId);
    }


  if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

  return (
    <div className="space-y-4" style={{ color: 'var(--ink)' }}>
      {flash && (
        <div
          className="rounded-md px-3 py-2 text-sm ring-1"
          style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
        >
          <span className="text-emerald-700 [data-orbit='1']:text-emerald-200">{flash}</span>
        </div>
      )}

      {/* Controls */}
      <div className="rounded-lg p-3 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
        <div className="grid grid-cols-1 md:grid-cols-8 gap-2 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Search</label>
            <input
              className="w-full rounded-md px-3 py-2 ring-1"
              style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Course or location"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>From</label>
            <input
              type="date"
              className="w-full rounded-md px-3 py-2 ring-1"
              style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>To</label>
            <input
              type="date"
              className="w-full rounded-md px-3 py-2 ring-1"
              style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>Company</label>
            <div className="flex gap-2">
              <input
                className="w-full rounded-md px-3 py-2 ring-1"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                value={companyName || companyId}
                readOnly
              />
              <button
                onClick={() => openCreate()}
                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              >
                New session
              </button>
            </div>
          </div>
        </div>
        {err && <p className="mt-2 text-sm" style={{ color: '#F87171' }}>{err}</p>}
      </div>

      {/* Upcoming table */}
      <div className="overflow-x-auto rounded-lg ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
        <table className="min-w-full text-sm">
          <thead>
            <tr
              className="text-xs"
              style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
            >
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
            {sessions
              .filter(s => new Date(s.starts_at).getTime() >= Date.now())
              .map(s => {
                  const c = counts[s.id] || { confirmed: 0, pending: 0, waitlist: 0, priority: 0, used: 0 };
                const deleting = pendingDelete === s.id;
                return (
                  <tr key={s.id} className="border-t" style={{ borderColor: 'var(--ring)' }}>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>{s.courses?.name || '—'}</td>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>
                      {fmtWhen(s.starts_at, s.ends_at)}
                      {s.confirm_deadline ? (
                        <div className="text-xs" style={{ color: 'var(--sub)' }}>
                          Confirm by {new Date(s.confirm_deadline).toLocaleDateString()}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>{s.location || '—'}</td>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>{s.capacity}</td>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>{c.confirmed}</td>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>{c.pending}</td>
                    <td className="p-2" style={{ color: 'var(--ink)' }}>{c.waitlist}</td>
                    <td className="p-2 text-center">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => viewRosterCSV(s)}
                          className="rounded-md px-2 py-1 text-xs ring-1 transition"
                          style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        >
                          Export CSV
                        </button>
                        <button
                          onClick={() => setInviteOpen(s)}
                          className="rounded-md px-2 py-1 text-xs ring-1 transition"
                          style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        >
                          Invite
                        </button>
                                {pendingDelete === s.id ? (
                                    <>
                                        <button
                                            onClick={() => void deleteSessionFinal(s.id)}
                                            className="rounded-md px-2 py-1 text-xs text-white transition"
                                            style={{ background: '#DC2626' }}
                                        >
                                            Confirm delete
                                        </button>
                                        <button
                                            onClick={() => setPendingDelete(null)}
                                            className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                        >
                                            Cancel
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => setPendingDelete(s.id)}
                                        className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                        style={{ background: 'var(--nav-item-bg)', borderColor: '#fecaca', color: '#b91c1c' }}
                                    >
                                        Delete
                                    </button>
                                )}
                      </div>
                    </td>
                    <td className="p-2">
                      <RosterButton session={s} onChanged={() => { void loadSessions(companyId); }} />
                    </td>
                  </tr>
                );
              })}
            {sessions.filter(s => new Date(s.starts_at).getTime() >= Date.now()).length === 0 && (
              <tr>
                <td colSpan={9} className="p-3 text-sm" style={{ color: 'var(--sub)' }}>
                  No upcoming sessions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {openNew && (
        <Modal title="Create training session" onClose={() => setOpenNew(false)}>
          <form onSubmit={createSession} className="space-y-3" style={{ color: 'var(--ink)' }}>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Course</label>
              <select
                className="w-full rounded-md px-3 py-2 ring-1"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
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
                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Date</label>
                <input
                  type="date"
                  className="w-full rounded-md px-3 py-2 ring-1"
                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Start time</label>
                <input
                  type="time"
                  className="w-full rounded-md px-3 py-2 ring-1"
                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                  value={form.start_time}
                  onChange={e => setForm({ ...form, start_time: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>End time (optional)</label>
                <input
                  type="time"
                  className="w-full rounded-md px-3 py-2 ring-1"
                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                  value={form.end_time}
                  onChange={e => setForm({ ...form, end_time: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Confirm by (optional)</label>
                <input
                  type="date"
                  className="w-full rounded-md px-3 py-2 ring-1"
                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                  value={form.confirm_deadline}
                  onChange={e => setForm({ ...form, confirm_deadline: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Capacity</label>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-md px-3 py-2 ring-1"
                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
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
                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Location</label>
                <input
                  className="w-full rounded-md px-3 py-2 ring-1"
                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                  value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
              <textarea
                className="w-full rounded-md px-3 py-2 ring-1"
                rows={3}
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <button
                disabled={saving}
                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              >
                {saving ? 'Creating…' : 'Create session'}
              </button>
              <button
                type="button"
                onClick={() => setOpenNew(false)}
                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
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
          <div className="space-y-3" style={{ color: 'var(--ink)' }}>
            <PeoplePicker
              people={people}
              homesById={homesById}
              selected={inviteSelected}
              onChange={setInviteSelected}
              placeholder="Search staff & managers…"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void sendInvitesFromRow()}
                disabled={inviteSelected.length === 0}
                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              >
                Send invites ({inviteSelected.length})
              </button>
              <button
                onClick={() => setInviteOpen(null)}
                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
              >
                Close
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--sub)' }}>
              Invites create <code>INVITED</code> rows. Staff/managers confirm via “My bookings”.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* === Roster drawer (confirmed attendees only) === */

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

  const [stagedRemove, setStagedRemove] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const att = await supabase
        .from('training_session_attendees')
        .select('session_id,user_id,status,confirmed_at,invited_at,booked_at,cancelled_at,attended_at,completed_at,noshow_at')
        .eq('session_id', session.id)
        .eq('status', 'CONFIRMED');
      if (att.error) throw att.error;

      const list = (att.data as unknown as Attendee[]) || [];
      const ids = Array.from(new Set(list.map(a => a.user_id)));

      const directory = await getPeopleDirectoryMap();
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
    if (error) { alert(error.message); return; }
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
        className="rounded-md px-2 py-1 text-xs ring-1 transition"
        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
      >
        View roster
      </button>
      {open && (
        <Modal title={`Roster — ${session.courses?.name || ''}`} onClose={() => setOpen(false)}>
          {loading ? (
            <p style={{ color: 'var(--sub)' }}>Loading…</p>
          ) : (
            <div className="space-y-3" style={{ color: 'var(--ink)' }}>
              <div className="overflow-x-auto rounded-md ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr
                      className="text-xs"
                      style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                    >
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
                        <tr key={`${a.session_id}-${a.user_id}`} className="border-t" style={{ borderColor: 'var(--ring)' }}>
                          <td className="p-2" style={{ color: 'var(--ink)' }}>{a.full_name || a.user_id.slice(0, 8)}</td>
                          <td className="p-2" style={{ color: 'var(--ink)' }}>{a.email || '—'}</td>
                          <td className="p-2" style={{ color: 'var(--ink)' }}>{a.status}</td>
                          <td className="p-2 text-center">
                            <div className="inline-flex items-center gap-2">
                              {!isStaged ? (
                                <button
                                  onClick={() => setStagedRemove(p => ({ ...p, [a.user_id]: true }))}
                                  className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                  style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                >
                                  Remove
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => void removeFinal(a.user_id)}
                                    className="rounded-md px-2 py-1 text-xs text-white transition"
                                    style={{ background: '#DC2626' }}
                                  >
                                    Remove
                                  </button>
                                  <button
                                    onClick={() => setStagedRemove(p => ({ ...p, [a.user_id]: false }))}
                                    className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
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
                        <td colSpan={4} className="p-3 text-sm" style={{ color: 'var(--sub)' }}>
                          No confirmed attendees yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {err && <div className="text-sm" style={{ color: '#F87171' }}>{err}</div>}
              <div className="text-xs" style={{ color: 'var(--sub)' }}>
                Removing sets <code>CANCELLED</code>. Your waitlist promotion trigger (if any) will take care of upgrades.
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/* ========================= TRACKING (company + managers) ========================= */

function isInPersonType(type?: string | null): boolean {
    const s = (type ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    return s.includes('inperson') || s.endsWith('person');
}
function hasRefresherCycle(years?: number | null): boolean {
    return typeof years === 'number' && years > 0;
}

function isInPerson(type?: string | null) {
    return isInPersonType(type);
}

function CreateFromCourseButton({ course }: { course: Course }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');
    const [companyId, setCompanyId] = useState<string>('');

    useEffect(() => {
        (async () => {
            const [{ data: u }, lvl] = await Promise.all([
                supabase.auth.getUser(),
                getEffectiveLevel(),
            ]);
            setUid(u.user?.id ?? null);
            setLevel((lvl as Level) || '4_STAFF');
        })();
    }, []);

    useEffect(() => {
        (async () => {
            if (!uid) return;
            const cid = await resolveCompanyIdForUser(uid, level);
            if (cid) setCompanyId(cid);
        })();
    }, [uid, level]);

    const [form, setForm] = useState<{
        date: string;
        start_time: string;
        end_time: string;
        confirm_deadline: string;
        capacity: number | '';
        location: string;
        notes: string;
    }>({
        date: '',
        start_time: '',
        end_time: '',
        confirm_deadline: '',
        capacity: '',
        location: '',
        notes: '',
    });

    async function create(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        if (!companyId) return setErr('No company in scope.');
        if (!form.date || !form.start_time) return setErr('Pick date and start time.');
        if (form.capacity === '' || Number(form.capacity) <= 0) {
            return setErr('Capacity must be a positive number.');
        }

        setSaving(true);
        try {
            const starts_at = new Date(`${form.date}T${form.start_time}:00`).toISOString();
            const ends_at = form.end_time ? new Date(`${form.date}T${form.end_time}:00`).toISOString() : null;
            const confirm_deadline = form.confirm_deadline
                ? new Date(`${form.confirm_deadline}T23:59:59`).toISOString()
                : null;

            const ins = await supabase
                .from('training_sessions')
                .insert({
                    company_id: companyId,
                    course_id: course.id,
                    starts_at,
                    ends_at,
                    confirm_deadline,
                    capacity: Number(form.capacity),
                    location: form.location || null,
                    notes: form.notes || null,
                    status: 'PUBLISHED', // important so booking RPCs work
                })
                .select('id')
                .single();

            if (ins.error) throw ins.error;

            // Close modal. (If you want to refresh other lists, you can do it from parent.)
            setOpen(false);
        } catch (e) {
            setErr((e as { message?: string })?.message ?? 'Failed to create session');
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
            >
                Create session…
            </button>

            {open && (
                <Modal title={`Create: ${course.name}`} onClose={() => setOpen(false)}>
                    <form onSubmit={create} className="space-y-3" style={{ color: 'var(--ink)' }}>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Date</label>
                                <input
                                    type="date"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.date}
                                    onChange={e => setForm({ ...form, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Start time</label>
                                <input
                                    type="time"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.start_time}
                                    onChange={e => setForm({ ...form, start_time: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>End time (optional)</label>
                                <input
                                    type="time"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.end_time}
                                    onChange={e => setForm({ ...form, end_time: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Confirm by (optional)</label>
                                <input
                                    type="date"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.confirm_deadline}
                                    onChange={e => setForm({ ...form, confirm_deadline: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Capacity</label>
                                <input
                                    type="number"
                                    min={1}
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
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
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Location</label>
                                <input
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.location}
                                    onChange={e => setForm({ ...form, location: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
                            <textarea
                                rows={3}
                                className="w-full rounded-md px-3 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={form.notes}
                                onChange={e => setForm({ ...form, notes: e.target.value })}
                            />
                        </div>

                        {err && <div className="text-sm" style={{ color: '#F87171' }}>{err}</div>}

                        <div className="flex gap-2">
                            <button
                                disabled={saving}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            >
                                {saving ? 'Creating…' : 'Create session'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </>
    );
}

function TrackingTab({ isCompany, isManager }: { isCompany: boolean; isManager: boolean }) {
    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');

    const [companyId, setCompanyId] = useState<string>('');
    const [companyName, setCompanyName] = useState<string>('');

    const [courses, setCourses] = useState<Course[]>([]);
    const [dues, setDues] = useState<
        Array<{
            user_id: string;
            course_id: string;
            course_name: string;
            next_due_date: string | null;
            status: 'OVERDUE' | 'DUE_SOON' | 'UP_TO_DATE';
        }>
    >([]);

    const [groupSize, setGroupSize] = useState<number>(10);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // ===== Create-session (tracked + eligible courses only) =====
    const [createCourses, setCreateCourses] = useState<Course[]>([]);
    const [createOpen, setCreateOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [createErr, setCreateErr] = useState<string | null>(null);
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

    // ===== Priority selector (PeoplePicker) =====
    type Person = {
        id: string;
        name: string;
        home_id?: string | null;
        position?: 'Manager' | 'Staff' | 'Bank';
        is_bank?: boolean;
    };

    type MemberFromAPI = {
        id: string | number;
        full_name?: string | null;
        email?: string | null;
        roles: {
            manager_homes?: Array<{ id: string | number }>;
            staff_home?: { id: string | number } | null;
            bank?: boolean;
        };
    };

    const [companyHomes, setCompanyHomes] = useState<{ id: string; name: string }[]>([]);
    const homesById = useMemo(() => new Map(companyHomes.map((h) => [h.id, h.name])), [companyHomes]);

    const [companyPeople, setCompanyPeople] = useState<Person[]>([]);
    const [nameById, setNameById] = useState<Record<string, string>>({});
    const [prioritySelected, setPrioritySelected] = useState<string[]>([]);

    // Manager scope toggles
    const restrictToManager = (isManager && !isCompany) && level !== '1_ADMIN';
    const [managerHomeIds, setManagerHomeIds] = useState<string[]>([]);
    const [allowedUserIds, setAllowedUserIds] = useState<Set<string>>(new Set());

    // ===== Suggestions (for selected course) =====
    type Suggestion = {
        user_id: string;
        next_due_date: string | null;
        status: 'OVERDUE' | 'DUE_SOON';
        reason: string;
        score: number;
    };
    const [prioritySuggestions, setPrioritySuggestions] = useState<Suggestion[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);

    // Can create?
    const canCreateSessions = isCompany || isManager || level === '1_ADMIN';

    // Identity & level
    useEffect(() => {
        (async () => {
            const [{ data: u }, lvl] = await Promise.all([supabase.auth.getUser(), getEffectiveLevel()]);
            setUid(u.user?.id ?? null);
            setLevel((lvl as Level) || '4_STAFF');
        })();
    }, []);

    // Load company scope + everything. Managers are restricted to their home(s).
    useEffect(() => {
        (async () => {
            if (!uid) return;
            setLoading(true);
            setErr(null);

            try {
                // Company scope
                const cid = await resolveCompanyIdForUser(uid, level);
                if (!cid) throw new Error('No company in scope.');
                setCompanyId(cid);

                const co = await supabase.from('companies').select('name').eq('id', cid).maybeSingle();
                if (!co.error) setCompanyName(co.data?.name || cid);

                // All company homes (normalize IDs to strings)
                const h = await supabase.from('homes').select('id,name').eq('company_id', cid);
                const allHomes = ((h.data as unknown as { id: string | number; name: string }[]) || []).map((x) => ({
                    id: String(x.id),
                    name: x.name,
                }));
                const allHomeIdSet = new Set(allHomes.map((x) => x.id));

                // Determine manager’s home(s), if restricted (normalize to strings)
                let mgrHomesStr: string[] = [];
                if (restrictToManager) {
                    try {
                        const raw = await getManagerHomeIds(uid);
                        mgrHomesStr = (raw || []).map((id: string | number) => String(id));
                    } catch {
                        mgrHomesStr = [];
                    }
                    setManagerHomeIds(mgrHomesStr);
                    // For labels in picker, show only manager’s homes
                    setCompanyHomes(allHomes.filter((hh) => mgrHomesStr.includes(hh.id)));
                } else {
                    // Company/admin see all homes
                    setCompanyHomes(allHomes);
                }

                // Tracked courses
                const monitored = await supabase
                    .from('training_monitored_courses')
                    .select('course_id, is_monitored')
                    .eq('company_id', cid)
                    .eq('is_monitored', true);
                const trackedIds = new Set<string>(
                    (((monitored.data as Array<{ course_id: string | number }> | null) ?? []).map((r) => String(r.course_id)))
                );

                // All company courses
                const cr = await supabase.from('courses').select('*').eq('company_id', cid).order('name');
                const companyCourses = (cr.data as Course[]) || [];
                setCourses(companyCourses);

                // Eligible for tracking (InPerson + refresher years > 0)
                const eligibleCourseIds = new Set(
                    companyCourses
                        .filter((c) => isInPersonType(c?.training_type) && hasRefresherCycle(c?.refresher_years))
                        .map((c) => c.id)
                );
                const trackedEligible = companyCourses.filter((c) => trackedIds.has(c.id) && eligibleCourseIds.has(c.id));
                setCreateCourses(trackedEligible);

                // Dues rows for tracking view (tracked + eligible + due soon/overdue)
                const tv = await supabase
                    .from('training_records_v')
                    .select('user_id, company_id, course_id, course_name, next_due_date, status')
                    .eq('company_id', cid);

                type DueStatus = 'OVERDUE' | 'DUE_SOON' | 'UP_TO_DATE';
                type DueRowRaw = {
                    user_id: string | number;
                    course_id: string | number;
                    course_name: string;
                    next_due_date: string | null;
                    status?: DueStatus | null;
                };
                type DueRow = Omit<DueRowRaw, 'status' | 'user_id' | 'course_id'> & { status: DueStatus; user_id: string; course_id: string };

                let dueRows: DueRow[] =
                    ((tv.data ?? []) as DueRowRaw[])
                        .map((r) => ({
                            user_id: String(r.user_id),
                            course_id: String(r.course_id),
                            course_name: r.course_name,
                            next_due_date: r.next_due_date,
                            status: r.status ?? 'UP_TO_DATE',
                        }))
                        .filter((r) => trackedIds.has(r.course_id) && eligibleCourseIds.has(r.course_id))
                        .filter((r) => r.status === 'DUE_SOON' || r.status === 'OVERDUE');

                // Memberships for role info + manager scope
                const hmAll = await supabase
                    .from('home_memberships')
                    .select('user_id,home_id,role')
                    .in('home_id', Array.from(allHomeIdSet));

                const homeMembershipRows =
                    ((hmAll.data as Array<{ user_id: string | number; home_id: string | number; role: string }> | null) ?? []).map(
                        (r) => ({
                            user_id: String(r.user_id),
                            home_id: String(r.home_id),
                            role: r.role,
                        })
                    );

                // API directory — may include staff_home/manager_homes even if home_memberships misses them
                let apiMembers: MemberFromAPI[] = [];
                try {
                    const dirRes = await fetch('/api/self/members/list');
                    if (dirRes.ok) {
                        const data = await dirRes.json();
                        apiMembers = (data?.members || []) as MemberFromAPI[];
                    }
                } catch {
                    /* ignore */
                }
                const apiIndex = new Map<string, MemberFromAPI>();
                apiMembers.forEach((m) => apiIndex.set(String(m.id), {
                    ...m,
                    id: String(m.id),
                    roles: {
                        manager_homes: (m.roles?.manager_homes || []).map((x) => ({ id: String(x.id) })),
                        staff_home: m.roles?.staff_home ? { id: String(m.roles.staff_home.id) } : null,
                        bank: !!m.roles?.bank,
                    },
                }));

                // Manager restriction — compute allowed users in manager’s home(s)
                const allowed = new Set<string>();
                if (restrictToManager) {
                    const mgrSet = new Set(mgrHomesStr);

                    // From home_memberships
                    for (const r of homeMembershipRows) {
                        if (mgrSet.has(r.home_id)) allowed.add(r.user_id);
                    }

                    // From API roles (staff_home/manager_homes)
                    for (const m of apiIndex.values()) {
                        const staffHome = m.roles?.staff_home?.id ? String(m.roles.staff_home.id) : null;
                        const mgrHomes = (m.roles?.manager_homes || []).map((x) => String(x.id));
                        const inScope = (staffHome && mgrSet.has(staffHome)) || mgrHomes.some((id) => mgrSet.has(id));
                        if (inScope) allowed.add(String(m.id));
                    }

                    // Always include self
                    if (uid) allowed.add(String(uid));
                }
                setAllowedUserIds(allowed);

                // Filter dues for managers
                if (restrictToManager) {
                    dueRows = dueRows.filter((r) => allowed.has(r.user_id));
                }
                setDues(dueRows);

                // ===== Build directory for PeoplePicker =====
                const cm = await supabase.from('company_memberships').select('user_id').eq('company_id', cid);
                const companyMembershipIds = new Set<string>(
                    (((cm.data as Array<{ user_id: string | number }> | null) ?? []).map((r) => String(r.user_id)))
                );

                // Start from union; intersect with allowed if manager
                const unionIds = new Set<string>();

                // from home_memberships
                for (const r of homeMembershipRows) {
                    if (!restrictToManager || allowed.has(r.user_id)) unionIds.add(r.user_id);
                }
                // from company_memberships
                for (const id of companyMembershipIds) {
                    if (!restrictToManager || allowed.has(id)) unionIds.add(id);
                }
                // from API directory
                for (const id of apiIndex.keys()) {
                    if (!restrictToManager || allowed.has(id)) unionIds.add(id);
                }
                // from dues
                for (const r of dueRows) {
                    if (!restrictToManager || allowed.has(r.user_id)) unionIds.add(r.user_id);
                }

                // Role labels
                const roleByUser = new Map<string, { home_id: string | null; position: 'Manager' | 'Staff' | 'Bank' }>();
                homeMembershipRows.forEach((r) => {
                    const prev = roleByUser.get(r.user_id);
                    const isMgr = r.role === 'MANAGER';
                    const home = r.home_id || prev?.home_id || null;
                    const pos: 'Manager' | 'Staff' = prev?.position === 'Manager' || isMgr ? 'Manager' : 'Staff';
                    roleByUser.set(r.user_id, { home_id: home, position: pos });
                });

                // Names (directory + profile fallback)
                const directory = await getPeopleDirectoryMap().catch(
                    () => new Map<string, { full_name: string | null; email: string | null }>()
                );
                const missingForNames = Array.from(unionIds).filter((id) => !(directory.get(id)?.full_name));
                const profileNameFallback = await getProfilesNameMap(missingForNames).catch(() => new Map<string, string | null>());

                // Compose Person[]
                const people: Person[] = [];
                const nameMap: Record<string, string> = {};

                for (const id of unionIds) {
                    const api = apiIndex.get(id);
                    const dirN = directory.get(id)?.full_name;
                    const profN = profileNameFallback.get(id) || null;
                    const baseName = api?.full_name || dirN || profN || (api?.email ?? id.slice(0, 8));

                    let position: 'Manager' | 'Staff' | 'Bank' = 'Staff';
                    let homeId: string | null = roleByUser.get(id)?.home_id ?? null;

                    if (api) {
                        const hasMgr = (api.roles?.manager_homes || []).length > 0;
                        const isBank = !!api.roles?.bank;
                        position = hasMgr ? 'Manager' : isBank ? 'Bank' : (roleByUser.get(id)?.position ?? 'Staff');
                        if (!homeId) {
                            const staff = api.roles?.staff_home?.id;
                            const mgr0 = api.roles?.manager_homes?.[0]?.id;
                            homeId = staff != null ? String(staff) : mgr0 != null ? String(mgr0) : null;
                        }
                    } else {
                        position = roleByUser.get(id)?.position ?? 'Staff';
                    }

                    const display = `${baseName} — ${position}`;
                    people.push({ id, name: display, home_id: homeId, position, is_bank: position === 'Bank' });
                    nameMap[id] = display;
                }

                // Include self if missing (friendly label)
                if (uid) {
                    const uidStr = String(uid);
                    if (!people.some((p) => p.id === uidStr)) {
                        const dirN = directory.get(uidStr)?.full_name || profileNameFallback.get(uidStr) || 'Me';
                        people.unshift({ id: uidStr, name: `${dirN} — Staff`, home_id: null, position: 'Staff', is_bank: false });
                        nameMap[uidStr] = `${dirN} — Staff`;
                    }
                }

                // Sort visibly
                people.sort((a, b) => a.name.localeCompare(b.name));

                setCompanyPeople(people);
                setNameById(nameMap);
            } catch (e) {
                setErr((e as { message?: string })?.message ?? 'Failed to load tracking');
            } finally {
                setLoading(false);
            }
        })();
    }, [uid, level, isCompany, isManager, restrictToManager]);

    // Suggestions — restrict to manager’s allowed users if needed
    useEffect(() => {
        (async () => {
            if (!createOpen || !form.course_id || !companyId) {
                setPrioritySuggestions([]);
                return;
            }
            setSuggestionsLoading(true);
            try {
                const rec = await supabase
                    .from('training_records_v')
                    .select('user_id, next_due_date, status')
                    .eq('company_id', companyId)
                    .eq('course_id', form.course_id)
                    .in('status', ['OVERDUE', 'DUE_SOON']);

                const now = Date.now();
                let list: Suggestion[] =
                    ((rec.data as Array<{ user_id: string | number; next_due_date: string | null; status: 'OVERDUE' | 'DUE_SOON' }> | null) ?? [])
                        .map((r) => {
                            const id = String(r.user_id);
                            const t = r.next_due_date ? new Date(r.next_due_date).getTime() : null;
                            const days = t ? Math.round((t - now) / (1000 * 60 * 60 * 24)) : null; // negative => overdue
                            const overdueDays = days !== null ? Math.max(0, -days) : 0;

                            const score = (r.status === 'OVERDUE' ? 2000 : 1000) + (r.status === 'OVERDUE' ? overdueDays : -(days ?? 9999));
                            const reason =
                                r.status === 'OVERDUE'
                                    ? `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`
                                    : `Due in ${Math.max(0, days ?? 0)} day${Math.max(0, days ?? 0) === 1 ? '' : 's'}`;

                            return { user_id: id, next_due_date: r.next_due_date, status: r.status, reason, score };
                        });

                // Manager restriction
                if (restrictToManager) {
                    list = list.filter((s) => allowedUserIds.has(s.user_id));
                }

                list.sort((a, b) => b.score - a.score);
                setPrioritySuggestions(list);
            } catch {
                setPrioritySuggestions([]);
            } finally {
                setSuggestionsLoading(false);
            }
        })();
    }, [createOpen, form.course_id, companyId, restrictToManager, allowedUserIds]);

    // Group for tracking cards
    const grouped = useMemo(() => {
        type DueRow = (typeof dues)[number];
        const byCourse = new Map<string, DueRow[]>();
        for (const r of dues) {
            if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, []);
            byCourse.get(r.course_id)!.push(r);
        }
        const out: Array<{ course: Course; rows: DueRow[] }> = [];
        for (const [course_id, list] of byCourse.entries()) {
            const course = courses.find((c) => c.id === course_id);
            if (!course) continue;
            const sorted = [...list].sort((a, b) => (a.next_due_date || '').localeCompare(b.next_due_date || ''));
            out.push({ course, rows: sorted.slice(0, Math.max(2, groupSize)) });
        }
        out.sort((a, b) => (a.rows[0]?.next_due_date || '').localeCompare(b.rows[0]?.next_due_date || ''));
        return out;
    }, [dues, courses, groupSize]);

    // Create session (+ grant priority places)
    async function createSession(e: React.FormEvent) {
        e.preventDefault();
        setCreateErr(null);
        if (!companyId) return setCreateErr('No company in scope.');
        if (!form.course_id) return setCreateErr('Pick a course.');
        if (!form.date || !form.start_time) return setCreateErr('Pick date and start time.');
        if (form.capacity === '' || Number(form.capacity) <= 0) return setCreateErr('Capacity must be a positive number.');

        setSaving(true);
        try {
            const starts_at = new Date(`${form.date}T${form.start_time}:00`).toISOString();
            const ends_at = form.end_time ? new Date(`${form.date}T${form.end_time}:00`).toISOString() : null;
            const confirm_deadline = form.confirm_deadline ? new Date(`${form.confirm_deadline}T23:59:59`).toISOString() : null;

            const ins = await supabase
                .from('training_sessions')
                .insert({
                    company_id: companyId,
                    course_id: form.course_id,
                    starts_at,
                    ends_at,
                    confirm_deadline,
                    capacity: Number(form.capacity),
                    location: form.location || null,
                    notes: form.notes || null,
                    status: 'PUBLISHED',
                })
                .select('id')
                .single();
            if (ins.error) throw ins.error;

            const newId = (ins.data as unknown as { id: string } | null)?.id;

            if (newId && prioritySelected.length > 0) {
                await assignPriorityPlaces(newId, prioritySelected);
            }

            // Reset + close
            setCreateOpen(false);
            setPrioritySelected([]);
            setPrioritySuggestions([]);
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
        } catch (e) {
            setCreateErr((e as { message?: string })?.message ?? 'Failed to create session');
        } finally {
            setSaving(false);
        }
    }

    // Priority placement via RPCs (with safe fallback)
    async function assignPriorityPlaces(sessionId: string, userIds: string[]) {
        const ids = Array.from(new Set(userIds.map(String))).filter(Boolean);
        if (!sessionId || ids.length === 0) return;

        const { error, data } = await supabase.rpc('invite_priority_to_training_session_v1', {
            p_session: sessionId,
            p_user_ids: ids,
        });

        if (error) {
            alert('Priority placement failed: ' + (error.message || String(error)));
        }
    }


    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

    return (
        <section className="space-y-4" style={{ color: 'var(--ink)' }}>
            {/* Top bar */}
            <div
                className="rounded-lg p-3 ring-1 flex flex-wrap items-end gap-3"
                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
            >
                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                    Company:&nbsp;
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>
                        {companyName || companyId}
                    </span>
                </div>

                <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                        Group size
                    </label>
                    <select
                        className="rounded-md px-3 py-2 ring-1"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={groupSize}
                        onChange={(e) => setGroupSize(Number(e.target.value))}
                    >
                        {[10, 20, 30, 40, 50, 60].map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </div>

                {canCreateSessions && (
                    <div className="ml-auto">
                        <button
                            onClick={() => {
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
                                setPrioritySelected([]);
                                setPrioritySuggestions([]);
                                setCreateErr(null);
                                setCreateOpen(true);
                            }}
                            disabled={createCourses.length === 0}
                            className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            title={createCourses.length === 0 ? 'Add tracked courses in Settings first' : 'Create a new session'}
                        >
                            Create session…
                        </button>
                    </div>
                )}
            </div>

            {err && (
                <div className="text-sm" style={{ color: '#F87171' }}>
                    {err}
                </div>
            )}

            {/* Tracking cards */}
            {grouped.length === 0 ? (
                <div
                    className="rounded-lg p-4 ring-1"
                    style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--sub)' }}
                >
                    No one is currently near due for your tracked in-person courses.
                </div>
            ) : (
                grouped.map(({ course, rows }) => (
                    <div key={course.id} className="rounded-lg ring-1 overflow-hidden" style={{ borderColor: 'var(--ring)' }}>
                        <div className="px-3 py-2 flex items-center justify-between" style={{ background: 'var(--nav-item-bg)' }}>
                            <div>
                                <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                                    {course.name}
                                </div>
                                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                    {course.refresher_years ? `Every ${course.refresher_years} year${course.refresher_years > 1 ? 's' : ''}` : 'One-off'}
                                    &nbsp;•&nbsp;Due soon threshold: {course.due_soon_days ?? 60} days
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto" style={{ background: 'var(--card-grad)' }}>
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr
                                        className="text-xs"
                                        style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                                    >
                                        <th className="text-left p-2">Name</th>
                                        <th className="text-left p-2">Next due</th>
                                        <th className="text-left p-2">Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r) => {
                                        const display = nameById[String(r.user_id)] || String(r.user_id).slice(0, 8);
                                        return (
                                            <tr key={`${r.user_id}-${r.course_id}`} className="border-t" style={{ borderColor: 'var(--ring)' }}>
                                                <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                    {display}
                                                </td>
                                                <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                    {r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : '—'}
                                                </td>
                                                <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                    Needs training to maintain compliance.
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))
            )}

            <p className="text-xs" style={{ color: 'var(--sub)' }}>
                Due soon and Overdue come from <code>training_records_v</code>.
            </p>

            {/* Create-session modal (with PRIORITY selector + Suggestions) */}
            {createOpen && (
                <Modal title="Create training session" onClose={() => setCreateOpen(false)}>
                    <form onSubmit={createSession} className="space-y-4" style={{ color: 'var(--ink)' }}>
                        {/* Course & timing */}
                        <div>
                            <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                Course
                            </label>
                            <select
                                className="w-full rounded-md px-3 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={form.course_id}
                                onChange={(e) => setForm({ ...form, course_id: e.target.value })}
                                required
                            >
                                <option value="">{createCourses.length ? 'Select…' : 'No tracked eligible courses'}</option>
                                {createCourses.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                        {typeof c.refresher_years === 'number' && c.refresher_years > 0
                                            ? ` — Every ${c.refresher_years} year${c.refresher_years > 1 ? 's' : ''}`
                                            : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                    Date
                                </label>
                                <input
                                    type="date"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.date}
                                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                    Start time
                                </label>
                                <input
                                    type="time"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.start_time}
                                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                    End time (optional)
                                </label>
                                <input
                                    type="time"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.end_time}
                                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                    Confirm by (optional)
                                </label>
                                <input
                                    type="date"
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.confirm_deadline}
                                    onChange={(e) => setForm({ ...form, confirm_deadline: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                    Capacity
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.capacity}
                                    onChange={(e) =>
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
                                <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                    Location
                                </label>
                                <input
                                    className="w-full rounded-md px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                    value={form.location}
                                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                Notes
                            </label>
                            <textarea
                                rows={3}
                                className="w-full rounded-md px-3 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            />
                        </div>

                        {/* ===== Priority places (search anyone + suggestions) ===== */}
                        <div className="rounded-lg p-3 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                                    Priority places
                                </h4>
                                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                    {prioritySelected.length} selected{form.capacity !== '' ? ` • capacity ${form.capacity}` : ''}
                                </div>
                            </div>

                            {/* Suggestions — show names (already restricted for managers) */}
                            {form.course_id && (
                                <div className="mb-3">
                                    <div className="text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                        {suggestionsLoading ? 'Loading suggestions…' : 'Suggested (needs this most)'}
                                    </div>
                                    {prioritySuggestions.length === 0 ? (
                                        <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                            {suggestionsLoading ? ' ' : 'No suggestions for this course right now.'}
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {prioritySuggestions.slice(0, 12).map((sug) => {
                                                const label =
                                                    nameById[sug.user_id] ||
                                                    companyPeople.find((p) => p.id === sug.user_id)?.name ||
                                                    sug.user_id.slice(0, 8);
                                                const selected = prioritySelected.includes(sug.user_id);
                                                return (
                                                    <button
                                                        key={sug.user_id}
                                                        type="button"
                                                        onClick={() =>
                                                            setPrioritySelected((prev) =>
                                                                prev.includes(sug.user_id) ? prev.filter((x) => x !== sug.user_id) : [...prev, sug.user_id]
                                                            )
                                                        }
                                                        title={sug.reason}
                                                        className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ring-1 transition"
                                                        style={{
                                                            background: selected ? 'var(--nav-item-bg)' : 'var(--panel-bg)',
                                                            color: 'var(--ink)',
                                                            borderColor: selected ? 'var(--ring-strong)' : 'var(--ring)',
                                                        }}
                                                    >
                                                        <span className="font-medium">{label}</span>
                                                        <span style={{ color: 'var(--sub)' }}>• {sug.reason}</span>
                                                        <span className="rounded px-1 ring-1" style={{ borderColor: 'var(--ring)', color: 'var(--sub)' }}>
                                                            {sug.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}
                                                        </span>
                                                        <span className="text-sm">{selected ? '−' : '+'}</span>
                                                    </button>
                                                );
                                            })}
                                            {prioritySuggestions.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setPrioritySelected((prev) => {
                                                            const ids = prioritySuggestions.slice(0, Math.min(prioritySuggestions.length, 10)).map((p) => p.user_id);
                                                            return Array.from(new Set([...prev, ...ids]));
                                                        })
                                                    }
                                                    className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                                >
                                                    Add top {Math.min(prioritySuggestions.length, 10)}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Picker — company sees all; managers only their home(s) thanks to filtering */}
                            <PeoplePicker
                                people={companyPeople}
                                homesById={homesById}
                                selected={prioritySelected}
                                onChange={setPrioritySelected}
                                placeholder={restrictToManager ? 'Search people in your home(s)…' : 'Search anyone in the company…'}
                                solidOverlay
                                constrainToViewport
                            />

                            <p className="mt-2 text-xs" style={{ color: 'var(--sub)' }}>
                                People added here will receive priority places when you create the session.
                            </p>
                        </div>

                        {createErr && (
                            <div className="text-sm" style={{ color: '#F87171' }}>
                                {createErr}
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                disabled={saving || createCourses.length === 0}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            >
                                {saving ? 'Creating…' : 'Create session'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setCreateOpen(false)}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Orbit input styling guards */}
            <style jsx global>{`
        [data-orbit='1'] select,
        [data-orbit='1'] input[type='date'],
        [data-orbit='1'] input[type='time'],
        [data-orbit='1'] input[type='number'],
        [data-orbit='1'] input[type='text'],
        [data-orbit='1'] textarea {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        [data-orbit='1'] select option {
          color: var(--ink);
          background-color: #0b1221;
        }
      `}</style>
        </section>
    );
}



/* ========================= SETTINGS — tracked courses (company/admin only) ========================= */

function SettingsSection() {
    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');

    const [companyId, setCompanyId] = useState<string>('');
    const [companyName, setCompanyName] = useState<string>('');

    // Eligible company courses (InPerson + has refresher cycle)
    const [courses, setCourses] = useState<Course[]>([]);
    // Tracked course IDs
    const [tracked, setTracked] = useState<Set<string>>(new Set());

    // UI
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    // Add
    const [addCourseId, setAddCourseId] = useState<string>('');
    const [adding, setAdding] = useState(false);

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
                // Scope company
                const cid = await resolveCompanyIdForUser(uid, level);
                if (!cid) throw new Error('No company in scope.');
                setCompanyId(cid);

                const co = await supabase.from('companies').select('name').eq('id', cid).maybeSingle();
                if (!co.error) setCompanyName(co.data?.name || cid);

                // Company courses → list ALL courses created by this company
                const cr = await supabase
                    .from('courses')
                    .select('id, company_id, name, training_type, refresher_years')
                    .eq('company_id', cid)
                    .order('name');

                if (cr.error) throw cr.error;

                setCourses((cr.data as unknown as Course[]) || []);

                // Tracked rows
                const mr = await supabase
                    .from('training_monitored_courses')
                    .select('course_id, is_monitored')
                    .eq('company_id', cid);

                const on = new Set(
                    ((mr.data as Array<{ course_id: string; is_monitored: boolean | null }> | null) ?? [])
                        .filter((r) => !!r.is_monitored)
                        .map((r) => r.course_id),
                );
                setTracked(on);
            } catch (e) {
                setErr((e as { message?: string })?.message ?? 'Failed to load settings');
            } finally {
                setLoading(false);
            }
        })();
    }, [uid, level]);

    const availableToAdd = courses.filter((c) => !tracked.has(c.id));

    async function addMonitoredCourse() {
        if (!companyId || !addCourseId) return;
        setAdding(true);
        setErr(null);
        setOk(null);
        try {
            const up = await supabase
                .from('training_monitored_courses')
                .upsert(
                    { company_id: companyId, course_id: addCourseId, is_monitored: true },
                    { onConflict: 'company_id,course_id' },
                );
            if (up.error) throw up.error;

            setTracked((prev) => new Set(prev).add(addCourseId));
            setAddCourseId('');
            setOk('Course added to tracking.');
            window.setTimeout(() => setOk(null), 1800);
        } catch (e) {
            setErr((e as { message?: string })?.message ?? 'Failed to add course');
        } finally {
            setAdding(false);
        }
    }

    async function deleteTracked(course_id: string) {
        try {
            const r = await supabase
                .from('training_monitored_courses')
                .update({ is_monitored: false })
                .eq('company_id', companyId)
                .eq('course_id', course_id);

            if (r.error) throw r.error;

            setTracked((prev) => {
                const next = new Set(prev);
                next.delete(course_id);
                return next;
            });
        } catch (e) {
            alert((e as { message?: string })?.message ?? 'Failed to remove from tracking');
        }
    }


    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

    return (
        <section className="space-y-4" style={{ color: 'var(--ink)' }}>
            <div className="rounded-lg p-4 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--ink)' }}>Tracked courses</h2>

                <div className="text-xs mb-3" style={{ color: 'var(--sub)' }}>
                    Company:&nbsp;<span className="font-medium" style={{ color: 'var(--ink)' }}>{companyName || companyId}</span>
                </div>

                {/* Add tracked course */}
                <div className="mb-3 flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="sm:w-96">
                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                            Add course
                        </label>
                        <select
                            className="w-full rounded-md px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={addCourseId}
                            onChange={(e) => setAddCourseId(e.target.value)}
                        >
                            <option value="">Select…</option>
                            {availableToAdd.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}{typeof c.refresher_years === 'number' && c.refresher_years > 0
                                        ? ` — Every ${c.refresher_years} year${c.refresher_years > 1 ? 's' : ''}`
                                        : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <button
                            onClick={() => void addMonitoredCourse()}
                            disabled={!addCourseId || adding}
                            className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-60"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        >
                            {adding ? 'Adding…' : 'Add to tracking'}
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="mt-1 flex gap-3">
                    {err && <span className="text-sm" style={{ color: '#F87171' }}>{err}</span>}
                    {ok && <span className="text-sm text-emerald-700 [data-orbit='1']:text-emerald-200">{ok}</span>}
                </div>

                {/* Tracked list */}
                <div className="mt-4 overflow-x-auto rounded-lg ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr
                                className="text-xs"
                                style={{ color: 'var(--sub)', background: 'var(--nav-item-bg)', borderBottom: '1px solid var(--ring)' }}
                            >
                                <th className="text-left p-2">Course</th>
                                <th className="text-left p-2">Cycle</th>
                                <th className="p-2 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from(tracked).length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="p-3 text-sm" style={{ color: 'var(--sub)' }}>
                                        No tracked courses yet.
                                    </td>
                                </tr>
                            ) : (
                                Array.from(tracked)
                                    .map((id) => courses.find((c) => c.id === id))
                                    .filter((c): c is Course => !!c)
                                    .map((c) => (
                                        <tr key={c.id} className="border-t" style={{ borderColor: 'var(--ring)' }}>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>{c.name}</td>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                Every {c.refresher_years} year{(c.refresher_years ?? 0) > 1 ? 's' : ''}
                                            </td>
                                            <td className="p-2 text-center">
                                                <button
                                                    onClick={() => void deleteTracked(c.id)}
                                                    className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                                    style={{ background: 'var(--nav-item-bg)', borderColor: '#fecaca', color: '#b91c1c' }}
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                            )}
                        </tbody>
                    </table>
                </div>

                <p className="mt-3 text-xs" style={{ color: 'var(--sub)' }}>
                    Only courses added here will appear in <em>Tracking</em>.
                </p>
            </div>

            {/* Orbit input styling guards, if this renders standalone */}
            <style jsx global>{`
        [data-orbit="1"] select {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        [data-orbit="1"] select option {
          color: var(--ink);
          background-color: #0b1221;
        }
      `}</style>
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
      <div
        className="absolute inset-0"
        onClick={onClose}
        style={{ background: 'rgba(0,0,0,0.35)' }}
      />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div
          className="w-full max-w-2xl rounded-2xl p-4 ring-1 shadow-lg"
          style={{ background: 'var(--panel-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              className="rounded-lg p-1 ring-1 transition"
              aria-label="Close"
              type="button"
              style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={2}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div style={{ color: 'var(--ink)' }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function PeoplePicker({
    people,
    homesById,
    selected,
    onChange,
    placeholder = 'Search people…',
    disabled = false,
    solidOverlay = false,           // NEW
    constrainToViewport = false,    // NEW
}: {
    people: { id: string; name: string; home_id?: string | null; is_bank?: boolean }[];
    homesById: Map<string, string>;
    selected: string[];
    onChange: (ids: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
    solidOverlay?: boolean;
    constrainToViewport?: boolean;
}) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [dropUp, setDropUp] = useState(false);
    const [maxH, setMaxH] = useState(256); // px

    // Make search robust (matches name + home name)
    const normalize = (s: string) =>
        s.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim();

    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const list = useMemo(() => {
        const q = normalize(query);
        const base = q
            ? people.filter(p => {
                const home = p.home_id ? homesById.get(p.home_id) ?? '' : p.is_bank ? 'bank staff' : '';
                const hay = normalize(`${p.name} ${home}`);
                return hay.includes(q);
            })
            : people;
        return base.filter(p => !selectedSet.has(p.id)).slice(0, 100);
    }, [people, query, selectedSet, homesById]);

    function add(id: string) {
        onChange([...selected, id]);
        setQuery('');
        setOpen(false);
    }
    function remove(id: string) {
        onChange(selected.filter(x => x !== id));
    }

    // Compute dropdown direction + max height so it never goes off page
    function recomputeDropdownLayout() {
        if (!constrainToViewport || !containerRef.current) return;
        const el = inputRef.current || containerRef.current;
        const rect = el.getBoundingClientRect();
        const margin = 8;
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 800;
        const spaceBelow = viewportH - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const wantDropUp = spaceBelow < 220 && spaceAbove > spaceBelow;
        const space = wantDropUp ? spaceAbove : spaceBelow;
        const clamped = Math.max(180, Math.min(360, space)); // keep it usable
        setDropUp(wantDropUp);
        setMaxH(clamped);
    }

    useEffect(() => {
        if (!open || !constrainToViewport) return;
        recomputeDropdownLayout();
        const onScrollOrResize = () => recomputeDropdownLayout();
        window.addEventListener('resize', onScrollOrResize);
        window.addEventListener('scroll', onScrollOrResize, true);
        return () => {
            window.removeEventListener('resize', onScrollOrResize);
            window.removeEventListener('scroll', onScrollOrResize, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, constrainToViewport, list.length]);

    const inputBg = solidOverlay ? 'var(--panel-bg)' : 'var(--nav-item-bg)';
    const dropdownBg = solidOverlay ? 'var(--panel-bg)' : 'var(--nav-item-bg)';

    return (
        <div ref={containerRef} className="space-y-2" style={{ color: 'var(--ink)' }}>
            {/* Chips */}
            <div className="flex flex-wrap gap-2">
                {selected.map(id => {
                    const p = people.find(x => x.id === id);
                    const label = p ? p.name : id.slice(0, 8);
                    const ctx = p?.home_id ? homesById.get(p.home_id) : p?.is_bank ? 'Bank staff' : '—';
                    return (
                        <span
                            key={id}
                            className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        >
                            <span className="font-medium" style={{ color: 'var(--ink)' }}>{label}</span>
                            <span style={{ color: 'var(--sub)' }}>({ctx || '—'})</span>
                            <button
                                type="button"
                                className="rounded-md px-1 text-sm ring-1 transition"
                                onClick={() => remove(id)}
                                disabled={disabled}
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            >
                                ×
                            </button>
                        </span>
                    );
                })}
                {selected.length === 0 && <span className="text-xs" style={{ color: 'var(--sub)' }}>No one selected yet.</span>}
            </div>

            {/* Search + dropdown */}
            <div className="relative max-w-lg">
                <input
                    ref={inputRef}
                    disabled={disabled}
                    className="w-full rounded-lg px-3 py-2 ring-1"
                    placeholder={placeholder}
                    value={query}
                    onChange={e => {
                        setQuery(e.target.value);
                        setOpen(true);
                        requestAnimationFrame(recomputeDropdownLayout);
                    }}
                    onFocus={() => {
                        setOpen(true);
                        requestAnimationFrame(recomputeDropdownLayout);
                    }}
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
                        if (e.key === 'Escape') setOpen(false);
                    }}
                    // Opaque input background for Orbit
                    style={{
                        background: inputBg,
                        // ensure opacity in Orbit (fallback)
                        backgroundColor: solidOverlay ? 'rgba(11,18,33,0.98)' : undefined,
                        color: 'var(--ink)',
                        borderColor: 'var(--ring)',
                    }}
                />

                {open && list.length > 0 && (
                    <div
                        className="absolute z-[9999] mt-1 w-full rounded-xl ring-1 shadow-lg pp-dropdown"
                        onMouseDown={e => e.preventDefault()} // keep focus so clicks work
                        style={{
                            // position either below or above the input
                            top: dropUp ? 'auto' : 'calc(100% + 4px)',
                            bottom: dropUp ? 'calc(100% + 4px)' : 'auto',
                            background: dropdownBg,
                            // hard opaque fallback so Orbit can't make it see-through
                            backgroundColor: 'rgba(11,18,33,0.98)',
                            borderColor: 'var(--ring)',
                            maxHeight: maxH,
                            overflowY: 'auto',
                        }}
                    >
                        {list.map((p, i) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => add(p.id)}
                                className="w-full text-left px-3 py-2 text-sm transition"
                                style={{
                                    background: i === highlight ? 'var(--nav-item-bg-hover)' : 'transparent',
                                    color: 'var(--ink)',
                                }}
                                onMouseEnter={() => setHighlight(i)}
                            >
                                <div className="font-medium" style={{ color: 'var(--ink)' }}>{p.name}</div>
                                <div className="text-xs" style={{ color: 'var(--sub)' }}>
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
