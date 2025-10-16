'use client';

import Link from 'next/link';
import { useState } from 'react';
import type React from 'react';

/**
 * Help Centre (client page)
 * Orbit-ready: uses tokenized surfaces/inks/rings and fixes inputs in dark mode.
 */

export default function HelpCentrePage() {
    return (
        <div className="space-y-6" style={{ color: 'var(--ink)' }}>
            {/* Header */}
            <header className="flex items-end justify-between">
                <div>
                    <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
                        Help Centre
                    </h1>
                    <p className="text-[13px]" style={{ color: 'var(--sub)' }}>
                        Find answers, learn the basics, and tell us how to improve.
                    </p>
                </div>
            </header>

            {/* Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Col 1: FAQ */}
                <section
                    className="lg:col-span-1 rounded-2xl p-4 ring-1"
                    style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                >
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                        FAQs
                    </h2>
                    <p className="text-[12px]" style={{ color: 'var(--sub)' }}>
                        Popular quick answers
                    </p>

                    <div className="mt-3 divide-y" style={{ borderColor: 'var(--ring)' }}>
                        {FAQ_ITEMS.map((f, i) => (
                            <details key={i} className="group py-3">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                                    <span className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                                        {f.q}
                                    </span>
                                    <span
                                        className="shrink-0 h-6 w-6 grid place-items-center rounded-md ring-1 transition group-open:rotate-180"
                                        style={{ borderColor: 'var(--ring)', color: 'var(--sub)', background: 'var(--nav-item-bg)' }}
                                    >
                                        <IconChevron />
                                    </span>
                                </summary>
                                <p className="mt-2 text-[13px]" style={{ color: 'var(--sub)' }}>
                                    {f.a}
                                </p>
                                {f.link && (
                                    <div className="mt-2">
                                        <Link
                                            href={f.link.href}
                                            className="text-[12px] hover:underline"
                                            style={{ color: 'var(--brand-link)' }}
                                        >
                                            {f.link.label} →
                                        </Link>
                                    </div>
                                )}
                            </details>
                        ))}
                    </div>
                </section>

                {/* Col 2: Tutorials */}
                <section
                    className="lg:col-span-1 rounded-2xl p-4 ring-1"
                    style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                >
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Tutorials
                        </h2>
                        <Link href="#" className="text-[12px] hover:underline" style={{ color: 'var(--brand-link)' }}>
                            View all →
                        </Link>
                    </div>

                    <ul className="mt-3 space-y-3">
                        {TUTORIALS.map((t) => (
                            <li key={t.slug}>
                                <Link
                                    href={t.href ?? '#'}
                                    className="group block rounded-lg p-3 ring-1 transition"
                                    style={{
                                        borderColor: 'var(--ring)',
                                        background: 'var(--nav-item-bg)',
                                    }}
                                >
                                    <div className="flex items-start gap-3">
                                        {/* keep the playful tone colors for icons, but add a ring */}
                                        <span
                                            className={`h-8 w-8 grid place-items-center rounded-md ring-1 ${t.toneBg} ${t.toneRing} ${t.toneText}`}
                                        >
                                            {t.icon}
                                        </span>
                                        <div className="min-w-0">
                                            <div
                                                className="text-[13px] font-medium group-hover:underline"
                                                style={{ color: 'var(--ink)' }}
                                            >
                                                {t.title}
                                            </div>
                                            <div className="text-[12px]" style={{ color: 'var(--sub)' }}>
                                                {t.desc}
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Col 3: Forms */}
                <section className="lg:col-span-1 space-y-6">
                    <div className="rounded-2xl p-4 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Submit a suggestion
                        </h2>
                        <p className="text-[12px]" style={{ color: 'var(--sub)' }}>
                            Tell us what would make your work easier.
                        </p>
                        <div className="mt-3">
                            <SuggestionForm />
                        </div>
                    </div>

                    <div className="rounded-2xl p-4 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                            Report a problem
                        </h2>
                        <p className="text-[12px]" style={{ color: 'var(--sub)' }}>
                            Spotted a bug or something broken?
                        </p>
                        <div className="mt-3">
                            <ProblemForm />
                        </div>
                    </div>
                </section>
            </div>

            {/* Contact us */}
            <section className="rounded-2xl p-4 ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                        Contact us
                    </h2>
                </div>
                <div className="mt-3">
                    <ContactUs />
                </div>
            </section>

            {/* --- Orbit-only input/textarea fixes (scoped) --- */}
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
          opacity: 0.8;
        }
        [data-orbit='1'] code {
          color-scheme: dark;
        }
      `}</style>
        </div>
    );
}

/* --------------------------
   Client islands: forms
--------------------------- */

function SuggestionForm() {
    const [submitting, setSubmitting] = useState(false);
    const [ok, setOk] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setOk(null);
        setErr(null);
        setSubmitting(true);

        const fd = new FormData(e.currentTarget);
        const payload = {
            title: ((fd.get('title') as string) || '').trim(),
            details: ((fd.get('details') as string) || '').trim(),
        };

        if (!payload.title || !payload.details) {
            setErr('Please add a title and some details.');
            setSubmitting(false);
            return;
        }

        // TODO: Wire to backend (Supabase table or /api/help-centre)
        await new Promise((r) => setTimeout(r, 600));
        setSubmitting(false);
        setOk('Thanks! Your suggestion has been captured.');
        e.currentTarget.reset();
    }

    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
                <label className="text-[12px] font-medium" style={{ color: 'var(--sub)' }}>
                    Title
                </label>
                <input
                    name="title"
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                    placeholder="e.g., Make rotas printable"
                />
            </div>
            <div className="space-y-1">
                <label className="text-[12px] font-medium" style={{ color: 'var(--sub)' }}>
                    Details
                </label>
                <textarea
                    name="details"
                    rows={4}
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                    placeholder="Describe the improvement and why it helps…"
                />
            </div>
            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-indigo-300/50 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-500 hover:via-violet-500 hover:to-purple-500 disabled:opacity-60 transition"
                >
                    {submitting ? 'Submitting…' : 'Submit suggestion'}
                </button>
                {ok && <span className="text-[12px]" style={{ color: 'rgb(16 185 129)' }}>{ok}</span>}
                {err && <span className="text-[12px]" style={{ color: 'rgb(244 63 94)' }}>{err}</span>}
            </div>
        </form>
    );
}

function ProblemForm() {
    const [submitting, setSubmitting] = useState(false);
    const [ok, setOk] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setOk(null);
        setErr(null);
        setSubmitting(true);

        const fd = new FormData(e.currentTarget);
        const payload = {
            area: ((fd.get('area') as string) || '').trim(),
            steps: ((fd.get('steps') as string) || '').trim(),
            expected: ((fd.get('expected') as string) || '').trim(),
            actual: ((fd.get('actual') as string) || '').trim(),
        };

        if (!payload.area || !payload.steps) {
            setErr('Please tell us where it happened and how to reproduce it.');
            setSubmitting(false);
            return;
        }

        // TODO: Wire to backend (Supabase table or /api/help-centre)
        await new Promise((r) => setTimeout(r, 700));
        setSubmitting(false);
        setOk('We’ve logged the issue. Thanks for reporting it!');
        e.currentTarget.reset();
    }

    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
                <label className="text-[12px] font-medium" style={{ color: 'var(--sub)' }}>
                    Where did this happen?
                </label>
                <input
                    name="area"
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                    placeholder="e.g., Timesheets > Submit"
                />
            </div>
            <div className="space-y-1">
                <label className="text-[12px] font-medium" style={{ color: 'var(--sub)' }}>
                    Steps to reproduce
                </label>
                <textarea
                    name="steps"
                    rows={3}
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none focus:ring-2"
                    style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                    placeholder="1) Go to… 2) Click… 3) See error…"
                />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                    <label className="text-[12px] font-medium" style={{ color: 'var(--sub)' }}>
                        What did you expect?
                    </label>
                    <textarea
                        name="expected"
                        rows={2}
                        className="w-full rounded-md px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-[12px] font-medium" style={{ color: 'var(--sub)' }}>
                        What actually happened?
                    </label>
                    <textarea
                        name="actual"
                        rows={2}
                        className="w-full rounded-md px-3 py-2 text-[13px] outline-none focus:ring-2"
                        style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', border: '1px solid var(--ring)' }}
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-indigo-300/50 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-500 hover:via-violet-500 hover:to-purple-500 disabled:opacity-60 transition"
                >
                    {submitting ? 'Submitting…' : 'Report problem'}
                </button>
                {ok && <span className="text-[12px]" style={{ color: 'rgb(16 185 129)' }}>{ok}</span>}
                {err && <span className="text-[12px]" style={{ color: 'rgb(244 63 94)' }}>{err}</span>}
            </div>
        </form>
    );
}

function ContactUs() {
    const [revealed, setRevealed] = useState(false);
    const [copied, setCopied] = useState(false);
    const email = 'joshrob1410@aol.co.uk';

    async function copy() {
        try {
            await navigator.clipboard.writeText(email);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { }
    }

    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
                <span
                    className="h-8 w-8 grid place-items-center rounded-md ring-1"
                    style={{ borderColor: 'var(--ring)', background: 'var(--nav-item-bg)', color: 'var(--brand-link)' }}
                >
                    <IconMail />
                </span>
                <div>
                    <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                        Need to reach us directly?
                    </div>
                    <div className="text-[12px]" style={{ color: 'var(--sub)' }}>
                        Reveal the support email to copy or open in your mail app.
                    </div>
                </div>
            </div>

            {!revealed ? (
                <button
                    onClick={() => setRevealed(true)}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ring-1"
                    style={{
                        color: 'var(--brand-link)',
                        background: 'var(--nav-item-bg)',
                        borderColor: 'var(--ring)',
                    }}
                    type="button"
                >
                    Reveal email
                </button>
            ) : (
                <div className="flex items-center gap-2">
                    <code
                        className="px-2 py-1 rounded-md ring-1 text-[12px]"
                        style={{ borderColor: 'var(--ring)', background: 'var(--nav-item-bg)', color: 'var(--ink)' }}
                    >
                        {email}
                    </code>
                    <button
                        onClick={copy}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ring-1"
                        type="button"
                        aria-live="polite"
                        style={{ color: 'var(--ink)', background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}
                    >
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <a
                        href={`mailto:${email}`}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-sm ring-1 ring-indigo-300/50 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-500 hover:via-violet-500 hover:to-purple-500 transition"
                    >
                        Email
                    </a>
                </div>
            )}
        </div>
    );
}

function IconMail() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
        </svg>
    );
}

/* --------------------------
   Data (FAQ + Tutorials)
--------------------------- */
const FAQ_ITEMS: {
    q: string;
    a: string;
    link?: { href: string; label: string };
}[] = [
        {
            q: 'How do I see my upcoming shifts?',
            a: 'Go to Rotas from the sidebar. Your current week is also highlighted on the Dashboard under “My week”.',
            link: { href: '/rotas', label: 'Open Rotas' },
        },
        {
            q: 'Where do I book training?',
            a: 'Use Training booking to view available sessions and reserve a slot.',
            link: { href: '/bookings', label: 'Training booking' },
        },
        {
            q: 'How do I submit my timesheet?',
            a: 'Open Timesheets, complete your entries for the month, and select Submit.',
            link: { href: '/timesheets', label: 'Open Timesheets' },
        },
        {
            q: 'How do I request annual leave?',
            a: 'Use Annual leave in the sidebar to create a new request.',
            link: { href: '/annual-leave', label: 'Manage leave' },
        },
    ];

const TUTORIALS: {
    slug: string;
    title: string;
    desc: string;
    href?: string;
    icon: React.ReactNode;
    toneBg: string;
    toneRing: string;
    toneText: string;
}[] = [
        {
            slug: 'rotas-basics',
            title: 'Rotas: the basics',
            desc: 'Understand shifts, statuses, and how to read your week.',
            href: '#',
            icon: <IconRota />,
            toneBg: 'bg-fuchsia-50',
            toneRing: 'ring-fuchsia-200',
            toneText: 'text-fuchsia-700',
        },
        {
            slug: 'timesheets-howto',
            title: 'Submitting your timesheet',
            desc: 'Enter hours accurately and avoid common issues.',
            href: '#',
            icon: <IconClock />,
            toneBg: 'bg-cyan-50',
            toneRing: 'ring-cyan-200',
            toneText: 'text-cyan-700',
        },
        {
            slug: 'training-book',
            title: 'Booking training',
            desc: 'Find sessions and track attendance.',
            href: '#',
            icon: <IconCalendar />,
            toneBg: 'bg-violet-50',
            toneRing: 'ring-violet-200',
            toneText: 'text-violet-700',
        },
    ];

/* --------------------------
   Inline icons
--------------------------- */
function IconChevron() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M7 10l5 5 5-5" />
        </svg>
    );
}
function IconHome() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <path d="M3 10.5l9-7 9 7" />
            <path d="M5 10v9h14v-9" />
        </svg>
    );
}
function IconRota() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M7 9h10M7 13h6" />
        </svg>
    );
}
function IconClock() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
        </svg>
    );
}
function IconCalendar() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6" aria-hidden>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
    );
}
