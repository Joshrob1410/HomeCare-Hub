'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';

type Level = '2_COMPANY'|'3_MANAGER'|'other';
type RoleChoice = 'COMPANY'|'MANAGER'|'STAFF'|'BANK';

type Company = { id: string; name: string };
type Home    = { id: string; name: string; company_id: string };
type Member = {
    id: string;
    email: string;
    full_name: string;
    created_at?: string;
    last_sign_in_at?: string | null;
    is_admin?: boolean;
    roles: {
        company: boolean;
        bank: boolean;
        manager_homes: { id: string; name: string }[];
        staff_home: { id: string; name: string } | null;
        // NEW: company-scoped DSL flag (may be undefined until API updated)
        dsl?: boolean;
    };
};


export default function PeoplePage() {
  const [level, setLevel] = useState<Level>('other');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [homes, setHomes] = useState<Home[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string|null>(null);

  // Toast state
  const [toast, setToast] = useState<{ id: number; type: 'success'|'error'; text: string } | null>(null);
  const showToast = (type: 'success'|'error', text: string) => {
    const id = Date.now();
    setToast({ id, type, text });
    setTimeout(() => setToast(t => (t?.id === id ? null : t)), 2400);
  };

  // Caller scope (for filtering UI lists)
  const [myCompanyId, setMyCompanyId] = useState<string | null>(null);
  const [myManagedHomes, setMyManagedHomes] = useState<string[]>([]);

  // Create form + busy state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [createRole, setCreateRole] = useState<'STAFF'|'MANAGER'>('STAFF');
  const [companyId, setCompanyId] = useState('');
  const [homeId, setHomeId] = useState('');
  const [homeIds, setHomeIds] = useState<string[]>([]);
    const [bankStaff, setBankStaff] = useState(false);
    const [isDSL, setIsDSL] = useState(false); // NEW
    const [creating, setCreating] = useState(false);


  // Filters
  const [search, setSearch] = useState('');
  const [filterHomeId, setFilterHomeId] = useState('');
  const [bankOnly, setBankOnly] = useState(false); // company only

  const homesForCompany = useMemo(() => homes.filter(h => !companyId || h.company_id === companyId), [homes, companyId]);
  const homesForMyCompany = useMemo(() => homes.filter(h => !myCompanyId || h.company_id === myCompanyId), [homes, myCompanyId]);
  const homesIManage = useMemo(() => homes.filter(h => myManagedHomes.includes(h.id)), [homes, myManagedHomes]);

  // Home list available to the toolbar (scoped)
  const toolbarHomes = useMemo(
    () => (level === '2_COMPANY' ? homesForMyCompany : homesIManage),
    [level, homesForMyCompany, homesIManage]
  );

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);

      const { data: lvl } = await supabase.rpc('get_effective_level');
      if (lvl === '2_COMPANY' || lvl === '3_MANAGER') setLevel(lvl);
      else setLevel('other');

      const [{ data: co }, { data: hm }, [c, h]] = await Promise.all([
        supabase.from('company_memberships').select('company_id').maybeSingle(),
        supabase.from('home_memberships').select('home_id').eq('role', 'MANAGER'),
        Promise.all([
          supabase.from('companies').select('id,name').order('name'),
          supabase.from('homes').select('id,name,company_id').order('name')
        ])
      ]);

      if (co?.company_id) setMyCompanyId(co.company_id);
      if (hm) setMyManagedHomes(hm.map((r: any) => r.home_id));
      if (!c.error) setCompanies(c.data || []);
      if (!h.error) setHomes(h.data as Home[] || []);

      await loadMembers();
      setLoading(false);
    })();
  }, []);

  async function loadMembers() {
    setErr(null);
    const res = await fetch('/api/self/members/list');
    const data = await res.json();
    if (!res.ok) { setErr(data?.error || `Failed (${res.status})`); return; }
    setMembers(data.members || []);
  }

  // Derived filtered members
  const filteredMembers = useMemo(() => {
    let list = [...members];

    // Bank staff filter (company only)
    if (level === '2_COMPANY' && bankOnly) {
      list = list.filter(m => m.roles.bank);
    } else if (filterHomeId) {
      // Match staff_home OR any manager_homes
      list = list.filter(m =>
        (m.roles.staff_home && m.roles.staff_home.id === filterHomeId) ||
        (m.roles.manager_homes && m.roles.manager_homes.some(h => h.id === filterHomeId))
      );
    }

    // Search by name or email
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        (m.full_name || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q)
      );
    }

    // Optional: sort by name for stability
    list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    return list;
  }, [members, bankOnly, filterHomeId, search, level]);

  // Reset Home filter when switching Bank only on
  useEffect(() => {
    if (bankOnly) setFilterHomeId('');
  }, [bankOnly]);

  function clearFilters() {
    setSearch('');
    setFilterHomeId('');
    setBankOnly(false);
  }

  function toggleHome(id: string) {
    setHomeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const isCompany = level === '2_COMPANY';
    if (!email || !pw) { setErr('Email and password are required.'); return; }

    if (isCompany) {
      if (!companyId) return setErr('Pick a company.');
      if (createRole === 'MANAGER' && homeIds.length === 0) return setErr('Pick at least one home for a Manager.');
      if (createRole === 'STAFF' && !bankStaff && !homeId) return setErr('Pick a home for the staff member, or mark as bank staff.');
    } else {
      if (createRole !== 'STAFF') return setErr('Managers can only create Staff.');
      if (!homeId) return setErr('Pick a home for the staff member.');
    }

    setCreating(true);
    try {
        const payload: any = { email, password: pw, full_name: fullName, role: createRole };
        if (isCompany) {
            payload.company_id = companyId;
            payload.is_dsl = isDSL; // NEW
            if (createRole === 'MANAGER') payload.home_ids = homeIds;
            if (createRole === 'STAFF') { payload.bank_staff = bankStaff; if (!bankStaff) payload.home_id = homeId; }
        } else {
            payload.home_id = homeId;
            // Managers cannot mark DSL at create-time (company-scoped control)
        }


      const res = await fetch('/api/self/members/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);

      setFullName(''); setEmail(''); setPw(''); setCompanyId(''); setHomeId(''); setHomeIds([]); setBankStaff(false); setIsDSL(false);
      await loadMembers();
      showToast('success', 'Member created');
    } catch (e: any) {
      const msg = e?.message || 'Failed to create member';
      setErr(msg);
      showToast('error', msg);
    } finally {
      setCreating(false);
    }
  }

  // Parent-side save handlers return boolean so the card knows whether to close editors.
  async function saveProfile(id: string, full_name: string, email: string): Promise<boolean> {
    try {
      const res = await fetch('/api/self/members/update-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: id, full_name, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
      await loadMembers();
      showToast('success', 'Profile updated');
      return true;
    } catch (e: any) {
      const msg = e?.message || 'Failed to update profile';
      showToast('error', msg);
      return false;
    }
  }

   async function setRole(id: string, choice: RoleChoice, selectedHomes: string[], staffHome: string, dsl?: boolean): Promise<boolean> {
    try {
        let payload: any = { user_id: id };
        if (choice === 'COMPANY') payload = { ...payload, role: 'COMPANY' };
        else if (choice === 'BANK') payload = { ...payload, role: 'STAFF', bank: true };
        else if (choice === 'MANAGER') payload = { ...payload, role: 'MANAGER', home_ids: selectedHomes };
        else payload = { ...payload, role: 'STAFF', home_id: staffHome };

        // NEW: Allow company users to set DSL; managers shouldn’t send this flag.
        if (dsl !== undefined) payload.is_dsl = dsl;


      const res = await fetch('/api/self/members/update-role', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);

      await loadMembers();
      showToast('success', 'Role & scope saved');
      return true;
    } catch (e: any) {
      const msg = e?.message || 'Failed to save role';
      showToast('error', msg);
      return false;
    }
  }

  if (loading) return <p className="p-6">Loading…</p>;
  if (level === 'other') return <p className="p-6">You need Company or Manager access to use this page.</p>;

  const isCompany = level === '2_COMPANY';
  const isManager = level === '3_MANAGER';

  const resultsText = `${filteredMembers.length} result${filteredMembers.length === 1 ? '' : 's'}` +
    (filteredMembers.length !== members.length ? ` · ${members.length} total` : '');

  return (
    <div className="p-6 space-y-8">
      {/* Toast */}
      <Toast toast={toast} />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{isCompany ? 'Company' : 'Manager'} · People</h1>
        <p className="text-sm text-gray-600">Create users, edit details, and manage roles + scope.</p>
      </header>

      {/* Create user */}
      <section className="rounded-2xl border bg-white shadow-sm ring-1 ring-gray-50 p-4 space-y-3 max-w-2xl" aria-busy={creating}>
        <h2 className="text-base font-semibold">Create member</h2>
        <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Full name</label>
            <input className="border rounded-lg px-3 py-2 w-full" value={fullName} onChange={e=>setFullName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input type="email" className="border rounded-lg px-3 py-2 w-full" value={email} onChange={e=>setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input type="password" className="border rounded-lg px-3 py-2 w-full" value={pw} onChange={e=>setPw(e.target.value)} required />
          </div>

          {isCompany ? (
            <>
              <div>
                <label className="block text-sm mb-1">Role</label>
                <select value={createRole} onChange={e=>{ const v = e.target.value as 'STAFF'|'MANAGER'; setCreateRole(v); setHomeId(''); setHomeIds([]); setBankStaff(false); }}
                        className="border rounded-lg px-3 py-2 w-full">
                  <option value="STAFF">Staff</option>
                  <option value="MANAGER">Manager</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Company</label>
                <select value={companyId} onChange={e=>{ setCompanyId(e.target.value); setHomeId(''); setHomeIds([]); }}
                        className="border rounded-lg px-3 py-2 w-full" required>
                  <option value="">Select…</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {createRole === 'MANAGER' && (
                <div className="sm:col-span-2">
                  <label className="block text-sm mb-1">Homes (one or more)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-auto border rounded-lg p-2">
                    {(companyId ? homesForCompany : homesForMyCompany).map(h => (
                      <label key={h.id} className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={homeIds.includes(h.id)} onChange={() => toggleHome(h.id)} />
                        <span>{h.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
                          {createRole === 'STAFF' && (
                              <>
                                  <div className="sm:col-span-2">
                                      <label className="inline-flex items-center gap-2 text-sm">
                                          <input type="checkbox" checked={bankStaff} onChange={e => setBankStaff(e.target.checked)} />
                                          <span>Bank staff (company only)</span>
                                      </label>
                                  </div>
                                  {!bankStaff && (
                                      <div>
                                          <label className="block text-sm mb-1">Home</label>
                                          <select value={homeId} onChange={e => setHomeId(e.target.value)} className="border rounded-lg px-3 py-2 w-full" required>
                                              <option value="">Select…</option>
                                              {(companyId ? homesForCompany : homesForMyCompany).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                          </select>
                                      </div>
                                  )}
                              </>
                          )}
                          <div className="sm:col-span-2">
                              <label className="inline-flex items-center gap-2 text-sm">
                                  <input
                                      type="checkbox"
                                      checked={isDSL}
                                      onChange={e => setIsDSL(e.target.checked)}
                                  />
                                  <span>Designated Safeguarding Lead (DSL)</span>
                              </label>
                          </div>

              
            </>
          ) : (
            <>
              <div className="sm:col-span-2">
                <label className="block text-sm mb-1">Role</label>
                <input className="border rounded-lg px-3 py-2 w-full bg-gray-50" value="Staff (only)" readOnly />
              </div>
              <div>
                <label className="block text-sm mb-1">Home</label>
                <select value={homeId} onChange={e=>setHomeId(e.target.value)} className="border rounded-lg px-3 py-2 w-full" required>
                  <option value="">Select…</option>
                  {homesIManage.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <BusyButton type="submit" loading={creating}>
              {creating ? 'Creating…' : 'Create'}
            </BusyButton>
          </div>
        </form>

        {err && <p className="text-sm text-red-600">{err}</p>}
      </section>

      {/* Members */}
      <section className="space-y-4">
        <div className="rounded-2xl border bg-white shadow-sm ring-1 ring-gray-50 p-3">
          {/* Toolbar */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
              {/* Search */}
              <div className="sm:col-span-1">
                <label className="block text-xs text-gray-600 mb-1">Search</label>
                <div className="relative">
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Name or email…"
                    className="w-full border rounded-lg pl-9 pr-3 py-2"
                  />
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" />
                  </svg>
                </div>
              </div>

              {/* Home filter */}
              <div className="sm:col-span-1">
                <label className="block text-xs text-gray-600 mb-1">Home</label>
                <select
                  value={filterHomeId}
                  onChange={e => setFilterHomeId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  disabled={isCompany && bankOnly}
                >
                  <option value="">All homes</option>
                  {toolbarHomes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>

              {/* Bank staff toggle (company only) */}
              <div className="sm:col-span-1">
                <label className="block text-xs text-gray-600 mb-1">Filters</label>
                <label className={`inline-flex items-center gap-2 border rounded-lg px-3 py-2 w-full ${isCompany ? 'cursor-pointer' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    disabled={!isCompany}
                    checked={isCompany ? bankOnly : false}
                    onChange={e => setBankOnly(e.target.checked)}
                  />
                  <span className="text-sm">Bank staff only</span>
                </label>
              </div>
            </div>

            {/* Right: clear + count */}
            <div className="flex items-center justify-between md:justify-end gap-3">
              {(search || filterHomeId || (isCompany && bankOnly)) && (
                <button onClick={clearFilters} className="text-sm rounded-lg border px-3 py-2 hover:bg-gray-50">
                  Clear filters
                </button>
              )}
              <span className="text-xs text-gray-500">{resultsText}</span>
            </div>
          </div>
        </div>

        {filteredMembers.length === 0 ? (
          <p className="text-sm text-gray-600">No matching people.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredMembers.map(m => (
              <MemberCard
                key={m.id}
                m={m}
                isCompany={isCompany}
                isManager={isManager}
                homesForMyCompany={homesForMyCompany}
                homesIManage={homesIManage}
                onSaveProfile={saveProfile}
                onSetRole={setRole}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* =========================
   Member Card (polished visuals + busy buttons)
   ========================= */
function MemberCard({
  m, isCompany, isManager,
  homesForMyCompany, homesIManage,
  onSaveProfile, onSetRole
}: {
  m: Member;
  isCompany: boolean;
  isManager: boolean;
  homesForMyCompany: Home[];
  homesIManage: Home[];
  onSaveProfile: (id: string, full_name: string, email: string) => Promise<boolean>;
  onSetRole: (id: string, choice: RoleChoice, selectedHomes: string[], staffHome: string, dsl?: boolean) => Promise<boolean>;
}) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState(m.full_name || '');
  const [email, setEmail] = useState(m.email || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Role editor (dropdown) + busy
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<RoleChoice>(() => {
    if (m.roles.company) return 'COMPANY';
    if (m.roles.bank) return 'BANK';
    if (m.roles.manager_homes?.length) return 'MANAGER';
    return 'STAFF';
  });
  const [managerHomes, setManagerHomes] = useState<string[]>(m.roles.manager_homes?.map(h => h.id) || []);
  const [staffHome, setStaffHome] = useState<string>(m.roles.staff_home?.id || '');
    const [savingRole, setSavingRole] = useState(false);
    const [dsl, setDsl] = useState<boolean>(!!m.roles.dsl); // NEW


  // Allowed options based on caller + current status
  const canSetCompany = isCompany; // managers can’t
  const canSetBank = isCompany;    // managers can’t
  const canSetManager = isManager || isCompany;
  const canSetStaff = true;        // both can set staff (with scoped home)
  const inBank = !!m.roles.bank;

  const managerHomeList = isManager ? homesIManage : homesForMyCompany;
  const staffHomeList = managerHomeList;

  const visibleChoices: RoleChoice[] = [
    ...(canSetCompany ? (['COMPANY'] as RoleChoice[]) : []),
    ...(canSetManager && !inBank ? (['MANAGER'] as RoleChoice[]) : []),
    ...(canSetStaff ? (['STAFF'] as RoleChoice[]) : []),
    ...(canSetBank ? (['BANK'] as RoleChoice[]) : []),
  ];

  function toggleManagerHome(id: string) {
    setManagerHomes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSaveProfile() {
    setSavingProfile(true);
    const ok = await onSaveProfile(m.id, name, email);
    setSavingProfile(false);
    if (ok) setEditingProfile(false);
  }

  async function handleSaveRole() {
    setSavingRole(true);
      const ok = await onSetRole(m.id, choice, managerHomes, staffHome, dsl); // NEW
    setSavingRole(false);
    if (ok) setOpen(false);
  }

  // Initials avatar
  const initials = (m.full_name || m.email || '?')
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <article className="relative rounded-2xl border bg-white shadow-sm ring-1 ring-gray-50 p-3 space-y-2 hover:shadow-md transition">
      {/* Header with avatar */}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center text-xs font-semibold">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">{m.full_name || '—'}</div>
          <div className="text-xs text-gray-600 truncate">{m.email}</div>
        </div>
      </div>

      {/* Badges */}
          <div className="flex flex-wrap gap-1 text-[11px] mt-1">
              {m.roles.company && <span className="px-2 py-0.5 rounded-full border bg-gray-50">Company access</span>}
              {m.roles.bank && <span className="px-2 py-0.5 rounded-full border bg-gray-50">Bank staff</span>}
              {m.roles.manager_homes?.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full border bg-gray-50">
                      Manager @ {m.roles.manager_homes.map(h => h.name).join(', ')}
                  </span>
              )}
              {m.roles.staff_home && (
                  <span className="px-2 py-0.5 rounded-full border bg-gray-50">
                      Staff @ {m.roles.staff_home.name}
                  </span>
              )}
              {/* NEW: DSL badge (defensive: treat undefined as false) */}
              {m.roles.dsl ? (
                  <span className="px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                      DSL
                  </span>
              ) : null}
          </div>


      {/* Profile editor */}
      {!editingProfile ? (
        <button onClick={() => setEditingProfile(true)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Edit name/email</button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs">Full name</label>
          <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={name} onChange={e=>setName(e.target.value)} />
          <label className="block text-xs">Email</label>
          <input type="email" className="border rounded-lg px-2 py-1.5 text-sm w-full" value={email} onChange={e=>setEmail(e.target.value)} />
          <div className="flex gap-2">
            <BusyButton onClick={handleSaveProfile} loading={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save'}
            </BusyButton>
            <button onClick={() => { setEditingProfile(false); setName(m.full_name || ''); setEmail(m.email || ''); }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Role dropdown editor */}
      {(isCompany || isManager) && (
        <div className="pt-2 border-t mt-2">
          {!open ? (
            <button onClick={() => setOpen(true)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">
              Edit role & scope
            </button>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-xs mb-1">Role</label>
                <select
                  className="border rounded-lg px-2 py-1.5 text-sm w-full"
                  value={choice}
                  onChange={e => setChoice(e.target.value as RoleChoice)}
                >
                  {visibleChoices.map(opt => (
                    <option key={opt} value={opt}>
                      {opt === 'COMPANY' ? 'Company access'
                        : opt === 'MANAGER' ? 'Manager'
                        : opt === 'BANK' ? 'Bank staff'
                        : 'Staff (home)'}
                    </option>
                  ))}
                </select>
              </div>

              {choice === 'MANAGER' && (
                <div>
                  <p className="text-xs text-gray-700 mb-1">Select homes (one or more)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-auto border rounded-lg p-2">
                    {(isManager ? homesIManage : homesForMyCompany).length === 0 ? (
                      <p className="text-xs text-gray-500 px-2 py-1">No homes available.</p>
                    ) : (isManager ? homesIManage : homesForMyCompany).map(h => (
                      <label key={h.id} className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={managerHomes.includes(h.id)} onChange={() => toggleManagerHome(h.id)} />
                        <span>{h.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {choice === 'STAFF' && (
                <div>
                  <label className="block text-xs mb-1">Home</label>
                  <select
                    className="border rounded-lg px-2 py-1.5 text-sm w-full"
                    value={staffHome}
                    onChange={e => setStaffHome(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {(isManager ? homesIManage : homesForMyCompany).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              )}

                              {choice === 'BANK' && (
                                  <p className="text-[11px] text-gray-600">Bank staff belong to the company only and not to any home.</p>
                              )}
                              {isCompany && (
                                  <div>
                                      <label className="inline-flex items-center gap-2 text-sm">
                                          <input type="checkbox" checked={dsl} onChange={e => setDsl(e.target.checked)} />
                                          <span>Designated Safeguarding Lead (DSL)</span>
                                      </label>
                                  </div>
                              )}


              <div className="flex gap-2">
                <BusyButton onClick={handleSaveRole} loading={savingRole}>
                  {savingRole ? 'Saving…' : 'Save'}
                </BusyButton>
                <button
                  onClick={() => {
                                          setOpen(false);
                                          setChoice(m.roles.company ? 'COMPANY' : m.roles.bank ? 'BANK' : m.roles.manager_homes?.length ? 'MANAGER' : 'STAFF');
                                          setManagerHomes(m.roles.manager_homes?.map(h => h.id) || []);
                                          setStaffHome(m.roles.staff_home?.id || '');
                                          setDsl(!!m.roles.dsl); // NEW

                  }}
                  className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/* =========================
   UI helpers: BusyButton + Toast
   ========================= */
function BusyButton({
  children, loading, className = '', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      disabled={loading}
      className={
        `inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60 ${className}`
      }
      {...props}
    >
      {loading && <Spinner />}
      <span>{children}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
    </svg>
  );
}

function Toast({ toast }: { toast: { id: number; type: 'success'|'error'; text: string } | null }) {
  if (!toast) return null;
  const tone = toast.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-900';
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`min-w-[220px] max-w-[360px] rounded-xl border px-3 py-2 text-sm shadow-sm ${tone}`}>
        {toast.text}
      </div>
    </div>
  );
}
