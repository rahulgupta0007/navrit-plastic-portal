"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "./admin-shell";
import { useBusinessMode, type BusinessMode } from "./business-mode-provider";
import { Package, Wallet, Scale, ArrowRight, PlusCircle, BarChart3, FileText, type LucideIcon } from "lucide-react";

type InventoryRow = { mode: BusinessMode; materialName: string; quantityKg: number; value: number };
type Purchase = { mode: BusinessMode; total_amount: number; credit_amount: number; purchase_date: string };
type Borrowing = { mode: BusinessMode; amount: number; outstanding_amount: number };

export function AdminDashboardClient({ username }: { username: string }) {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<{ inventory: InventoryRow[]; purchases: Purchase[]; borrowings: Borrowing[] } | null>(null);

  useEffect(() => {
    fetch("/api/admin/inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const rows = useMemo(() => (data?.inventory || []).filter((x) => x.mode === mode), [data, mode]);
  const purchases = useMemo(() => (data?.purchases || []).filter((x) => x.mode === mode), [data, mode]);
  const borrowings = useMemo(() => (data?.borrowings || []).filter((x) => x.mode === mode), [data, mode]);

  const stockKg = rows.reduce((n, x) => n + Number(x.quantityKg || 0), 0);
  const stockValue = rows.reduce((n, x) => n + Number(x.value || 0), 0);
  const purchaseValue = purchases.reduce((n, x) => n + Number(x.total_amount || 0), 0);
  const supplierCredit = purchases.reduce((n, x) => n + Number(x.credit_amount || 0), 0);
  const borrowedOutstanding = borrowings.reduce((n, x) => n + Number(x.outstanding_amount || 0), 0);
  const recent = purchases.slice(0, 5);

  return (
    <AdminShell username={username} title={mode + " Command Center"} subtitle={"Internal management · " + username}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ad-muted)]">Business mode</p>
          <p className="mt-1 text-sm">All figures below are for <strong>{mode}</strong> only.</p>
        </div>
        <Link href="/admin/inventory" className="ad-btn ad-btn-primary"><PlusCircle size={14} /> Add purchase</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          [Package, "Current stock", stockKg.toFixed(2) + " kg", rows.length + " materials"],
          [Wallet, "Stock value", "₹" + stockValue.toFixed(2), "Current inventory value"],
          [Scale, "Purchases", "₹" + purchaseValue.toFixed(2), purchases.length + " purchase records"],
          [Wallet, "Outstanding", "₹" + (supplierCredit + borrowedOutstanding).toFixed(2), "Credit ₹" + supplierCredit.toFixed(2) + " · Borrowed ₹" + borrowedOutstanding.toFixed(2)],
        ] as [LucideIcon, string, string, string][]).map(([Icon, label, value, sub]) => (
          <div key={String(label)} className="ad-card p-4">
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]"><Icon size={16} /></span>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">{label}</p>
            <p className="mt-1 font-display text-2xl tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-[var(--ad-muted)]">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="ad-card p-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{mode} Inventory</h2>
            <Link href="/admin/inventory" className="text-xs font-semibold text-[var(--ad-accent)]">Manage →</Link>
          </div>
          <div className="ad-table-wrap mt-4">
            <table className="ad-table"><thead><tr><th>Material</th><th>Quantity</th><th>Value</th></tr></thead>
              <tbody>{rows.length ? rows.map((r) => <tr key={r.materialName}><td className="font-semibold">{r.materialName}</td><td>{Number(r.quantityKg).toFixed(2)} kg</td><td>₹{Number(r.value).toFixed(2)}</td></tr>) : <tr><td colSpan={3}>No {mode} inventory yet.</td></tr>}</tbody>
            </table>
          </div>
        </section>

        <section className="ad-card p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Management shortcuts</h2>
          <div className="mt-4 grid gap-2">
            {[
              ["/admin/inventory", "Inventory & Finance", Package],
              ["/admin/analytics", "Analytics", BarChart3],
              ["/admin/reports", "Reports", FileText],
            ].map(([href, label, Icon]) => <Link key={String(href)} href={String(href)} className="flex items-center justify-between rounded-lg border border-[var(--ad-border)] px-3 py-2.5 text-sm hover:bg-[var(--ad-hover)]"><span className="flex items-center gap-2"><Icon size={14} />{String(label)}</span><ArrowRight size={14} className="text-[var(--ad-muted)]" /></Link>)}
          </div>
          <div className="mt-5 rounded-xl bg-[var(--ad-accent-dim)] p-3">
            <p className="text-xs font-semibold text-[var(--ad-accent)]">Current mode</p>
            <p className="mt-1 text-sm">{mode} data is isolated from the other business mode.</p>
          </div>
        </section>
      </div>

      <section className="ad-card mt-4 p-4">
        <h2 className="text-sm font-semibold">Recent {mode} purchases</h2>
        <div className="mt-3 ad-table-wrap">
          <table className="ad-table"><thead><tr><th>Date</th><th>Total</th><th>Credit</th></tr></thead><tbody>
            {recent.length ? recent.map((p, i) => <tr key={i}><td>{p.purchase_date}</td><td>₹{Number(p.total_amount).toFixed(2)}</td><td>₹{Number(p.credit_amount).toFixed(2)}</td></tr>) : <tr><td colSpan={3}>No purchases recorded for {mode}.</td></tr>}
          </tbody></table>
        </div>
      </section>
    </AdminShell>
  );
}
