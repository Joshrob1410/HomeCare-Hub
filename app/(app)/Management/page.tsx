"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";
import { getEffectiveLevel, type AppLevel } from "@/supabase/roles";



/**
 * Management hub
 * Tabs: People, Homes, Companies
 *
 * Access
 * - Admin (1_ADMIN): all tabs; can choose any company/home; can set any role (incl Admin)
 * - Company (2_COMPANY): People + Homes only; company is fixed to their own; can set roles up to their level
 * - Manager (3_MANAGER): People only; scope limited to their managed home(s); can set roles up to their level
 * - Staff (4_STAFF): no access (redirect)
 */

// Helper to include the Supabase access token on API calls
async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    return fetch(input, { ...init, headers });
}

export default function ManagementPage() {
    const router = useRouter();
    const [level, setLevel] = useState<AppLevel | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const lvl = await getEffectiveLevel();
            setLevel(lvl as AppLevel);
            setLoading(false);
        })();
    }, []);

    useEffect(() => {
        if (!loading && level === "4_STAFF") router.replace("/dashboard");
    }, [level, loading, router]);

    if (loading || level === "4_STAFF") {
        return (
            <div className="p-5 min-h-screen bg-gray-50">
                <div className="animate-pulse text-sm text-gray-600">Loading…</div>
            </div>
        );
    }

    const isAdmin = level === "1_ADMIN";
    const isCompany = level === "2_COMPANY";
    const isManager = level === "3_MANAGER";

    return (
        <div className="p-5 space-y-5 bg-gray-50 min-h-screen">
            <header className="flex items-end justify-between">
                <div>
                    <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight text-gray-900">
                        Management
                    </h1>
                    <p className="text-[13px] text-gray-600">People, Homes and Companies</p>
                </div>
            </header>

            <Tabbed isAdmin={isAdmin} isCompany={isCompany} isManager={isManager} />
        </div>
    );
}

function Tabbed({
    isAdmin,
    isCompany,
    isManager,
}: {
    isAdmin: boolean;
    isCompany: boolean;
    isManager: boolean;
}) {
    type Tab = "PEOPLE" | "HOMES" | "COMPANIES";
    const [tab, setTab] = useState<Tab>("PEOPLE");

    const showHomes = isAdmin || isCompany;
    const showCompanies = isAdmin;

    return (
        <div className="space-y-4">
            <div className="inline-flex rounded-lg ring-1 ring-gray-300 bg-white shadow-sm overflow-hidden">
                <TabBtn active={tab === "PEOPLE"} onClick={() => setTab("PEOPLE")}>
                    People
                </TabBtn>
                {showHomes && (
                    <TabBtn active={tab === "HOMES"} onClick={() => setTab("HOMES")}>
                        Homes
                    </TabBtn>
                )}
                {showCompanies && (
                    <TabBtn active={tab === "COMPANIES"} onClick={() => setTab("COMPANIES")}>
                        Companies
                    </TabBtn>
                )}
            </div>

            {tab === "PEOPLE" && (
                <PeopleTab isAdmin={isAdmin} isCompany={isCompany} isManager={isManager} />
            )}
            {tab === "HOMES" && showHomes && (
                <HomesTab isAdmin={isAdmin} isCompany={isCompany} />
            )}
            {tab === "COMPANIES" && showCompanies && <CompaniesTab />}
        </div>
    );
}

