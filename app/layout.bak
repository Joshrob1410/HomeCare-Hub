// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

// Fonts
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Only use metadataBase if NEXT_PUBLIC_SITE_URL starts with http/https.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const hasValidSiteUrl = !!siteUrl && /^https?:\/\//i.test(siteUrl);
const safeBase = hasValidSiteUrl ? new URL(siteUrl!) : null;

// Metadata
export const metadata: Metadata = safeBase
  ? {
      title: { default: "HomeCare Hub", template: "%s · HomeCare Hub" },
      description: "HomeCare Hub – home management.",
      metadataBase: safeBase,
      icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/apple-touch-icon.png" },
    }
  : {
      title: { default: "HomeCare Hub", template: "%s · HomeCare Hub" },
      description: "HomeCare Hub – home management.",
      icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/apple-touch-icon.png" },
    };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
