'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

/* ========= Theme ========= */
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

/* ========= Types ========= */
type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type TrainingType = 'TES' | 'InPerson' | 'ELearning' | 'Other' | null;

type Course = {
    id: string;
    company_id: string;
    name: string;
    refresher_years: number | null;
    training_type: string; // keep as string to match DB values
    mandatory: boolean; // global mandatory (Everyone)
    mandatory_dsl?: boolean | null; // true when targets (specific people) exist ➜ shows "Conditional"
    due_soon_days: number;
    link?: string | null;
};

type RecordV = {
    id: string; // real id or synthetic "assignment:user"
    user_id: string;
    course_id: string;
    date_completed: string | null; // nullable for pending rows (assignments)
    certificate_path: string | null;
    company_id: string;
    course_name: string;
    refresher_years: number | null;
    training_type: string;
    mandatory: boolean; // legacy global (from view)
    due_soon_days: number;
    next_due_date: string | null;
    status: 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE';
};

/* ========= Page ========= */
export default function TrainingPage() {
    const [level, setLevel] = useState<Level>('4_STAFF');

    useEffect(() => {
        (async () => {
            const lvl = await getEffectiveLevel();
            setLevel(lvl as Level);
        })();
    }, []);

    const isAdmin = level === '1_ADMIN';
    const isCompany = level === '2_COMPANY';
    const isManager = level === '3_MANAGER';

    const [tab, setTab] = useState<'MY' | 'TEAM' | 'SET' | 'COURSES'>('MY');

    const showTeam = isAdmin || isCompany || isManager;
    const showSet = isAdmin || isCompany || isManager;
    const showCourses = isAdmin || isCompany || isManager;

    useEffect(() => {
        if (!showTeam && tab === 'TEAM') setTab('MY');
        if (!showSet && tab === 'SET') setTab('MY');
        if (!showCourses && tab === 'COURSES') setTab('MY');
    }, [showTeam, showSet, showCourses, tab]);

    return (
        <div className="p-6 space-y-6" style={{ color: 'var(--ink)' }}>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
                Training
            </h1>

            {/* Tabs (match payslips) */}
            <div className="flex gap-2">
                <TabBtn active={tab === 'MY'} onClick={() => setTab('MY')}>
                    My Training
                </TabBtn>
                {showTeam && (
                    <TabBtn active={tab === 'TEAM'} onClick={() => setTab('TEAM')}>
                        Team Training
                    </TabBtn>
                )}
                {showSet && (
                    <TabBtn active={tab === 'SET'} onClick={() => setTab('SET')}>
                        Set Training
                    </TabBtn>
                )}
                {showCourses && (
                    <TabBtn
                        active={tab === 'COURSES'}
                        onClick={() => setTab('COURSES')}
                    >
                        Course Settings
                    </TabBtn>
                )}
            </div>

            {tab === 'MY' && <MyTraining />}
            {tab === 'TEAM' && showTeam && (
                <TeamTraining isAdmin={isAdmin} isCompany={isCompany} />
            )}
            {tab === 'SET' && showSet && (
                <SetTraining
                    isAdmin={isAdmin}
                    isCompany={isCompany}
                    isManager={isManager}
                />
            )}
            {tab === 'COURSES' && showCourses && <CourseSettings isAdmin={isAdmin} />}

            {/* --- Orbit-only native control fixes (scoped) --- */}
            <style jsx global>{`
        [data-orbit='1'] select,
        [data-orbit='1'] input[type='number'],
        [data-orbit='1'] input[type='date'] {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        [data-orbit='1'] select option {
          color: var(--ink);
          background-color: #0b1221;
        }
        @-moz-document url-prefix() {
          [data-orbit='1'] select option {
            background-color: #0b1221;
          }
        }
        [data-orbit='1'] select:where(:not(:disabled)) {
          opacity: 1;
        }
      `}</style>
        </div>
    );
}

function TabBtn(
    {
        active,
        children,
        ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean },
) {
    const style = active
        ? {
            background: BRAND_GRADIENT,
            color: '#FFFFFF',
            borderColor: 'var(--ring-strong)',
        }
        : {
            background: 'var(--nav-item-bg)',
            color: 'var(--ink)',
            borderColor: 'var(--ring)',
        };
    return (
        <button
            className="px-4 py-2 text-sm rounded-md ring-1 transition"
            style={style}
            {...props}
        >
            {children}
        </button>
    );
}

/* ========= Small UI atoms ========= */

