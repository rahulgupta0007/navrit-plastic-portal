"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocale } from "./locale-provider";
import { useTheme } from "./theme-provider";
import clsx from "clsx";

const links = [
  { href: "/", key: "navHome" as const },
  { href: "/articles", key: "navArticles" as const },
  { href: "/about", key: "navAbout" as const },
  { href: "/contact", key: "navContact" as const },
];

export function SiteHeader() {
  const { locale, setLocale, dict } = useLocale();
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const brand = dict.brand;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (pathname.startsWith("/admin")) return null;

  return (
    <header
      className={clsx(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-[var(--nv-border)] bg-white/75 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:bg-[#111827]/80"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="container-premium flex items-center justify-between gap-4 py-3.5">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#16a34a] to-[#84cc16] text-sm font-bold text-white shadow-lg shadow-green-500/25 transition group-hover:scale-105">
            N
          </span>
          <span className="font-display text-lg tracking-tight text-[var(--nv-text)] sm:text-xl">
            {brand}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {links.map((l) => {
            const active =
              pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                data-active={active}
                className="nav-link"
              >
                {dict[l.key]}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageToggle locale={locale} setLocale={setLocale} />
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle dark mode"
            className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--nv-border)] bg-[var(--nv-card)] text-[var(--nv-muted)] transition hover:text-[var(--nv-text)]"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            href="/admin/login"
            className="hidden rounded-full border border-[var(--nv-border)] bg-[var(--nv-card)] px-3.5 py-2 text-xs font-semibold text-[var(--nv-muted)] transition hover:border-green-500/30 hover:text-[var(--nv-text)] sm:inline-flex"
          >
            {dict.navAdmin}
          </Link>
          <button
            type="button"
            aria-label="Menu"
            className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--nv-border)] lg:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[var(--nv-border)] bg-[var(--nv-card)] px-4 py-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-sm font-medium text-[var(--nv-text)] hover:bg-green-50 dark:hover:bg-white/5"
              >
                {dict[l.key]}
              </Link>
            ))}
            <Link
              href="/admin/login"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-sm font-medium text-[var(--nv-muted)]"
            >
              {dict.navAdmin}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function LanguageToggle({
  locale,
  setLocale,
}: {
  locale: "en" | "hi";
  setLocale: (l: "en" | "hi") => void;
}) {
  return (
    <div className="relative flex rounded-full border border-[var(--nv-border)] bg-[var(--nv-card)] p-0.5 text-xs font-bold">
      <span
        className={clsx(
          "absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-gradient-to-r from-[#16a34a] to-[#84cc16] transition-transform duration-300",
          locale === "hi" ? "translate-x-[100%]" : "translate-x-0"
        )}
      />
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={clsx(
          "relative z-10 px-2.5 py-1.5 transition-colors",
          locale === "en" ? "text-white" : "text-[var(--nv-muted)]"
        )}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("hi")}
        className={clsx(
          "relative z-10 px-2.5 py-1.5 transition-colors",
          locale === "hi" ? "text-white" : "text-[var(--nv-muted)]"
        )}
      >
        हिं
      </button>
    </div>
  );
}
