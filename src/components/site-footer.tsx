"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";

export function SiteFooter() {
  const { dict } = useLocale();
  const pathname = usePathname();
  const brand = dict.brand;
  const tagline = process.env.NEXT_PUBLIC_BUSINESS_TAGLINE || dict.tagline;

  if (pathname.startsWith("/admin")) return null;

  return (
    <footer className="mt-auto border-t border-[var(--nv-border)] bg-gradient-to-b from-transparent to-[#ecfdf5]/60 dark:to-emerald-950/30">
      <div className="container-premium grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-gradient-to-br from-[#16a34a] to-[#84cc16] text-sm font-bold text-white">
              N
            </span>
            <span className="font-display text-xl text-[var(--nv-text)]">{brand}</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--nv-muted)]">
            {tagline}
          </p>
          <p className="mt-4 text-xs text-[var(--nv-muted)]">
            © {new Date().getFullYear()} {brand}. Transparent daily rates.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--nv-muted)]">
            Explore
          </p>
          <div className="mt-4 flex flex-col gap-2.5 text-sm">
            <Link href="/" className="text-[var(--nv-text)] hover:text-[#16a34a]">
              {dict.navHome}
            </Link>
            <Link href="/articles" className="text-[var(--nv-text)] hover:text-[#16a34a]">
              {dict.navArticles}
            </Link>
            <Link href="/about" className="text-[var(--nv-text)] hover:text-[#16a34a]">
              {dict.navAbout}
            </Link>
            <Link href="/contact" className="text-[var(--nv-text)] hover:text-[#16a34a]">
              {dict.navContact}
            </Link>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--nv-muted)]">
            Staff
          </p>
          <div className="mt-4 flex flex-col gap-2.5 text-sm">
            <Link href="/admin/login" className="text-[var(--nv-muted)] hover:text-[#16a34a]">
              {dict.navAdmin}
            </Link>
          </div>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-green-500/10 to-lime-400/15 px-3 py-1.5 text-xs font-semibold text-[#166534]">
            <span className="live-dot size-1.5 rounded-full bg-[#16a34a]" />
            Live daily rates
          </div>
        </div>
      </div>
    </footer>
  );
}
