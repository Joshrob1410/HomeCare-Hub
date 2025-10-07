'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel } from '@/supabase/roles';

type AppLevel = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';
const lvlToLabel = (lvl: AppLevel) =>
    lvl === '1_ADMIN' ? 'Admin' : lvl === '2_COMPANY' ? 'Company' : lvl === '3_MANAGER' ? 'Manager' : 'Staff';

export default function UserChip() {
    const [initialLoading, setInitialLoading] = useState(true);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [level, setLevel] = useState<AppLevel>('4_STAFF');

    // Second line under name: prefer Position when exactly one position exists; otherwise fallback to role
    const [secondaryLabel, setSecondaryLabel] = useState<string>('');

    const [menuOpen, setMenuOpen] = useState(false);
    const [nameOpen, setNameOpen] = useState(false);
    const [emailOpen, setEmailOpen] = useState(false);
    const [passOpen, setPassOpen] = useState(false);

    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState<{ id: number; type: 'success' | 'error'; text: string } | null>(null);

    const menuRef = useRef<HTMLDivElement | null>(null);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;

        const load = async (initial = false) => {
            try {
                if (initial) setInitialLoading(true);
                const [sessionRes, lvl] = await Promise.all([supabase.auth.getSession(), getEffectiveLevel()]);
                if (!alive.current) return;

                const user = sessionRes?.data?.session?.user || null;
                setEmail(user?.email || '');

                if (user?.id) {
                    const [{ data: prof }, { data: hm }, { data: bm }] = await Promise.all([
                        supabase.from('profiles').select('full_name').eq('user_id', user.id).maybeSingle(),
                        supabase
                            .from('home_memberships')
                            .select('home_id, role, staff_subrole, manager_subrole')
                            .eq('user_id', user.id),
                        supabase.from('bank_memberships').select('id').eq('user_id', user.id),
                    ]);

                    setName((prof?.full_name || '').trim() || (user?.email || ''));

                    // Compute the label to show under the name:
                    // - If exactly one position, show that position (Bank / Residential / Team Leader / Manager / Deputy Manager)
                    // - If none or multiple, fall back to app-level role label.
                    const homes = Array.isArray(hm) ? hm : [];
                    const banks = Array.isArray(bm) ? bm : [];
                    const membershipCount = homes.length + banks.length;

                    let positionLabel: string | null = null;
                    if (membershipCount === 1) {
                        if (banks.length === 1 && homes.length === 0) {
                            positionLabel = 'Bank';
                        } else if (homes.length === 1) {
                            const m = homes[0] as any;
                            const role = (m.role || '').toUpperCase();
                            const staffSub = (m.staff_subrole || '').toUpperCase();
                            const mgrSub = (m.manager_subrole || '').toUpperCase();

                            if (role === 'STAFF') {
                                if (staffSub === 'TEAM_LEADER') positionLabel = 'Team Leader';
                                else if (staffSub === 'RESIDENTIAL') positionLabel = 'Residential';
                                else positionLabel = null; // unknown subrole → fallback to role
                            } else if (role === 'MANAGER') {
                                if (mgrSub === 'DEPUTY_MANAGER') positionLabel = 'Deputy Manager';
                                else positionLabel = 'Manager';
                            }
                        }
                    }
                    setSecondaryLabel(positionLabel || lvlToLabel(lvl));
                } else {
                    setName(user?.email || '');
                    setSecondaryLabel(lvlToLabel(lvl));
                }

                setLevel(lvl);
            } finally {
                if (initial && alive.current) setInitialLoading(false);
            }
        };

        load(true);

        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
            if (!alive.current) return;
            if (['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
                load(false);
            }
        });

        const onFocus = () => load(false);
        const onVis = () => document.visibilityState === 'visible' && load(false);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVis);

        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setMenuOpen(false);
                setNameOpen(false);
                setEmailOpen(false);
                setPassOpen(false);
            }
        };
        document.addEventListener('keydown', onEsc);

        return () => {
            alive.current = false;
            try {
                sub?.subscription?.unsubscribe();
            } catch { }
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVis);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    const initials = (name || email || '?')
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    const showToast = (type: 'success' | 'error', text: string) => {
        const id = Date.now();
        setToast({ id, type, text });
        setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2400);
    };

    async function onSignOut() {
        await supabase.auth.signOut();
        window.location.href = '/auth/login';
    }

    async function saveName(newName: string) {
        setBusy(true);
        try {
            const { data: u } = await supabase.auth.getUser();
            const uid = u?.user?.id;
            if (!uid) throw new Error('Not signed in.');
            const { error } = await supabase.from('profiles').update({ full_name: newName }).eq('user_id', uid);
            if (error) throw error;
            setName(newName);
            setNameOpen(false);
            showToast('success', 'Name updated');
        } catch (e: any) {
            showToast('error', e?.message || 'Failed to update name');
        } finally {
            setBusy(false);
        }
    }

    async function saveEmail(newEmail: string) {
        setBusy(true);
        try {
            const { error } = await supabase.auth.updateUser({ email: newEmail });
            if (error) throw error;
            setEmailOpen(false);
            showToast('success', 'Email update requested. Check your inbox to confirm.');
        } catch (e: any) {
            showToast('error', e?.message || 'Failed to update email');
        } finally {
            setBusy(false);
        }
    }

    async function savePassword(oldPw: string, newPw: string, newPw2: string) {
        if (!oldPw || !newPw) {
            showToast('error', 'Please fill all fields');
            return;
        }
        if (newPw !== newPw2) {
            showToast('error', 'New passwords do not match');
            return;
        }
        if (newPw.length < 8) {
            showToast('error', 'Use at least 8 characters');
            return;
        }
        setBusy(true);
        try {
            const { data: u } = await supabase.auth.getUser();
            const addr = u?.user?.email;
            if (!addr) throw new Error('Not signed in.');
            const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: addr, password: oldPw });
            if (reauthErr) throw new Error('Old password is incorrect');
            const { error } = await supabase.auth.updateUser({ password: newPw });
            if (error) throw error;
            setPassOpen(false);
            showToast('success', 'Password updated');
        } catch (e: any) {
            showToast('error', e?.message || 'Failed to update password');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="relative z-10 flex items-center gap-2 sm:gap-3 min-w-0 max-w-full">
            <Toast toast={toast} />

            {menuOpen && (
                <button
                    aria-hidden
                    className="fixed inset-0 z-[90] cursor-default bg-transparent"
                    onClick={() => setMenuOpen(false)}
                />
            )}

            {/* Trigger: soft white pill, no border/ring */}
            <div ref={menuRef} className="relative z-[100]">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen((v) => !v);
                    }}
                    className="
    inline-flex items-center gap-2 rounded-full bg-white/90 text-black
    px-2.5 py-1.5 shadow-sm hover:bg-white focus:outline-none
    min-w-0 max-w-[70vw] sm:max-w-none shrink
  "
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    type="button"
                >
                    {initialLoading ? (
                        <span className="h-8 w-8 rounded-full bg-gray-200 animate-pulse" />
                    ) : (
                        <span className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center text-xs font-semibold">
                            {initials}
                        </span>
                    )}
                    <div className="hidden sm:block min-w-0 max-w-full text-left">
                        <div className="text-sm font-medium leading-5 truncate">
                            {initialLoading ? '—' : name || email || '—'}
                        </div>
                        <div className="text-[11px] text-gray-600 leading-4">
                            {initialLoading ? '—' : secondaryLabel || lvlToLabel(level)}
                        </div>
                    </div>
                    <svg className="h-4 w-4 text-gray-700" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M7 10l5 5 5-5H7z" />
                    </svg>
                </button>

                {menuOpen && (
                    <div
                        role="menu"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="
    absolute mt-2 min-w-[12rem] rounded-xl bg-white text-gray-900 shadow-xl ring-1 ring-gray-900/5 p-1 z-[110]
    right-0 left-auto sm:left-0 sm:right-auto
  "
                    >
                        <MenuBtn
                            onClick={() => {
                                setNameOpen(true);
                                setMenuOpen(false);
                            }}
                        >
                            Change name
                        </MenuBtn>
                        <MenuBtn
                            onClick={() => {
                                setEmailOpen(true);
                                setMenuOpen(false);
                            }}
                        >
                            Change email
                        </MenuBtn>
                        <MenuBtn
                            onClick={() => {
                                setPassOpen(true);
                                setMenuOpen(false);
                            }}
                        >
                            Change password
                        </MenuBtn>
                    </div>
                )}
            </div>

            {/* Sign out: white-outline pill that fits the purple header */}
            <button
                onClick={onSignOut}
                type="button"
                className="
    relative z-0 rounded-full bg-red-300/80
    px-3 sm:px-4 py-1.5
    text-xs sm:text-sm font-medium text-black
    shadow-sm hover:bg-rose-400 transition
    whitespace-nowrap shrink-0
  "
            >
                Logout
            </button>

            {/* Modals */}
            {nameOpen && (
                <Modal title="Change name" onClose={() => setNameOpen(false)}>
                    <NameForm defaultName={name} busy={busy} onCancel={() => setNameOpen(false)} onSave={saveName} />
                </Modal>
            )}
            {emailOpen && (
                <Modal title="Change email" onClose={() => setEmailOpen(false)}>
                    <EmailForm defaultEmail={email} busy={busy} onCancel={() => setEmailOpen(false)} onSave={saveEmail} />
                </Modal>
            )}
            {passOpen && (
                <Modal title="Change password" onClose={() => setPassOpen(false)}>
                    <PasswordForm busy={busy} onCancel={() => setPassOpen(false)} onSave={savePassword} />
                </Modal>
            )}
        </div>
    );
}

