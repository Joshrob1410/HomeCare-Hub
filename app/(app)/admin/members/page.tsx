'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';

/* =========================
   Types
   ========================= */

type Role = 'ADMIN' | 'COMPANY' | 'MANAGER' | 'STAFF';

// Positions by role
type StaffPosition = 'RESIDENTIAL' | 'BANK_STAFF' | 'TEAM_LEADER';
type ManagerPosition = 'DEPUTY' | 'HOME_MANAGER';
type CompanyPosition = 'OWNER' | 'SITE_MANAGER' | 'FINANCE_OFFICER';

type Company = { id: string; name: string };
type Home = { id: string; name: string; company_id: string };

type Member = {
    id: string;
    email: string;
    full_name: string;
    is_admin: boolean;
    level: '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF' | 'UNASSIGNED';
    companies: { id: string; name: string }[]; // company_memberships
    homes: { home_id: string; home_name: string; role: 'MANAGER' | 'STAFF'; company_id: string | null; company_name: string }[];
    bank?: boolean;
    created_at?: string;
    last_sign_in_at?: string | null;

    // NEW (may be returned by your API; handled gracefully):
    position?: StaffPosition | ManagerPosition | null; // STAFF/MANAGER single
    positions?: CompanyPosition[] | null;              // COMPANY multi
};

/* =========================
   Constants
   ========================= */
const STAFF_POSITIONS: StaffPosition[] = ['RESIDENTIAL', 'BANK_STAFF', 'TEAM_LEADER'];
const MANAGER_POSITIONS: ManagerPosition[] = ['DEPUTY', 'HOME_MANAGER'];
const COMPANY_POSITIONS: CompanyPosition[] = ['OWNER', 'SITE_MANAGER', 'FINANCE_OFFICER'];

/* =========================
   Page
   ========================= */
