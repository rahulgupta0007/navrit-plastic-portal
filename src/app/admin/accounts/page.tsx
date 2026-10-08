"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { useBusinessMode } from "@/components/business-mode-provider";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, WalletCards } from "lucide-react";

type Person = "Rahul" | "Nitin" | "Devesh";
type Row = Record<string, unknown>;
type AccountsData = {
  openingBalance?: Record<string, number>;
  personAccountTotals?: Record<string, Record<string, { received:number; purchasesPaid:number; expensesPaid:number; processingPaid:number; saleProcessingPaid:number; paid:number; balance:number }>>;
  cashBalance?: Record<string, number>;
  salePayments?: Row[];
  purchases?: Row[];
  vendorPayments?: Row[];
  otherExpenses?: Row[];
  processingExpenses?: Row[];
  saleProcessingCosts?: Row[];
};

const people: Person[] = ["Rahul", "Nitin", "Devesh"];

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sumBy(rows: Row[] | undefined, field: string, person: Person, mode: string, amountField = "amount") {
  return (rows || [])
    .filter((row) => row.mode === mode && String(row[field] || "") === person)
    .reduce((total, row) => total + Number(row[amountField] ?? row.amount ?? 0), 0);
}

export default function AccountsPage() {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<AccountsData | null>(null);
  const [opening, setOpening] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load accounts");
      setData(json);
      setOpening(String(Number(json.openingBalance?.[mode] || 0)));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveOpeningBalance() {
    const amount = Number(opening);
    if (!Number.isFinite(amount) || amount < 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setOpeningBalance", mode, amount }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Failed to save opening balance");
      await load();
    } finally {
      setSaving(false);
    }
  }

  const companyBalance = Number(data?.cashBalance?.[mode] || 0);
  const openingBalance = Number(data?.openingBalance?.[mode] || 0);

  const accounts = useMemo(() => {
    return people.map((person) => {
      const serverTotals = data?.personAccountTotals?.[mode]?.[person];
      if (serverTotals) {
        return {
          person,
          received: Number(serverTotals.received || 0),
          paid: Number(serverTotals.paid || 0),
          balance: Number(serverTotals.balance || 0),
          purchasesPaid: Number(serverTotals.purchasesPaid || 0),
          expensesPaid: Number(serverTotals.expensesPaid || 0) + Number(serverTotals.processingPaid || 0) + Number(serverTotals.saleProcessingPaid || 0),
        };
      }

      const received = sumBy(data?.salePayments, "received_by", person, mode);
      const purchasesPaid = (data?.vendorPayments || [])
        .filter((row) =>
          row.mode === mode &&
          String(row.paid_by || "") === person &&
          String(row.payment_type || "") !== "ADVANCE" &&
          String(row.payment_mode || "") !== "Advance"
        )
        .reduce((total, row) => total + Number(row.amount ?? 0), 0);
      const expensesPaid = sumBy(data?.otherExpenses, "paid_by", person, mode);
      const processingPaid = sumBy(data?.processingExpenses, "paid_by", person, mode);
      const saleProcessingPaid = (data?.saleProcessingCosts || [])
        .filter((row) => row.mode === mode && String(row.paid_by || "") === person)
        .reduce((total, row) => total + Number(row.labour_cost || 0) + Number(row.loading_cost || 0), 0);
      const paid = purchasesPaid + expensesPaid + processingPaid + saleProcessingPaid;
      return {
        person,
        received,
        paid,
        balance: received - paid,
        purchasesPaid,
        expensesPaid: expensesPaid + processingPaid + saleProcessingPaid,
      };
    });
  }, [data, mode]);

  const transactions = useMemo(() => {
    const rows: Array<{ date: string; type: string; description: string; person: string; amount: number; direction: "in" | "out" }> = [];

    (data?.salePayments || [])
      .filter((x) => x.mode === mode && x.received_by)
      .forEach((x) => rows.push({
        date: String(x.payment_date ?? ""),
        type: "Sale receipt",
        description: x.customerName ? `Sale from ${x.customerName}` : `Sale #${x.sale_id}`,
        person: String(x.received_by ?? ""),
        amount: Number(x.amount || 0),
        direction: "in",
      }));

    (data?.vendorPayments || [])
      .filter((x) => x.mode === mode && x.paid_by && String(x.payment_type || "") !== "ADVANCE" && String(x.payment_mode || "") !== "Advance" && Number(x.amount) > 0)
      .forEach((x) => rows.push({
        date: String(x.payment_date ?? ""),
        type: "Purchase payment",
        description: x.purchase_id ? `Purchase #${x.purchase_id} — ${x.materialName || "Vendor payment"}` : "Vendor payment",
        person: String(x.paid_by ?? ""),
        amount: Number(x.amount || 0),
        direction: "out",
      }));

    [...(data?.otherExpenses || []), ...(data?.processingExpenses || []), ...(data?.saleProcessingCosts || [])]
      .filter((x) => x.mode === mode && x.paid_by && Number(x.amount ?? x.labour_cost ?? x.loading_cost) > 0)
      .forEach((x) => {
        const amount = x.amount != null
          ? Number(x.amount)
          : Number(x.labour_cost ?? 0) + Number(x.loading_cost ?? 0);
        rows.push({
          date: String(x.expense_date ?? x.payment_date ?? ""),
          type: "Expense",
          description: String(x.description ?? x.expense_type ?? "Business expense"),
          person: String(x.paid_by ?? ""),
          amount,
          direction: "out",
        });
      });

    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  }, [data, mode]);

  return (
    <AdminShell
      title="Accounts & Finance"
      subtitle={`Company and individual money tracking for ${mode}`}
      actions={
        <button className="ad-btn ad-btn-ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      }
    >
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="ad-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="ad-muted text-xs">Opening Balance</p>
              <p className="mt-1 text-2xl font-bold">{money(openingBalance)}</p>
              <p className="ad-muted mt-1 text-xs">Starting {mode} company cash</p>
            </div>
            <WalletCards size={20} className="text-[var(--ad-accent)]" />
          </div>
          <div className="mt-4 flex gap-2">
            <input
              className="ad-input min-w-0"
              type="number"
              min="0"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="Opening balance"
            />
            <button className="ad-btn ad-btn-primary" onClick={saveOpeningBalance} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Company Account</p>
          <p className="mt-1 text-3xl font-bold">{money(companyBalance)}</p>
          <p className="ad-muted mt-1 text-xs">
            Consolidated company cash after receipts, payments, borrowings, repayments and expenses.
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {accounts.map((account) => (
          <div key={account.person} className="ad-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{account.person} Account</p>
                <p className="ad-muted text-xs">Money handled on behalf of the company</p>
              </div>
              <p className="text-xl font-bold">{money(account.balance)}</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[var(--ad-border)] p-2">
                <p className="ad-muted">Received by {account.person}</p>
                <p className="mt-1 font-semibold">{money(account.received)}</p>
              </div>
              <div className="rounded-lg border border-[var(--ad-border)] p-2">
                <p className="ad-muted">Paid by {account.person}</p>
                <p className="mt-1 font-semibold">{money(account.paid)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="ad-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Account Transactions</h2>
            <p className="ad-muted text-xs">Every receipt/payment is attributed to the person recorded as Received By or Paid By.</p>
          </div>
          <span className="ad-muted text-xs">{transactions.length} recent entries</span>
        </div>

        {loading ? (
          <p className="ad-muted py-8 text-center text-sm">Loading account transactions…</p>
        ) : transactions.length === 0 ? (
          <p className="ad-muted py-8 text-center text-sm">No person-attributed transactions found for {mode}.</p>
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Person</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, index) => (
                  <tr key={index}>
                    <td>{tx.date || "—"}</td>
                    <td>{tx.type}</td>
                    <td>{tx.description}</td>
                    <td>{tx.person}</td>
                    <td className="font-semibold">
                      <span className="inline-flex items-center gap-1">
                        {tx.direction === "in" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                        {tx.direction === "in" ? "+" : "−"}{money(tx.amount)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