/* ===== Small UI bits ===== */

function MenuBtn({ onClick, children }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            className="w-full text-left text-sm rounded-lg px-2.5 py-2 hover:bg-gray-50"
            onClick={onClick}
            role="menuitem"
            type="button"
        >
            {children}
        </button>
    );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-[200]">
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />
            <div className="absolute inset-0 grid place-items-center p-4">
                <div className="w-full max-w-sm rounded-2xl border bg-white shadow-lg ring-1 ring-gray-50 p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-base font-semibold">{title}</h3>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-50" aria-label="Close" type="button">
                            <svg className="h-4 w-4" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2">
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

import { useState as useStateReact } from 'react';

function NameForm({
    defaultName,
    busy,
    onCancel,
    onSave,
}: {
    defaultName: string;
    busy: boolean;
    onCancel: () => void;
    onSave: (n: string) => void;
}) {
    const [n, setN] = useStateReact(defaultName || '');
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSave(n.trim());
            }}
            className="space-y-3"
        >
            <div>
                <label className="block text-sm mb-1">Full name</label>
                <input className="w-full border rounded-lg px-3 py-2" value={n} onChange={(e) => setN(e.target.value)} />
            </div>
            <div className="flex gap-2">
                <BusyButton type="submit" loading={busy}>
                    {busy ? 'Saving…' : 'Save'}
                </BusyButton>
                <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                    Cancel
                </button>
            </div>
        </form>
    );
}

