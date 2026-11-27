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
  Cog,
  Eye,
  Home,
  ShoppingCart,
  Receipt,
  Boxes,
  Landmark,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { NaviFloat } from "@/components/navi-float";
import { NaviNavIcon } from "@/components/navi-logo";
import "@/app/admin-theme.css";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }> };

const BUSINESS_HOME = "/admin/business";

const v2Nav: NavItem[] = [
  { href: BUSINESS_HOME, label: "Home", icon: Home },
  { href: "/admin/business/buy", label: "Buy", icon: ShoppingCart },
  { href: "/admin/business/sell", label: "Sell", icon: Receipt },
  { href: "/admin/business/stock", label: "Stock", icon: Boxes },
  { href: "/admin/business/parties", label: "Parties", icon: Users },
  { href: "/admin/business/investment", label: "Investment", icon: Landmark },
  { href: "/admin/business/accounts", label: "Accounts", icon: WalletCards },
];

const previousBooksNav = {
  PET: [
    { href: "/admin", label: "PET Dashboard", icon: LayoutDashboard },
    { href: "/admin/inventory", label: "PET Inventory", icon: Package },
    { href: "/admin/vendors", label: "Vendors & Buyers", icon: Users },
    { href: "/admin/material-analysis", label: "Material & Profit Analysis", icon: LineChart },
    { href: "/admin/accounts", label: "Accounts & Finance", icon: WalletCards },
    { href: "/admin/machines", label: "Machine & Setup", icon: Cog },
    { href: "/admin/processing", label: "Labour Management", icon: Factory },
  ],
  PLASTIC: [
    { href: "/admin", label: "Plastic Dashboard", icon: LayoutDashboard },
    { href: "/admin/inventory", label: "Plastic Inventory", icon: Package },
    { href: "/admin/vendors", label: "Vendors & Buyers", icon: Users },
    { href: "/admin/material-analysis", label: "Material & Profit Analysis", icon: LineChart },
    { href: "/admin/accounts", label: "Accounts & Finance", icon: WalletCards },
    { href: "/admin/machines", label: "Machine & Setup", icon: Cog },
    { href: "/admin/processing", label: "Labour Management", icon: Factory },
  ],
} as const satisfies Record<string, readonly NavItem[]>;

