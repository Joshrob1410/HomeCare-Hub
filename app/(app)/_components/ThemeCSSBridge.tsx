// app/(app)/_components/ThemeCSSBridge.tsx
"use client";

import { useLayoutEffect, useEffect } from "react";

type Props = { initialOrbit: boolean };

const TOKENS = {
    ORBIT: {
        pageBg:
            "linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)",
        ring: "rgba(148,163,184,0.16)",
        ink: "#E5E7EB",
        sub: "#94A3B8",
        panelBg:
            "linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)",
        cardGrad:
            "linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(99,102,241,0.09) 35%, rgba(59,130,246,0.08) 100%)",
        ringStrong: "rgba(148,163,184,0.20)",
        headerTint: "rgba(0,0,0,0.30)",
        link: "#C7D2FE",
        navItemBg: "rgba(255,255,255,0.02)",
        navItemBgHover: "rgba(255,255,255,0.05)",
    },
    LIGHT: {
        pageBg:
            "linear-gradient(180deg, #F7F8FB 0%, #F4F6FA 60%, #F2F4F8 100%)",
        ring: "rgba(15,23,42,0.08)",
        ink: "#0F172A",
        sub: "#475569",
        panelBg:
            "linear-gradient(180deg, #FBFCFE 0%, #F8FAFD 60%, #F6F8FC 100%)",
        cardGrad:
            "linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(99,102,241,0.05) 35%, rgba(59,130,246,0.05) 100%)",
        ringStrong: "rgba(15,23,42,0.12)",
        headerTint: "rgba(255,255,255,0.60)",
        link: "#4F46E5",
        navItemBg: "#FFFFFF",
        navItemBgHover: "#F8FAFF",
    },
} as const;

function applyVars(orbit: boolean) {
    const t = orbit ? TOKENS.ORBIT : TOKENS.LIGHT;
    const r = document.documentElement;

    r.dataset.orbit = orbit ? "1" : "0";

    r.style.setProperty("--page-bg", t.pageBg);
    r.style.setProperty("--ring", t.ring);
    r.style.setProperty("--ink", t.ink);
    r.style.setProperty("--sub", t.sub);
    r.style.setProperty("--card-grad", t.cardGrad);
    r.style.setProperty("--ring-strong", t.ringStrong);
    r.style.setProperty("--header-tint", t.headerTint);
    r.style.setProperty("--brand-link", t.link);

    // neutral surfaces
    r.style.setProperty("--nav-item-bg", t.navItemBg);
    r.style.setProperty("--nav-item-bg-hover", t.navItemBgHover);

    r.style.setProperty("--panel-bg", t.panelBg);
    r.style.setProperty("--panel-bg-light", TOKENS.LIGHT.panelBg);
    r.style.setProperty("--panel-bg-dark", TOKENS.ORBIT.panelBg);
    r.style.setProperty("--bg-light-alpha", orbit ? "0" : "1");
    r.style.setProperty("--bg-dark-alpha", orbit ? "1" : "0");
}

export default function ThemeCSSBridge({ initialOrbit }: Props) {
    // Apply before paint to avoid any flash/mismatch
    useLayoutEffect(() => {
        applyVars(initialOrbit);
    }, [initialOrbit]);

    // Listen for changes (same-tab + cross-tab)
    useEffect(() => {
        const onLocal = (e: Event) => {
            const detail = (e as CustomEvent).detail as { orbit?: boolean } | undefined;
            if (typeof detail?.orbit === "boolean") applyVars(detail.orbit);
        };
        window.addEventListener("orbit:changed", onLocal as EventListener);

        const onStorage = (e: StorageEvent) => {
            if (e.key !== "orbit:lastChange" || !e.newValue) return;
            try {
                const { orbit } = JSON.parse(e.newValue) as { orbit?: boolean };
                if (typeof orbit === "boolean") applyVars(orbit);
            } catch {
                /* noop */
            }
        };
        window.addEventListener("storage", onStorage);

        return () => {
            window.removeEventListener("orbit:changed", onLocal as EventListener);
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    return null;
}