function TabBtn(
    {
        active,
        children,
        ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
    return (
        <button
            className={`px-4 py-2 text-sm border-r last:border-r-0 transition ${active ? "bg-indigo-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
            {...props}
        >
            {children}
        </button>
    );
}


/* =====================
   PEOPLE TAB
   ===================== */

type Company = { id: string; name: string };
type Home = { id: string; name: string; company_id: string };

function PeopleTab({
    isAdmin,
    isCompany,
    isManager,
}: {
    isAdmin: boolean;
    isCompany: boolean;
    isManager: boolean;
}) {
    // Scope
    const [myCompanyId, setMyCompanyId] = useState<string>("");
    const [myCompanyName, setMyCompanyName] = useState<string>("");
    const [companies, setCompanies] = useState<Company[]>([]);
    const [homesFilter, setHomesFilter] = useState<Home[]>([]);
    const [homesCreate, setHomesCreate] = useState<Home[]>([]);

    // Listing
    const PAGE_SIZE = 10;
    const [rows, setRows] = useState<
        Array<{ user_id: string; full_name: string; home_id: string | null; is_bank: boolean }>
    >([]);
    const [nextFrom, setNextFrom] = useState<number | null>(0);
    const [filterCompany, setFilterCompany] = useState<string>("");
    const [filterHome, setFilterHome] = useState<string>("");
    const [loading, setLoading] = useState(false);

    // Create form
    const [creating, setCreating] = useState(false);
    const [role, setRole] = useState<AppLevel>("4_STAFF"); // app-level
    const [isAdminRole, setIsAdminRole] = useState(false);

    // role-driven UI
    const [position, setPosition] = useState<string>(""); // STAFF: RESIDENTIAL|TEAM_LEADER|BANK ; MANAGER: MANAGER|DEPUTY_MANAGER
    const [companyPositions, setCompanyPositions] = useState<string[]>([]); // COMPANY only

    const [createCompanyId, setCreateCompanyId] = useState<string>("");
    // single-home for Staff/Deputy; multi-home ONLY for Manager=MANAGER
    const [createHomeId, setCreateHomeId] = useState<string>("");
    const [createManagerHomeIds, setCreateManagerHomeIds] = useState<string[]>([]);


    // new user fields
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    // under the other useState hooks
    const [search, setSearch] = useState("");

    const filtersLiveRef = useRef(false);


    // add this effect (debounces search changes)
    useEffect(() => {
        const t = setTimeout(() => {
            // start a fresh list from page 0 using current search text
            resetAndLoad();
        }, 300); // adjust to taste (200–500ms)
        return () => clearTimeout(t);
    }, [search]); // ONLY search is debounced


    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;
            if (!me) return;

            if (isAdmin) {
                const co = await supabase.from("companies").select("id,name").order("name");
                const list = (co.data || []) as Company[];
                setCompanies(list);
                if (!filterCompany && list.length) setFilterCompany(list[0].id);
                if (!createCompanyId && list.length) setCreateCompanyId(list[0].id);
            } else if (isCompany) {
                const cm = await supabase
                    .from("company_memberships")
                    .select("company_id")
                    .eq("user_id", me)
                    .maybeSingle();
                const cid = cm.data?.company_id || "";
                setMyCompanyId(cid);
                setCreateCompanyId(cid);

                if (cid) {
                    const co = await supabase.from("companies").select("name").eq("id", cid).maybeSingle();
                    setMyCompanyName(co.data?.name || "");
                }
            }

            await resetAndLoad();               // initial fetch
            filtersLiveRef.current = true;      // NOW allow filter-triggered reloads
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, isCompany, isManager]);


    // Company users: homes in their company
    useEffect(() => {
        (async () => {
            if (!isCompany || !myCompanyId) return;
            const h = await supabase
                .from("homes")
                .select("id,name,company_id")
                .eq("company_id", myCompanyId)
                .order("name");
            const list = (h.data || []) as Home[];
            setHomesFilter(list);
            setHomesCreate(list);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCompany, myCompanyId]);

    // Managers: homes they manage
    useEffect(() => {
        (async () => {
            if (!isManager) return;
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;
            if (!me) return;

            const managed = await supabase.rpc("home_ids_managed_by", { p_user: me });
            const ids = (managed.data || []) as string[];
            if (ids.length) {
                const h = await supabase.from("homes").select("id,name,company_id").in("id", ids).order("name");
                const list = (h.data || []) as Home[];
                setHomesFilter(list);
                setHomesCreate(list);
            } else {
                setHomesFilter([]);
                setHomesCreate([]);
            }
        })();
    }, [isManager]);

    // Admin: homes list for selected company in search filter
    useEffect(() => {
        (async () => {
            if (!isAdmin) return;
            const cid = filterCompany || "";
            if (!cid) {
                setHomesFilter([]);
                return;
            }
            const h = await supabase.from("homes").select("id,name,company_id").eq("company_id", cid).order("name");
            setHomesFilter((h.data || []) as Home[]);
        })();
    }, [isAdmin, filterCompany]);

    // Admin: homes list for selected company in create form
    useEffect(() => {
        (async () => {
            if (!isAdmin) return;
            const cid = createCompanyId || "";
            if (!cid) {
                setHomesCreate([]);
                return;
            }
            const h = await supabase.from("homes").select("id,name,company_id").eq("company_id", cid).order("name");
            setHomesCreate((h.data || []) as Home[]);
        })();
    }, [isAdmin, createCompanyId]);

    useEffect(() => {
        if (!filtersLiveRef.current) return;  // ignore changes during initial boot
        resetAndLoad();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterCompany, filterHome]);


    async function resetAndLoad() {
        setRows([]);
        setNextFrom(0);
        await loadMore(0);
    }

    function uniqueByKey<T>(arr: T[], makeKey: (t: T) => string): T[] {
        const seen = new Set<string>();
        const out: T[] = [];
        for (const item of arr) {
            const k = makeKey(item);
            if (!seen.has(k)) {
                seen.add(k);
                out.push(item);
            }
        }
        return out;
    }

    async function loadMore(from?: number | null) {
        if (loading) return;
        setLoading(true);
        try {
            const f = from ?? nextFrom;
            if (f == null) return;

            type PersonRecord = {
                user_id: string;
                full_name: string;
                home_id: string | null;
                is_bank: boolean;
            };

            let base: PersonRecord[] = [];


            if (isAdmin) {
                const cid = filterCompany || myCompanyId || createCompanyId || companies[0]?.id || null;
                if (!cid) {
                    setRows([]);
                    setNextFrom(null);
                    return;
                }
                const { data, error } = await supabase
                    .rpc("list_company_people", { p_company_id: cid })
                    .range(f, f + PAGE_SIZE - 1);
                if (error) throw error;
                base = data || [];
            } else if (isCompany) {
                const { data: me } = await supabase.auth.getUser();
                const userId = me.user?.id;
                if (!userId) return;

                const cm = await supabase
                    .from("company_memberships")
                    .select("company_id")
                    .eq("user_id", userId)
                    .maybeSingle();
                const cid = cm.data?.company_id ?? "";
                if (!cid) return;
                const { data, error } = await supabase
                    .rpc("list_company_people", { p_company_id: cid })
                    .range(f, f + PAGE_SIZE - 1);
                if (error) throw error;
                base = data || [];
            } else if (isManager) {
                const { data, error } = await supabase.rpc("list_manager_people");
                if (error) throw error;
                type PersonRecord = {
                    user_id: string;
                    full_name: string;
                    home_id: string | null;
                    is_bank: boolean;
                };

                base = (data ?? []) as PersonRecord[];
            }

            let list = uniqueByKey<PersonRecord>(base, (r) => `${r.user_id}:${r.home_id ?? "bank"}`);

            if (filterHome) {
                list = list.filter((r) => (filterHome === "BANK" ? r.is_bank : r.home_id === filterHome));
            }
            if (search.trim()) {
                const q = search.trim().toLowerCase();
                list = list.filter((r) => (r.full_name || "").toLowerCase().includes(q));
            }

            setRows((prev) => {
                const merged = [...prev, ...list];
                return uniqueByKey<PersonRecord>(merged, (r) => `${r.user_id}:${r.home_id ?? "bank"}`);
            });

            if (base.length < PAGE_SIZE || isManager) setNextFrom(null);
            else setNextFrom((f ?? 0) + PAGE_SIZE);
        } finally {
            setLoading(false);
        }
    }

    async function createPerson(e: React.FormEvent) {
        e.preventDefault();
        setCreating(true);
        try {
            if (!fullName || !email) throw new Error("Name and email are required");

            const isManagerManager = !isAdminRole && role === "3_MANAGER" && position === "MANAGER";

            // put these minimal types near the top of the component (or above createPerson)
            type CreatePosition = "" | "BANK" | "RESIDENTIAL" | "TEAM_LEADER" | "MANAGER" | "DEPUTY_MANAGER";

            type CreateUserPayload = {
                full_name: string;
                email: string;
                password?: string;
                role: AppLevel;                         // "1_ADMIN" | "2_COMPANY" | "3_MANAGER" | "4_STAFF"
                company_id: string | null;
                home_id: string | null;                 // null when manager with multiple homes or bank/no fixed home
                manager_home_ids?: string[];            // only when role is manager=MANAGER (multi-home)
                position: CreatePosition;
                company_positions: string[];            // used for company-level role extras
            };

            const payload: CreateUserPayload = {
                full_name: fullName,
                email,
                ...(password ? { password } : {}),
                role: (isAdminRole ? "1_ADMIN" : role) as AppLevel,
                company_id: isAdmin ? (createCompanyId || null) : (myCompanyId || null),

                // single-home for Staff/Deputy; null for Manager=MANAGER to signal multi-home
                home_id: isManagerManager ? null : (createHomeId || null),

                // only include when truly a multi-home manager
                ...(isManagerManager ? { manager_home_ids: createManagerHomeIds } : {}),

                position: position as CreatePosition,
                company_positions: companyPositions,
            };

            const res = await authFetch("/api/admin/create-user", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error((await res.json())?.error || "Failed to create user");

            setFullName("");
            setEmail("");
            setPassword("");
            setPosition("");
            setCompanyPositions([]);
            setIsAdminRole(false);
            await resetAndLoad();
        } catch (err) {
            if (err instanceof Error) {
                alert(err.message);
            } else {
                alert("Failed");
            }
        }
         finally {
            setCreating(false);
        }
    }

    function randomPassword() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        let out = "";
        for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
        setPassword(out);
    }

    const companyIdContext = isAdmin
        ? filterCompany || createCompanyId || myCompanyId || ""
        : isCompany
            ? myCompanyId
            : "";

    const bankSelected = role === "4_STAFF" && position === "BANK";

    useEffect(() => {
        if (bankSelected && createHomeId) setCreateHomeId("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bankSelected]);

    return (
        <div className="space-y-4">
            {/* Create person */}
            <section className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-900">Create person</h2>
                <form onSubmit={createPerson} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-sm">Full name</label>
                        <input
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm">Email</label>
                        <input
                            type="email"
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm">Password</label>
                        <div className="mt-1 flex gap-2">
                            <input
                                className="flex-1 rounded-lg border p-2 text-sm"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="(optional)"
                            />
                            <button type="button" onClick={randomPassword} className="rounded-lg border px-3 text-sm">
                                Generate
                            </button>
                        </div>
                    </div>

                    {/* Role FIRST — drives position UI */}
                    <div>
                        <label className="block text-sm">Role</label>
                        <select
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                            value={isAdminRole ? "1_ADMIN" : role}
                            onChange={(e) => {
                                const v = e.target.value as AppLevel;
                                setIsAdminRole(v === "1_ADMIN");
                                setRole(v);
                                setPosition("");
                                setCompanyPositions([]);
                                setCreateHomeId("");
                                setCreateManagerHomeIds([]); // reset multi-home when switching roles
                            }}
                        >
                            <option value="4_STAFF">Staff</option>
                            <option value="3_MANAGER">Manager</option>
                            <option value="2_COMPANY">Company</option>
                            {isAdmin && <option value="1_ADMIN">Admin</option>}
                        </select>
                    </div>

                    {/* Company (not applicable for pure Admin) */}
                    {!isAdminRole && (
                        <div>
                            <label className="block text-sm">Company</label>
                            {isAdmin ? (
                                <select
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={createCompanyId}
                                    onChange={(e) => setCreateCompanyId(e.target.value)}
                                >
                                    <option value="">(Select company)</option>
                                    {companies.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    className="mt-1 w-full rounded-lg border p-2 text-sm bg-gray-50"
                                    value={myCompanyName || "(Your company)"}
                                    readOnly
                                />
                            )}
                        </div>
                    )}

                    {/* Home (hidden for Company; also disabled/cleared for Bank) */}
                    {/* Home(s): single for Staff/Deputy, MULTI for Manager=MANAGER */}
                    {!isAdminRole && role !== "2_COMPANY" && (
                        <div>
                            <label className="block text-sm">
                                {role === "3_MANAGER" && position === "MANAGER" ? "Homes (select all that apply)" : "Home"}
                            </label>

                            {role === "3_MANAGER" && position === "MANAGER" ? (
                                homesCreate.length ? (
                                    <MultiSelect
                                        value={createManagerHomeIds}
                                        onChange={setCreateManagerHomeIds}
                                        options={homesCreate.map((h) => ({ value: h.id, label: h.name }))}
                                    />
                                ) : (
                                    <div className="mt-1 rounded-lg border p-2 text-xs text-gray-600 bg-gray-50">
                                        {isAdmin
                                            ? "Pick a company first to load homes."
                                            : "No homes available in your scope."}
                                    </div>
                                )
                            ) : (
                                <select
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={bankSelected ? "" : createHomeId}
                                    onChange={(e) => setCreateHomeId(e.target.value)}
                                    disabled={bankSelected}
                                    aria-disabled={bankSelected}
                                    title={bankSelected ? "Home is not applicable when position is Bank" : undefined}
                                >
                                    <option value="">(No fixed home / Bank)</option>
                                    {homesCreate.map((h) => (
                                        <option key={h.id} value={h.id}>
                                            {h.name}
                                        </option>
                                    ))}
                                </select>
                            )}

                            {isManager && (
                                <p className="text-xs text-gray-500 mt-1">
                                    Managers can only create people for the homes they manage.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Position/subrole driven by Role */}
                    {!isAdminRole && role === "4_STAFF" && (
                        <div>
                            <label className="block text-sm">Position</label>
                            <select
                                className="mt-1 w-full rounded-lg border p-2 text-sm"
                                value={position}
                                onChange={(e) => setPosition(e.target.value)}
                            >
                                <option value="">(Select)</option>
                                <option value="BANK">Bank</option>
                                <option value="RESIDENTIAL">Residential</option>
                                <option value="TEAM_LEADER">Team Leader</option>
                            </select>
                            <p className="text-[11px] text-gray-500 mt-1">Bank staff will not be linked to a home.</p>
                        </div>
                    )}

                    {!isAdminRole && role === "3_MANAGER" && (
                        <div>
                            <label className="block text-sm">Position</label>
                            <select
                                className="mt-1 w-full rounded-lg border p-2 text-sm"
                                value={position}
                                onChange={(e) => setPosition(e.target.value)}
                            >
                                <option value="">(Select)</option>
                                <option value="MANAGER">Manager</option>
                                <option value="DEPUTY_MANAGER">Deputy Manager</option>
                            </select>
                        </div>
                    )}

                    {role === "2_COMPANY" && (
                        <div>
                            <label className="block text-sm">Company positions</label>
                            <MultiSelect
                                value={companyPositions}
                                onChange={setCompanyPositions}
                                options={[
                                    { value: "OWNER", label: "Owner" },
                                    { value: "FINANCE_OFFICER", label: "Finance Officer" },
                                    { value: "SITE_MANAGER", label: "Site Manager" },
                                ]}
                            />
                        </div>
                    )}

                    <div className="md:col-span-3">
                        <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" disabled={creating}>
                            {creating ? "Creating…" : "Create person"}
                        </button>
                        <span className="ml-3 text-[12px] text-gray-500">Creation calls /api/admin/create-user.</span>
                    </div>
                </form>
            </section>

            {/* List & search */}
            <section className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
                <div className="flex flex-wrap gap-3 items-end">
                    {isAdmin && (
                        <div>
                            <label className="block text-sm">Company</label>
                            <select
                                className="mt-1 rounded-lg border p-2 text-sm"
                                value={filterCompany}
                                onChange={(e) => setFilterCompany(e.target.value)}
                            >
                                <option value="">(Select)</option>
                                {companies.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm">Home</label>
                        <select
                            className="mt-1 rounded-lg border p-2 text-sm"
                            value={filterHome}
                            onChange={(e) => setFilterHome(e.target.value)}
                        >
                            <option value="">(All)</option>
                            <option value="BANK">Bank</option>
                            {homesFilter.map((h) => (
                                <option key={h.id} value={h.id}>
                                    {h.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <label className="block text-sm">Search</label>
                        <input
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name"
                        />
                    </div>
                </div>

                <div className="mt-4 divide-y">
                    {rows.map((r) => (
                        <PersonRow
                            key={`${r.user_id}:${r.home_id || "bank"}`}
                            row={r}
                            homes={homesFilter}
                            companies={companies}
                            isAdmin={isAdmin}
                            isCompany={isCompany}
                            isManager={isManager}
                            companyIdContext={companyIdContext}
                            onAfterSave={resetAndLoad}
                        />
                    ))}
                </div>

                <div className="mt-3">
                    {nextFrom != null && (
                        <button
                            onClick={() => loadMore()}
                            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                            disabled={loading}
                        >
                            {loading ? "Loading…" : "Next"}
                        </button>
                    )}
                    {nextFrom == null && rows.length > 0 && (
                        <div className="text-sm text-gray-500">End of results.</div>
                    )}
                </div>
            </section>
        </div>
    );
}

function PersonRow({
    row,
    homes,
    companies,
    isAdmin,
    isCompany,
    isManager,
    companyIdContext,
    onAfterSave,
}: {
    row: { user_id: string; full_name: string; home_id: string | null; is_bank: boolean };
    homes: Home[];
    companies: Company[];
    isAdmin: boolean;
    isCompany: boolean;
    isManager: boolean;
    companyIdContext: string;
    onAfterSave?: () => Promise<void> | void;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    const [name, setName] = useState(row.full_name || "");
    const [email, setEmail] = useState<string>("");
    const [password, setPassword] = useState<string>("");

    const [companyId, setCompanyId] = useState<string>("");
    const [homeId, setHomeId] = useState<string>(row.home_id || "");
    type PositionValue = "" | "BANK" | "RESIDENTIAL" | "TEAM_LEADER" | "MANAGER" | "DEPUTY_MANAGER";
    const [positionEdit, setPositionEdit] = useState<PositionValue>("");

    const [managerHomeIdsEdit, setManagerHomeIdsEdit] = useState<string[]>([]);
    const [currentlyManager, setCurrentlyManager] = useState(false);
    const [companyPositionsEdit, setCompanyPositionsEdit] = useState<string[]>([]);

    const [appRole, setAppRole] = useState<AppLevel | "">("");
    const [viewerId, setViewerId] = useState<string | null>(null);

    const U = (s?: string | null) => (s ?? "").trim().toUpperCase();
    const asStringArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];

    useEffect(() => {
        setName(row.full_name || "");
    }, [row.user_id, row.full_name]);

    useEffect(() => {
        setHomeId(row.home_id || "");
    }, [row.user_id, row.home_id, row.is_bank]);

    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getUser();
            setViewerId(data.user?.id ?? null);
        })();
    }, []);

    useEffect(() => {
        if (editing && isAdmin && !companyId) {
            setCompanyId(companies[0]?.id || "");
        }
    }, [editing, isAdmin, companyId, companies]);

    useEffect(() => {
        const load = async () => {
            if (!editing) return;
            const wantsManagerMulti = positionEdit === "MANAGER" || currentlyManager;
            if (!wantsManagerMulti) return;
            if (managerHomeIdsEdit.length > 0) return;
            const { data, error } = await supabase
                .from("home_memberships")
                .select("home_id")
                .eq("user_id", row.user_id)
                .eq("role", "MANAGER");
            if (!error && data) {
                const ids = (data as { home_id: string }[]).map((d) => d.home_id);
                setManagerHomeIdsEdit(ids);
                setCurrentlyManager(ids.length > 0);
            }
        };
        load();
    }, [editing, positionEdit, currentlyManager, managerHomeIdsEdit.length, row.user_id]);

    async function prefillFromServer() {
        try {
            const cm = await supabase
                .from("company_memberships")
                .select("company_id, positions")
                .eq("user_id", row.user_id)
                .maybeSingle();
            if (cm.data?.company_id) setCompanyId(cm.data.company_id);
            setCompanyPositionsEdit(asStringArray(cm.data?.positions));
        } catch { }

        try {
            const rpc = await supabase.rpc("home_ids_managed_by", { p_user: row.user_id });
            const managerIds: string[] = (rpc.data || []) as string[];
            if (managerIds.length > 0) {
                setManagerHomeIdsEdit(managerIds);
                setCurrentlyManager(true);
                setAppRole("3_MANAGER");
                setPositionEdit("MANAGER");
                return;
            }
        } catch (e) {
            console.error("prefill: home_ids_managed_by failed", e);
        }

        type HomeMembership = {
            home_id: string;
            role: "MANAGER" | "STAFF" | null;
            manager_subrole: "MANAGER" | "DEPUTY_MANAGER" | null;
            staff_subrole: "RESIDENTIAL" | "TEAM_LEADER" | null;
        };
        let hmsRaw: HomeMembership[] | null = null;
        try {
            const { data } = await supabase
                .from("home_memberships")
                .select("home_id, role, manager_subrole, staff_subrole")
                .eq("user_id", row.user_id);
            hmsRaw = data || [];
        } catch (e) {
            console.warn("prefill: home_memberships blocked/failed", e);
        }

        const U = (s?: string | null) => (s ?? "").trim().toUpperCase();
        const hms = (hmsRaw ?? []).map((r) => ({
            home_id: r.home_id,
            role: (U(r.role) as "MANAGER" | "STAFF" | null) || null,
            manager_subrole: (U(r.manager_subrole) as "MANAGER" | "DEPUTY_MANAGER" | null) || null,
            staff_subrole: (U(r.staff_subrole) as "RESIDENTIAL" | "TEAM_LEADER" | null) || null,
        }));

        const deputy = hms.find((r) => r.role === "MANAGER" && r.manager_subrole === "DEPUTY_MANAGER");
        if (deputy) {
            setAppRole("3_MANAGER");
            setPositionEdit("DEPUTY_MANAGER");
            setHomeId(deputy.home_id);
            return;
        }
        const teamLead = hms.find((r) => r.role === "STAFF" && r.staff_subrole === "TEAM_LEADER");
        if (teamLead) {
            setAppRole("4_STAFF");
            setPositionEdit("TEAM_LEADER");
            setHomeId(teamLead.home_id);
            return;
        }
        const staffAny = hms.find((r) => r.role === "STAFF");
        if (staffAny) {
            setAppRole("4_STAFF");
            setPositionEdit("RESIDENTIAL");
            setHomeId(staffAny.home_id);
            return;
        }
        if (row.is_bank) {
            setAppRole("4_STAFF");
            setPositionEdit("BANK");
            setHomeId("");
            return;
        }
        if (row.home_id) {
            setAppRole("4_STAFF");
            setPositionEdit("RESIDENTIAL");
            setHomeId(row.home_id);
        }
    }

    const canEditName = isAdmin || isCompany || isManager;
    const canEditEmail = canEditName;
    const canEditPassword = canEditName;
    const canChangeCompany = isAdmin;
    const canChangeHome = isAdmin || isCompany || isManager;

    const LEVEL_RANK: Record<AppLevel, number> = {
        "1_ADMIN": 1,
        "2_COMPANY": 2,
        "3_MANAGER": 3,
        "4_STAFF": 4,
    };
    const LEVEL_LABELS: Record<AppLevel, string> = {
        "1_ADMIN": "Admin",
        "2_COMPANY": "Company",
        "3_MANAGER": "Manager",
        "4_STAFF": "Staff",
    };
    const viewerCap: AppLevel = isAdmin ? "1_ADMIN" : isCompany ? "2_COMPANY" : "3_MANAGER";
    const canChangeAppRole = (isAdmin || isCompany || isManager) && viewerId !== row.user_id;
    const allowedAppLevels: AppLevel[] = (["1_ADMIN", "2_COMPANY", "3_MANAGER", "4_STAFF"] as AppLevel[]).filter(
        (l) => LEVEL_RANK[l] >= LEVEL_RANK[viewerCap]
    );

    const bankMode =
        (appRole === "4_STAFF" && positionEdit === "BANK") || (!positionEdit && row.is_bank);

    useEffect(() => {
        if (bankMode && homeId) setHomeId("");
    }, [bankMode]);

    async function handleEditClick() {
        await prefillFromServer();
        setEditing(true);
    }

    async function save() {
        setSaving(true);
        try {
            type UpdatePersonBody = {
                user_id: string;
                full_name?: string;
                email?: string;
                password?: string;
                set_company?: { company_id: string };
                set_bank?: { company_id: string; home_id?: string };
                clear_home?: { home_id: string };
                set_home?: { home_id: string; clear_bank_for_company?: string };
                set_home_role?: { home_id: string; role: string };
                set_manager_homes?: { home_ids: string[] };
                set_level?: { level: AppLevel; company_id: string | null };
                ensure_role_manager?: boolean;
            };

            const body: UpdatePersonBody = { user_id: row.user_id };

            const trimmedName = (name || "").trim();
            if (canEditName && trimmedName && trimmedName !== (row.full_name || "")) {
                body.full_name = trimmedName;
            }
            if (canEditEmail && email.trim()) {
                body.email = email.trim();
            }
            if (canEditPassword && password) {
                body.password = password;
            }

            if (canChangeCompany && companyId) {
                body.set_company = { company_id: companyId };
            }

            if (canChangeHome) {
                const isManagerManager = appRole === "3_MANAGER" && positionEdit === "MANAGER";
                if (isManagerManager) {
                    body.set_manager_homes = { home_ids: managerHomeIdsEdit };
                } else if (bankMode) {
                    const bankCompanyId = (isAdmin && companyId ? companyId : companyIdContext) as string;
                    body.set_bank = {
                        company_id: bankCompanyId,
                        ...(row.home_id ? { home_id: row.home_id } : {}),
                    };
                } else if (!homeId) {
                    if (row.home_id) {
                        body.clear_home = { home_id: row.home_id };
                    }
                } else if (row.home_id !== homeId) {
                    const ensuredHomeId = homeId as string;
                    body.set_home = {
                        home_id: ensuredHomeId,
                        ...(row.is_bank && (companyId || companyIdContext)
                            ? { clear_bank_for_company: (companyId || companyIdContext) as string }
                            : {}),
                    };
                }
            }

            if (positionEdit) {
                if (positionEdit === "BANK") {
                    // no-op
                } else if (positionEdit === "MANAGER") {
                    body.ensure_role_manager = true;
                } else {
                    const targetHome = homeId || row.home_id;
                    if (!targetHome) throw new Error("Select a home before assigning this position.");
                    let apiRole: "STAFF" | "TEAM_LEADER" | "MANAGER" | "DEPUTY_MANAGER";
                    switch (positionEdit) {
                        case "RESIDENTIAL":
                            apiRole = "STAFF";
                            break;
                        case "TEAM_LEADER":
                            apiRole = "TEAM_LEADER";
                            break;
                        case "DEPUTY_MANAGER":
                            apiRole = "DEPUTY_MANAGER";
                            break;
                        default:
                            apiRole = "STAFF";
                    }
                    body.set_home_role = { home_id: targetHome, role: apiRole };
                }
            }

            if (canChangeAppRole && appRole) {
                if (!allowedAppLevels.includes(appRole)) {
                    throw new Error("You are not allowed to assign that role.");
                }
                body.set_level = {
                    level: appRole,
                    company_id: appRole === "2_COMPANY" ? (companyId || companyIdContext || null) : null,
                };
            }

            const res = await authFetch("/api/admin/people/update", {
                method: "PATCH",
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                let message = "Failed to update";
                try {
                    const j = await res.json();
                    if (j?.error) message = j.error;
                } catch { }
                throw new Error(message);
            }

            setEditing(false);
            if (onAfterSave) await onAfterSave?.();
            setEmail("");
            setPassword("");
            setPositionEdit("");
            setCompanyPositionsEdit([]);
            setAppRole("");
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
                {!editing ? (
                    <>
                        <div className="font-medium text-gray-900">{name || "(No name)"}</div>
                        <div className="text-xs text-gray-500">
                            {row.is_bank
                                ? "Bank staff"
                                : row.home_id
                                    ? homes.find((h) => h.id === row.home_id)?.name || "Home"
                                    : "—"}
                        </div>
                    </>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {canEditName && (
                            <div>
                                <label className="block text-xs text-gray-600">Name</label>
                                <input
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                        )}
                        {canEditEmail && (
                            <div>
                                <label className="block text-xs text-gray-600">
                                    Email (leave blank to keep)
                                </label>
                                <input
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="new-email@example.com"
                                />
                            </div>
                        )}
                        {canEditPassword && (
                            <div>
                                <label className="block text-xs text-gray-600">
                                    Password (leave blank to keep)
                                </label>
                                <input
                                    type="password"
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                            </div>
                        )}
                        {canChangeCompany && (
                            <div>
                                <label className="block text-xs text-gray-600">Company (admin only)</label>
                                <select
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={companyId}
                                    onChange={(e) => setCompanyId(e.target.value)}
                                >
                                    <option value="">(Select company)</option>
                                    {companies.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {canChangeHome && (
                            <div>
                                <label className="block text-xs text-gray-600">
                                    {positionEdit === "MANAGER" || currentlyManager
                                        ? "Homes (select all that apply)"
                                        : "Home"}
                                </label>
                                {(() => {
                                    const showManagerMulti =
                                        positionEdit === "MANAGER" || currentlyManager;
                                    const homesUnion = (() => {
                                        const map = new Map<string, Home>();
                                        homes.forEach((h) => map.set(h.id, h));
                                        managerHomeIdsEdit.forEach((id) => {
                                            if (!map.has(id)) {
                                                map.set(id, { id, name: "(out of scope)", company_id: "" });
                                            }
                                        });
                                        return Array.from(map.values());
                                    })();
                                    return showManagerMulti ? (
                                        <MultiSelect
                                            value={managerHomeIdsEdit}
                                            onChange={setManagerHomeIdsEdit}
                                            options={homesUnion.map((h) => ({
                                                value: h.id,
                                                label: h.name,
                                            }))}
                                        />
                                    ) : (
                                        <select
                                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                                            value={homeId}
                                            onChange={(e) => setHomeId(e.target.value)}
                                            disabled={bankMode}
                                            aria-disabled={bankMode}
                                            title={
                                                bankMode ? "Home is locked when position is Bank" : undefined
                                            }
                                        >
                                            <option value="">(No fixed home)</option>
                                            {homesUnion.map((h) => (
                                                <option key={h.id} value={h.id}>
                                                    {h.name}
                                                </option>
                                            ))}
                                        </select>
                                    );
                                })()}
                                {bankMode && (
                                    <p className="text-[11px] text-gray-500 mt-1">
                                        Position is <b>Bank</b>; home is not applicable.
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                            <div className={`${canChangeAppRole ? "" : "opacity-60"}`}>
                                <label className="block text-xs text-gray-600">
                                    Role {viewerId === row.user_id && "(you can’t change your own role)"}
                                </label>
                                <select
                                    className="mt-1 w-full rounded-lg border p-2 text-sm"
                                    value={appRole}
                                    onChange={(e) => {
                                        const v = e.target.value as AppLevel;
                                        setAppRole(v);
                                        setPositionEdit("");
                                        setCompanyPositionsEdit([]);
                                    }}
                                    disabled={!canChangeAppRole}
                                >
                                    <option value="">(No change)</option>
                                    {allowedAppLevels.map((lvl) => (
                                        <option key={lvl} value={lvl}>
                                            {LEVEL_LABELS[lvl]}
                                        </option>
                                    ))}
                                </select>
                                {!isAdmin && canChangeAppRole && (
                                    <p className="mt-1 text-[11px] text-gray-500">
                                        You can assign roles up to <b>{LEVEL_LABELS[viewerCap]}</b>.
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs text-gray-600">Position</label>
                                {appRole === "4_STAFF" && (
                                    <select
                                        className="mt-1 w-full rounded-lg border p-2 text-sm"
                                        value={positionEdit}
                                        onChange={(e) => setPositionEdit(e.target.value as PositionValue)}
                                    >
                                        <option value="">(No change)</option>
                                        <option value="BANK">Bank</option>
                                        <option value="RESIDENTIAL">Residential</option>
                                        <option value="TEAM_LEADER">Team Leader</option>
                                    </select>
                                )}
                                {appRole === "3_MANAGER" && (
                                    <select
                                        className="mt-1 w-full rounded-lg border p-2 text-sm"
                                        value={positionEdit}
                                        onChange={(e) => setPositionEdit(e.target.value as PositionValue)}
                                    >
                                        <option value="">(No change)</option>
                                        <option value="MANAGER">Manager</option>
                                        <option value="DEPUTY_MANAGER">Deputy Manager</option>
                                    </select>
                                )}
                                {appRole === "2_COMPANY" && (
                                    <div className="mt-1">
                                        <div className="rounded-lg border p-2 text-sm bg-gray-50 text-gray-500">
                                            Company positions are managed separately.
                                        </div>
                                    </div>
                                )}
                                {appRole === "1_ADMIN" && (
                                    <div className="mt-1 rounded-lg border p-2 text-sm bg-gray-50 text-gray-500">
                                        Admin has no position.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {!editing ? (
                <button
                    onClick={handleEditClick}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                >
                    Edit
                </button>
            ) : (
                <div className="flex items-center gap-2">
                    <button
                        onClick={save}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        disabled={saving}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                        onClick={() => {
                            setEditing(false);
                            setName(row.full_name || "");
                            setEmail("");
                            setPassword("");
                            setCompanyId("");
                            setHomeId(row.home_id || "");
                            setPositionEdit("");
                            setCompanyPositionsEdit([]);
                            setAppRole("");
                            setManagerHomeIdsEdit([]);
                        }}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}


function MultiSelect({
    value,
    onChange,
    options,
}: {
    value: string[];
    onChange: (v: string[]) => void;
    options: { value: string; label: string }[];
}) {
    const toggle = (v: string) => {
        onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    };
    return (
        <div className="mt-1 flex flex-wrap gap-2">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    className={`px-2 py-1 text-xs rounded border ${value.includes(o.value) ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "hover:bg-gray-50"
                        }`}
                    onClick={() => toggle(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/* =====================
   HOMES TAB
   ===================== */
function HomesTab({ isAdmin, isCompany }: { isAdmin: boolean; isCompany: boolean }) {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState<string>("");
    const [companyName, setCompanyName] = useState<string>("");
    const [homes, setHomes] = useState<Home[]>([]);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            const { data: u } = await supabase.auth.getUser();
            const me = u.user?.id;
            if (!me) return;

            if (isAdmin) {
                const { data: co } = await supabase.from("companies").select("id,name").order("name");
                setCompanies(co ?? []);
                if (!companyId && co?.[0]?.id) setCompanyId(co[0].id);
            } else if (isCompany) {
                const { data: cm } = await supabase
                    .from("company_memberships")
                    .select("company_id")
                    .eq("user_id", me)
                    .maybeSingle();

                const cid = cm?.company_id || "";
                setCompanyId(cid);

                if (cid) {
                    const { data: co } = await supabase
                        .from("companies")
                        .select("name")
                        .eq("id", cid)
                        .maybeSingle();
                    setCompanyName(co?.name || "");
                } else {
                    setCompanyName("");
                }
            }
        })();
    }, [isAdmin, isCompany, companyId]);

    useEffect(() => {
        (async () => {
            if (!companyId) {
                setHomes([]);
                return;
            }
            const { data: list } = await supabase
                .from("homes")
                .select("id,name,company_id")
                .eq("company_id", companyId)
                .order("name");
            setHomes(list ?? []);
        })();
    }, [companyId]);

    async function addHome(e: React.FormEvent) {
        e.preventDefault();
        if (!companyId || !name.trim()) return;
        setSaving(true);
        try {
            const res = await authFetch("/api/admin/homes", {
                method: "POST",
                body: JSON.stringify({ company_id: companyId, name: name.trim() }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error || "Failed to create home");
            }
            setName("");
            const { data: list } = await supabase
                .from("homes")
                .select("id,name,company_id")
                .eq("company_id", companyId)
                .order("name");
            setHomes(list ?? []);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to create home";
            alert(msg);
        } finally {
            setSaving(false);
        }
    }

    async function renameHome(id: string, newName: string) {
        const res = await authFetch("/api/admin/homes", {
            method: "PATCH",
            body: JSON.stringify({ home_id: id, name: newName.trim() }),
        });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            alert(j?.error || "Failed to rename home");
            return;
        }
        const { data: list } = await supabase
            .from("homes")
            .select("id,name,company_id")
            .eq("company_id", companyId)
            .order("name");
        setHomes(list ?? []);
    }

    return (
        <div className="space-y-4">
            <section className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-900">Create home</h2>
                <form onSubmit={addHome} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-sm">Company</label>
                        {isAdmin ? (
                            <select
                                className="mt-1 w-full rounded-lg border p-2 text-sm"
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
                            <input
                                className="mt-1 w-full rounded-lg border p-2 text-sm bg-gray-50"
                                value={companyName || "(Your company)"}
                                readOnly
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-sm">Home name</label>
                        <input
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="self-end">
                        <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" disabled={saving}>
                            {saving ? "Creating…" : "Create home"}
                        </button>
                    </div>
                </form>
            </section>

            <section className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-900">Homes</h2>
                <ul className="mt-3 divide-y">
                    {homes.map((h) => (
                        <EditableRow key={h.id} label={h.name} onSave={(val) => renameHome(h.id, val)} />
                    ))}
                    {!homes.length && <li className="py-3 text-sm text-gray-500">No homes yet.</li>}
                </ul>
            </section>
        </div>
    );
}


/* =====================
   COMPANIES TAB (Admin)
   ===================== */
function CompaniesTab() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            const { data: co } = await supabase.from("companies").select("id,name").order("name");
            setCompanies(co ?? []);
        })();
    }, []);

    async function addCompany(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            const res = await authFetch("/api/admin/companies", {
                method: "POST",
                body: JSON.stringify({ name: name.trim() }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error || "Failed to create company");
            }
            setName("");
            const { data: co } = await supabase.from("companies").select("id,name").order("name");
            setCompanies(co ?? []);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to create company";
            alert(msg);
        } finally {
            setSaving(false);
        }
    }

    async function renameCompany(id: string, newName: string) {
        const res = await authFetch("/api/admin/companies", {
            method: "PATCH",
            body: JSON.stringify({ company_id: id, name: newName.trim() }),
        });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            alert(j?.error || "Failed to rename company");
            return;
        }
        const { data: co } = await supabase.from("companies").select("id,name").order("name");
        setCompanies(co ?? []);
    }

    return (
        <div className="space-y-4">
            <section className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-900">Create company</h2>
                <form onSubmit={addCompany} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                        <label className="block text-sm">Company name</label>
                        <input
                            className="mt-1 w-full rounded-lg border p-2 text-sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="self-end">
                        <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" disabled={saving}>
                            {saving ? "Creating…" : "Create company"}
                        </button>
                    </div>
                </form>
            </section>

            <section className="rounded-2xl border border-gray-300 bg-white shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-900">Companies</h2>
                <ul className="mt-3 divide-y">
                    {companies.map((c) => (
                        <EditableRow key={c.id} label={c.name} onSave={(val) => renameCompany(c.id, val)} />
                    ))}
                    {!companies.length && <li className="py-3 text-sm text-gray-500">No companies yet.</li>}
                </ul>
            </section>
        </div>
    );
}


/* =====================
   Small editable row
   ===================== */
function EditableRow({ label, onSave }: { label: string; onSave: (v: string) => void }) {
    const [val, setVal] = useState(label);
    const [edit, setEdit] = useState(false);
    const [saving, setSaving] = useState(false);
    async function save() {
        setSaving(true);
        try {
            await onSave(val);
            setEdit(false);
        } finally {
            setSaving(false);
        }
    }
    return (
        <li className="py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
                {edit ? (
                    <input
                        className="w-full rounded-lg border p-2 text-sm"
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                    />
                ) : (
                    <div className="font-medium text-gray-900">{label}</div>
                )}
            </div>
            {edit ? (
                <div className="flex items-center gap-2">
                    <button
                        onClick={save}
                        className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        disabled={saving}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEdit(false)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                        Cancel
                    </button>
                </div>
            ) : (
                <button onClick={() => setEdit(true)} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                    Rename
                </button>
            )}
        </li>
    );
}