const toolsNav: NavItem[] = [
  { href: "/admin/assistant", label: "Navi AI", icon: NaviNavIcon },
  { href: "/admin/backup", label: "Backup", icon: HardDrive },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === BUSINESS_HOME) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

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
  const [sessionUser, setSessionUser] = useState(username || "");
  const [canWrite, setCanWrite] = useState(true);
  const [role, setRole] = useState<"admin" | "readonly">("admin");

  const owner = sessionUser || process.env.NEXT_PUBLIC_OWNER_NAME || username || "Admin";
  const [booksOpen, setBooksOpen] = useState(false);
  const isV2Page = pathname.startsWith(BUSINESS_HOME);
  const bookNav = previousBooksNav[mode];
  const tools = useMemo(
    () => (canWrite ? toolsNav : toolsNav.filter((n) => n.href !== "/admin/backup")),
    [canWrite]
  );
  const nav = useMemo<NavItem[]>(
    () => [...v2Nav, ...bookNav, ...tools],
    [bookNav, tools]
  );
  const onPreviousBook = !isV2Page && bookNav.some((n) => isActive(pathname, n.href));
  const previousBooksVisible = booksOpen || onPreviousBook;

  useEffect(() => {
    const saved = localStorage.getItem("navrit-admin-theme");
    setDark(saved !== "light");
  }, []);

  useEffect(() => {
    localStorage.setItem("navrit-admin-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSessionUser(String(data.username || ""));
        const write = data.canWrite !== false && data.role !== "readonly";
        setCanWrite(write);
        setRole(data.role === "readonly" ? "readonly" : "admin");
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (role !== "readonly") return;
    const orig = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(
        init?.method || (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        if (url.includes("/api/auth/logout") || url.includes("/api/admin/assistant")) {
          return orig(input, init);
        }
        if (url.includes("/api/")) {
          adminToast("View-only account — cannot change data");
          return new Response(
            JSON.stringify({ error: "View-only account — changes are not allowed" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      return orig(input, init);
    };
    return () => {
      window.fetch = orig;
    };
  }, [role]);

  useEffect(() => {
    if (role === "readonly" && pathname.startsWith("/admin/backup")) {
      router.replace("/admin");
    }
  }, [role, pathname, router]);

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
    const item = nav.find((n) => isActive(pathname, n.href));
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

  function renderNav(onNavigate?: () => void) {
    const link = (item: NavItem) => (
      <Link
        key={item.href}
        href={item.href}
        data-active={isActive(pathname, item.href)}
        className="ad-nav-item"
        onClick={onNavigate}
      >
        <item.icon size={16} />
        {item.label}
      </Link>
    );
    return (
      <div className="space-y-4">
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ad-accent)]">
            NAVRIT 2.0
          </p>
          {v2Nav.map(link)}
        </div>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setBooksOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 pb-1 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--ad-muted)]"
          >
            <BookOpen size={12} />
            <span className="flex-1">Previous Books</span>
            <ChevronDown
              size={12}
              className={clsx("transition-transform", previousBooksVisible && "rotate-180")}
            />
          </button>
          {previousBooksVisible && (
            <>
              <div className="mx-3 mb-1 flex overflow-hidden rounded-lg border border-[var(--ad-border)] text-[10px] font-bold">
                {(["PET", "PLASTIC"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={clsx(
                      "flex-1 px-2 py-1.5",
                      mode === m && "bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]"
                    )}
                  >
                    {m === "PET" ? "PET book" : "Plastic book"}
                  </button>
                ))}
              </div>
              {bookNav.map(link)}
            </>
          )}
        </div>
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ad-muted)]">
            Tools
          </p>
          {tools.map(link)}
        </div>
      </div>
    );
  }

  const headerActions = canWrite ? actions : null;
  const displayName = role === "readonly" ? sessionUser || "Viewer" : owner.split(" ")[0];

  return (
    <div className={clsx("admin-app", !dark && "admin-light")} data-readonly={role === "readonly" ? "1" : undefined}>
      <div className="flex min-h-screen">
        <aside className="ad-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col lg:flex">
          <div className="flex items-center gap-2.5 px-4 py-5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--ad-accent)] text-sm font-bold text-[#052e16]">
              N
            </span>
            <div>
              <p className="text-sm font-bold tracking-tight">NAVRIT</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--ad-muted)]">
                {role === "readonly" ? "View only" : "Admin"}
              </p>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
            {renderNav()}
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
                <p className="font-bold">NAVRIT {role === "readonly" ? "View" : "Admin"}</p>
                <button type="button" onClick={() => setSidebarOpen(false)}>
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
                {renderNav(() => setSidebarOpen(false))}
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
                  {role === "readonly" ? "View" : "Admin"} /{" "}
                  <span className="text-[var(--ad-text)]">{crumbs}</span>
                </p>
                {onPreviousBook && (
                  <p className="mt-0.5 inline-flex rounded bg-[var(--ad-accent-dim)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--ad-accent)]">
                    Previous Book - {mode === "PET" ? "PET" : "Plastic"}
                  </p>
                )}
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
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-xs font-medium">{displayName}</span>
                  {role === "readonly" ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-[var(--ad-accent-dim)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--ad-accent)]">
                      <Eye size={10} /> View
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 sm:px-6">
            {role === "readonly" ? (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--ad-border)] bg-[var(--ad-accent-dim)]/40 px-3 py-2 text-xs text-[var(--ad-muted)]">
                <Eye size={14} className="mt-0.5 shrink-0 text-[var(--ad-accent)]" />
                <p>
                  <strong className="text-[var(--ad-text)]">View-only login</strong> — you can browse
                  all ledgers and reports. Saving, editing, deletes, and backups are disabled.
                </p>
              </div>
            ) : null}
            {(title || headerActions) && (
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  {title && <h1 className="ad-page-title">{title}</h1>}
                  {subtitle && <p className="ad-muted mt-1">{subtitle}</p>}
                </div>
                {headerActions && (
                  <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
                )}
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

      <NaviFloat />
    </div>
  );
}

export function adminToast(text: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("admin-toast", { detail: text }));
  }
}
