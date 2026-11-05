"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "./admin-shell";
import { AdminSelect } from "./admin-select";
import { useBusinessMode, type BusinessMode } from "./business-mode-provider";
import {
  Package, Wallet, Scale, ArrowRight, PlusCircle, BarChart3, FileText,
  ShoppingCart, TrendingUp, type LucideIcon,
} from "lucide-react";

type InventoryRow = { mode: BusinessMode; materialName: string; quantityKg: number; value: number };
type Purchase = {
  mode: BusinessMode;
  total_amount: number;
  credit_amount: number;
  quantity_kg?: number;
  purchase_date: string;
  supplierName?: string;
  material_name?: string;
};
type Sale = {
  mode: BusinessMode;
  total_amount: number;
  received_amount: number;
  credit_amount: number;
  quantity_kg?: number;
  sale_date: string;
  customer_name?: string;
};
type Expense = { mode: BusinessMode; amount: number; expense_date?: string; payment_date?: string };
type Labour = { mode: BusinessMode; amount: number; payment_date: string; payment_kind?: string };
type Borrowing = { mode: BusinessMode; amount: number; outstanding_amount: number };

type PeriodPreset = "15" | "30" | "all" | "custom";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return d.toISOString().slice(0, 10);
}

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function inRange(date: string | undefined, from: string | null, to: string | null) {
  if (!date) return false;
  if (!from && !to) return true;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export function AdminDashboardClient({ username }: { username: string }) {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<{
    inventory: InventoryRow[];
    purchases: Purchase[];
    sales: Sale[];
    otherExpenses: Expense[];
    processingExpenses: Expense[];
    manualLabour: Labour[];
    borrowings: Borrowing[];
  } | null>(null);

  const [period, setPeriod] = useState<PeriodPreset>("30");
  const [customFrom, setCustomFrom] = useState(daysAgo(30));
  const [customTo, setCustomTo] = useState(todayStr());

  useEffect(() => {
    fetch("/api/admin/inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const { from, to, label } = useMemo(() => {
    if (period === "all") return { from: null as string | null, to: null as string | null, label: "All time" };
    if (period === "15") return { from: daysAgo(15), to: todayStr(), label: "Last 15 days" };
    if (period === "30") return { from: daysAgo(30), to: todayStr(), label: "Last 30 days" };
    return { from: customFrom || null, to: customTo || null, label: `${customFrom || "…"} → ${customTo || "…"}` };
  }, [period, customFrom, customTo]);

  const rows = useMemo(() => (data?.inventory || []).filter((x) => x.mode === mode), [data, mode]);
  const borrowings = useMemo(() => (data?.borrowings || []).filter((x) => x.mode === mode), [data, mode]);

  const purchasesInRange = useMemo(
    () => (data?.purchases || []).filter((x) => x.mode === mode && inRange(x.purchase_date, from, to)),
    [data, mode, from, to]
  );
  const salesInRange = useMemo(
    () => (data?.sales || []).filter((x) => x.mode === mode && inRange(x.sale_date, from, to)),
    [data, mode, from, to]
  );
  const expensesInRange = useMemo(() => {
    const other = (data?.otherExpenses || []).filter((x) => x.mode === mode && inRange(x.expense_date, from, to));
    const proc = (data?.processingExpenses || []).filter((x) => x.mode === mode && inRange(x.expense_date, from, to));
    return [...other, ...proc];
  }, [data, mode, from, to]);
  const labourInRange = useMemo(
    () =>
      (data?.manualLabour || []).filter(
        (x) =>
          x.mode === mode &&
          inRange(x.payment_date, from, to) &&
          ["WAGE", "ADVANCE", ""].includes(String(x.payment_kind || "WAGE"))
      ),
    [data, mode, from, to]
  );

  const stockKg = rows.reduce((n, x) => n + Number(x.quantityKg || 0), 0);
  const stockValue = rows.reduce((n, x) => n + Number(x.value || 0), 0);

  const purchaseValue = purchasesInRange.reduce((n, x) => n + Number(x.total_amount || 0), 0);
  const purchaseKg = purchasesInRange.reduce((n, x) => n + Number(x.quantity_kg || 0), 0);
  const supplierCreditOpen = (data?.purchases || [])
    .filter((x) => x.mode === mode)
    .reduce((n, x) => n + Number(x.credit_amount || 0), 0);
  const borrowedOutstanding = borrowings.reduce((n, x) => n + Number(x.outstanding_amount || 0), 0);

  const salesValue = salesInRange.reduce((n, x) => n + Number(x.total_amount || 0), 0);
  const salesReceived = salesInRange.reduce((n, x) => n + Number(x.received_amount || 0), 0);
  const salesKg = salesInRange.reduce((n, x) => n + Number(x.quantity_kg || 0), 0);
  const expenseTotal = expensesInRange.reduce((n, x) => n + Number(x.amount || 0), 0);
  const labourTotal = labourInRange.reduce((n, x) => n + Number(x.amount || 0), 0);

  const recentPurchases = purchasesInRange.slice(0, 8);
  const recentSales = salesInRange.slice(0, 8);

  return (
    <AdminShell username={username} title={mode + " Command Center"} subtitle={"Internal management · " + username}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ad-muted)]">Period</p>
          <p className="mt-1 text-sm">
            Cash is company-wide (PET + Plastic). This screen shows <strong>{mode}</strong> activity for{" "}
            <strong>{label}</strong>
            {period !== "all" && from && to ? <> ({from} → {to})</> : null}.
            Current stock is always live (not filtered).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <AdminSelect
            label="Timeline"
            value={period}
            onChange={(v) => setPeriod(v as PeriodPreset)}
            options={[
              { value: "15", label: "Last 15 days" },
              { value: "30", label: "Last 30 days" },
              { value: "all", label: "All time" },
              { value: "custom", label: "Custom range" },
            ]}
          />
          {period === "custom" && (
            <>
              <label className="ad-field">
                <span className="ad-field-label">From</span>
                <input className="ad-input" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="ad-field">
                <span className="ad-field-label">To</span>
                <input className="ad-input" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </>
          )}
          <Link href="/admin/inventory" className="ad-btn ad-btn-primary">
            <PlusCircle size={14} /> Add purchase
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            [Package, "Current stock", `${stockKg.toFixed(2)} kg`, `${rows.length} materials · live`],
            [Wallet, "Stock value", money(stockValue), "Current inventory value · live"],
            [ShoppingCart, "Purchases", money(purchaseValue), `${purchasesInRange.length} buys · ${purchaseKg.toFixed(1)} kg`],
            [TrendingUp, "Sales", money(salesValue), `${salesInRange.length} sales · ${salesKg.toFixed(1)} kg · received ${money(salesReceived)}`],
            [Scale, "Expenses", money(expenseTotal), `${expensesInRange.length} expense rows in period`],
            [Wallet, "Labour cash", money(labourTotal), "Wages + advances in period"],
            [Wallet, "Outstanding (live)", money(supplierCreditOpen + borrowedOutstanding), `Credit ${money(supplierCreditOpen)} · Borrowed ${money(borrowedOutstanding)}`],
            [BarChart3, "Buy vs sell kg", `${purchaseKg.toFixed(1)} / ${salesKg.toFixed(1)} kg`, "Purchased vs sold in period"],
          ] as [LucideIcon, string, string, string][]
        ).map(([Icon, cardLabel, value, sub]) => (
          <div key={cardLabel} className="ad-card p-4">
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]">
              <Icon size={16} />
            </span>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">{cardLabel}</p>
            <p className="mt-1 font-display text-2xl tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-[var(--ad-muted)]">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <section className="ad-card p-4 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{mode} Inventory (live)</h2>
            <Link href="/admin/inventory" className="text-xs font-semibold text-[var(--ad-accent)]">
              Manage →
            </Link>
          </div>
          <div className="ad-table-wrap mt-4">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Quantity</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r) => (
                    <tr key={r.materialName}>
                      <td className="font-semibold">{r.materialName}</td>
                      <td>{Number(r.quantityKg).toFixed(2)} kg</td>
                      <td>{money(Number(r.value))}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>No {mode} inventory yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ad-card p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Management shortcuts</h2>
          <div className="mt-4 grid gap-2">
            {(
              [
                ["/admin/inventory", "Inventory & Finance", Package],
                ["/admin/analytics", "Analytics", BarChart3],
                ["/admin/reports", "Reports", FileText],
                ["/admin/processing", "Labour Management", Scale],
              ] as const
            ).map(([href, shortcutLabel, Icon]) => (
              <Link
                key={href}
                href={href}
                className="flex items-center justify-between rounded-lg border border-[var(--ad-border)] px-3 py-2.5 text-sm hover:bg-[var(--ad-hover)]"
              >
                <span className="flex items-center gap-2">
                  <Icon size={14} />
                  {shortcutLabel}
                </span>
                <ArrowRight size={14} className="text-[var(--ad-muted)]" />
              </Link>
            ))}
          </div>
          <div className="mt-5 rounded-xl bg-[var(--ad-accent-dim)] p-3">
            <p className="text-xs font-semibold text-[var(--ad-accent)]">Mode vs cash</p>
            <p className="mt-1 text-sm">
              Activity here is {mode}-only. Company cash (Accounts) is shared across PET and Plastic.
            </p>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="ad-card p-4">
          <h2 className="text-sm font-semibold">Purchases in period</h2>
          <div className="mt-3 ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor / material</th>
                  <th>Total</th>
                  <th>Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {recentPurchases.length ? (
                  recentPurchases.map((p, i) => (
                    <tr key={i}>
                      <td>{p.purchase_date}</td>
                      <td>
                        {p.supplierName || "—"}
                        {p.material_name ? ` · ${p.material_name}` : ""}
                      </td>
                      <td>{money(Number(p.total_amount))}</td>
                      <td>{money(Number(p.credit_amount))}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>No purchases in this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ad-card p-4">
          <h2 className="text-sm font-semibold">Sales in period</h2>
          <div className="mt-3 ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.length ? (
                  recentSales.map((s, i) => (
                    <tr key={i}>
                      <td>{s.sale_date}</td>
                      <td>{s.customer_name || "—"}</td>
                      <td>{money(Number(s.total_amount))}</td>
                      <td>{money(Number(s.received_amount))}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>No sales in this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
