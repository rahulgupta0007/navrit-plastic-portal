"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useBusinessMode } from "@/components/business-mode-provider";
import clsx from "clsx";
import {
  LayoutDashboard,
  Package,
  BarChart3,
  Download,
  LogOut,
  Search,
  Moon,
  Sun,
  Bell,
  Menu,
  X,
  Command,
  HardDrive,
  LineChart,
  Users,
  WalletCards,
  Factory,
} from "lucide-react";
import "@/app/admin-theme.css";

const navByMode = {
  PET: [
    { href: "/admin", label: "PET Dashboard", icon: LayoutDashboard },
    { href: "/admin/inventory", label: "PET Inventory", icon: Package },
    { href: "/admin/vendors", label: "Vendors & Management", icon: Users },
    { href: "/admin/material-analysis", label: "Material & Profit Analysis", icon: LineChart },
    { href: "/admin/accounts", label: "Accounts & Finance", icon: WalletCards },
    { href: "/admin/processing", label: "Labour Management", icon: Factory },
  ],
  PLASTIC: [
    { href: "/admin", label: "Plastic Dashboard", icon: LayoutDashboard },
    { href: "/admin/inventory", label: "Plastic Inventory & Finance", icon: Package },
    { href: "/admin/analytics", label: "Plastic Analytics", icon: BarChart3 },
    { href: "/admin/material-analysis", label: "Material & Profit Analysis", icon: LineChart },
    { href: "/admin/reports", label: "Plastic Reports", icon: Download },
    { href: "/admin/report-analysis", label: "Plastic Month Analysis", icon: LineChart },
    { href: "/admin/backup", label: "Backup", icon: HardDrive },
    { href: "/admin/accounts", label: "Accounts & Finance", icon: WalletCards },
  ],
} as const;

type Toast = { id: number; text: string };

export function useAdminToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return { toasts, push };
}

export function AdminShell({
  children,
  title,
  subtitle,
  actions,
  username,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  username?: string;
}) {
  const { dict, locale, setLocale } = useLocale();
  const { mode, setMode } = useBusinessMode();
  const pathname = usePathname();
  const router = useRouter();
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQ, setCmdQ] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const owner = process.env.NEXT_PUBLIC_OWNER_NAME || username || "Admin";
  const nav = navByMode[mode];

  useEffect(() => {
    const saved = localStorage.getItem("navrit-admin-theme");
    setDark(saved !== "light");
  }, []);

  useEffect(() => {
    localStorage.setItem("navrit-admin-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === "Escape") setCmdOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  const crumbs = useMemo(() => {
    const item = nav.find(
      (n) => n.href === pathname || (n.href !== "/admin" && pathname.startsWith(n.href))
    );
    return item?.label || "Admin";
  }, [pathname, nav]);

  const filteredNav = nav.filter((n) =>
    n.label.toLowerCase().includes(cmdQ.trim().toLowerCase())
  );

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (!detail) return;
      const id = Date.now();
      setToasts((t) => [...t, { id, text: detail }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
    }
    window.addEventListener("admin-toast", onToast);
    return () => window.removeEventListener("admin-toast", onToast);
  }, []);

  return (
    <div className={clsx("admin-app", !dark && "admin-light")}>
      <div className="flex min-h-screen">
        <aside className="ad-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col lg:flex">
          <div className="flex items-center gap-2.5 px-4 py-5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--ad-accent)] text-sm font-bold text-[#052e16]">
              N
            </span>
            <div>
              <p className="text-sm font-bold tracking-tight">NAVRIT</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--ad-muted)]">Admin</p>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2.5 pb-4">
            {nav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} data-active={active} className="ad-nav-item">
                  <item.icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="space-y-1 border-t border-[var(--ad-border)] p-2.5">
            <button type="button" onClick={logout} className="ad-nav-item w-full text-left">
              <LogOut size={16} />
              {dict.logout}
            </button>
          </div>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              aria-label="Close"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="ad-sidebar absolute inset-y-0 left-0 flex w-64 flex-col">
              <div className="flex items-center justify-between px-4 py-4">
                <p className="font-bold">NAVRIT Admin</p>
                <button type="button" onClick={() => setSidebarOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 space-y-0.5 px-2.5">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="ad-nav-item"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon size={16} />
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="ad-topbar sticky top-0 z-30">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                className="ad-btn ad-btn-ghost lg:hidden !px-2"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu size={16} />
              </button>

              <div className="hidden min-w-0 sm:block">
                <p className="text-[11px] text-[var(--ad-muted)]">
                  Admin / <span className="text-[var(--ad-text)]">{crumbs}</span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                className="ml-auto flex max-w-xs flex-1 items-center gap-2 rounded-lg border border-[var(--ad-border)] bg-[var(--ad-input)] px-3 py-2 text-left text-xs text-[var(--ad-muted)] sm:ml-4"
              >
                <Search size={14} />
                <span className="flex-1">Search…</span>
                <kbd className="hidden rounded border border-[var(--ad-border)] px-1.5 py-0.5 text-[10px] sm:inline-flex">
                  <Command size={10} className="mr-0.5" />K
                </kbd>
              </button>

              <div className="flex items-center gap-1.5">
                <div className="flex overflow-hidden rounded-lg border border-[var(--ad-border)] text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setMode("PET")}
                    className={clsx("px-2 py-1.5", mode === "PET" && "bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]")}
                  >
                    PET
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("PLASTIC")}
                    className={clsx("px-2 py-1.5", mode === "PLASTIC" && "bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]")}
                  >
                    Plastic
                  </button>
                </div>
                <div className="flex overflow-hidden rounded-lg border border-[var(--ad-border)] text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setLocale("en")}
                    className={clsx("px-2 py-1.5", locale === "en" && "bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]")}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocale("hi")}
                    className={clsx("px-2 py-1.5", locale === "hi" && "bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]")}
                  >
                    हिं
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Theme"
                  className="ad-btn ad-btn-ghost !px-2"
                  onClick={() => setDark((d) => !d)}
                >
                  {dark ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <button type="button" className="ad-btn ad-btn-ghost !px-2" aria-label="Notifications">
                  <Bell size={15} />
                </button>
                <div className="hidden items-center gap-2 rounded-lg border border-[var(--ad-border)] px-2.5 py-1.5 sm:flex">
                  <span className="flex size-6 items-center justify-center rounded-full bg-[var(--ad-accent-dim)] text-[10px] font-bold text-[var(--ad-accent)]">
                    {owner.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-xs font-medium">{owner.split(" ")[0]}</span>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 sm:px-6">
            {(title || actions) && (
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  {title && <h1 className="ad-page-title">{title}</h1>}
                  {subtitle && <p className="ad-muted mt-1">{subtitle}</p>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {cmdOpen && (
        <div className="ad-cmd" onClick={() => setCmdOpen(false)}>
          <div className="ad-cmd-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-[var(--ad-border)] px-3">
              <Search size={16} className="text-[var(--ad-muted)]" />
              <input
                autoFocus
                value={cmdQ}
                onChange={(e) => setCmdQ(e.target.value)}
                placeholder="Jump to…"
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </div>
            <div className="max-h-72 overflow-auto p-2">
              {filteredNav.map((item) => (
                <button
                  key={item.href}
                  type="button"
                  className="ad-nav-item w-full"
                  onClick={() => {
                    setCmdOpen(false);
                    setCmdQ("");
                    router.push(item.href);
                  }}
                >
                  <item.icon size={16} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="ad-toast">
        {toasts.map((t) => (
          <div key={t.id} className="ad-toast-item">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function adminToast(text: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("admin-toast", { detail: text }));
  }
}