export default function AdminMembersPage() {
    // -------- Create form state --------
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [pw, setPw] = useState('');
    const [role, setRole] = useState<Role>('STAFF');
    const [companyId, setCompanyId] = useState<string>('');

    // STAFF
    const [homeId, setHomeId] = useState<string>('');  // required unless BANK_STAFF
    const [staffPosition, setStaffPosition] = useState<StaffPosition>('RESIDENTIAL');

    // MANAGER
    const [homeIds, setHomeIds] = useState<string[]>([]);
    const [managerPosition, setManagerPosition] = useState<ManagerPosition>('DEPUTY');

    // COMPANY
    const [companyPositions, setCompanyPositions] = useState<CompanyPosition[]>([]);

    const [formErr, setFormErr] = useState<string | null>(null);

    // Dropdown data
    const [companies, setCompanies] = useState<Company[]>([]);
    const [homes, setHomes] = useState<Home[]>([]);
    const homesForCompany = useMemo(
        () => homes.filter(h => h.company_id === companyId),
        [homes, companyId]
    );

    const [submitting, setSubmitting] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    // -------- Members list state + filters --------
    const [members, setMembers] = useState<Member[]>([]);
    const [listLoading, setListLoading] = useState<boolean>(true);

    const [q, setQ] = useState('');
    const [filterCompanyId, setFilterCompanyId] = useState<string>('');
    const [filterHomeId, setFilterHomeId] = useState<string>('');

    // Load dropdown data once
    useEffect(() => {
        let alive = true;
        (async () => {
            const [c, h] = await Promise.all([
                supabase.from('companies').select('id,name').order('name', { ascending: true }),
                supabase.from('homes').select('id,name,company_id').order('name', { ascending: true }),
            ]);
            if (!alive) return;
            if (!c.error) setCompanies(c.data ?? []);
            if (!h.error) setHomes(h.data as Home[] ?? []);
        })();
        return () => { alive = false; };
    }, []);

    function resetForm() {
        setFullName(''); setEmail(''); setPw('');
        setRole('STAFF');
        setCompanyId('');
        setHomeId('');
        setHomeIds([]);
        setStaffPosition('RESIDENTIAL');
        setManagerPosition('DEPUTY');
        setCompanyPositions([]);
        setFormErr(null); setMsg(null); setErr(null);
    }

    function toggleHome(id: string) {
        setHomeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    async function onCreate(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null); setErr(null); setFormErr(null);

        if (role === 'MANAGER') {
            if (!companyId) { setFormErr('Select a company.'); return; }
            if (homeIds.length === 0) { setFormErr('Select at least one home.'); return; }
        }
        if (role === 'STAFF') {
            if (!companyId) { setFormErr('Select a company.'); return; }
            if (staffPosition !== 'BANK_STAFF' && !homeId) { setFormErr('Select a home.'); return; }
        }
        if (role === 'COMPANY') {
            if (!companyId) { setFormErr('Select a company.'); return; }
            if (companyPositions.length === 0) { setFormErr('Select at least one position for company role.'); return; }
        }

        setSubmitting(true);
        try {
            const payload: any = { email, password: pw, full_name: fullName, role };
            if (role === 'ADMIN') {
                // no company context, no position fields
            } else if (role === 'COMPANY') {
                payload.company_id = companyId || null;
                payload.positions = companyPositions;              // multi
            } else if (role === 'MANAGER') {
                payload.company_id = companyId;
                payload.home_ids = homeIds;
                payload.position = managerPosition;                // single
            } else if (role === 'STAFF') {
                payload.company_id = companyId;
                payload.bank_staff = (staffPosition === 'BANK_STAFF'); // derive
                if (staffPosition !== 'BANK_STAFF') payload.home_id = homeId;
                payload.position = staffPosition;                  // single
            }

            const res = await fetch('/api/admin/members/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await res.text();
            let json: any = null;
            try { json = text ? JSON.parse(text) : null; } catch {
                setErr(`Server returned non-JSON (${res.status}). ${text.slice(0, 200)}…`);
                setSubmitting(false); return;
            }

            if (!res.ok) {
                setErr(json?.error || `Request failed (${res.status}).`);
            } else {
                setMsg(`Created ${json.user.email} (${json.user.role}).`);
                resetForm();
                await loadMembers({ q, company_id: filterCompanyId, home_id: filterHomeId });
            }
        } catch (e: any) {
            setErr(e?.message || 'Network error.');
        } finally {
            setSubmitting(false);
        }
    }

    // Load members (server API) — supports filters
    // Load members (server API) — supports filters, but also handles array payloads
    // and applies client-side filtering if the server doesn't.
    async function loadMembers(params?: { q?: string; company_id?: string; home_id?: string }) {
        setListLoading(true);
        try {
            // Build QS but keep it lenient (server might only support `q`)
            const qs = new URLSearchParams();
            if (params?.q) qs.set('q', params.q);
            if (params?.company_id) qs.set('company_id', params.company_id);
            if (params?.home_id) qs.set('home_id', params.home_id);

            const url = '/api/admin/members/list' + (qs.toString() ? `?${qs.toString()}` : '');
            const res = await fetch(url);
            const data = await res.json();

            // Accept either `{ members: [...] }` or `[...]`
            const raw: Member[] = Array.isArray(data) ? data : (data?.members ?? []);

            // If server already filtered, great. If not, apply client-side filters.
            const qLower = (params?.q ?? '').trim().toLowerCase();
            const filtered = raw.filter((m) => {
                // Text filter
                const passText = !qLower
                    || (m.full_name || '').toLowerCase().includes(qLower)
                    || (m.email || '').toLowerCase().includes(qLower);

                // Company filter
                const cid = params?.company_id;
                const passCompany = !cid
                    || m.companies?.some(c => c.id === cid)
                    || m.homes?.some(h => h.company_id === cid);

                // Home filter
                const hid = params?.home_id;
                const passHome = !hid
                    || m.homes?.some(h => h.home_id === hid);

                return passText && passCompany && passHome;
            });

            setMembers(filtered);
        } catch (e) {
            // Fallback: if something goes wrong, don't leave the list empty silently
            console.error(e);
            setMembers([]);
        } finally {
            setListLoading(false);
        }
    }

    useEffect(() => { loadMembers(); }, []);

    const needsCompany = role === 'COMPANY' || role === 'MANAGER' || role === 'STAFF';
    const needsHomesMulti = role === 'MANAGER';
    const needsHomeSingle = role === 'STAFF' && staffPosition !== 'BANK_STAFF';

    // Derived for the list filter
    const homesForFilterCompany = useMemo(
        () => homes.filter(h => !filterCompanyId || h.company_id === filterCompanyId),
        [homes, filterCompanyId]
    );

    return (
        <div className="space-y-8">
            <h1 className="text-2xl font-semibold">Admin · Member Control</h1>

            {/* Create member */}
            <section className="rounded-xl border p-4 max-w-2xl space-y-4">
                <h2 className="text-base font-semibold">Create a member</h2>
                <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                        <label className="block text-sm mb-1">Full name</label>
                        <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="Jane Doe" />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-sm mb-1">Password</label>
                        <input type="password" value={pw} onChange={e => setPw(e.target.value)} required className="w-full border rounded-lg px-3 py-2" />
                    </div>

                    <div>
                        <label className="block text-sm mb-1">Role</label>
                        <select
                            value={role}
                            onChange={e => {
                                const r = e.target.value as Role;
                                setRole(r);
                                setHomeId(''); setHomeIds([]);
                                // reset positions when role changes
                                setStaffPosition('RESIDENTIAL');
                                setManagerPosition('DEPUTY');
                                setCompanyPositions([]);
                            }}
                            className="w-full border rounded-lg px-3 py-2"
                        >
                            <option value="STAFF">Staff</option>
                            <option value="MANAGER">Manager</option>
                            <option value="COMPANY">Company</option>
                            <option value="ADMIN">Admin</option>
                        </select>
                    </div>

                    {needsCompany && (
                        <div>
                            <label className="block text-sm mb-1">Company</label>
                            <select
                                value={companyId}
                                onChange={e => { setCompanyId(e.target.value); setHomeId(''); setHomeIds([]); }}
                                className="w-full border rounded-lg px-3 py-2"
                                required
                            >
                                <option value="">Select...</option>
                                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                    )}

                    {/* Position (depends on role) */}
                    {role === 'STAFF' && (
                        <div>
                            <label className="block text-sm mb-1">Position</label>
                            <select
                                value={staffPosition}
                                onChange={e => setStaffPosition(e.target.value as StaffPosition)}
                                className="w-full border rounded-lg px-3 py-2"
                            >
                                {STAFF_POSITIONS.map(p => (
                                    <option key={p} value={p}>
                                        {p === 'RESIDENTIAL' ? 'Residential'
                                            : p === 'BANK_STAFF' ? 'Bank Staff'
                                                : 'Team Leader'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {role === 'MANAGER' && (
                        <div>
                            <label className="block text-sm mb-1">Position</label>
                            <select
                                value={managerPosition}
                                onChange={e => setManagerPosition(e.target.value as ManagerPosition)}
                                className="w-full border rounded-lg px-3 py-2"
                            >
                                {MANAGER_POSITIONS.map(p => (
                                    <option key={p} value={p}>
                                        {p === 'DEPUTY' ? 'Deputy' : 'Home Manager'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {role === 'COMPANY' && (
                        <div className="sm:col-span-2">
                            <label className="block text-sm mb-1">Positions (select one or more)</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-auto border rounded-lg p-2">
                                {COMPANY_POSITIONS.map(p => (
                                    <label key={p} className="inline-flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={companyPositions.includes(p)}
                                            onChange={() => setCompanyPositions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                                        />
                                        <span>
                                            {p === 'OWNER' ? 'Owner' : p === 'SITE_MANAGER' ? 'Site Manager' : 'Finance Officer'}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {needsHomesMulti && (
                        <div className="sm:col-span-2">
                            <label className="block text-sm mb-1">Homes (select one or more)</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-auto border rounded-lg p-2">
                                {homesForCompany.length === 0 ? (
                                    <p className="text-xs text-gray-500 px-2 py-1">No homes in this company.</p>
                                ) : homesForCompany.map(h => (
                                    <label key={h.id} className="inline-flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={homeIds.includes(h.id)} onChange={() => toggleHome(h.id)} />
                                        <span>{h.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {needsHomeSingle && (
                        <div>
                            <label className="block text-sm mb-1">Home</label>
                            <select
                                value={homeId}
                                onChange={e => setHomeId(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2"
                                required
                            >
                                <option value="">Select…</option>
                                {homesForCompany.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                            </select>
                        </div>
                    )}

                    <div className="sm:col-span-2">
                        <button type="submit" disabled={submitting} className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60">
                            {submitting ? 'Creating…' : 'Create member'}
                        </button>
                    </div>
                </form>
                {formErr && <p className="text-sm text-amber-700">{formErr}</p>}
                {msg && <p className="text-green-700 text-sm">{msg}</p>}
                {err && <p className="text-red-600 text-sm">{err}</p>}
            </section>

            {/* Members list */}
            <MembersList
                members={members}
                listLoading={listLoading}
                q={q}
                setQ={setQ}
                companies={companies}
                homes={homes}
                filterCompanyId={filterCompanyId}
                setFilterCompanyId={(v) => { setFilterCompanyId(v); setFilterHomeId(''); }}
                filterHomeId={filterHomeId}
                setFilterHomeId={setFilterHomeId}
                onSearch={(params) => loadMembers(params)}
                onChanged={() => loadMembers({ q, company_id: filterCompanyId, home_id: filterHomeId })}
            />
        </div>
    );
}

/* =========================
   Helpers + Subcomponents
   ========================= */
function labelForLevel(l: Member['level']) {
    return l === '1_ADMIN' ? 'Admin'
        : l === '2_COMPANY' ? 'Company'
            : l === '3_MANAGER' ? 'Manager'
                : l === '4_STAFF' ? 'Staff'
                    : 'Unassigned';
}

function Skeleton() {
    return <div className="h-24 rounded-xl bg-gradient-to-br from-gray-100 to-gray-50 animate-pulse" />;
}

function MembersList({
    members, listLoading, q, setQ, onSearch,
    companies, homes,
    filterCompanyId, setFilterCompanyId, filterHomeId, setFilterHomeId,
    onChanged
}: {
    members: Member[];
    listLoading: boolean;
    q: string;
    setQ: (v: string) => void;
    onSearch: (params?: { q?: string; company_id?: string; home_id?: string }) => void;
    companies: Company[];
    homes: Home[];
    filterCompanyId: string;
    setFilterCompanyId: (v: string) => void;
    filterHomeId: string;
    setFilterHomeId: (v: string) => void;
    onChanged: () => void;
}) {
    const homesForCompany = homes.filter(h => !filterCompanyId || h.company_id === filterCompanyId);

    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold mr-2">Members</h2>

                {/* Search text */}
                <input
                    placeholder="Search name or email…"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            onSearch({
                                q: q.trim() || undefined,
                                company_id: filterCompanyId || undefined,
                                home_id: filterHomeId || undefined
                            });
                        }
                    }}
                    className="border rounded-lg px-3 py-1.5 w-64"
                />

                {/* Company filter */}
                <select
                    className="border rounded-lg px-3 py-1.5"
                    value={filterCompanyId}
                    onChange={e => { setFilterCompanyId(e.target.value); setFilterHomeId(''); }}
                >
                    <option value="">All companies</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>

                {/* Home filter (scoped to company) */}
                <select
                    className="border rounded-lg px-3 py-1.5"
                    value={filterHomeId}
                    onChange={e => setFilterHomeId(e.target.value)}
                    disabled={!filterCompanyId}
                    title={filterCompanyId ? '' : 'Select a company to filter homes'}
                >
                    <option value="">{filterCompanyId ? 'All homes' : 'Select company first'}</option>
                    {homesForCompany.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>

                <button
                    onClick={() => onSearch({ q, company_id: filterCompanyId, home_id: filterHomeId })}
                    className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                >
                    Search
                </button>
                <button
                    onClick={() => {
                        setQ(''); setFilterCompanyId(''); setFilterHomeId('');
                        onSearch();
                    }}
                    className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
                >
                    Reset
                </button>
            </div>

            {listLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Skeleton /><Skeleton /><Skeleton />
                </div>
            ) : members.length === 0 ? (
                <p className="text-sm text-gray-600">No members found.</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {members.map(m => (
                        <MemberCard
                            key={m.id}
                            m={m}
                            companies={companies}
                            homes={homes}
                            onChanged={onChanged}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function MemberCard({ m, companies, homes, onChanged }: {
    m: Member;
    companies: Company[];
    homes: Home[];
    onChanged: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Editable profile fields
    const [fullName, setFullName] = useState(m.full_name || '');
    const [email, setEmail] = useState(m.email || '');

    // Password bits
    const [showPw, setShowPw] = useState(false);
    const [pw, setPw] = useState('');
    const [pw2, setPw2] = useState('');
    const [settingPw, setSettingPw] = useState(false);
    const [pwMsg, setPwMsg] = useState<string | null>(null);
    const [pwErr, setPwErr] = useState<string | null>(null);

    // Initial role guess
    const initialRole: Role =
        m.is_admin ? 'ADMIN'
            : m.level === '2_COMPANY' ? 'COMPANY'
                : m.homes.find(h => h.role === 'MANAGER') ? 'MANAGER'
                    : m.homes.find(h => h.role === 'STAFF') ? 'STAFF'
                        : 'STAFF';

    const [role, setRole] = useState<Role>(initialRole);

    // Initial company: prefer company memberships, then homes' company
    const firstCompanyId = (m.companies[0]?.id) || (m.homes[0]?.company_id || '');
    const [companyId, setCompanyId] = useState<string>(firstCompanyId);

    // STAFF single home; MANAGER multiple
    const staffHomeInitial = (m.homes.find(h => h.role === 'STAFF')?.home_id) || '';
    const [homeId, setHomeId] = useState<string>(staffHomeInitial);

    const managerHomeInitials =
        m.homes.filter(h => h.role === 'MANAGER').map(h => h.home_id);
    const [homeIds, setHomeIds] = useState<string[]>(managerHomeInitials);

    // Positions
    const [staffPosition, setStaffPosition] = useState<StaffPosition>(
        (m.position as StaffPosition) || (m.bank ? 'BANK_STAFF' : 'RESIDENTIAL')
    );
    const [managerPosition, setManagerPosition] = useState<ManagerPosition>(
        (m.position as ManagerPosition) || 'DEPUTY'
    );
    const [companyPositions, setCompanyPositions] = useState<CompanyPosition[]>(
        Array.isArray(m.positions) && m.positions.length ? (m.positions as CompanyPosition[]) : []
    );

    const needsCompany = role === 'COMPANY' || role === 'MANAGER' || role === 'STAFF';
    const needsHomesMulti = role === 'MANAGER';
    const needsHomeSingle = role === 'STAFF' && staffPosition !== 'BANK_STAFF';

    function toggleHome(id: string) {
        setHomeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    useEffect(() => {
        if (role === 'ADMIN') { setCompanyId(''); setHomeId(''); setHomeIds([]); }
        if (role === 'COMPANY') { setHomeId(''); setHomeIds([]); if (!companyId && companies[0]) setCompanyId(companies[0].id); }
        if (role === 'MANAGER' && homeIds.length === 0) {
            const first = homes.find(h => !companyId || h.company_id === companyId);
            if (first) { setCompanyId(first.company_id); setHomeIds([first.id]); }
        }
        if (role === 'STAFF') {
            if (staffPosition === 'BANK_STAFF') { setHomeId(''); }
            else if (!homeId) {
                const first = homes.find(h => !companyId || h.company_id === companyId);
                if (first) { setCompanyId(first.company_id); setHomeId(first.id); }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role, staffPosition]);

    function setsEqual(a: string[], b: string[]) {
        if (a.length !== b.length) return false;
        const A = new Set(a); for (const x of b) if (!A.has(x)) return false;
        return true;
    }

    function profileChanged(): boolean {
        return (fullName !== (m.full_name || '')) || (email !== (m.email || ''));
    }
    function roleChanged(): boolean {
        if (initialRole !== role) return true;
        if (role === 'COMPANY') return companyId !== firstCompanyId || JSON.stringify(companyPositions) !== JSON.stringify(Array.isArray(m.positions) ? m.positions : []);
        if (role === 'MANAGER') return !setsEqual(homeIds, managerHomeInitials) || companyId !== firstCompanyId || (managerPosition !== (m.position as ManagerPosition));
        if (role === 'STAFF') return homeId !== staffHomeInitial || companyId !== firstCompanyId || (staffPosition !== ((m.position as StaffPosition) || (m.bank ? 'BANK_STAFF' : 'RESIDENTIAL')));
        return false;
    }

    async function onSave() {
        setSaving(true); setErr(null);
        try {
            // 1) Profile
            if (profileChanged()) {
                const res = await fetch('/api/admin/members/update-profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: m.id, full_name: fullName, email }),
                });
                const data = await res.json();
                if (!res.ok) { setErr(data?.error || `Profile update failed (${res.status}).`); setSaving(false); return; }
            }

            // 2) Role/memberships (+ positions)
            if (roleChanged()) {
                const payload: any = { user_id: m.id, role };
                if (role === 'ADMIN') {
                    // nothing else
                } else if (role === 'COMPANY') {
                    payload.company_id = companyId;
                    payload.positions = companyPositions;               // multi
                } else if (role === 'MANAGER') {
                    payload.company_id = companyId || null;
                    payload.home_ids = homeIds;
                    payload.position = managerPosition;               // single
                } else if (role === 'STAFF') {
                    payload.company_id = companyId || null;
                    payload.bank_staff = (staffPosition === 'BANK_STAFF'); // derive
                    if (staffPosition !== 'BANK_STAFF') payload.home_id = homeId;
                    payload.position = staffPosition;                   // single
                }

                const res = await fetch('/api/admin/members/update', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!res.ok) { setErr(data?.error || `Role update failed (${res.status}).`); setSaving(false); return; }
            }

            setEditing(false);
            onChanged();
        } catch (e: any) {
            setErr(e?.message || 'Network error.');
        } finally {
            setSaving(false);
        }
    }

    async function onSetPassword() {
        setPwErr(null); setPwMsg(null);
        if (pw.length < 8) { setPwErr('Password must be at least 8 characters.'); return; }
        if (pw !== pw2) { setPwErr('Passwords do not match.'); return; }
        setSettingPw(true);
        try {
            const res = await fetch('/api/admin/members/set-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: m.id, password: pw }),
            });
            const data = await res.json();
            if (!res.ok) setPwErr(data?.error || `Failed (${res.status}).`);
            else { setPw(''); setPw2(''); setPwMsg('Password updated.'); }
        } catch (e: any) { setPwErr(e?.message || 'Network error.'); }
        finally { setSettingPw(false); }
    }

    function generatePassword(len = 12) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%^*()-_=+';
        let out = ''; for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
        setPw(out); setPw2(out);
    }

    const homesForCompany = homes.filter(h => !companyId || h.company_id === companyId);

    return (
        <article className="rounded-xl border p-4 space-y-2">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="font-medium">{m.full_name || '—'}</h3>
                    <p className="text-xs text-gray-600">{m.email}</p>
                </div>
                <span className="text-xs rounded-full px-2 py-0.5 border bg-gray-50">
                    {labelForLevel(m.level)}
                </span>
            </div>

            {!editing ? (
                <>
                    {m.is_admin && <p className="text-xs text-indigo-700">Admin</p>}
                    {m.companies.length > 0 && (
                        <p className="text-xs text-gray-600">Companies: {m.companies.map(c => c.name).join(', ')}</p>
                    )}
                    {m.homes.length > 0 && (
                        <p className="text-xs text-gray-600">
                            Homes: {m.homes.map(h => `${h.home_name} (${h.company_name}) • ${h.role.toLowerCase()}`).join(' · ')}
                        </p>
                    )}
                    {/* Positions summary */}
                    {initialRole === 'COMPANY' && (Array.isArray(m.positions) && m.positions.length > 0) && (
                        <p className="text-xs text-gray-700">Positions: {m.positions.map(p => (
                            p === 'OWNER' ? 'Owner' : p === 'SITE_MANAGER' ? 'Site Manager' : 'Finance Officer'
                        )).join(', ')}</p>
                    )}
                    {initialRole === 'MANAGER' && m.position && (
                        <p className="text-xs text-gray-700">Position: {(m.position === 'DEPUTY') ? 'Deputy' : 'Home Manager'}</p>
                    )}
                    {initialRole === 'STAFF' && (
                        <p className="text-xs text-gray-700">
                            Position: {m.position === 'TEAM_LEADER' ? 'Team Leader'
                                : m.position === 'BANK_STAFF' ? 'Bank Staff'
                                    : 'Residential'}
                        </p>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button onClick={() => setEditing(true)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
                            Edit
                        </button>
                        <button onClick={() => setShowPw(s => !s)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
                            {showPw ? 'Hide password' : 'Change password'}
                        </button>
                    </div>

                    {showPw && (
                        <div className="mt-3 rounded-lg border p-3 space-y-2 bg-gray-50/50">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-gray-700">Set a new password</h4>
                                <button type="button" onClick={() => generatePassword(12)} className="text-xs underline">
                                    Generate strong
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input type="text" placeholder="New password" value={pw} onChange={e => setPw(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
                                <input type="text" placeholder="Confirm password" value={pw2} onChange={e => setPw2(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
                            </div>
                            <div className="flex gap-2">
                                <button disabled={settingPw} onClick={onSetPassword} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60">
                                    {settingPw ? 'Updating…' : 'Update password'}
                                </button>
                                <button disabled={settingPw} onClick={() => { setPw(''); setPw2(''); setPwErr(null); setPwMsg(null); setShowPw(false); }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
                                    Cancel
                                </button>
                            </div>
                            {pwErr && <p className="text-xs text-red-600">{pwErr}</p>}
                            {pwMsg && <p className="text-xs text-green-700">{pwMsg}</p>}
                        </div>
                    )}

                    <p className="text-[11px] text-gray-400 pt-1">
                        Created: {m.created_at ? new Date(m.created_at).toLocaleString() : '—'} ·
                        Last sign-in: {m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString() : '—'}
                    </p>
                </>
            ) : (
        <>
                    {/* Profile fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs mb-1">Full name</label>
                            <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Full name" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1">Email</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="name@company.com" />
                        </div>

                        {/* Role fields */}
                        <div>
                            <label className="block text-xs mb-1">Role</label>
                            <select value={role} onChange={e => { setRole(e.target.value as Role); setHomeId(''); setHomeIds([]); }} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                                <option value="STAFF">Staff</option>
                                <option value="MANAGER">Manager</option>
                                <option value="COMPANY">Company</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                        </div>

                        {role !== 'ADMIN' && (
                            <div>
                                    <label className="block text-xs mb-1">Company</label>
                                <select value={companyId} onChange={e => { setCompanyId(e.target.value); setHomeId(''); setHomeIds([]); }} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                                    <option value="">Select…</option>
                                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        )}

                        {/* Position editors */}
                        {role === 'STAFF' && (
                            <div>
                                <label className="block text-xs mb-1">Position</label>
                                <select
                                    value={staffPosition}
                                    onChange={e => setStaffPosition(e.target.value as StaffPosition)}
                                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                >
                                    {(['RESIDENTIAL', 'BANK_STAFF', 'TEAM_LEADER'] as StaffPosition[]).map(p => (
                                        <option key={p} value={p}>
                                            {p === 'RESIDENTIAL' ? 'Residential'
                                                : p === 'BANK_STAFF' ? 'Bank Staff'
                                                    : 'Team Leader'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {role === 'MANAGER' && (
                            <div>
                                <label className="block text-xs mb-1">Position</label>
                                <select
                                    value={managerPosition}
                                    onChange={e => setManagerPosition(e.target.value as ManagerPosition)}
                                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                >
                                    {(['DEPUTY', 'HOME_MANAGER'] as ManagerPosition[]).map(p => (
                                        <option key={p} value={p}>
                                            {p === 'DEPUTY' ? 'Deputy' : 'Home Manager'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {role === 'COMPANY' && (
                            <div className="sm:col-span-2">
                                <label className="block text-xs mb-1">Positions (select one or more)</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-auto border rounded-lg p-2">
                                    {(['OWNER', 'SITE_MANAGER', 'FINANCE_OFFICER'] as CompanyPosition[]).map(p => (
                                        <label key={p} className="inline-flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={companyPositions.includes(p)}
                                                onChange={() =>
                                                    setCompanyPositions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
                                                }
                                            />
                                            <span>{p === 'OWNER' ? 'Owner' : p === 'SITE_MANAGER' ? 'Site Manager' : 'Finance Officer'}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {role === 'MANAGER' && (
                            <div className="sm:col-span-2">
                                <label className="block text-xs mb-1">Homes (select one or more)</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-auto border rounded-lg p-2">
                                    {homes.filter(h => !companyId || h.company_id === companyId).length === 0 ? (
                                        <p className="text-xs text-gray-500 px-2 py-1">No homes in this company.</p>
                                    ) : homes.filter(h => !companyId || h.company_id === companyId).map(h => (
                                        <label key={h.id} className="inline-flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={homeIds.includes(h.id)}
                                                onChange={() => setHomeIds(prev => prev.includes(h.id) ? prev.filter(x => x !== h.id) : [...prev, h.id])}
                                            />
                                            <span>{h.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {role === 'STAFF' && staffPosition !== 'BANK_STAFF' && (
                            <div className="sm:col-span-2">
                                <label className="block text-xs mb-1">Home</label>
                                <select
                                    value={homeId}
                                    onChange={e => setHomeId(e.target.value)}
                                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                                >
                                    <option value="">Select…</option>
                                    {homes.filter(h => !companyId || h.company_id === companyId).map(h => (
                                        <option key={h.id} value={h.id}>{h.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {err && <p className="text-xs text-red-600">{err}</p>}

                    <div className="flex gap-2">
                        <button
                            disabled={saving}
                            onClick={onSave}
                            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            disabled={saving}
                            onClick={() => {
                                setEditing(false); setErr(null);
                                setFullName(m.full_name || ''); setEmail(m.email || '');
                                setRole(initialRole); setCompanyId(firstCompanyId);
                                setHomeId(staffHomeInitial); setHomeIds(managerHomeInitials);
                                setStaffPosition((m.position as StaffPosition) || (m.bank ? 'BANK_STAFF' : 'RESIDENTIAL'));
                                setManagerPosition((m.position as ManagerPosition) || 'DEPUTY');
                                setCompanyPositions(Array.isArray(m.positions) ? (m.positions as CompanyPosition[]) : []);
                            }}
                            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                    </div>
                </>
            )}
        </article>
    );
}