function EmailForm({
    defaultEmail,
    busy,
    onCancel,
    onSave,
}: {
    defaultEmail: string;
    busy: boolean;
    onCancel: () => void;
    onSave: (e: string) => void;
}) {
    const [addr, setAddr] = useStateReact(defaultEmail || '');
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSave(addr.trim());
            }}
            className="space-y-3"
        >
            <div>
                <label className="block text-sm mb-1">New email</label>
                <input
                    type="email"
                    className="w-full border rounded-lg px-3 py-2"
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                    required
                />
                <p className="text-xs text-gray-500 mt-1">You may need to confirm this address via a link sent to it.</p>
            </div>
            <div className="flex gap-2">
                <BusyButton type="submit" loading={busy}>
                    {busy ? 'Updating…' : 'Update email'}
                </BusyButton>
                <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                    Cancel
                </button>
            </div>
        </form>
    );
}

function PasswordForm({
    busy,
    onCancel,
    onSave,
}: {
    busy: boolean;
    onCancel: () => void;
    onSave: (oldPw: string, newPw: string, newPw2: string) => void;
}) {
    const [oldPw, setOldPw] = useStateReact('');
    const [pw1, setPw1] = useStateReact('');
    const [pw2, setPw2] = useStateReact('');
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSave(oldPw, pw1, pw2);
            }}
            className="space-y-3"
        >
            <div>
                <label className="block text-sm mb-1">Current password</label>
                <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2"
                    value={oldPw}
                    onChange={(e) => setOldPw(e.target.value)}
                    required
                />
            </div>
            <div>
                <label className="block text-sm mb-1">New password</label>
                <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2"
                    value={pw1}
                    onChange={(e) => setPw1(e.target.value)}
                    required
                />
            </div>
            <div>
                <label className="block text-sm mb-1">Confirm new password</label>
                <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    required
                />
            </div>
            <div className="flex gap-2">
                <BusyButton type="submit" loading={busy}>
                    {busy ? 'Saving…' : 'Save password'}
                </BusyButton>
                <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                    Cancel
                </button>
            </div>
        </form>
    );
}

function BusyButton({
    children,
    loading,
    className = '',
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
    return (
        <button
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 ${className}`}
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

function Toast({ toast }: { id?: number; type?: 'success' | 'error'; text?: string } | any) {
    if (!toast) return null;
    const tone =
        toast.type === 'success'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
            : 'border-rose-300 bg-rose-50 text-rose-900';
    return (
        <div className="fixed top-4 right-4 z-[210]">
            <div className={`min-w-[220px] max-w-[360px] rounded-xl border px-3 py-2 text-sm shadow-sm ${tone}`}>
                {toast.text}
            </div>
        </div>
    );
}