function CoursePicker({
    courses,
    value,
    onChange,
    placeholder = 'Type to search…',
}: {
    courses: { id: string; name: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);

    const items = useMemo(() => {
        const q = value.trim().toLowerCase();
        const base = q ? courses.filter((c) => c.name.toLowerCase().includes(q)) : courses;
        const seen = new Set<string>();
        const cleaned = base.filter((c) => {
            const k = c.name.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        return cleaned.slice(0, 50);
    }, [courses, value]);

    useEffect(() => {
        if (!open) setHighlight(0);
        else if (highlight >= items.length) setHighlight(items.length - 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, items.length]);

    function commit(val: string) {
        onChange(val);
        setOpen(false);
    }

    // put this directly above the return in CoursePicker()
    const isOrbit = typeof document !== 'undefined' && document.documentElement.dataset.orbit === '1';

    return (
        <div className="relative">
            <input
                className="w-full rounded-lg px-3 py-2 ring-1"
                style={{
                    background: 'var(--nav-item-bg)',
                    color: 'var(--ink)',
                    borderColor: 'var(--ring)',
                }}
                placeholder={placeholder}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                    requestAnimationFrame(() => setOpen(false));
                }}
                onKeyDown={(e) => {
                    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true);
                    if (!open) return;
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setHighlight((h) => Math.min(h + 1, items.length - 1));
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlight((h) => Math.max(h - 1, 0));
                    }
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (items[highlight]) commit(items[highlight].name);
                    }
                    if (e.key === 'Escape') {
                        setOpen(false);
                    }
                }}
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls="course-combobox-list"
                role="combobox"
            />
            {open && (
                <div
                    id="course-combobox-list"
                    role="listbox"
                    className="absolute z-50 mt-1 w-full rounded-xl ring-1 shadow-lg max-h-64 overflow-auto"
                    style={{
                        /* 👇 solid surface only in Orbit */
                        background: isOrbit ? 'var(--panel-bg)' : 'var(--nav-item-bg)',
                        borderColor: 'var(--ring)',
                    }}
                >
                    {items.length === 0 ? (
                        <div className="px-3 py-2 text-sm" style={{ color: 'var(--sub)' }}>
                            No matches
                        </div>
                    ) : (
                        items.map((c, i) => (
                            <button
                                key={c.id}
                                role="option"
                                aria-selected={i === highlight}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => commit(c.name)}
                                className="w-full text-left px-3 py-2 text-sm"
                                style={{
                                    background: i === highlight ? 'var(--nav-item-bg-hover)' : 'transparent',
                                    color: 'var(--ink)',
                                }}
                            >
                                <div className="font-medium" style={{ color: 'var(--ink)' }}>
                                    {c.name}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );

}

function CertificateCell({ path }: { path?: string | null }) {
    const [signing, setSigning] = useState(false);
    const [url, setUrl] = useState<string | null>(null);

    if (!path) return <span style={{ color: 'var(--sub)' }}>—</span>;

    async function getUrl() {
        try {
            setSigning(true);

            // Narrow `path` for this closure so TS knows it's a string
            if (typeof path !== 'string' || !path) {
                throw new Error('Could not open certificate');
            }

            const { data, error } = await supabase.storage
                .from('certificates')
                .createSignedUrl(path, 60 * 10);

            if (error) throw error;
            setUrl(data.signedUrl);
        } catch (e) {
            const message =
                e instanceof Error && typeof e.message === 'string'
                    ? e.message
                    : 'Could not open certificate';
            // eslint-disable-next-line no-alert
            alert(message);
        } finally {
            setSigning(false);
        }
    }

    return url ? (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="underline"
            style={{ color: 'var(--brand-link)' }}
            onClick={() => {
                /* keep link */
            }}
        >
            View
        </a>
    ) : (
        <button
            type="button"
            onClick={getUrl}
            disabled={signing}
            className="rounded-md px-2 py-1 text-xs ring-1 disabled:opacity-60 transition"
            style={{
                background: 'var(--nav-item-bg)',
                color: 'var(--ink)',
                borderColor: 'var(--ring)',
            }}
        >
            {signing ? 'Loading…' : 'View'}
        </button>
    );
}

/* =========================
   MY TRAINING (self only)
   ========================= */
function MyTraining() {
    const [uid, setUid] = useState<string | null>(null);
    const [companyId, setCompanyId] = useState<string>('');
    const [courses, setCourses] = useState<Course[]>([]);
    const [coursesWithTargets, setCoursesWithTargets] = useState<Set<string>>(new Set());

    const [records, setRecords] = useState<RecordV[]>([]);
    const [myMandatoryCourseIds, setMyMandatoryCourseIds] = useState<Set<string>>(new Set());

    // user already has (record or assignment)
    const ownedCourseIds = useMemo(() => {
        const s = new Set<string>();
        records.forEach((r) => s.add(r.course_id));
        return s;
    }, [records]);

    // only show courses the user doesn't already have
    const availableCourses = useMemo(() => {
        return courses.filter((c) => !ownedCourseIds.has(c.id));
    }, [courses, ownedCourseIds]);

    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // form state
    const [courseName, setCourseName] = useState(''); // combobox text
    const [dateCompleted, setDateCompleted] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);

    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setErr(null);

            const { data: uRes, error: uErr } = await supabase.auth.getUser();
            if (uErr || !uRes?.user?.id) {
                setErr('Not signed in');
                setLoading(false);
                return;
            }
            const me = uRes.user.id;
            setUid(me);

            // Determine company id
            let cid = '';
            const cm = await supabase
                .from('company_memberships')
                .select('company_id')
                .eq('user_id', me)
                .limit(1)
                .maybeSingle();
            if (cm.data?.company_id) {
                cid = cm.data.company_id;
            } else {
                const hm = await supabase
                    .from('home_memberships')
                    .select('home_id')
                    .eq('user_id', me)
                    .limit(1)
                    .maybeSingle();
                if (hm.data?.home_id) {
                    const h = await supabase
                        .from('homes')
                        .select('company_id')
                        .eq('id', hm.data.home_id)
                        .single();
                    if (h.data?.company_id) cid = h.data.company_id;
                } else {
                    const bm = await supabase
                        .from('bank_memberships')
                        .select('company_id')
                        .eq('user_id', me)
                        .limit(1)
                        .maybeSingle();
                    if (bm.data?.company_id) cid = bm.data.company_id;
                }
            }
            setCompanyId(cid);

            // Courses (company-scoped if we have cid)
            const cq = supabase.from('courses').select('*').order('name');
            const c = cid ? await cq.eq('company_id', cid) : await cq;
            if (c.error) setErr(c.error.message);
            else {
                const list: Course[] = Array.isArray(c.data) ? (c.data as Course[]) : [];
                setCourses(list);

                // mark which courses have any individual targets
                if (list.length) {
                    const ids = list.map((x) => x.id);
                    const t = await supabase
                        .from('course_mandatory_targets')
                        .select('course_id')
                        .in('course_id', ids);
                    const set = new Set<string>();
                    (t.data || []).forEach((row) => {
                        if (typeof (row as { course_id?: string }).course_id === 'string') {
                            set.add((row as { course_id: string }).course_id);
                        }
                    });
                    setCoursesWithTargets(set);
                } else {
                    setCoursesWithTargets(new Set());
                }
            }

            // My records
            const r = await supabase
                .from('training_records_v')
                .select('*')
                .eq('user_id', me)
                .order('date_completed', { ascending: false });
            if (r.error) {
                setErr(r.error.message);
            } else {
                setRecords((Array.isArray(r.data) ? r.data : []) as typeof records);
            }

            // Targeted mandatory (conditional) that applies to ME
            const t = await supabase
                .from('course_mandatory_targets')
                .select('course_id')
                .eq('user_id', me);
            if (!t.error) {
                const ids = new Set<string>(
                    Array.isArray(t.data)
                        ? t.data
                            .filter(
                                (row): row is { course_id: string } =>
                                    typeof (row as { course_id?: unknown }).course_id === 'string',
                            )
                            .map((row) => row.course_id)
                        : [],
                );
                setMyMandatoryCourseIds(ids);
            }

            setLoading(false);
        })();
    }, []);

    const courseMap = useMemo(() => {
        const m = new Map<string, Course>();
        availableCourses.forEach((c) => m.set(c.name.toLowerCase(), c));
        return m;
    }, [availableCourses]);

    // map by ID for table rows
    const courseById = useMemo(() => {
        const m = new Map<string, Course>();
        courses.forEach((c) => m.set(c.id, c));
        return m;
    }, [courses]);

    // pending assignment ids in my view
    const pendingAssignedCourseIds = useMemo(() => {
        const s = new Set<string>();
        records.forEach((r) => {
            if (!r.date_completed) s.add(r.course_id);
        });
        return s;
    }, [records]);

    // required courses for ME (global or targeted only)
    const requiredCourseIds = useMemo(() => {
        const s = new Set<string>();
        courses.forEach((c) => {
            if (c.mandatory || myMandatoryCourseIds.has(c.id)) s.add(c.id);
        });
        return s;
    }, [courses, myMandatoryCourseIds]);

    const mandatoryTotal = requiredCourseIds.size;

    const mandatoryCompleted = useMemo(() => {
        const done = new Set<string>();
        records.forEach((r) => {
            if (requiredCourseIds.has(r.course_id) && r.status === 'UP_TO_DATE') {
                done.add(r.course_id);
            }
        });
        return done.size;
    }, [records, requiredCourseIds]);

    async function refreshList() {
        if (!uid) return;
        const r = await supabase
            .from('training_records_v')
            .select('*')
            .eq('user_id', uid)
            .order('date_completed', { ascending: false });
        if (!r.error) {
            setRecords(Array.isArray(r.data) ? (r.data as typeof records) : []);
        }
    }

    // Add a training record for the selected course
    async function onAddRecord(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        try {
            if (!uid) throw new Error('Not signed in.');
            if (!companyId) throw new Error('Could not determine your company.');
            const choice = courseMap.get(courseName.trim().toLowerCase());
            if (!choice) throw new Error('Please pick a course from the list.');
            if (!dateCompleted) throw new Error('Date completed is required.');

            setSaving(true);

            // 1) insert record
            const ins = await supabase
                .from('training_records')
                .insert({ user_id: uid, course_id: choice.id, date_completed: dateCompleted })
                .select('id')
                .single();
            if (ins.error) throw ins.error;
            const recordId: string = ins.data.id;

            // 2) optional upload
            if (file) {
                const safe = file.name.replace(/\s+/g, '_');
                const path = `${recordId}/${Date.now()}-${safe}`;
                const up = await supabase.storage.from('certificates').upload(path, file, { upsert: true });
                if (up.error) throw up.error;
                const upd = await supabase
                    .from('training_records')
                    .update({ certificate_path: path })
                    .eq('id', recordId);
                if (upd.error) throw upd.error;
            }

            // 3) stamp assignment complete if this fulfilled one
            const { error: completeErr } = await supabase.rpc('assignment_complete_for_record', {
                p_record_id: recordId,
            });
            if (completeErr) console.warn('assignment_complete_for_record:', completeErr.message);

            // reset + refresh
            setCourseName('');
            setDateCompleted('');
            setFile(null);
            await refreshList();
        } catch (e) {
            const message =
                e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to add record';
            setErr(message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

    return (
        <div className="space-y-6">
            {/* Add form + Summary */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Add record */}
                <div
                    className="rounded-lg p-4 space-y-3 ring-1"
                    style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                >
                    <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                        Add training
                    </h2>
                    <form onSubmit={onAddRecord} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                            <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                Course
                            </label>
                            <CoursePicker
                                courses={availableCourses.map(({ id, name }) => ({ id, name }))}
                                value={courseName}
                                onChange={setCourseName}
                                placeholder="Search courses…"
                            />
                            <p className="text-xs mt-1" style={{ color: 'var(--sub)' }}>
                                {companyId ? 'Courses for your company.' : 'Courses you can access.'}
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                Date completed
                            </label>
                            <input
                                type="date"
                                className="w-full rounded-lg px-3 py-2 ring-1"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                                value={dateCompleted}
                                onChange={(e) => setDateCompleted(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                                Certificate (optional)
                            </label>
                            <input
                                type="file"
                                className="w-full rounded-lg px-3 py-2 ring-1"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <button
                                disabled={saving}
                                className="rounded-md px-3 py-2 text-sm ring-1 transition disabled:opacity-50"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                            >
                                {saving ? 'Saving…' : 'Submit'}
                            </button>
                        </div>
                        {err && (
                            <p className="sm:col-span-2 text-sm" style={{ color: '#dc2626' }}>
                                {err}
                            </p>
                        )}
                    </form>
                </div>

                {/* Right: Summary (mandatory x/y reflects *my* mandatory set) */}
                <TrainingSummary
                    records={records}
                    mandatoryCompleted={mandatoryCompleted}
                    mandatoryTotal={mandatoryTotal}
                />
            </section>

            {/* List (fixed height, scroll) */}
            <section className="space-y-2">
                <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                    My records
                </h2>
                {records.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--sub)' }}>
                        No training logged yet.
                    </p>
                ) : (
                    <div
                        className="rounded-lg ring-1"
                        style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                    >
                        <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead
                                    className="sticky top-0 z-10"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)' }}
                                >
                                    <tr>
                                        <th className="text-left p-2">Course</th>
                                        <th className="text-left p-2">Completed</th>
                                        <th className="text-left p-2">Next due</th>
                                        <th className="text-left p-2">Refresher</th>
                                        <th className="text-left p-2">Type</th>
                                        <th className="text-left p-2">Mandatory</th>
                                        <th className="text-left p-2">Status</th>
                                        <th className="text-left p-2">Link</th>
                                        <th className="text-left p-2">Certificate</th>
                                        <th className="p-2">Edit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.map((r) => {
                                        const course = courseById.get(r.course_id);
                                        const mandatoryLabel = course
                                            ? course.mandatory
                                                ? 'Yes'
                                                : coursesWithTargets.has(course.id)
                                                    ? 'Conditional'
                                                    : 'No'
                                            : r.mandatory
                                                ? 'Yes'
                                                : 'No';

                                        return (
                                            <MyRow
                                                key={r.id}
                                                r={r}
                                                mandatoryLabel={mandatoryLabel}
                                                refresh={refreshList}
                                                courseLink={course?.link ?? null}
                                            />
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

function MyRow({
    r,
    mandatoryLabel,
    refresh,
    courseLink,
}: {
    r: RecordV;
    mandatoryLabel: string;
    refresh: () => void;
    courseLink?: string | null;
}) {
    const [editing, setEditing] = useState(false);
    const [date, setDate] = useState(r.date_completed || '');
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false); // NEW

    const isPending = !r.date_completed; // synthetic assignment rows

    // Light-mode base + Orbit overrides (like payslips banners)
    const badgeBase =
        r.status === 'OVERDUE'
            ? 'bg-rose-50 text-rose-700 ring-rose-100'
            : r.status === 'DUE_SOON'
                ? 'bg-amber-50 text-amber-700 ring-amber-100'
                : 'bg-emerald-50 text-emerald-700 ring-emerald-100';
    const badgeOrbit =
        r.status === 'OVERDUE'
            ? '[data-orbit="1"]:bg-rose-500/10 [data-orbit="1"]:text-rose-200 [data-orbit="1"]:ring-rose-400/25'
            : r.status === 'DUE_SOON'
                ? '[data-orbit="1"]:bg-amber-500/10 [data-orbit="1"]:text-amber-200 [data-orbit="1"]:ring-amber-400/25'
                : '[data-orbit="1"]:bg-emerald-500/10 [data-orbit="1"]:text-emerald-200 [data-orbit="1"]:ring-emerald-400/25';

    async function downloadCert() {
        if (!r.certificate_path) return;
        const { data, error } = await supabase.storage.from('certificates').download(r.certificate_path);
        if (error) return alert(error.message);
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = r.certificate_path.split('/').pop() || 'certificate';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function save() {
        setBusy(true);
        try {
            if (isPending) {
                if (!date) throw new Error('Pick a completion date.');
                const { data: u } = await supabase.auth.getUser();
                const me = u?.user?.id;
                if (!me) throw new Error('Not signed in.');

                // insert a real record
                const ins = await supabase
                    .from('training_records')
                    .insert({ user_id: me, course_id: r.course_id, date_completed: date })
                    .select('id')
                    .single();
                if (ins.error) throw ins.error;
                const recordId: string = ins.data.id;

                if (file) {
                    const safe = file.name.replace(/\s+/g, '_');
                    const path = `${recordId}/${Date.now()}-${safe}`;
                    const up = await supabase.storage.from('certificates').upload(path, file, { upsert: true });
                    if (up.error) throw up.error;
                    const upd = await supabase
                        .from('training_records')
                        .update({ certificate_path: path })
                        .eq('id', recordId);
                    if (upd.error) throw upd.error;
                }

                const { error: completeErr } = await supabase.rpc('assignment_complete_for_record', {
                    p_record_id: recordId,
                });
                if (completeErr) console.warn('assignment_complete_for_record:', completeErr.message);

                setEditing(false);
                await refresh();
            } else {
                // update existing record
                const upd = await supabase
                    .from('training_records')
                    .update({ date_completed: date })
                    .eq('id', r.id);
                if (upd.error) throw upd.error;

                if (file) {
                    const safe = file.name.replace(/\s+/g, '_');
                    const path = `${r.id}/${Date.now()}-${safe}`;
                    const up = await supabase.storage.from('certificates').upload(path, file, { upsert: true });
                    if (up.error) throw up.error;
                    const upd2 = await supabase
                        .from('training_records')
                        .update({ certificate_path: path })
                        .eq('id', r.id);
                    if (upd2.error) throw upd2.error;
                }

                setEditing(false);
                await refresh();
            }
        } catch (e) {
            const message =
                e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to save';
            // eslint-disable-next-line no-alert
            alert(message);
        } finally {
            setBusy(false);
        }
    }

    async function onDelete() {
        if (isPending) return; // safety
        setBusy(true);
        try {
            const del = await supabase.from('training_records').delete().eq('id', r.id);
            if (del.error) throw del.error;
            setConfirmDelete(false); // close the inline box
            await refresh();
        } catch (e) {
            const message =
                e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to delete';
            // eslint-disable-next-line no-alert
            alert(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <tr className="align-top border-t" style={{ borderColor: 'var(--ring)' }}>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {r.course_name}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {r.date_completed ? new Date(r.date_completed).toLocaleDateString() : '—'}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : '—'}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {r.refresher_years ? `${r.refresher_years} yr${r.refresher_years > 1 ? 's' : ''}` : '—'}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {r.training_type}
            </td>
            <td className="p-2" style={{ color: 'var(--ink)' }}>
                {mandatoryLabel}
            </td>
            <td className="p-2">
                <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ring-1 ${badgeBase} ${badgeOrbit}`}
                >
                    {r.status === 'OVERDUE' ? 'Overdue' : r.status === 'DUE_SOON' ? 'Due soon' : 'Up to date'}
                </span>
            </td>
            <td className="p-2">
                {courseLink ? (
                    <a href={courseLink} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--brand-link)' }}>
                        Open
                    </a>
                ) : (
                    '—'
                )}
            </td>
            <td className="p-2">
                {r.certificate_path ? (
                    <button onClick={downloadCert} className="underline" style={{ color: 'var(--brand-link)' }}>
                        Download
                    </button>
                ) : (
                    '—'
                )}
            </td>
            <td className="p-2">
                {/* Not editing & not showing delete confirm */}
                {!editing && !confirmDelete && (
                    <div className="flex gap-2">
                        {!r.date_completed ? (
                            <button
                                onClick={() => setEditing(true)}
                                className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                            >
                                Mark complete
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={() => setEditing(true)}
                                    className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => setConfirmDelete(true)}
                                    className="rounded-md px-2 py-1 text-xs ring-1 transition"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        borderColor: 'var(--ring)',
                                        color: '#b91c1c',
                                    }}
                                >
                                    Delete
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* Inline red confirm box */}
                {!editing && confirmDelete && (
                    <div
                        className="space-y-2 min-w-[260px] rounded-lg p-2 ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                    >
                        <div className="text-xs" style={{ color: '#7f1d1d' }} data-orbit="0">
                            Delete this “{r.course_name}” record? This cannot be undone.
                        </div>
                        <div className="text-xs hidden [data-orbit='1']:block [data-orbit='1']:text-rose-200">
                            Delete this “{r.course_name}” record? This cannot be undone.
                        </div>
                        <div className="flex gap-2">
                            <button
                                disabled={busy}
                                onClick={onDelete}
                                className="rounded px-2 py-1 text-xs text-white transition"
                                style={{ background: '#B91C1C' }}
                            >
                                {busy ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => setConfirmDelete(false)}
                                className="rounded px-2 py-1 text-xs ring-1 transition"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Editing UI */}
                {editing && (
                    <div className="space-y-1 min-w-[220px]">
                        <input
                            type="date"
                            className="rounded px-2 py-1 text-xs w-full ring-1"
                            style={{
                                background: 'var(--nav-item-bg)',
                                color: 'var(--ink)',
                                borderColor: 'var(--ring)',
                            }}
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                        <input
                            type="file"
                            className="rounded px-2 py-1 text-xs w-full ring-1"
                            style={{
                                background: 'var(--nav-item-bg)',
                                color: 'var(--ink)',
                                borderColor: 'var(--ring)',
                            }}
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                        />
                        <div className="flex gap-2">
                            <button
                                disabled={busy}
                                onClick={save}
                                className="rounded px-2 py-1 text-xs ring-1 transition disabled:opacity-60"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                            >
                                {busy ? 'Saving…' : !r.date_completed ? 'Save & complete' : 'Save'}
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => {
                                    setEditing(false);
                                    setDate(r.date_completed || '');
                                    setFile(null);
                                }}
                                className="rounded px-2 py-1 text-xs ring-1 transition"
                                style={{
                                    background: 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                    borderColor: 'var(--ring)',
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </td>
        </tr>
    );
}

/* ===== Shared summary helpers + components ===== */

type Status = 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE';

function summarize(records: { status: Status }[]) {
    const total = records.length;
    let upToDate = 0,
        dueSoon = 0,
        overdue = 0;
    for (const r of records) {
        if (r.status === 'UP_TO_DATE') upToDate++;
        else if (r.status === 'DUE_SOON') dueSoon++;
        else if (r.status === 'OVERDUE') overdue++;
    }
    return { total, upToDate, dueSoon, overdue };
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
    return (
        <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
            <span style={{ color: 'var(--ink)' }}>{label}</span>
            <span className="ml-auto tabular-nums" style={{ color: 'var(--ink)' }}>
                {value}
            </span>
        </div>
    );
}

function StatusPie({
    upToDate,
    dueSoon,
    overdue,
}: {
    upToDate: number;
    dueSoon: number;
    overdue: number;
}) {
    const total = upToDate + dueSoon + overdue;
    const a = total ? (overdue / total) * 360 : 0;
    const b = total ? (dueSoon / total) * 360 : 0;
    const startB = a;
    const endB = a + b;
    const bg = total
        ? `conic-gradient(#f43f5e 0deg ${a}deg, #f59e0b ${startB}deg ${endB}deg, #10b981 ${endB}deg 360deg)`
        : `conic-gradient(#e5e7eb 0deg 360deg)`;

    return (
        <div className="flex items-center gap-4">
            <div className="relative h-36 w-36 rounded-full flex-none" style={{ background: bg }}>
                <div
                    className="absolute inset-4 rounded-full ring-1"
                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                />
                <div className="absolute inset-0 grid place-items-center">
                    <div className="text-center">
                        <div className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
                            {total}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--sub)' }}>
                            total
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2 text-sm">
                <LegendRow color="#10b981" label="Up to date" value={upToDate} />
                <LegendRow color="#f59e0b" label="Due soon" value={dueSoon} />
                <LegendRow color="#f43f5e" label="Overdue" value={overdue} />
            </div>
        </div>
    );
}

/* Simple donut chart used in ComplianceAnalytics */
function Donut({
    segments,
    centerLabel,
    size = 160,
}: {
    segments: { label: string; value: number; color: string }[];
    centerLabel?: string;
    size?: number;
}) {
    const total = segments.reduce((s, x) => s + (x.value || 0), 0);
    let acc = 0;
    const stops = segments.map((seg) => {
        const sweep = total ? (seg.value / total) * 360 : 0;
        const from = acc;
        const to = acc + sweep;
        acc = to;
        return `${seg.color} ${from}deg ${to}deg`;
    });
    const bg = total ? `conic-gradient(${stops.join(',')})` : 'conic-gradient(#e5e7eb 0deg 360deg)';
    const holeInset = Math.max(12, Math.round(size * 0.2)); // thickness of the ring

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <div className="absolute inset-0 rounded-full" style={{ background: bg }} />
            <div
                className="absolute rounded-full ring-1"
                style={{ inset: `${holeInset}px`, background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
            />
            <div className="absolute inset-0 grid place-items-center">
                {centerLabel ? (
                    <div className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
                        {centerLabel}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function StatCard({
    label,
    value,
    sub,
    tone,
}: {
    label: string;
    value: number;
    sub?: string;
    tone: 'emerald' | 'amber' | 'rose';
}) {
    const badge =
        tone === 'emerald'
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
            : tone === 'amber'
                ? 'bg-amber-50 text-amber-700 ring-amber-100'
                : 'bg-rose-50 text-rose-700 ring-rose-100';

    const badgeOrbit =
        tone === 'emerald'
            ? '[data-orbit="1"]:bg-emerald-500/10 [data-orbit="1"]:text-emerald-200 [data-orbit="1"]:ring-emerald-400/25'
            : tone === 'amber'
                ? '[data-orbit="1"]:bg-amber-500/10 [data-orbit="1"]:text-amber-200 [data-orbit="1"]:ring-amber-400/25'
                : '[data-orbit="1"]:bg-rose-500/10 [data-orbit="1"]:text-rose-200 [data-orbit="1"]:ring-rose-400/25';

    return (
        <div
            className="rounded-lg p-2 text-center ring-1"
            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
        >
            <div
                className={`mx-auto mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${badge} ${badgeOrbit}`}
            >
                {label}
            </div>
            <div className="text-xl font-semibold leading-6 tabular-nums" style={{ color: 'var(--ink)' }}>
                {value}
            </div>
            {sub && (
                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                    {sub}
                </div>
            )}
        </div>
    );
}

function MandatoryCard({ completed, total }: { completed: number; total: number }) {
    return (
        <div
            className="inline-block rounded-lg p-3 text-center w-fit ring-1"
            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
        >
            <div
                className="mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 bg-indigo-50 text-indigo-700 ring-indigo-100
        [data-orbit='1']:bg-indigo-500/10 [data-orbit='1']:text-indigo-200 [data-orbit='1']:ring-indigo-400/25"
            >
                Mandatory completed
            </div>
            <div className="text-xl font-semibold leading-6 tabular-nums" style={{ color: 'var(--ink)' }}>
                {completed}/{total}
            </div>
            <div className="text-xs" style={{ color: 'var(--sub)' }}>
                up to date
            </div>
        </div>
    );
}

function TrainingSummary({
    records,
    title = 'Training summary',
    mandatoryCompleted,
    mandatoryTotal,
}: {
    records: { status: Status }[];
    title?: string;
    mandatoryCompleted?: number;
    mandatoryTotal?: number;
}) {
    const { total, upToDate, dueSoon, overdue } = summarize(records);
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

    const showMandatory =
        typeof mandatoryCompleted === 'number' && typeof mandatoryTotal === 'number';

    return (
        <section
            className="rounded-lg p-3 space-y-3 ring-1"
            style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
        >
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                {title}
            </h2>

            <div className="grid grid-cols-3 gap-2">
                <StatCard label="Up to date" value={upToDate} sub={`${pct(upToDate)}%`} tone="emerald" />
                <StatCard label="Due soon" value={dueSoon} sub={`${pct(dueSoon)}%`} tone="amber" />
                <StatCard label="Overdue" value={overdue} sub={`${pct(overdue)}%`} tone="rose" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                <StatusPie upToDate={upToDate} dueSoon={dueSoon} overdue={overdue} />
                {showMandatory && (
                    <div className="justify-self-end">
                        <MandatoryCard completed={mandatoryCompleted!} total={mandatoryTotal!} />
                    </div>
                )}
            </div>
        </section>
    );
}

/* =========================
   TEAM TRAINING (read + filters + certificate links)
   ========================= */
function TeamTraining({ isAdmin, isCompany }: { isAdmin: boolean; isCompany: boolean }) {
    type Level = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

    type RecordV = {
        id: string;
        user_id: string;
        company_id: string;
        course_id: string;
        course_name: string;
        date_completed: string | null;
        next_due_date: string | null;
        refresher_years: number | null;
        training_type: 'TES' | 'InPerson' | 'eLearning' | 'Other' | null;
        mandatory: boolean; // legacy everyone flag from the view
        status: 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE';
        certificate_path?: string | null;
    };

    type Roles = {
        bank: boolean;
        staff_home: { id: string; name: string } | null;
        manager_homes: { id: string; name: string }[];
    };

    type Row = RecordV & {
        user_name?: string;
        home_label?: string | null;
        home_id?: string | null;
        is_bank?: boolean;
    };

    const [level, setLevel] = useState<Level>('4_STAFF');
    const [uid, setUid] = useState<string | null>(null);

    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
    const [companyId, setCompanyId] = useState<string>('');

    const [homes, setHomes] = useState<{ id: string; name: string }[]>([]);
    const [list, setList] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // course meta for “Conditional” label/filter
    // courses that have any individual targets (-> Conditional if not Everyone)
    const [coursesWithTargets, setCoursesWithTargets] = useState<Set<string>>(new Set());

    // Compliance resources (NEW)
    const [roster, setRoster] = useState<
        { id: string; name: string; home_id?: string | null; is_bank?: boolean }[]
    >([]);
    const [perUserRequired, setPerUserRequired] = useState<Map<string, Set<string>>>(new Map()); // user → required course ids
    const [courseNameById, setCourseNameById] = useState<Map<string, string>>(new Map());
    const [complianceLoading, setComplianceLoading] = useState(true);

    // Secondary tabs
    const [subTab, setSubTab] = useState<'TEAM' | 'COMPLIANCE'>('TEAM');

    // Filters
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<'ALL' | 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE'>('ALL');
    const [hasCert, setHasCert] = useState<'ALL' | 'YES' | 'NO'>('ALL');
    const [mandatory, setMandatory] = useState<'ALL' | 'YES' | 'NO' | 'CONDITIONAL'>('ALL');
    const [homeId, setHomeId] = useState(''); // '' = All, 'BANK' = Bank staff

    // identity
    useEffect(() => {
        (async () => {
            const [{ data: u }, lvl] = await Promise.all([supabase.auth.getUser(), getEffectiveLevel()]);
            setUid(u.user?.id ?? null);
            setLevel((lvl as Level) || '4_STAFF');
        })();
    }, []);

    // roles fetcher
    async function fetchRoles(): Promise<Map<string, Roles>> {
        const res = await fetch('/api/self/members/list');
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);

        const map = new Map<string, Roles>();

        (Array.isArray(data.members) ? (data.members as unknown[]) : []).forEach((m: unknown) => {
            const member = m as {
                id?: unknown;
                roles?: {
                    bank?: unknown;
                    staff_home?: unknown; // could be string id or {id,name} or null
                    manager_homes?: unknown; // could be string[] or {id,name}[]
                };
            };

            const id = typeof member.id === 'string' ? member.id : null;
            if (!id) return;

            const raw = member.roles ?? {};

            // Normalize staff_home to {id,name} | null
            let staff_home: { id: string; name: string } | null = null;
            if (raw.staff_home && typeof raw.staff_home === 'object') {
                const sh = raw.staff_home as { id?: unknown; name?: unknown };
                if (typeof sh.id === 'string' && typeof sh.name === 'string') {
                    staff_home = { id: sh.id, name: sh.name };
                }
            } else if (typeof raw.staff_home === 'string') {
                // if API only returns an ID, keep name empty or resolve later
                staff_home = { id: raw.staff_home, name: '' };
            }

            // Normalize manager_homes to Array<{id,name}>
            let manager_homes: Array<{ id: string; name: string }> = [];
            if (Array.isArray(raw.manager_homes)) {
                // elements might be strings or objects
                manager_homes = raw.manager_homes
                    .map((h) => {
                        if (typeof h === 'string') return { id: h, name: '' };
                        if (h && typeof h === 'object') {
                            const ho = h as { id?: unknown; name?: unknown };
                            if (typeof ho.id === 'string' && typeof ho.name === 'string') {
                                return { id: ho.id, name: ho.name };
                            }
                        }
                        return null;
                    })
                    .filter((x): x is { id: string; name: string } => x !== null);
            }

            map.set(id, {
                bank: Boolean(raw.bank),
                staff_home,
                manager_homes,
            });
        });

        return map;
    }

    // helper: same fallback chain used in MyTraining
    async function getCompanyIdForUser(me: string) {
        const cm = await supabase
            .from('company_memberships')
            .select('company_id')
            .eq('user_id', me)
            .limit(1)
            .maybeSingle();
        if (cm.data?.company_id) return cm.data.company_id;

        const hm = await supabase
            .from('home_memberships')
            .select('home_id')
            .eq('user_id', me)
            .limit(1)
            .maybeSingle();
        if (hm.data?.home_id) {
            const h = await supabase
                .from('homes')
                .select('company_id')
                .eq('id', hm.data.home_id)
                .single();
            if (h.data?.company_id) return h.data.company_id;
        }

        const bm = await supabase
            .from('bank_memberships')
            .select('company_id')
            .eq('user_id', me)
            .limit(1)
            .maybeSingle();
        return bm.data?.company_id || '';
    }

    // Resolve scope (decide companyId or manager path)
    useEffect(() => {
        (async () => {
            if (!uid) return;
            setErr(null);

            try {
                if (isAdmin) {
                    const co = await supabase.from('companies').select('id,name').order('name');
                    const list = Array.isArray(co.data) ? co.data : [];
                    setCompanies(list);
                    if (!companyId && list[0]?.id) setCompanyId(list[0].id);
                } else if (isCompany) {
                    const cid = await getCompanyIdForUser(uid);
                    setCompanyId(cid || '');
                } else if (level === '3_MANAGER') {
                    setLoading(true);
                    await loadForManager(uid);
                    setLoading(false);
                } else {
                    setHomes([]);
                    setList([]);
                    setCoursesWithTargets(new Set());
                    setRoster([]);
                    setPerUserRequired(new Map());
                    setCourseNameById(new Map());
                }
            } catch (e) {
                const message =
                    e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to load';
                setErr(message);
                setHomes([]);
                setList([]);
                setCoursesWithTargets(new Set());
                setRoster([]);
                setPerUserRequired(new Map());
                setCourseNameById(new Map());
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid, level, isAdmin, isCompany]);

    // Load company data when companyId is known
    useEffect(() => {
        (async () => {
            if (!(isAdmin || isCompany)) return;
            if (!companyId) {
                setHomes([]);
                setList([]);
                setCoursesWithTargets(new Set());
                setRoster([]);
                setPerUserRequired(new Map());
                setCourseNameById(new Map());
                return;
            }

            setLoading(true);
            setErr(null);
            try {
                await loadForCompany(companyId);
            } catch (e) {
                const message =
                    e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to load';
                setErr(message);
                setHomes([]);
                setList([]);
                setCoursesWithTargets(new Set());
                setRoster([]);
                setPerUserRequired(new Map());
                setCourseNameById(new Map());
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId, isAdmin, isCompany]);

    async function fetchCoursesWithTargetsForCompany(cid: string) {
        // find all courses in company
        const cs = await supabase.from('courses').select('id').eq('company_id', cid);
        const ids = Array.isArray(cs.data)
            ? cs.data
                .filter((c): c is { id: string } => typeof (c as { id?: unknown }).id === 'string')
                .map((c) => c.id)
            : [];
        if (!ids.length) {
            setCoursesWithTargets(new Set());
            return;
        }

        const t = await supabase.from('course_mandatory_targets').select('course_id').in('course_id', ids);

        const set = new Set<string>();
        (Array.isArray(t.data) ? t.data : []).forEach((row) => {
            if (typeof (row as { course_id?: unknown }).course_id === 'string') {
                set.add((row as { course_id: string }).course_id);
            }
        });
        setCoursesWithTargets(set);
    }

    async function loadForCompany(cid: string) {
        // 1) Homes in company (for scoping + labels)
        const homesRes = await supabase.from('homes').select('id,name').eq('company_id', cid);
        if (homesRes.error) throw homesRes.error;
        const homesArr = Array.isArray(homesRes.data) ? homesRes.data : [];
        setHomes(homesArr);

        const companyHomeIds = homesArr.map((h) => h.id);
        const homeNameById = new Map<string, string>(homesArr.map((h) => [h.id, h.name]));

        // 2) Base roster (staff + bank) via RPC
        const rosterRes = await supabase.rpc('list_company_people', { p_company_id: cid });
        if (rosterRes.error) throw rosterRes.error;
        const baseRoster: { id: string; name: string; home_id: string | null; is_bank: boolean }[] = (
            Array.isArray(rosterRes.data) ? rosterRes.data : []
        ).map((r) => {
            const row = r as {
                user_id?: unknown;
                full_name?: unknown;
                name?: unknown;
                home_id?: unknown;
                is_bank?: unknown;
            };

            const user_id = typeof row.user_id === 'string' ? row.user_id : '';
            const full_name =
                typeof row.full_name === 'string' && row.full_name ? row.full_name : undefined;
            const alt_name = typeof row.name === 'string' && row.name ? row.name : undefined;

            const name = full_name ?? alt_name ?? (user_id ? user_id.slice(0, 8) : '');

            const home_id =
                typeof row.home_id === 'string' || row.home_id === null
                    ? (row.home_id as string | null)
                    : null;

            const is_bank = Boolean(row.is_bank);

            return { id: user_id, name, home_id, is_bank };
        });

        // 3) Add ALL managers of company homes (even with 0 records)
        let extraManagers: { id: string; home_id: string | null }[] = [];
        if (companyHomeIds.length) {
            const mgrMemberships = await supabase
                .from('home_memberships')
                .select('user_id, home_id, role')
                .in('home_id', companyHomeIds)
                .eq('role', 'MANAGER');
            if (mgrMemberships.error) throw mgrMemberships.error;

            // first home per manager (for a stable label)
            const firstHomeByUser = new Map<string, string | null>();
            (Array.isArray(mgrMemberships.data) ? mgrMemberships.data : []).forEach((m) => {
                const user_id = (m as { user_id?: unknown }).user_id;
                if (typeof user_id !== 'string') return;

                const home_idVal = (m as { home_id?: unknown }).home_id;
                const home_id = typeof home_idVal === 'string' ? home_idVal : null;

                if (!firstHomeByUser.has(user_id)) {
                    firstHomeByUser.set(user_id, home_id);
                }
            });

            const already = new Set(baseRoster.map((p) => p.id));
            extraManagers = Array.from(firstHomeByUser.entries())
                .filter(([uid]) => !already.has(uid))
                .map(([uid, hid]) => ({ id: uid, home_id: hid ?? null }));
        }

        // 4) Records for this company
        const recRes = await supabase.from('training_records_v').select('*').eq('company_id', cid);
        if (recRes.error) throw recRes.error;
        const recRows = Array.isArray(recRes.data) ? recRes.data : [];

        // 5) Merge roster: staff+bank + all managers
        const mergedRoster: { id: string; name: string; home_id: string | null; is_bank: boolean }[] = [
            ...baseRoster,
            ...extraManagers.map((m) => ({
                id: m.id,
                name: m.id.slice(0, 8), // temp, will overwrite from profiles
                home_id: m.home_id,
                is_bank: false,
            })),
        ];

        // 6) Fetch profiles for EVERYONE we might display (roster ∪ records)
        const allUserIds = Array.from(
            new Set([
                ...mergedRoster.map((p) => p.id),
                ...(Array.isArray(recRows)
                    ? recRows
                        .filter((r): r is { user_id: string } => typeof (r as { user_id?: unknown }).user_id === 'string')
                        .map((r) => r.user_id)
                    : []),
            ]),
        ).filter(Boolean);

        type ProfileRow = { user_id: string; full_name: string | null };

        const profiles = allUserIds.length
            ? await supabase.from('profiles').select('user_id, full_name').in('user_id', allUserIds)
            : { data: [] as ProfileRow[], error: null };
        if (profiles.error) throw profiles.error;

        const nameById = new Map<string, string>();
        (Array.isArray(profiles.data) ? profiles.data : []).forEach((p) => {
            const user_id = (p as { user_id?: unknown }).user_id;
            if (typeof user_id !== 'string') return;

            const full_nameVal = (p as { full_name?: unknown }).full_name;
            const full_name = typeof full_nameVal === 'string' ? full_nameVal.trim() : '';

            nameById.set(user_id, full_name);
        });

        // 7) Final roster with proper names
        const finalRoster = mergedRoster.map((p) => ({
            ...p,
            name: nameById.get(p.id) || p.name || p.id.slice(0, 8),
        }));
        setRoster(finalRoster);

        // quick maps for decorating rows
        const nameByUser = new Map<string, string>(finalRoster.map((p) => [p.id, p.name]));
        const homeIdByUser = new Map<string, string | null>(finalRoster.map((p) => [p.id, p.home_id]));
        const isBankByUser = new Map<string, boolean>(finalRoster.map((p) => [p.id, p.is_bank]));

        // 8) Decorated rows for TEAM table
        const rows: Row[] = (Array.isArray(recRows) ? recRows : []).map((r) => {
            const row = r as {
                user_id?: unknown;
                [key: string]: unknown;
            };

            const user_id = typeof row.user_id === 'string' ? row.user_id : '';
            const hid = homeIdByUser.get(user_id) ?? null;

            return {
                ...row,
                user_name: nameByUser.get(user_id) || (user_id ? user_id.slice(0, 8) : ''),
                home_id: hid,
                home_label: hid ? homeNameById.get(hid) || null : isBankByUser.get(user_id) ? 'Bank staff' : null,
                is_bank: Boolean(isBankByUser.get(user_id)),
            } as Row;
        });
        setList(rows);

        // 9) Build set of courses that have any targets (for “Conditional”)
        await fetchCoursesWithTargetsForCompany(cid);

        // 10) Build compliance inputs (includes managers even if they have zero records)
        await buildRosterAndComplianceForCompany(cid, finalRoster, rows);
    }

    async function loadForManager(me: string) {
        // managed homes
        const mh = await supabase
            .from('home_memberships')
            .select('home_id')
            .eq('user_id', me)
            .eq('role', 'MANAGER');
        const managed = Array.isArray(mh.data)
            ? mh.data
                .filter((x): x is { home_id: string } => typeof (x as { home_id?: unknown }).home_id === 'string')
                .map((x) => x.home_id)
            : [];
        if (managed.length === 0) {
            setHomes([]);
            setList([]);
            setRoster([]);
            setPerUserRequired(new Map<string, Set<string>>());
            setCourseNameById(new Map<string, string>());
            return;
        }

        const h = await supabase.from('homes').select('id,name,company_id').in('id', managed);
        const hs = Array.isArray(h.data) ? h.data : [];
        setHomes(hs.map((x) => ({ id: x.id, name: x.name })));
        const cid = hs[0]?.company_id || '';

        // people ids for those homes
        const stf = await supabase
            .from('home_memberships')
            .select('user_id')
            .in('home_id', managed)
            .eq('role', 'STAFF');
        const mgr = await supabase
            .from('home_memberships')
            .select('user_id')
            .in('home_id', managed)
            .eq('role', 'MANAGER');
        const ids = Array.from(
            new Set([
                ...(Array.isArray(stf.data)
                    ? stf.data
                        .filter((x): x is { user_id: string } => typeof (x as { user_id?: unknown }).user_id === 'string')
                        .map((x) => x.user_id)
                    : []),
                ...(Array.isArray(mgr.data)
                    ? mgr.data
                        .filter((x): x is { user_id: string } => typeof (x as { user_id?: unknown }).user_id === 'string')
                        .map((x) => x.user_id)
                    : []),
            ]),
        );
        if (ids.length === 0) {
            setList([]);
            setRoster([]);
            setPerUserRequired(new Map<string, Set<string>>());
            setCourseNameById(new Map<string, string>());
            return;
        }

        // records
        const r = await supabase.from('training_records_v').select('*').in('user_id', ids);
        const rows: RecordV[] = Array.isArray(r.data) ? (r.data as RecordV[]) : [];

        // names
        const prof = await supabase.from('profiles').select('user_id, full_name').in('user_id', ids);
        const nameMap = new Map<string, string>();
        (Array.isArray(prof.data) ? prof.data : []).forEach((p) => {
            const user_id = (p as { user_id?: unknown }).user_id;
            if (typeof user_id !== 'string') return;

            const full_nameVal = (p as { full_name?: unknown }).full_name;
            const full_name = typeof full_nameVal === 'string' ? full_nameVal : '';

            nameMap.set(user_id, full_name);
        });

        // roles
        const rolesByUser = await fetchRoles();

        const mapped: Row[] = rows.map((rec) => {
            const roles = rolesByUser.get(rec.user_id);
            const label =
                roles?.staff_home?.name ??
                (roles?.manager_homes?.length ? roles.manager_homes.map((h2) => h2.name).join(', ') : null);

            return {
                ...rec,
                user_name: nameMap.get(rec.user_id) || '',
                home_label: label,
                is_bank: !!roles?.bank && !roles?.staff_home && !(roles?.manager_homes?.length),
                roles,
            } as Row;
        });
        setList(mapped);

        if (cid) await fetchCoursesWithTargetsForCompany(cid);

        await buildRosterAndComplianceForManager(me, rolesByUser, managed, cid, mapped);
    }

    /* ===== Compliance helpers (per-person mandatory) ===== */
    async function buildRosterAndComplianceForCompany(
        cid: string,
        rosterIn: { id: string; name: string; home_id?: string | null; is_bank?: boolean }[],
        rows: Row[],
    ) {
        setComplianceLoading(true);
        try {
            setRoster(rosterIn);

            // course metadata for names + global mandatory
            const allCourses = await supabase.from('courses').select('id,name,mandatory').eq('company_id', cid);

            const nameById = new Map<string, string>();
            const globalMandatory = new Set<string>();
            (Array.isArray(allCourses.data) ? allCourses.data : []).forEach((c) => {
                const id = (c as { id?: unknown }).id;
                if (typeof id !== 'string') return;

                const nameVal = (c as { name?: unknown }).name;
                const name = typeof nameVal === 'string' ? nameVal : '';

                nameById.set(id, name);

                const mandatory = (c as { mandatory?: unknown }).mandatory;
                if (mandatory === true) {
                    globalMandatory.add(id);
                }
            });
            setCourseNameById(nameById);

            // individual targets (Conditional)
            const targetsByUser = new Map<string, Set<string>>();
            if (rosterIn.length) {
                const t = await supabase
                    .from('course_mandatory_targets')
                    .select('user_id,course_id')
                    .in('user_id', rosterIn.map((p) => p.id));
                (Array.isArray(t.data) ? t.data : []).forEach((row) => {
                    const r = row as { user_id?: unknown; course_id?: unknown };

                    const user_id = typeof r.user_id === 'string' ? r.user_id : null;
                    const course_id = typeof r.course_id === 'string' ? r.course_id : null;
                    if (!user_id || !course_id) return;

                    if (!targetsByUser.has(user_id)) {
                        targetsByUser.set(user_id, new Set<string>());
                    }
                    targetsByUser.get(user_id)!.add(course_id);
                });
            }

            // required = global ∪ targets   (❌ no assignments here)
            const required = new Map<string, Set<string>>();
            for (const p of rosterIn) {
                const s = new Set<string>();
                globalMandatory.forEach((id) => s.add(id));
                (targetsByUser.get(p.id) || new Set()).forEach((id) => s.add(id));
                required.set(p.id, s);
            }
            setPerUserRequired(required);
        } finally {
            setComplianceLoading(false);
        }
    }

    async function buildRosterAndComplianceForManager(
        me: string,
        rolesByUser: Map<string, Roles>,
        managed: string[],
        cid: string,
        rows: Row[],
    ) {
        setComplianceLoading(true);
        try {
            type ProfileRow = { user_id: string; full_name: string | null };
            type CourseRow = { id: string; name: string; mandatory: boolean };

            const stf = await supabase
                .from('home_memberships')
                .select('user_id, home_id')
                .in('home_id', managed)
                .eq('role', 'STAFF');

            const mgr = await supabase
                .from('home_memberships')
                .select('user_id, home_id')
                .in('home_id', managed)
                .eq('role', 'MANAGER');

            // Avoid inline object type in a type predicate; instead pluck safely to strings
            const stfIds = Array.isArray(stf.data)
                ? stf.data
                    .map((x) => {
                        const uid = (x as { user_id?: unknown }).user_id;
                        return typeof uid === 'string' ? uid : null;
                    })
                    .filter((v): v is string => v !== null)
                : [];

            const mgrIds = Array.isArray(mgr.data)
                ? mgr.data
                    .map((x) => {
                        const uid = (x as { user_id?: unknown }).user_id;
                        return typeof uid === 'string' ? uid : null;
                    })
                    .filter((v): v is string => v !== null)
                : [];

            const allIds = Array.from(new Set<string>([...stfIds, ...mgrIds]));

            const prof = allIds.length
                ? await supabase.from('profiles').select('user_id, full_name').in('user_id', allIds)
                : { data: [] as ProfileRow[] };

            const nameMap = new Map<string, string>();
            (Array.isArray(prof.data) ? prof.data : []).forEach((p) => {
                const user_id = (p as { user_id?: unknown }).user_id;
                if (typeof user_id !== 'string') return;

                const full_nameVal = (p as { full_name?: unknown }).full_name;
                const full_name = typeof full_nameVal === 'string' ? full_nameVal : '';

                nameMap.set(user_id, full_name);
            });

            const people = allIds.map((id) => {
                const roles = rolesByUser.get(id);
                const h = roles?.staff_home?.id || roles?.manager_homes?.[0]?.id || null;
                return {
                    id,
                    name: nameMap.get(id) || id.slice(0, 8),
                    home_id: h || undefined,
                    is_bank: !!roles?.bank && !roles?.staff_home && !(roles?.manager_homes?.length),
                };
            });
            setRoster(people);

            // Course names + global mandatory (for this company)
            const allCourses = cid
                ? await supabase.from('courses').select('id,name,mandatory').eq('company_id', cid)
                : { data: [] as CourseRow[] };

            const nameById = new Map<string, string>();
            const globalMandatory = new Set<string>();
            (Array.isArray(allCourses.data) ? allCourses.data : []).forEach((c) => {
                const id = (c as { id?: unknown }).id;
                if (typeof id !== 'string') return;

                const nameVal = (c as { name?: unknown }).name;
                const name = typeof nameVal === 'string' ? nameVal : '';

                nameById.set(id, name);

                const mandatory = (c as { mandatory?: unknown }).mandatory;
                if (mandatory === true) {
                    globalMandatory.add(id);
                }
            });
            setCourseNameById(nameById);

            // Individual targets for these users (Conditional)
            const targetsByUser = new Map<string, Set<string>>();
            if (people.length) {
                const t = await supabase
                    .from('course_mandatory_targets')
                    .select('user_id,course_id')
                    .in('user_id', people.map((p) => p.id));

                (Array.isArray(t.data) ? t.data : []).forEach((row) => {
                    const r = row as { user_id?: unknown; course_id?: unknown };

                    const user_id = typeof r.user_id === 'string' ? r.user_id : null;
                    const course_id = typeof r.course_id === 'string' ? r.course_id : null;
                    if (!user_id || !course_id) return;

                    if (!targetsByUser.has(user_id)) {
                        targetsByUser.set(user_id, new Set<string>());
                    }
                    targetsByUser.get(user_id)!.add(course_id);
                });
            }

            // Pending assignments per user (from rows)
            const pendingByUser = new Map<string, Set<string>>();
            for (const r of rows) {
                if (!r.date_completed) {
                    if (!pendingByUser.has(r.user_id)) pendingByUser.set(r.user_id, new Set());
                    pendingByUser.get(r.user_id)!.add(r.course_id);
                }
            }

            // per-user required = global ∪ targets   (❌ no assignments here)
            const required = new Map<string, Set<string>>();
            for (const p of people) {
                const s = new Set<string>();
                globalMandatory.forEach((id) => s.add(id));
                (targetsByUser.get(p.id) || new Set()).forEach((id) => s.add(id));
                required.set(p.id, s);
            }
            setPerUserRequired(required);
        } finally {
            setComplianceLoading(false);
        }
    }

    const showHomeFilter = isAdmin || isCompany || level === '3_MANAGER';

    function mandatoryInfoForRow(r: Row) {
        if (r.mandatory) return { label: 'Yes', isMandatory: true, isConditional: false };
        const hasSomeTargets = coursesWithTargets.has(r.course_id);
        if (hasSomeTargets) return { label: 'Conditional', isMandatory: true, isConditional: true };
        return { label: 'No', isMandatory: false, isConditional: false };
    }

    // filtered rows for TEAM table
    const filtered = useMemo(() => {
        let rows = [...list];

        if (status !== 'ALL') rows = rows.filter((r) => r.status === status);
        if (hasCert !== 'ALL')
            rows = rows.filter((r) => (hasCert === 'YES' ? !!r.certificate_path : !r.certificate_path));

        if (mandatory !== 'ALL') {
            rows = rows.filter((r) => {
                const info = mandatoryInfoForRow(r);
                if (mandatory === 'YES') return info.isMandatory && !info.isConditional;
                if (mandatory === 'CONDITIONAL') return info.isConditional;
                return !info.isMandatory;
            });
        }

        if (homeId) {
            if (homeId === 'BANK') {
                rows = rows.filter((r) => r.is_bank);
            } else {
                rows = rows.filter((r) => r.home_id === homeId);
            }
        }

        const q = search.trim().toLowerCase();
        if (q)
            rows = rows.filter(
                (r) =>
                    (r.user_name || '').toLowerCase().includes(q) ||
                    (r.course_name || '').toLowerCase().includes(q),
            );

        return rows.sort(
            (a, b) =>
                (a.user_name || '').localeCompare(b.user_name || '') ||
                (a.course_name || '').localeCompare(b.course_name || ''),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list, status, hasCert, mandatory, homeId, search, coursesWithTargets]);

    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;
    if (err) return <p style={{ color: '#dc2626' }}>{err}</p>;

    return (
        <div className="space-y-4" style={{ color: 'var(--ink)' }}>
            {/* Secondary tabs (match payslips style) */}
            <div className="flex gap-2">
                <TabBtn active={subTab === 'TEAM'} onClick={() => setSubTab('TEAM')}>
                    Team
                </TabBtn>
                <TabBtn active={subTab === 'COMPLIANCE'} onClick={() => setSubTab('COMPLIANCE')}>
                    Compliance
                </TabBtn>
            </div>

            {/* TEAM TAB */}
            {subTab === 'TEAM' && (
                <>
                    {/* Filters */}
                    <div
                        className="rounded-lg p-3 ring-1"
                        style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                    >
                        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                            <div className="md:col-span-2">
                                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                    Search (name or course)
                                </label>
                                <input
                                    className="w-full rounded-lg px-3 py-2 ring-1"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="e.g., John, First Aid"
                                />
                            </div>
                            <div>
                                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                    Status
                                </label>
                                <select
                                    className="w-full rounded-lg px-3 py-2 ring-1"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                    value={status}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                        setStatus(e.target.value as 'ALL' | 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE')
                                    }
                                >
                                    <option value="ALL">All</option>
                                    <option value="UP_TO_DATE">Up to date</option>
                                    <option value="DUE_SOON">Due soon</option>
                                    <option value="OVERDUE">Overdue</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                    Certificate
                                </label>
                                <select
                                    className="w-full rounded-lg px-3 py-2 ring-1"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                    value={hasCert}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                        setHasCert(e.target.value as 'ALL' | 'YES' | 'NO')
                                    }
                                >
                                    <option value="ALL">All</option>
                                    <option value="YES">Attached</option>
                                    <option value="NO">Missing</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                    Mandatory
                                </label>
                                <select
                                    className="w-full rounded-lg px-3 py-2 ring-1"
                                    style={{
                                        background: 'var(--nav-item-bg)',
                                        color: 'var(--ink)',
                                        borderColor: 'var(--ring)',
                                    }}
                                    value={mandatory}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                        setMandatory(e.target.value as 'ALL' | 'YES' | 'CONDITIONAL' | 'NO')
                                    }
                                >
                                    <option value="ALL">All</option>
                                    <option value="YES">Yes (global)</option>
                                    <option value="CONDITIONAL">Conditional (targets)</option>
                                    <option value="NO">No (optional)</option>
                                </select>
                            </div>
                            {showHomeFilter && (
                                <div>
                                    <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                        Home
                                    </label>
                                    <select
                                        className="w-full rounded-lg px-3 py-2 ring-1"
                                        style={{
                                            background: 'var(--nav-item-bg)',
                                            color: 'var(--ink)',
                                            borderColor: 'var(--ring)',
                                        }}
                                        value={homeId}
                                        onChange={(e) => setHomeId(e.target.value)}
                                    >
                                        <option value="">All</option>
                                        <option value="BANK">Bank staff</option>
                                        {homes.map((h) => (
                                            <option key={h.id} value={h.id}>
                                                {h.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Summary */}
                    <TrainingSummary records={filtered} title="Training summary (filtered)" />

                    {/* Table */}
                    <div
                        className="overflow-x-auto rounded-lg ring-1"
                        style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                    >
                        <table className="min-w-full text-sm">
                            <thead
                                className="sticky top-0 z-10"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)' }}
                            >
                                <tr>
                                    <th className="text-left p-2">Person</th>
                                    <th className="text-left p-2">Home</th>
                                    <th className="text-left p-2">Course</th>
                                    <th className="text-left p-2">Completed</th>
                                    <th className="text-left p-2">Next due</th>
                                    <th className="text-left p-2">Mandatory</th>
                                    <th className="text-left p-2">Status</th>
                                    <th className="text-left p-2">Certificate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r, i) => {
                                    const badgeBase =
                                        r.status === 'OVERDUE'
                                            ? 'bg-rose-50 text-rose-700 ring-rose-100'
                                            : r.status === 'DUE_SOON'
                                                ? 'bg-amber-50 text-amber-700 ring-amber-100'
                                                : 'bg-emerald-50 text-emerald-700 ring-emerald-100';
                                    const badgeOrbit =
                                        r.status === 'OVERDUE'
                                            ? '[data-orbit="1"]:bg-rose-500/10 [data-orbit="1"]:text-rose-200 [data-orbit="1"]:ring-rose-400/25'
                                            : r.status === 'DUE_SOON'
                                                ? '[data-orbit="1"]:bg-amber-500/10 [data-orbit="1"]:text-amber-200 [data-orbit="1"]:ring-amber-400/25'
                                                : '[data-orbit="1"]:bg-emerald-500/10 [data-orbit="1"]:text-emerald-200 [data-orbit="1"]:ring-emerald-400/25';

                                    const mand = mandatoryInfoForRow(r).label;

                                    return (
                                        <tr key={`${r.id}-${i}`} className="align-top border-t" style={{ borderColor: 'var(--ring)' }}>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                {r.user_name || r.user_id.slice(0, 8)}
                                            </td>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                {r.home_label || '—'}
                                            </td>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                {r.course_name}
                                            </td>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                {r.date_completed ? new Date(r.date_completed).toLocaleDateString() : '—'}
                                            </td>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                {r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : '—'}
                                            </td>
                                            <td className="p-2" style={{ color: 'var(--ink)' }}>
                                                {mand}
                                            </td>
                                            <td className="p-2">
                                                <span
                                                    className={`inline-flex px-2 py-0.5 rounded-full text-xs ring-1 ${badgeBase} ${badgeOrbit}`}
                                                >
                                                    {r.status === 'OVERDUE'
                                                        ? 'Overdue'
                                                        : r.status === 'DUE_SOON'
                                                            ? 'Due soon'
                                                            : 'Up to date'}
                                                </span>
                                            </td>
                                            <td className="p-2">
                                                <CertificateCell path={r.certificate_path} />
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td className="p-2 text-sm" style={{ color: 'var(--sub)' }} colSpan={8}>
                                            No records match your filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* COMPLIANCE TAB (per-person logic: global mandatory + conditional targets + pending) */}
            {subTab === 'COMPLIANCE' && (
                <ComplianceAnalytics
                    loading={complianceLoading}
                    roster={roster}
                    homes={homes}
                    records={list}
                    perUserRequired={perUserRequired}
                    courseNameById={courseNameById}
                />
            )}
        </div>
    );
}

/* =========================
   COMPLIANCE ANALYTICS (filterable) — per-person mandatory
   ========================= */

function KPI({ label, value, tone }: { label: string; value: number | string; tone?: 'rose' | 'default' }) {
    const badgeBase =
        tone === 'rose'
            ? 'bg-rose-50 text-rose-700 ring-rose-100'
            : 'bg-indigo-50 text-indigo-700 ring-indigo-100';
    const badgeOrbit =
        tone === 'rose'
            ? '[data-orbit="1"]:bg-rose-500/10 [data-orbit="1"]:text-rose-200 [data-orbit="1"]:ring-rose-400/25'
            : '[data-orbit="1"]:bg-indigo-500/10 [data-orbit="1"]:text-indigo-200 [data-orbit="1"]:ring-indigo-400/25';

    return (
        <div className="rounded-lg p-3 ring-1" style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}>
            <div className={`mx-auto mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${badgeBase} ${badgeOrbit}`}>
                {label}
            </div>
            <div className="text-xl font-semibold leading-6 tabular-nums">{value}</div>
        </div>
    );
}

function ComplianceAnalytics({
    loading,
    roster,
    homes,
    records,
    perUserRequired,
    courseNameById,
}: {
    loading: boolean;
    roster: { id: string; name: string; home_id?: string | null; is_bank?: boolean }[];
    homes: { id: string; name: string }[];
    records: {
        id: string;
        user_id: string;
        course_id: string;
        course_name: string;
        date_completed: string | null;
        next_due_date: string | null;
        refresher_years: number | null;
        training_type: 'TES' | 'InPerson' | 'eLearning' | 'Other' | null;
        mandatory: boolean;
        status: 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE';
        certificate_path?: string | null;
    }[];
    perUserRequired: Map<string, Set<string>>;
    courseNameById: Map<string, string>;
}) {
    type Mode = 'MANDATORY' | 'COURSE';

    const [mode, setMode] = useState<Mode>('MANDATORY');
    const [homeId, setHomeId] = useState<string>(''); // '' = All, 'BANK' = Bank staff
    const [search, setSearch] = useState('');
    const [courseId, setCourseId] = useState<string>('');

    const homesById = useMemo(() => {
        const m = new Map<string, string>();
        homes.forEach((h) => m.set(h.id, h.name));
        return m;
    }, [homes]);

    const peopleSubset = useMemo(() => {
        let list = [...roster];
        if (homeId) {
            if (homeId === 'BANK') list = list.filter((p) => !!p.is_bank);
            else list = list.filter((p) => p.home_id === homeId);
        }
        const q = search.trim().toLowerCase();
        if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
        return list;
    }, [roster, homeId, search]);

    const upToDateByUser = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const r of records) {
            if (r.status !== 'UP_TO_DATE') continue;
            if (!map.has(r.user_id)) map.set(r.user_id, new Set());
            map.get(r.user_id)!.add(r.course_id);
        }
        return map;
    }, [records]);

    function computeMandatoryCompliance(subset: typeof roster) {
        const non: { person: (typeof roster)[number]; missing: string[] }[] = [];
        const ok: (typeof roster)[number][] = [];

        subset.forEach((p) => {
            const req = perUserRequired.get(p.id) ?? new Set<string>();
            if (req.size === 0) {
                ok.push(p);
                return;
            }
            const got = upToDateByUser.get(p.id) ?? new Set<string>();
            const missingIds: string[] = [];
            req.forEach((id) => {
                if (!got.has(id)) missingIds.push(id);
            });
            if (missingIds.length === 0) ok.push(p);
            else non.push({ person: p, missing: missingIds.map((id) => courseNameById.get(id) || 'Unknown') });
        });

        non.sort(
            (a, b) =>
                (a.person.name || '').localeCompare(b.person.name || '') || a.missing.length - b.missing.length,
        );
        return { compliant: ok, nonCompliant: non };
    }

    function computeCourseCompliance(subset: typeof roster, cId: string) {
        const non: { person: (typeof roster)[number]; missing: string[] }[] = [];
        const ok: (typeof roster)[number][] = [];

        subset.forEach((p) => {
            const got = upToDateByUser.get(p.id);
            if (got && got.has(cId)) ok.push(p);
            else non.push({ person: p, missing: [courseNameById.get(cId) || 'Selected course'] });
        });

        non.sort((a, b) => (a.person.name || '').localeCompare(b.person.name || ''));
        return { compliant: ok, nonCompliant: non };
    }

    const { compliant, nonCompliant } = useMemo(() => {
        if (mode === 'MANDATORY') return computeMandatoryCompliance(peopleSubset);
        if (!courseId)
            return {
                compliant: [] as typeof roster,
                nonCompliant: [] as { person: (typeof roster)[number]; missing: string[] }[],
            };
        return computeCourseCompliance(peopleSubset, courseId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, courseId, peopleSubset, upToDateByUser, perUserRequired, courseNameById]);

    const compliantCount = compliant.length;
    const totalPeople = peopleSubset.length;
    const nonCount = Math.max(totalPeople - compliantCount, 0);
    const rate = totalPeople ? Math.round((compliantCount / totalPeople) * 100) : 0;

    const topMissing = useMemo(() => {
        if (mode !== 'MANDATORY') return [] as { name: string; count: number }[];
        const freq = new Map<string, number>();
        nonCompliant.forEach((nc) => nc.missing.forEach((name) => freq.set(name, (freq.get(name) || 0) + 1)));
        return Array.from(freq.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);
    }, [mode, nonCompliant]);

    const byHome = useMemo(() => {
        const bucket = new Map<string, { name: string; compliant: number; total: number }>();
        for (const h of homes) bucket.set(h.id, { name: h.name, compliant: 0, total: 0 });
        bucket.set('BANK', { name: 'Bank staff', compliant: 0, total: 0 });

        const setIds = new Set(compliant.map((p) => p.id));
        for (const p of peopleSubset) {
            const key = p.is_bank ? 'BANK' : p.home_id || 'BANK';
            if (!bucket.has(key))
                bucket.set(key, { name: homesById.get(key) || 'Unknown', compliant: 0, total: 0 });
            const entry = bucket.get(key)!;
            entry.total += 1;
            if (setIds.has(p.id)) entry.compliant += 1;
        }

        return Array.from(bucket.entries())
            .map(([id, v]) => ({
                id,
                ...v,
                rate: v.total ? Math.round((v.compliant / v.total) * 100) : 0,
            }))
            .filter((x) => x.total > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [peopleSubset, compliant, homes, homesById]);

    const courseStatusCounts = useMemo(() => {
        if (mode !== 'COURSE' || !courseId) return { up: 0, soon: 0, late: 0, missing: nonCount };
        const byUser = new Map<string, 'UP_TO_DATE' | 'DUE_SOON' | 'OVERDUE'>();
        for (const r of records) {
            if (r.course_id !== courseId) continue;
            const prev = byUser.get(r.user_id);
            if (!prev || r.status === 'UP_TO_DATE' || (r.status === 'DUE_SOON' && prev === 'OVERDUE')) {
                byUser.set(r.user_id, r.status);
            }
        }
        let up = 0,
            soon = 0,
            late = 0,
            missing = 0;
        for (const p of peopleSubset) {
            const st = byUser.get(p.id);
            if (!st) {
                missing++;
                continue;
            }
            if (st === 'UP_TO_DATE') up++;
            else if (st === 'DUE_SOON') soon++;
            else late++;
        }
        return { up, soon, late, missing };
    }, [mode, courseId, records, peopleSubset, nonCount]);

    function exportCSV() {
        const rows = [['Person', 'Home', 'Bank', mode === 'MANDATORY' ? 'Missing mandatory courses' : 'Missing course']];
        nonCompliant.forEach((nc) => {
            const home = nc.person.is_bank ? '' : nc.person.home_id ? homesById.get(nc.person.home_id) || '' : '';
            rows.push([
                nc.person.name || nc.person.id.slice(0, 8),
                home,
                nc.person.is_bank ? 'Yes' : 'No',
                nc.missing.join(' | '),
            ]);
        });
        const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compliance-${mode.toLowerCase()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <section
            className="rounded-xl p-4 space-y-4 ring-1"
            style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
        >
            {/* Controls */}
            <div
                className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-lg p-3 ring-1"
                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
            >
                <div className="md:col-span-2">
                    <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                        Search people
                    </label>
                    <input
                        className="w-full rounded-lg px-3 py-2 ring-1"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="e.g., Jane Doe"
                    />
                </div>
                <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                        Home
                    </label>
                    <select
                        className="w-full rounded-lg px-3 py-2 ring-1"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={homeId}
                        onChange={(e) => setHomeId(e.target.value)}
                    >
                        <option value="">All</option>
                        <option value="BANK">Bank staff</option>
                        {homes.map((h) => (
                            <option key={h.id} value={h.id}>
                                {h.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                        View
                    </label>
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                        <label className="inline-flex items-center gap-1">
                            <input
                                type="radio"
                                name="mode"
                                value="MANDATORY"
                                checked={mode === 'MANDATORY'}
                                onChange={() => setMode('MANDATORY')}
                            />
                            <span>Mandatory</span>
                        </label>
                        <label className="inline-flex items-center gap-1">
                            <input
                                type="radio"
                                name="mode"
                                value="COURSE"
                                checked={mode === 'COURSE'}
                                onChange={() => setMode('COURSE')}
                            />
                            <span>Course</span>
                        </label>
                    </div>
                </div>
                {mode === 'COURSE' && (
                    <div className="md:col-span-2">
                        <label className="block text-xs mb-1" style={{ color: 'var(--sub)' }}>
                            Course
                        </label>
                        <select
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={courseId}
                            onChange={(e) => setCourseId(e.target.value)}
                        >
                            <option value="">Select…</option>
                            {Array.from(new Map(records.map((r) => [r.course_id, r.course_name])).entries())
                                .sort((a, b) => a[1].localeCompare(b[1]))
                                .map(([id, name]) => (
                                    <option key={id} value={id}>
                                        {name}
                                    </option>
                                ))}
                        </select>
                    </div>
                )}
            </div>

            {/* KPIs + Donut */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
                <div
                    className="rounded-xl p-4 ring-1"
                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                >
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Compliance overview
                        </h3>
                        <button
                            onClick={exportCSV}
                            className="rounded px-2 py-1 text-xs ring-1 transition"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        >
                            Export CSV
                        </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                        <KPI label="People in scope" value={totalPeople} />
                        <KPI label="Compliant" value={compliantCount} />
                        <KPI label="Non-compliant" value={nonCount} tone="rose" />
                        <KPI label="Compliance rate" value={`${rate}%`} />
                    </div>

                    <div className="mt-4 flex items-center gap-6">
                        <Donut
                            segments={[
                                { label: 'Compliant', value: compliantCount, color: '#10b981' },
                                { label: 'Non-compliant', value: nonCount, color: '#f43f5e' },
                            ]}
                            centerLabel={`${rate}%`}
                            size={160}
                        />
                        <div className="space-y-2 text-sm" style={{ color: 'var(--ink)' }}>
                            <LegendRow color="#10b981" label="Compliant" value={compliantCount} />
                            <LegendRow color="#f43f5e" label="Non-compliant" value={nonCount} />
                            {mode === 'COURSE' && courseId && (
                                <>
                                    <div className="h-px my-2" style={{ background: 'var(--ring)' }} />
                                    <LegendRow color="#10b981" label="Up to date" value={courseStatusCounts.up} />
                                    <LegendRow color="#f59e0b" label="Due soon" value={courseStatusCounts.soon} />
                                    <LegendRow color="#f43f5e" label="Overdue" value={courseStatusCounts.late} />
                                    <LegendRow color="#6b7280" label="No record" value={courseStatusCounts.missing} />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Top Missing + By Home */}
                <div className="space-y-4">
                    <div
                        className="rounded-xl p-4 ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                    >
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Top missing courses
                        </h3>
                        {mode === 'COURSE' ? (
                            <p className="text-xs mt-2" style={{ color: 'var(--sub)' }}>
                                Pick a course in the filters to see detailed status breakdown on the left.
                            </p>
                        ) : topMissing.length === 0 ? (
                            <p className="text-xs mt-2 [data-orbit=0]:text-emerald-700 [data-orbit=1]:text-emerald-300">
                                Everyone is compliant 🎉
                            </p>
                        ) : (
                            <ul className="mt-3 space-y-2">
                                {topMissing.map((t) => (
                                    <li key={t.name} className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 ring-1 bg-amber-50 text-amber-800 ring-amber-100 [data-orbit=1]:bg-amber-500/10 [data-orbit=1]:text-amber-200 [data-orbit=1]:ring-amber-400/25">
                                            {t.name}
                                        </span>
                                        <span className="ml-auto tabular-nums" style={{ color: 'var(--sub)' }}>
                                            {t.count}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div
                        className="rounded-xl p-4 ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                    >
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Compliance by home
                        </h3>
                        {byHome.length === 0 ? (
                            <p className="text-xs mt-2" style={{ color: 'var(--sub)' }}>
                                No people in scope.
                            </p>
                        ) : (
                            <ul className="mt-3 space-y-3">
                                {byHome.map((h) => (
                                    <li key={h.id}>
                                        <div className="flex items-center text-sm" style={{ color: 'var(--ink)' }}>
                                            <span className="font-medium">{h.name}</span>
                                            <span className="ml-2 text-xs" style={{ color: 'var(--sub)' }}>
                                                {h.compliant}/{h.total}
                                            </span>
                                            <span className="ml-auto text-xs" style={{ color: 'var(--sub)' }}>
                                                {h.rate}%
                                            </span>
                                        </div>
                                        <div className="h-2 rounded mt-1 overflow-hidden" style={{ background: 'var(--ring)' }}>
                                            <div className="h-2 bg-emerald-500" style={{ width: `${h.rate}%` }} title={`${h.rate}%`} />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Non-compliant list */}
            <div
                className="rounded-xl p-4 ring-1"
                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                        Who is not compliant
                    </h3>
                    <div className="text-xs" style={{ color: 'var(--sub)' }}>
                        {nonCount} people
                    </div>
                </div>
                {loading ? (
                    <div className="text-sm mt-2" style={{ color: 'var(--sub)' }}>
                        Checking…
                    </div>
                ) : nonCompliant.length === 0 ? (
                    <div className="text-sm mt-2 [data-orbit=0]:text-emerald-700 [data-orbit=1]:text-emerald-300">
                        Everyone is compliant 🎉
                    </div>
                ) : (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {nonCompliant.map(({ person, missing }) => (
                            <div
                                key={person.id}
                                className="rounded-lg p-3 ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            >
                                <div className="font-medium text-sm">{person.name || person.id.slice(0, 8)}</div>
                                <div className="text-xs mt-0.5" style={{ color: 'var(--sub)' }}>
                                    {person.is_bank ? 'Bank staff' : person.home_id ? homesById.get(person.home_id) || '—' : '—'}
                                </div>
                                <div className="text-xs mt-2" style={{ color: 'var(--sub)' }}>
                                    Missing:
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {missing.map((m, i) => (
                                        <span
                                            key={i}
                                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 bg-amber-50 text-amber-800 ring-amber-100 [data-orbit=1]:bg-amber-500/10 [data-orbit=1]:text-amber-200 [data-orbit=1]:ring-amber-400/25"
                                        >
                                            {m}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Orbit-only select fixes (scoped) */}
            <style jsx global>{`
        [data-orbit="1"] select,
        [data-orbit="1"] input[type="date"],
        [data-orbit="1"] input[type="text"] {
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
        [data-orbit="1"] select:where(:not(:disabled)) {
          opacity: 1;
        }
      `}</style>
        </section>
    );
}

/* =========================
PEOPLE PICKER (shared)
========================= */
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
        const base = q ? people.filter((p) => (p.name || '').toLowerCase().includes(q)) : people;
        return base.filter((p) => !selectedSet.has(p.id)).slice(0, 50);
    }, [people, query, selectedSet]);

    function add(id: string) {
        onChange([...selected, id]);
        setQuery('');
        setOpen(false);
    }
    function remove(id: string) {
        onChange(selected.filter((x) => x !== id));
    }

    return (
        <div className="space-y-2" style={{ color: 'var(--ink)' }}>
            {/* chips */}
            <div className="flex flex-wrap gap-2">
                {selected.map((id) => {
                    const p = people.find((x) => x.id === id);
                    const label = p ? p.name : id.slice(0, 8);
                    const ctx = p?.home_id ? homesById.get(p.home_id) : p?.is_bank ? 'Bank staff' : '—';
                    return (
                        <span
                            key={id}
                            className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        >
                            <span className="font-medium" style={{ color: 'var(--ink)' }}>
                                {label}
                            </span>
                            <span style={{ color: 'var(--sub)' }}>({ctx || '—'})</span>
                            <button
                                type="button"
                                className="rounded px-1 ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                onClick={() => remove(id)}
                                disabled={disabled}
                            >
                                ×
                            </button>
                        </span>
                    );
                })}
                {selected.length === 0 && <span className="text-xs" style={{ color: 'var(--sub)' }}>No one selected yet.</span>}
            </div>

            {/* input + dropdown */}
            <div className="relative max-w-lg">
                <input
                    disabled={disabled}
                    className="w-full rounded-lg px-3 py-2 ring-1"
                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                    placeholder={placeholder}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => requestAnimationFrame(() => setOpen(false))}
                    onKeyDown={(e) => {
                        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true);
                        if (!open) return;
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setHighlight((h) => Math.min(h + 1, list.length - 1));
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setHighlight((h) => Math.max(h - 1, 0));
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
                    <div
                        className="absolute z-50 mt-1 w-full rounded-xl ring-1 max-h-64 overflow-auto"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                    >
                        {list.map((p, i) => (
                            <button
                                key={p.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => setHighlight(i)}
                                onClick={() => add(p.id)}
                                className="w-full text-left px-3 py-2 text-sm"
                                style={{
                                    background: i === highlight ? 'var(--nav-item-bg-hover)' : 'var(--nav-item-bg)',
                                    color: 'var(--ink)',
                                }}
                            >
                                <div className="font-medium" style={{ color: 'var(--ink)' }}>
                                    {p.name}
                                </div>
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

/* =========================
   SET TRAINING (assignments)
   ========================= */
function SetTraining({ isAdmin, isCompany, isManager }: { isAdmin: boolean; isCompany: boolean; isManager: boolean }) {
    type Person = { id: string; name: string; home_id?: string | null; is_bank?: boolean };
    type ManagerSubrole = 'MANAGER' | 'DEPUTY_MANAGER' | null;
    const [uid, setUid] = useState<string | null>(null);
    const [level, setLevel] = useState<Level>('4_STAFF');

    // company + scope
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
    const [companyId, setCompanyId] = useState<string>('');
    const [homes, setHomes] = useState<{ id: string; name: string }[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const homesById = useMemo(() => {
        const m = new Map<string, string>();
        homes.forEach((h) => m.set(h.id, h.name));
        return m;
    }, [homes]);

    const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);

    // picker state
    type Mode = 'HOMES' | 'PEOPLE';
    const [mode, setMode] = useState<Mode>('HOMES');
    const [selectedHomes, setSelectedHomes] = useState<string[]>([]);
    const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
    const [courseId, setCourseId] = useState<string>('');
    const [dueBy, setDueBy] = useState<string>('');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    // Confirmation state for “already up to date”
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmNames, setConfirmNames] = useState<string[]>([]);
    const [confirmFreshIds, setConfirmFreshIds] = useState<string[]>([]);
    const [confirmExistingIds, setConfirmExistingIds] = useState<string[]>([]);

    // NEW: Include managers toggle + map of (user_id:home_id) -> subrole
    const [includeManagers, setIncludeManagers] = useState<boolean>(false); // default OFF
    const [managerMap, setManagerMap] = useState<Map<string, ManagerSubrole>>(new Map());

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
                if (isAdmin) {
                    const co = await supabase.from('companies').select('id,name').order('name');
                    if (co.error) throw co.error;
                    setCompanies(Array.isArray(co.data) ? co.data : []);
                    const defaultCid = companyId || (co.data?.[0]?.id ?? '');
                    if (!companyId && defaultCid) setCompanyId(defaultCid);
                    if (defaultCid) await loadAdminCompanyScope(defaultCid);
                } else if (isCompany) {
                    const cm = await supabase.from('company_memberships').select('company_id').eq('user_id', uid).maybeSingle();
                    const cid = cm.data?.company_id || '';
                    setCompanyId(cid);
                    if (cid) await loadCompanyScope(cid);
                } else if (isManager) {
                    await loadManagerScope(uid);
                } else {
                    setHomes([]);
                    setPeople([]);
                    setCourses([]);
                }
            } catch (e) {
                const message = e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to load';
                setErr(message);
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uid, isAdmin, isCompany, isManager, companyId]);

    useEffect(() => {
        (async () => {
            if (!isAdmin || !companyId) return;
            await loadAdminCompanyScope(companyId);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, companyId]);

    // NEW: load manager memberships map for the company in scope
    useEffect(() => {
        (async () => {
            if (!companyId) {
                setManagerMap(new Map());
                return;
            }
            const { data, error } = await supabase.rpc('list_company_home_manager_members', { p_company_id: companyId });
            if (error || !Array.isArray(data)) {
                setManagerMap(new Map());
                return;
            }
            const m = new Map<string, ManagerSubrole>();
            data.forEach((r: { home_id?: unknown; user_id?: unknown; manager_subrole?: unknown }) => {
                const home_id = typeof r.home_id === 'string' ? r.home_id : '';
                const user_id = typeof r.user_id === 'string' ? r.user_id : '';
                const sub =
                    r.manager_subrole === 'MANAGER' || r.manager_subrole === 'DEPUTY_MANAGER'
                        ? (r.manager_subrole as ManagerSubrole)
                        : null; // treat null as legacy "Manager"
                if (home_id && user_id) m.set(`${user_id}:${home_id}`, sub);
            });
            setManagerMap(m);
        })();
    }, [companyId]);

    async function loadAdminCompanyScope(cid: string) {
        const h = await supabase.from('homes').select('id,name').eq('company_id', cid);
        if (!h.error) {
            setHomes(Array.isArray(h.data) ? h.data : []);
        }

        const roster = await supabase.rpc('list_company_people', { p_company_id: cid });
        const ps: Person[] = (Array.isArray(roster.data) ? roster.data : []).map((r) => {
            const row = r as { user_id?: unknown; full_name?: unknown; home_id?: unknown; is_bank?: unknown };
            const user_id = typeof row.user_id === 'string' ? row.user_id : '';
            const full_name = typeof row.full_name === 'string' && row.full_name.trim() ? row.full_name : user_id.slice(0, 8);
            const home_id = typeof row.home_id === 'string' || row.home_id === null ? (row.home_id as string | null) : null;
            const is_bank = Boolean(row.is_bank);
            return { id: user_id, name: full_name, home_id, is_bank };
        });
        setPeople(ps);

        const cs = await supabase.from('courses').select('id,name').eq('company_id', cid).order('name');
        if (!cs.error) {
            setCourses(Array.isArray(cs.data) ? cs.data : []);
        }
    }

    async function loadCompanyScope(cid: string) {
        const h = await supabase.from('homes').select('id,name').eq('company_id', cid);
        if (!h.error) {
            setHomes(Array.isArray(h.data) ? h.data : []);
        }

        const roster = await supabase.rpc('list_company_people', { p_company_id: cid });
        const ps: Person[] = (Array.isArray(roster.data) ? roster.data : []).map((r) => {
            const row = r as { user_id?: unknown; full_name?: unknown; home_id?: unknown; is_bank?: unknown };
            const user_id = typeof row.user_id === 'string' ? row.user_id : '';
            const name = typeof row.full_name === 'string' && row.full_name ? row.full_name : user_id.slice(0, 8);
            const home_id = typeof row.home_id === 'string' || row.home_id === null ? (row.home_id as string | null) : null;
            const is_bank = Boolean(row.is_bank);
            return { id: user_id, name, home_id, is_bank };
        });
        setPeople(ps);

        const cs = await supabase.from('courses').select('id,name').eq('company_id', cid).order('name');
        if (!cs.error) {
            setCourses(Array.isArray(cs.data) ? cs.data : []);
        }
    }

    async function loadManagerScope(me: string) {
        const mh = await supabase.from('home_memberships').select('home_id').eq('user_id', me).eq('role', 'MANAGER');
        const managedHomeIds = Array.isArray(mh.data)
            ? mh.data
                .filter((x): x is { home_id: string } => typeof (x as { home_id?: unknown }).home_id === 'string')
                .map((x) => x.home_id)
            : [];
        if (managedHomeIds.length === 0) {
            setHomes([]);
            setPeople([]);
            setCourses([]);
            return;
        }

        const h = await supabase.from('homes').select('id,name,company_id').in('id', managedHomeIds);
        const hs = Array.isArray(h.data) ? h.data : [];
        setHomes(hs.map((x) => ({ id: x.id, name: x.name })));
        const cid = hs[0]?.company_id || '';
        setCompanyId(cid);

        const roster = await supabase.rpc('list_manager_people');
        const ps: Person[] = (Array.isArray(roster.data) ? roster.data : []).map((r) => {
            const row = r as { user_id?: unknown; full_name?: unknown; home_id?: unknown };
            const user_id = typeof row.user_id === 'string' ? row.user_id : '';
            const name = typeof row.full_name === 'string' && row.full_name ? row.full_name : user_id.slice(0, 8);
            const home_id = typeof row.home_id === 'string' || row.home_id === null ? (row.home_id as string | null) : null;
            return { id: user_id, name, home_id, is_bank: false };
        });
        setPeople(ps);

        if (cid) {
            const cs = await supabase.from('courses').select('id,name').eq('company_id', cid).order('name');
            if (!cs.error) {
                setCourses(Array.isArray(cs.data) ? cs.data : []);
            }
        }
    }

    const canSubmit =
        !!courseId &&
        !!dueBy &&
        ((mode === 'HOMES' && selectedHomes.length > 0) || (mode === 'PEOPLE' && selectedPeople.length > 0));

    // Helper to compute user IDs from current selection (respects includeManagers toggle)
    function computeSelectedRecipientIds(): string[] {
        const target = new Set<string>();

        if (mode === 'HOMES') {
            const allowedHomeIds = new Set(selectedHomes);

            people.forEach((p) => {
                if (!p.home_id || !allowedHomeIds.has(p.home_id)) return;

                // If toggle is OFF, skip "Manager – position: Manager" but keep Deputy
                if (!includeManagers) {
                    const key = `${p.id}:${p.home_id}`;
                    const sub = managerMap.get(key);
                    // Exclude true Managers (and legacy NULL), include Deputy Managers
                    if (sub === 'MANAGER' || sub === null) return;
                }

                target.add(p.id);
            });
        } else {
            selectedPeople.forEach((id) => target.add(id));
        }

        if (isManager && uid) target.delete(uid);
        return Array.from(target);
    }

    // proceed after user chose Skip / Change
    async function proceedAfterConfirm(includeExisting: boolean) {
        setErr(null);
        setOk(null);
        setSaving(true);
        setConfirmOpen(false);

        try {
            const finalRecipients = includeExisting
                ? [...confirmFreshIds, ...confirmExistingIds]
                : [...confirmFreshIds];

            if (finalRecipients.length === 0) {
                setErr('No recipients to set.');
                return;
            }

            const { error } = await supabase.rpc('create_training_assignment', {
                p_course_id: courseId,
                p_due_by: dueBy,
                p_recipient_ids: finalRecipients,
            });
            if (error) throw error;

            setSelectedHomes([]);
            setSelectedPeople([]);
            setCourseId('');
            setDueBy('');

            const changed = includeExisting ? confirmExistingIds.length : 0;
            const created = confirmFreshIds.length;
            const parts: string[] = [];
            if (created > 0) parts.push(`${created} new recipient${created === 1 ? '' : 's'}`);
            if (changed > 0)
                parts.push(`changed due date for ${changed} recipient${changed === 1 ? '' : 's'} who already had this course`);
            setOk(`Training set: ${parts.join(' & ')}.`);
        } catch (e) {
            const message = e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to set training';
            setErr(message);
        } finally {
            setSaving(false);
        }
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);
        setOk(null);

        if (!companyId) {
            setErr('No company in scope.');
            return;
        }
        if (!courseId) {
            setErr('Pick a course.');
            return;
        }
        if (!dueBy) {
            setErr('Pick a due date.');
            return;
        }

        const recipients = computeSelectedRecipientIds();
        if (recipients.length === 0) {
            setErr('No recipients found for the chosen scope.');
            return;
        }

        setSaving(true);
        try {
            // Who already has a training record for this course?
            const { data: existing, error: existsErr } = await supabase
                .from('training_records')
                .select('user_id')
                .eq('course_id', courseId)
                .in('user_id', recipients);

            if (existsErr) throw existsErr;

            const already = new Set<string>((existing ?? []).map((r) => (r.user_id as string) || ''));
            const alreadyIds = recipients.filter((id) => already.has(id));
            const freshIds = recipients.filter((id) => !already.has(id));

            if (alreadyIds.length > 0) {
                // Open confirmation dialog; stop here (don’t keep saving=true while dialog is open)
                const nameById = new Map(people.map((p) => [p.id, p.name]));
                const names = alreadyIds.map((id) => nameById.get(id) || id.slice(0, 8));

                setConfirmExistingIds(alreadyIds);
                setConfirmFreshIds(freshIds);
                setConfirmNames(names);
                setSaving(false);
                setConfirmOpen(true);
                return;
            }

            // No one already had it → behave like before
            const { error } = await supabase.rpc('create_training_assignment', {
                p_course_id: courseId,
                p_due_by: dueBy,
                p_recipient_ids: recipients,
            });
            if (error) throw error;

            setSelectedHomes([]);
            setSelectedPeople([]);
            setCourseId('');
            setDueBy('');

            setOk(`Training set for ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.`);
        } catch (e) {
            const message = e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to set training';
            setErr(message);
        } finally {
            // If we opened the dialog we already set saving=false above; this is safe to run regardless.
            setSaving(false);
        }
    }

    if (loading) return <p style={{ color: 'var(--sub)' }}>Loading…</p>;

    const disableControls = saving || (!companyId && (isAdmin || isCompany || isManager));

    return (
        <section
            className="rounded-xl p-4 space-y-4 ring-1"
            style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
        >
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                Set training
            </h2>

            {isAdmin && (
                <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                        Company
                    </label>
                    <select
                        className="w-full max-w-sm rounded-lg px-3 py-2 ring-1"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        disabled={saving}
                    >
                        {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <form onSubmit={onSubmit} className="space-y-3">
                {/* Course + Due */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                            Course
                        </label>
                        <select
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={courseId}
                            onChange={(e) => setCourseId(e.target.value)}
                            disabled={disableControls}
                        >
                            <option value="">Select…</option>
                            {courses.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                            Due by
                        </label>
                        <input
                            type="date"
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            value={dueBy}
                            onChange={(e) => setDueBy(e.target.value)}
                            disabled={disableControls}
                        />
                    </div>
                </div>

                {/* Who */}
                <div className="space-y-2">
                    <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                        Who
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <label
                            className="inline-flex items-center gap-2 text-sm rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        >
                            <input
                                type="radio"
                                name="mode"
                                value="HOMES"
                                checked={mode === 'HOMES'}
                                onChange={() => setMode('HOMES')}
                                disabled={disableControls}
                            />
                            <span>By home</span>
                        </label>
                        <label
                            className="inline-flex items-center gap-2 text-sm rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        >
                            <input
                                type="radio"
                                name="mode"
                                value="PEOPLE"
                                checked={mode === 'PEOPLE'}
                                onChange={() => setMode('PEOPLE')}
                                disabled={disableControls}
                            />
                            <span>Pick people</span>
                        </label>
                    </div>
                </div>

                {/* Homes multi-select */}
                {mode === 'HOMES' && (
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                            Homes
                        </label>

                        {/* Include managers toggle */}
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm" style={{ color: 'var(--sub)' }}>
                                Include managers
                            </span>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={includeManagers}
                                onClick={() => setIncludeManagers((v) => !v)}
                                disabled={disableControls}
                                className="relative inline-flex h-7 w-12 items-center rounded-full ring-1 transition"
                                style={{
                                    background: includeManagers ? 'var(--nav-item-bg-hover)' : 'var(--nav-item-bg)',
                                    borderColor: includeManagers ? 'var(--brand-link)' : 'var(--ring)',
                                    color: 'var(--ink)',
                                    opacity: disableControls ? 0.6 : 1,
                                }}
                                title="Include managers (position: Manager)"
                            >
                                <span
                                    className="absolute left-1 top-1 h-5 w-5 rounded-full shadow transition-transform"
                                    style={{
                                        background: 'var(--panel-bg)',
                                        transform: includeManagers ? 'translateX(24px)' : 'translateX(0)',
                                    }}
                                />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {homes.map((h) => {
                                const selected = selectedHomes.includes(h.id);
                                return (
                                    <label
                                        key={h.id}
                                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 transition"
                                        style={{
                                            background: selected ? 'var(--nav-item-bg-hover)' : 'var(--nav-item-bg)',
                                            borderColor: selected ? 'var(--brand-link)' : 'var(--ring)',
                                            color: 'var(--ink)',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => {
                                                if (selected) setSelectedHomes(selectedHomes.filter((x) => x !== h.id));
                                                else setSelectedHomes([...selectedHomes, h.id]);
                                            }}
                                            disabled={disableControls}
                                        />
                                        <span>{h.name}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* People multi-select */}
                {mode === 'PEOPLE' && (
                    <div>
                        <label className="block text-sm mb-1" style={{ color: 'var(--ink)' }}>
                            People
                        </label>
                        <PeoplePicker
                            people={people}
                            homesById={homesById}
                            selected={selectedPeople}
                            onChange={setSelectedPeople}
                            disabled={disableControls}
                        />
                        {isManager && (
                            <p className="text-xs mt-1" style={{ color: 'var(--sub)' }}>
                                Managers can only pick staff from the homes they manage.
                            </p>
                        )}
                    </div>
                )}

                <div className="pt-2">
                    <button
                        className="rounded-lg px-3 py-2 text-sm ring-1 transition disabled:opacity-50"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                        disabled={!canSubmit || saving}
                    >
                        {saving ? 'Setting…' : 'Set training'}
                    </button>
                    {err && (
                        <span className="ml-3 text-sm" style={{ color: '#dc2626' }}>
                            {err}
                        </span>
                    )}
                    {ok && (
                        <span className="ml-3 text-sm [data-orbit=0]:text-emerald-700 [data-orbit=1]:text-emerald-300">
                            {ok}
                        </span>
                    )}
                </div>
            </form>

            {/* Confirmation dialog */}
            {confirmOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div
                        className="absolute inset-0"
                        style={{ background: 'rgba(0,0,0,0.4)' }}
                        aria-hidden="true"
                        onClick={() => setConfirmOpen(false)}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="confirm-existing-title"
                        className="relative w-full max-w-lg rounded-xl p-4 ring-1"
                        style={{ background: 'var(--panel-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                    >
                        <h3 id="confirm-existing-title" className="text-base font-semibold mb-2" style={{ color: 'var(--ink)' }}>
                            Some people already have this course up to date
                        </h3>
                        <p className="text-sm mb-2" style={{ color: 'var(--sub)' }}>
                            {confirmNames.length <= 6
                                ? confirmNames.join(', ')
                                : `${confirmNames.slice(0, 6).join(', ')} + ${confirmNames.length - 6} more`}
                        </p>
                        <p className="text-sm mb-4" style={{ color: 'var(--ink)' }}>
                            Do you want to{' '}
                            <span className="font-medium [data-orbit=0]:text-indigo-700 [data-orbit=1]:text-indigo-300">
                                change their due-by date
                            </span>{' '}
                            to <span className="font-mono">{dueBy}</span>, or skip them?
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                className="rounded-lg px-3 py-2 text-sm ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                onClick={() => proceedAfterConfirm(false)}
                                disabled={saving}
                            >
                                Skip
                            </button>
                            <button
                                type="button"
                                className="rounded-lg px-3 py-2 text-sm ring-1"
                                style={{ background: 'var(--nav-item-bg-hover)', borderColor: 'var(--brand-link)', color: 'var(--ink)' }}
                                onClick={() => proceedAfterConfirm(true)}
                                disabled={saving}
                            >
                                Change due date
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Orbit-only select fixes (scoped) */}
            <style jsx global>{`
        [data-orbit="1"] select,
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
        [data-orbit="1"] select:where(:not(:disabled)) {
          opacity: 1;
        }
      `}</style>
        </section>
    );
}



/* =========================
   COURSE SETTINGS (create + edit targets → Conditional)
   ========================= */
function CourseSettings({ isAdmin }: { isAdmin: boolean }) {
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
    const [companyId, setCompanyId] = useState<string>(''); // admin picks; others inferred
    const [companyName, setCompanyName] = useState<string>(''); // label for non-admins
    const [courses, setCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // Roster for “individuals” selector
    type Person = { id: string; name: string; home_id?: string | null; is_bank?: boolean };
    const [people, setPeople] = useState<Person[]>([]);
    const [homes, setHomes] = useState<{ id: string; name: string }[]>([]);
    const homesById = useMemo(() => {
        const m = new Map<string, string>();
        homes.forEach((h) => m.set(h.id, h.name));
        return m;
    }, [homes]);

    // ---- type labels (keeps DB strings, shows nicer labels)
    const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
        { value: 'ELearning', label: 'E-learning' },
        { value: 'In Person', label: 'In person' }, // also display for "InPerson" if it exists in data
        { value: 'TES', label: 'TES' },
        { value: 'Other', label: 'Other' },
    ];
    const labelForType = (v?: string | null) => {
        if (!v) return '—';
        if (v === 'InPerson') return 'In person';
        const found = TYPE_OPTIONS.find((o) => o.value === v);
        return found ? found.label : v;
    };
    const normalizeTypeForDB = (v: string) => (v === 'In person' ? 'In Person' : v); // be forgiving

    // form
    const [name, setName] = useState('');
    const [type, setType] = useState('ELearning');
    const [refYears, setRefYears] = useState<number | ''>('');
    const [dueSoon, setDueSoon] = useState<number>(60);
    const [link, setLink] = useState(''); // optional

    // Audience mode
    type AudienceMode = 'NONE' | 'EVERYONE' | 'PEOPLE';
    const [audMode, setAudMode] = useState<AudienceMode>('NONE');
    const [audPeople, setAudPeople] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setErr(null);

            if (isAdmin) {
                const co = await supabase.from('companies').select('id,name').order('name');
                if (!co.error) setCompanies(Array.isArray(co.data) ? co.data : []);
                // don’t auto-load courses until a company is chosen
            } else {
                const [{ data: u }] = await Promise.all([supabase.auth.getUser()]);
                const me = u?.user?.id;
                if (me) {
                    let cid = '';
                    const cm = await supabase
                        .from('company_memberships')
                        .select('company_id')
                        .eq('user_id', me)
                        .limit(1)
                        .maybeSingle();
                    if (cm.data?.company_id) cid = cm.data.company_id;
                    else {
                        const hm = await supabase
                            .from('home_memberships')
                            .select('home_id')
                            .eq('user_id', me)
                            .limit(1)
                            .maybeSingle();
                        if (hm.data?.home_id) {
                            const h = await supabase.from('homes').select('company_id').eq('id', hm.data.home_id).single();
                            if (h.data?.company_id) cid = h.data.company_id;
                        } else {
                            const bm = await supabase
                                .from('bank_memberships')
                                .select('company_id')
                                .eq('user_id', me)
                                .limit(1)
                                .maybeSingle();
                            if (bm.data?.company_id) cid = bm.data.company_id;
                        }
                    }
                    if (cid) {
                        setCompanyId(cid);
                        const co = await supabase.from('companies').select('name').eq('id', cid).single();
                        setCompanyName(co.data?.name ?? '');
                    }
                }
            }

            // Only load when we know the company
            if (companyId) {
                await Promise.all([loadCourses(companyId), loadRoster(companyId)]);
            }
            setLoading(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, companyId]);

    // load roster (homes + people) for the selected company
    async function loadRoster(cid: string) {
        const h = await supabase.from('homes').select('id,name').eq('company_id', cid);
        if (!h.error) setHomes(Array.isArray(h.data) ? h.data : []);

        const roster = await supabase.rpc('list_company_people', { p_company_id: cid });
        const ps: Person[] = (Array.isArray(roster.data) ? roster.data : []).map((r) => {
            const row = r as {
                user_id?: string;
                full_name?: string | null;
                home_id?: string | null;
                is_bank?: boolean | null;
            };
            const user_id = typeof row.user_id === 'string' ? row.user_id : '';
            const full_name =
                typeof row.full_name === 'string' && row.full_name.trim() ? row.full_name : user_id.slice(0, 8);
            const home_id = typeof row.home_id === 'string' || row.home_id === null ? row.home_id : null;
            const is_bank = Boolean(row.is_bank);
            return { id: user_id, name: full_name, home_id, is_bank };
        });
        setPeople(ps);
    }

    async function loadCourses(targetCompanyId?: string) {
        const cid = targetCompanyId ?? companyId;
        if (!cid) return; // don’t load across all companies
        const res = await supabase.from('courses').select('*').eq('company_id', cid).order('name');
        if (res.error) setErr(res.error.message);
        else setCourses(Array.isArray(res.data) ? (res.data as Course[]) : []);
    }

    async function onCreate(e: React.FormEvent) {
        e.preventDefault();
        setErr(null);

        const cid = companyId;
        if (!cid) {
            setErr('Could not determine your company. Please select a company or refresh.');
            return;
        }
        if (!name.trim()) {
            setErr('Name is required.');
            return;
        }

        // light numeric guard
        const dueSoonSafe = Number.isFinite(dueSoon) ? Math.max(0, Math.floor(dueSoon)) : 0;
        const refSafe = refYears === '' ? null : Math.max(0, Math.floor(Number(refYears)));

        // optional URL tidy
        const linkVal = link.trim();
        const safeLink = linkVal === '' ? null : linkVal;

        setSaving(true);
        try {
            const legacyMandatory = audMode === 'EVERYONE';

            const insCourse = await supabase
                .from('courses')
                .insert({
                    company_id: cid,
                    name: name.trim(),
                    training_type: normalizeTypeForDB(type),
                    refresher_years: refSafe,
                    due_soon_days: dueSoonSafe,
                    mandatory: legacyMandatory,
                    link: safeLink,
                })
                .select('id, company_id')
                .single();

            if (insCourse.error) throw insCourse.error;
            const newCourseId = insCourse.data.id as string;

            if (audMode === 'PEOPLE' && audPeople.length > 0) {
                const rows = audPeople.map((uid) => ({
                    course_id: newCourseId,
                    kind: 'USER' as const,
                    user_id: uid,
                    company_id: cid,
                }));
                const insTargets = await supabase.from('course_mandatory_targets').insert(rows);
                if (insTargets.error) throw insTargets.error;
            }

            // reset + refresh
            setName('');
            setType('ELearning');
            setRefYears('');
            setDueSoon(60);
            setLink('');
            setAudMode('NONE');
            setAudPeople([]);
            await Promise.all([loadCourses(cid), loadRoster(cid)]);
        } catch (e) {
            const message = e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to create';
            setErr(message);
        } finally {
            setSaving(false);
        }
    }

    const disabled = loading || (!isAdmin && !companyId);

    return (
        <div className="space-y-4">
            <section
                className="rounded-xl p-4 space-y-3 max-w-3xl ring-1"
                style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
            >
                <h2 className="text-base font-semibold">Add course</h2>
                <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {isAdmin && (
                        <div className="sm:col-span-3">
                            <label className="block text-sm mb-1">Company</label>
                            <select
                                className="w-full rounded-lg px-3 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                value={companyId}
                                onChange={async (e) => {
                                    const cid = e.target.value;
                                    setCompanyId(cid);
                                    if (cid) await Promise.all([loadCourses(cid), loadRoster(cid)]);
                                    else setCourses([]);
                                }}
                            >
                                <option value="">Select…</option>
                                {companies.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    {!isAdmin && (
                        <div className="sm:col-span-3 text-xs" style={{ color: 'var(--sub)' }}>
                            Company: {companyName || (companyId ? 'Detecting…' : 'Detecting…')}
                        </div>
                    )}
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1">Course name</label>
                        <input
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            disabled={disabled}
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Type</label>
                        <select
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            disabled={disabled}
                        >
                            {TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Refresher (years)</label>
                        <input
                            type="number"
                            min={0}
                            max={10}
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={refYears}
                            onChange={(e) => {
                                const v = e.target.value;
                                setRefYears(v === '' ? '' : Math.max(0, Math.min(10, Math.floor(Number(v) || 0))));
                            }}
                            placeholder="blank = never"
                            disabled={disabled}
                        />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Due soon (days)</label>
                        <input
                            type="number"
                            min={0}
                            max={3650}
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={dueSoon}
                            onChange={(e) => setDueSoon(Math.max(0, Math.min(3650, Math.floor(Number(e.target.value) || 0))))}
                            disabled={disabled}
                        />
                    </div>

                    {/* Mandatory audience */}
                    <div className="sm:col-span-3 space-y-3">
                        <div className="text-sm font-medium">Mandatory for</div>

                        <div className="flex flex-wrap gap-2">
                            {[
                                { v: 'NONE', label: 'Not mandatory' },
                                { v: 'EVERYONE', label: 'Everyone' },
                                { v: 'PEOPLE', label: 'Selection of people' },
                            ].map((o) => (
                                <label
                                    key={o.v}
                                    className="inline-flex items-center gap-2 text-sm rounded-lg px-3 py-2 ring-1"
                                    style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                                >
                                    <input
                                        type="radio"
                                        name="audience"
                                        value={o.v}
                                        checked={audMode === (o.v as AudienceMode)}
                                        onChange={() => setAudMode(o.v as AudienceMode)}
                                        disabled={disabled}
                                    />
                                    <span>{o.label}</span>
                                </label>
                            ))}
                        </div>

                        {audMode === 'PEOPLE' && (
                            <div className="pt-1">
                                <div className="text-xs mb-1" style={{ color: 'var(--sub)' }}>
                                    Pick people
                                </div>
                                <PeoplePicker
                                    people={people}
                                    homesById={homesById}
                                    selected={audPeople}
                                    onChange={setAudPeople}
                                    disabled={disabled}
                                    placeholder="Search and pick people…"
                                />
                                <p className="text-xs mt-1" style={{ color: 'var(--sub)' }}>
                                    Tip: you can leave this blank, create the course, then edit it to assign later.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Link (optional) */}
                    <div className="sm:col-span-3">
                        <label className="block text-sm mb-1">Link (optional)</label>
                        <input
                            type="url"
                            className="w-full rounded-lg px-3 py-2 ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                            value={link}
                            onChange={(e) => setLink(e.target.value)}
                            placeholder="https://…"
                            disabled={disabled}
                        />
                    </div>

                    <div className="sm:col-span-3">
                        <button
                            disabled={saving || disabled}
                            className="rounded-lg px-3 py-2 text-sm ring-1 disabled:opacity-60"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                        >
                            {saving ? 'Saving…' : 'Add course'}
                        </button>
                    </div>
                    {err && <p className="sm:col-span-3 text-sm text-rose-600">{err}</p>}
                </form>
            </section>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">Courses</h2>
                <div className="rounded-xl ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    <div className="max-h-80 overflow-auto">
                        <table className="min-w-full text-sm">
                            <thead className="sticky top-0" style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)' }}>
                                <tr>
                                    <th className="text-left p-2">Name</th>
                                    <th className="text-left p-2">Type</th>
                                    <th className="text-left p-2">Refresher</th>
                                    <th className="text-left p-2">Due soon</th>
                                    <th className="text-left p-2">Mandatory</th>
                                    <th className="text-left p-2">Link</th>
                                    <th className="p-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {courses.map((c) => (
                                    <CourseRow
                                        key={c.id}
                                        c={c}
                                        onSaved={loadCourses}
                                        people={people}
                                        homesById={homesById}
                                        labelForType={labelForType}
                                    />
                                ))}
                                {courses.length === 0 && (
                                    <tr>
                                        <td className="p-2" style={{ color: 'var(--sub)' }} colSpan={7}>
                                            No courses yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <style jsx global>{`
  /* Orbit-only: native control polish */
  [data-orbit='1'] select,
  [data-orbit='1'] input[type='date'],
  [data-orbit='1'] input[type='text'],
  [data-orbit='1'] input[type='number'],
  [data-orbit='1'] input[type='url'] {
    color-scheme: dark;
    background: var(--nav-item-bg);
    color: var(--ink);
    border-color: var(--ring);
  }
  [data-orbit='1'] select option {
    color: var(--ink);
    background-color: #0b1221;
  }

  /* NEW — Orbit-only: make CoursePicker suggestions panel opaque & legible */
  [data-orbit='1'] #course-combobox-list {
    background: var(--panel-bg) !important;   /* overrides inline var(--nav-item-bg) */
    border-color: var(--ring-strong) !important;
    box-shadow: 0 12px 28px rgba(0,0,0,0.45);
    backdrop-filter: blur(6px);
  }
  [data-orbit='1'] #course-combobox-list [role='option'] {
    color: var(--ink);
  }
  [data-orbit='1'] #course-combobox-list [role='option'][aria-selected='true'],
  [data-orbit='1'] #course-combobox-list [role='option']:hover {
    background: var(--nav-item-bg-hover);
  }
`}</style>

        </div>
    );
}

/* =========================
   COURSE ROW (edit course + audience)
   ========================= */

function MandatoryLabel({
    courseId,
    courseMandatory,
    hasTargetsHint,
    refreshKey = 0,
}: {
    courseId: string;
    courseMandatory: boolean;
    hasTargetsHint?: boolean | null; // prefer preloaded hint (e.g., mandatory_dsl)
    refreshKey?: number;
}) {
    const [hasTargets, setHasTargets] = useState<boolean>(Boolean(hasTargetsHint));

    useEffect(() => {
        (async () => {
            if (courseMandatory) {
                setHasTargets(false);
                return;
            }
            // if caller already knows, trust it
            if (typeof hasTargetsHint === 'boolean') {
                setHasTargets(hasTargetsHint);
                return;
            }
            // fallback single COUNT query
            const t = await supabase
                .from('course_mandatory_targets')
                .select('course_id', { count: 'exact', head: true })
                .eq('course_id', courseId);
            setHasTargets(((t.count as number) || 0) > 0);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courseId, courseMandatory, hasTargetsHint, refreshKey]);

    if (courseMandatory) return <>Yes</>;
    return hasTargets ? <>Conditional</> : <>No</>;
}

function CourseRow({
    c,
    onSaved,
    people,
    homesById,
    labelForType,
}: {
    c: Course;
    onSaved: (companyId?: string) => Promise<void>;
    people: { id: string; name: string; home_id?: string | null; is_bank?: boolean }[];
    homesById: Map<string, string>;
    labelForType: (v?: string | null) => string;
}) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(c.name);
    const [type, setType] = useState(c.training_type);
    const [refYears, setRefYears] = useState<number | ''>(c.refresher_years ?? '');
    const [dueSoon, setDueSoon] = useState<number>(c.due_soon_days);
    const [link, setLink] = useState<string>(c.link ?? '');
    const [busy, setBusy] = useState(false);

    type AudienceMode = 'NONE' | 'EVERYONE' | 'PEOPLE';
    const [audMode, setAudMode] = useState<AudienceMode>(c.mandatory ? 'EVERYONE' : 'NONE');
    const [audPeople, setAudPeople] = useState<string[]>([]);

    const [confirmDelete, setConfirmDelete] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    async function deleteCourse() {
        setBusy(true);
        try {
            await supabase.from('course_mandatory_targets').delete().eq('course_id', c.id);
            const del = await supabase.from('courses').delete().eq('id', c.id);
            if (del.error) throw del.error;
            await onSaved(c.company_id);
            setRefreshKey((k) => k + 1);
        } catch (e) {
            const message = e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to delete course';
            alert(message);
        } finally {
            setBusy(false);
            setConfirmDelete(false);
            setEditing(false);
        }
    }

    // Load current targets on edit
    useEffect(() => {
        (async () => {
            if (!editing) return;
            const t = await supabase.from('course_mandatory_targets').select('kind,user_id').eq('course_id', c.id);
            if (t.error) return;
            const rows = (t.data || []) as { kind: string; user_id: string | null }[];
            const users = rows.filter((r) => r.kind === 'USER' && r.user_id).map((r) => r.user_id!) as string[];

            if (c.mandatory) {
                setAudMode('EVERYONE');
                setAudPeople([]);
            } else if (users.length > 0) {
                setAudMode('PEOPLE');
                setAudPeople(users);
            } else {
                setAudMode('NONE');
                setAudPeople([]);
            }
        })();
    }, [editing, c.id, c.mandatory]);

    async function save() {
        setBusy(true);
        try {
            const legacyMandatory = audMode === 'EVERYONE';
            const dueSoonSafe = Number.isFinite(dueSoon) ? Math.max(0, Math.floor(dueSoon)) : 0;
            const refSafe = refYears === '' ? null : Math.max(0, Math.floor(Number(refYears)));

            const upd = await supabase
                .from('courses')
                .update({
                    name: name.trim(),
                    training_type: type,
                    refresher_years: refSafe,
                    due_soon_days: dueSoonSafe,
                    mandatory: legacyMandatory,
                    link: link.trim() === '' ? null : link.trim(),
                })
                .eq('id', c.id);
            if (upd.error) throw upd.error;

            // Replace targets
            const del = await supabase.from('course_mandatory_targets').delete().eq('course_id', c.id);
            if (del.error) throw del.error;

            if (audMode === 'PEOPLE' && audPeople.length > 0) {
                const ins = await supabase.from('course_mandatory_targets').insert(
                    audPeople.map((uid) => ({
                        course_id: c.id,
                        kind: 'USER' as const,
                        user_id: uid,
                        company_id: c.company_id,
                    })),
                );
                if (ins.error) throw ins.error;
            }

            setEditing(false);
            await onSaved(c.company_id);
            setRefreshKey((k) => k + 1);
        } catch (e) {
            const message = e instanceof Error && typeof e.message === 'string' ? e.message : 'Failed to update course';
            alert(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <tr className="border-t align-top" style={{ color: 'var(--ink)' }}>
            <td className="p-2">
                {editing ? (
                    <input
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                ) : (
                    c.name
                )}
            </td>

            <td className="p-2">
                {editing ? (
                    <select
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                    >
                        {['ELearning', 'In Person', 'TES', 'Other'].map((v) => (
                            <option key={v} value={v}>
                                {v === 'ELearning' ? 'E-learning' : v === 'In Person' ? 'In person' : v}
                            </option>
                        ))}
                    </select>
                ) : (
                    labelForType(c.training_type)
                )}
            </td>

            <td className="p-2">
                {editing ? (
                    <input
                        type="number"
                        min={0}
                        max={10}
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        value={refYears}
                        onChange={(e) => {
                            const v = e.target.value;
                            setRefYears(v === '' ? '' : Math.max(0, Math.min(10, Math.floor(Number(v) || 0))));
                        }}
                        placeholder="blank = never"
                    />
                ) : (
                    c.refresher_years ?? '—'
                )}
            </td>

            <td className="p-2">
                {editing ? (
                    <input
                        type="number"
                        min={0}
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        value={dueSoon}
                        onChange={(e) => setDueSoon(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    />
                ) : (
                    c.due_soon_days
                )}
            </td>

            <td className="p-2">
                <MandatoryLabel
                    courseId={c.id}
                    courseMandatory={c.mandatory}
                    hasTargetsHint={c.mandatory_dsl ?? undefined}
                    refreshKey={refreshKey}
                />
            </td>

            <td className="p-2">
                {editing ? (
                    <input
                        type="url"
                        className="rounded px-2 py-1 text-sm w-full ring-1"
                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        placeholder="https://…"
                    />
                ) : c.link ? (
                    <a href={c.link} target="_blank" rel="noreferrer" className="underline">
                        Open
                    </a>
                ) : (
                    '—'
                )}
            </td>

            <td className="p-2">
                {!editing && !confirmDelete && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setEditing(true);
                                setConfirmDelete(false);
                            }}
                            className="rounded px-2 py-1 text-xs ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                            disabled={busy}
                        >
                            Edit
                        </button>
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="rounded px-2 py-1 text-xs ring-1"
                            style={{ background: 'var(--nav-item-bg)', borderColor: '#fecaca', color: '#b91c1c' }}
                            disabled={busy}
                        >
                            Delete
                        </button>
                    </div>
                )}

                {!editing && confirmDelete && (
                    <div className="space-y-2 min-w-[260px] rounded-lg p-2 ring-1" style={{ background: '#fff1f2', borderColor: '#fecaca' }}>
                        <div className="text-xs" style={{ color: '#9f1239' }}>
                            Delete “{c.name}”? This cannot be undone.
                        </div>
                        <div className="flex gap-2">
                            <button
                                disabled={busy}
                                onClick={deleteCourse}
                                className="rounded px-2 py-1 text-xs"
                                style={{ background: '#e11d48', color: 'white' }}
                            >
                                {busy ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => setConfirmDelete(false)}
                                className="rounded px-2 py-1 text-xs ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {editing && (
                    <div className="space-y-2 min-w-[340px]">
                        {/* Mandatory audience */}
                        <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { v: 'NONE', label: 'Not mandatory' },
                                    { v: 'EVERYONE', label: 'Everyone' },
                                    { v: 'PEOPLE', label: 'Selection of people' },
                                ].map((o) => (
                                    <label
                                        key={o.v}
                                        className="inline-flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 ring-1"
                                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                                    >
                                        <input
                                            type="radio"
                                            name={`aud-${c.id}`}
                                            value={o.v}
                                            checked={audMode === (o.v as AudienceMode)}
                                            onChange={() => setAudMode(o.v as AudienceMode)}
                                            disabled={busy}
                                        />
                                        <span>{o.label}</span>
                                    </label>
                                ))}
                            </div>

                            {audMode === 'PEOPLE' && (
                                <>
                                    <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                        People
                                    </div>
                                    <PeoplePicker
                                        people={people}
                                        homesById={homesById}
                                        selected={audPeople}
                                        onChange={setAudPeople}
                                        disabled={busy}
                                    />
                                </>
                            )}
                        </div>

                        <div className="flex gap-2 pt-1">
                            <button
                                disabled={busy}
                                onClick={save}
                                className="rounded px-2 py-1 text-xs ring-1 disabled:opacity-60"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                            >
                                {busy ? 'Saving…' : 'Save'}
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => {
                                    setEditing(false);
                                    setConfirmDelete(false);
                                    setName(c.name);
                                    setType(c.training_type);
                                    setRefYears(c.refresher_years ?? '');
                                    setDueSoon(c.due_soon_days);
                                    setLink(c.link ?? '');
                                    setAudMode(c.mandatory ? 'EVERYONE' : 'NONE');
                                    setAudPeople([]);
                                }}
                                className="rounded px-2 py-1 text-xs ring-1"
                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </td>
        </tr>
    );
}


