'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';

type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

type LicenseRow = {
    company_id: string;
    company_name: string | null;
    status: LicenseStatus;
    plan_code: string;
    seats: number;
    valid_until: string | null;        // 'YYYY-MM-DD' or null
    grace_period_days: number;
    billing_customer_id: string | null;
    updated_at: string;                // ISO
};

type EditState = Partial<Pick<
    LicenseRow,
    'status' | 'plan_code' | 'seats' | 'valid_until' | 'grace_period_days' | 'billing_customer_id'
>>;

function formatDate(d: string | null): string {
    if (!d) return '';
    return d.length > 10 ? d.slice(0, 10) : d; // ensure YYYY-MM-DD for <input type="date">
}

export default function LicenseAdminClient() {
    const [items, setItems] = useState<LicenseRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState<string | null>(null); // company_id when saving
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [editing, setEditing] = useState<{ company_id: string; data: EditState } | null>(null);

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return items;
        return items.filter((r) =>
            (r.company_name ?? '').toLowerCase().includes(q) ||
            r.plan_code.toLowerCase().includes(q) ||
            r.status.toLowerCase().includes(q)
        );
    }, [items, filter]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/admin/licenses/list', { cache: 'no-store' });
                if (!res.ok) throw new Error('Failed to load licenses');
                const json = (await res.json()) as { items: LicenseRow[] };
                setItems(Array.isArray(json.items) ? json.items : []);
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    async function onSave(company_id: string, data: EditState) {
        setSaving(company_id);
        setError(null);
        try {
            // Optional: send access token so API can verify platform admin if you add that check
            const { data: s } = await supabase.auth.getSession();
            const token = s.session?.access_token;

            const res = await fetch('/api/admin/licenses/update', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ company_id, ...data }),
            });
            if (!res.ok) throw new Error('Update failed');
            const json = (await res.json()) as {
                ok: boolean;
                license: Omit<LicenseRow, 'company_name'>;
            };

            setItems((prev) =>
                prev.map((r) => (r.company_id === company_id ? { ...r, ...json.license } : r))
            );
            setEditing(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(null);
        }
    }

    return (
        <div className="space-y-4" style={{ color: 'var(--ink)' }}>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    placeholder="Filter by company, plan, or status…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full sm:w-80 rounded-md px-3 py-2 text-sm outline-none focus:ring-2"
                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                />
            </div>

            {error && (
                <div
                    className="rounded-md px-3 py-2 text-sm"
                    style={{
                        background: 'rgba(244, 63, 94, 0.10)',
                        color: 'rgb(244 63 94)',
                        border: '1px solid rgba(244,63,94,0.25)',
                    }}
                >
                    {error}
                </div>
            )}

            <div className="overflow-x-auto rounded-lg ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <table className="min-w-full text-sm">
                    <thead>
                        <tr style={{ background: 'var(--nav-item-bg)', color: 'var(--sub)' }}>
                            <th className="px-3 py-2 text-left font-medium">Company</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                            <th className="px-3 py-2 text-left font-medium">Plan</th>
                            <th className="px-3 py-2 text-right font-medium">Seats</th>
                            <th className="px-3 py-2 text-left font-medium">Valid until</th>
                            <th className="px-3 py-2 text-right font-medium">Grace (days)</th>
                            <th className="px-3 py-2 text-left font-medium">Billing ID</th>
                            <th className="px-3 py-2 text-right font-medium">Updated</th>
                            <th className="px-3 py-2 text-right font-medium" />
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="px-3 py-3 text-center" style={{ color: 'var(--sub)' }} colSpan={9}>
                                    Loading…
                                </td>
                            </tr>
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td className="px-3 py-3 text-center" style={{ color: 'var(--sub)' }} colSpan={9}>
                                    No licenses found.
                                </td>
                            </tr>
                        ) : (
                            filtered.map((r) => (
                                <tr key={r.company_id} className="border-t" style={{ borderColor: 'var(--ring)', background: 'var(--nav-item-bg)' }}>
                                    <td className="px-3 py-2" style={{ color: 'var(--ink)' }}>
                                        {r.company_name ?? <span style={{ color: 'var(--sub)' }}>Unnamed</span>}
                                    </td>
                                    <td className="px-3 py-2" style={{ color: 'var(--ink)' }}>{r.status}</td>
                                    <td className="px-3 py-2" style={{ color: 'var(--ink)' }}>{r.plan_code}</td>
                                    <td className="px-3 py-2 text-right" style={{ color: 'var(--ink)' }}>{r.seats}</td>
                                    <td className="px-3 py-2" style={{ color: 'var(--ink)' }}>
                                        {r.valid_until ? formatDate(r.valid_until) : <span style={{ color: 'var(--sub)' }}>—</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right" style={{ color: 'var(--ink)' }}>{r.grace_period_days}</td>
                                    <td className="px-3 py-2" style={{ color: 'var(--ink)' }}>
                                        {r.billing_customer_id ?? <span style={{ color: 'var(--sub)' }}>—</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right" style={{ color: 'var(--ink)' }}>
                                        {new Date(r.updated_at).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <button
                                            onClick={() =>
                                                setEditing({
                                                    company_id: r.company_id,
                                                    data: {
                                                        status: r.status,
                                                        plan_code: r.plan_code,
                                                        seats: r.seats,
                                                        valid_until: r.valid_until ? formatDate(r.valid_until) : null,
                                                        grace_period_days: r.grace_period_days,
                                                        billing_customer_id: r.billing_customer_id,
                                                    },
                                                })
                                            }
                                            className="rounded-md px-2.5 py-1.5 text-xs font-medium transition"
                                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                        >
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Edit dialog */}
            {editing && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
                    <div className="w-full max-w-lg rounded-xl p-4 shadow-xl ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Edit license</h2>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="text-xs" style={{ color: 'var(--sub)' }}>
                                Status
                                <select
                                    className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                    value={editing.data.status ?? 'ACTIVE'}
                                    onChange={(e) =>
                                        setEditing({
                                            ...editing,
                                            data: { ...editing.data, status: e.target.value as LicenseStatus },
                                        })
                                    }
                                >
                                    {(['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const).map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="text-xs" style={{ color: 'var(--sub)' }}>
                                Plan code
                                <input
                                    className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                    value={editing.data.plan_code ?? ''}
                                    onChange={(e) =>
                                        setEditing({ ...editing, data: { ...editing.data, plan_code: e.target.value } })
                                    }
                                />
                            </label>

                            <label className="text-xs" style={{ color: 'var(--sub)' }}>
                                Seats
                                <input
                                    type="number"
                                    min={1}
                                    className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                    value={editing.data.seats ?? 1}
                                    onChange={(e) =>
                                        setEditing({
                                            ...editing,
                                            data: { ...editing.data, seats: Number(e.target.value || 1) },
                                        })
                                    }
                                />
                            </label>

                            <label className="text-xs" style={{ color: 'var(--sub)' }}>
                                Valid until
                                <input
                                    type="date"
                                    className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                    value={editing.data.valid_until ?? ''}
                                    onChange={(e) =>
                                        setEditing({
                                            ...editing,
                                            data: { ...editing.data, valid_until: e.target.value ? e.target.value : null },
                                        })
                                    }
                                />
                            </label>

                            <label className="text-xs" style={{ color: 'var(--sub)' }}>
                                Grace period (days)
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                    value={editing.data.grace_period_days ?? 0}
                                    onChange={(e) =>
                                        setEditing({
                                            ...editing,
                                            data: { ...editing.data, grace_period_days: Number(e.target.value || 0) },
                                        })
                                    }
                                />
                            </label>

                            <label className="text-xs sm:col-span-2" style={{ color: 'var(--sub)' }}>
                                Billing customer ID
                                <input
                                    className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                                    value={editing.data.billing_customer_id ?? ''}
                                    onChange={(e) =>
                                        setEditing({
                                            ...editing,
                                            data: {
                                                ...editing.data,
                                                billing_customer_id: e.target.value ? e.target.value : null,
                                            },
                                        })
                                    }
                                />
                            </label>
                        </div>

                        <div className="mt-4 flex items-center justify-end gap-2">
                            <button
                                className="rounded-md px-3 py-1.5 text-sm transition ring-1"
                                onClick={() => setEditing(null)}
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                            >
                                Cancel
                            </button>
                            <button
                                className="rounded-md px-3 py-1.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                                disabled={saving === editing.company_id}
                                onClick={() => onSave(editing.company_id, editing.data)}
                                style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 50%, #6366F1 100%)' }}
                            >
                                {saving === editing.company_id ? 'Saving…' : 'Save changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Orbit-only control fixes (scoped to this page) --- */}
            <style jsx global>{`
        [data-orbit='1'] input,
        [data-orbit='1'] textarea,
        [data-orbit='1'] select {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        [data-orbit='1'] input::placeholder,
        [data-orbit='1'] textarea::placeholder {
          color: var(--sub);
          opacity: 0.85;
        }
        [data-orbit='1'] table thead th {
          color: var(--sub);
        }
      `}</style>
        </div>
    );
}
