"use client";

import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Empty, ErrorBox, Field, Loading, ProfitText, Section, Stat, inr, kgText, postBiz, todayStr, useBizData, useCanWrite } from "@/components/business/common";
import { Trash2 } from "lucide-react";

type Period = { gross: number; cogs: number; sideCosts: number; salesProfit: number; expenses: number; profit: number };
type Summary = {
  capital: { equity: number; loans: number; drawings: number; net: number };
  cash: number;
  stock: { totalKg: number; totalValue: number };
  receivables: number;
  payables: number;
  gst: { collected: number; paid: number; payable: number };
  profit: { today: Period; month: Period; allTime: Period };
  check: { assets: number; liabilities: number; ownerFunds: number; difference: number; balanced: boolean };
  months: Array<{ month: string; sales: number; salesProfit: number; expenses: number; profit: number }>;
  byGroup: Array<{ group: string; sales: number; profit: number; kg: number }>;
};
type Ledger = { id: number; entry_date: string; kind: string; direction: "in" | "out"; amount: number; description: string; party_name: string | null; balance: number };
type Expense = { id: number; exp_date: string; category: string; amount: number; note: string };

const KIND_LABEL: Record<string, string> = {
  equity: "Capital in", loan: "Loan in", drawing: "Withdrawal", purchase_payment: "Supplier payment",
  sale_receipt: "Customer receipt", expense: "Expense", sale_cost: "Sale loading/freight",
};
const GROUP_LABEL: Record<string, string> = { PET: "PET", PLASTIC: "Plastic", OTHER: "Other" };

export default function BusinessAccountsPage() {
  const canWrite = useCanWrite();
  const summary = useBizData<Summary>("/api/admin/business/summary");
  const ledger = useBizData<{ entries: Ledger[] }>("/api/admin/business/ledger");
  const expenses = useBizData<{ expenses: Expense[]; categories: string[] }>("/api/admin/business/expenses");
  const [date, setDate] = useState(todayStr());
  const [category, setCategory] = useState("Labour");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function reloadAll() {
    summary.reload();
    ledger.reload();
    expenses.reload();
  }

  async function addExpense() {
    const res = await postBiz("/api/admin/business/expenses", { action: "add", date, category, amount: Number(amount), note }, "Expense saved");
    if (res.ok) {
      setAmount("");
      setNote("");
      reloadAll();
    }
  }

  async function removeExpense(id: number) {
    if (!confirm("Delete this expense?")) return;
    const res = await postBiz("/api/admin/business/expenses", { action: "delete", id }, "Expense deleted");
    if (res.ok) reloadAll();
  }

  async function removeSettlement(id: number) {
    if (!confirm("Remove this payment/receipt? The amount becomes due again.")) return;
    const res = await postBiz("/api/admin/business/ledger", { action: "removeSettlement", id }, "Entry removed");
    if (res.ok) reloadAll();
  }

  const s = summary.data;

  return (
    <AdminShell title="Accounts" subtitle="Investment, cash, stock and real profit, kept separate so they never get mixed up.">
      {summary.error ? <ErrorBox message={summary.error} /> : null}
      {!s && !summary.error ? <Loading /> : null}
      {s ? (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="ad-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ad-accent)]">1. Capital invested</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{inr(s.capital.net)}</p>
              <p className="mt-1 text-xs text-[var(--ad-muted)]">Put in {inr(s.capital.equity)}, withdrawn {inr(s.capital.drawings)}. Loans {inr(s.capital.loans)}.</p>
            </div>
            <div className="ad-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ad-accent)]">2. Cash and dues</p>
              <p className={"mt-1 text-2xl font-bold tabular-nums " + (s.cash < 0 ? "text-red-400" : "")}>{inr(s.cash)}</p>
              <p className="mt-1 text-xs text-[var(--ad-muted)]">Customers owe {inr(s.receivables)}. You owe suppliers {inr(s.payables)}.</p>
            </div>
            <div className="ad-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ad-accent)]">3. Stock value</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{inr(s.stock.totalValue)}</p>
              <p className="mt-1 text-xs text-[var(--ad-muted)]">{kgText(s.stock.totalKg)} at landed cost.</p>
            </div>
            <div className="ad-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ad-accent)]">4. Real profit</p>
              <p className="mt-1 text-2xl font-bold"><ProfitText value={s.profit.allTime.profit} className="text-2xl" /></p>
              <p className="mt-1 text-xs text-[var(--ad-muted)]">Sales profit {inr(s.profit.allTime.salesProfit)} minus expenses {inr(s.profit.allTime.expenses)}.</p>
            </div>
          </div>

          <Section title="Does it add up?" subtitle="Cash + stock + dues should equal what you owe + what the owners have in the business.">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <p>You have <strong className="tabular-nums">{inr(s.check.assets, 2)}</strong><span className="block text-xs text-[var(--ad-muted)]">cash + stock + customer dues</span></p>
              <p>You owe <strong className="tabular-nums">{inr(s.check.liabilities, 2)}</strong><span className="block text-xs text-[var(--ad-muted)]">suppliers + loans + GST to deposit</span></p>
              <p>Owners have <strong className="tabular-nums">{inr(s.check.ownerFunds, 2)}</strong><span className="block text-xs text-[var(--ad-muted)]">capital - withdrawn + profit</span></p>
            </div>
            <p className={"mt-3 text-sm font-semibold " + (s.check.balanced ? "text-emerald-400" : "text-red-400")}>
              {s.check.balanced ? "Books balance." : `Out of balance by ${inr(s.check.difference, 2)}.`}
            </p>
          </Section>

          <Section title="Profit by period">
            <div className="ad-table-wrap">
              <table className="ad-table compact">
                <thead><tr><th>Period</th><th className="text-right">Sales</th><th className="text-right">Stock cost</th><th className="text-right">Sales profit</th><th className="text-right">Expenses</th><th className="text-right">Real profit</th></tr></thead>
                <tbody>
                  {([["Today", s.profit.today], ["This month", s.profit.month], ["All time", s.profit.allTime]] as const).map(([label, p]) => (
                    <tr key={label}>
                      <td className="font-medium">{label}</td>
                      <td className="text-right tabular-nums">{inr(p.gross)}</td>
                      <td className="text-right tabular-nums">{inr(p.cogs)}</td>
                      <td className="text-right tabular-nums">{inr(p.salesProfit)}</td>
                      <td className="text-right tabular-nums">{inr(p.expenses)}</td>
                      <td className="text-right"><ProfitText value={p.profit} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--ad-muted)]">Last months</p>
                {s.months.length === 0 ? <Empty>No sales yet.</Empty> : (
                  <div className="ad-table-wrap">
                    <table className="ad-table compact">
                      <thead><tr><th>Month</th><th className="text-right">Sales</th><th className="text-right">Profit</th></tr></thead>
                      <tbody>{s.months.map((m) => (
                        <tr key={m.month}><td>{m.month}</td><td className="text-right tabular-nums">{inr(m.sales)}</td><td className="text-right"><ProfitText value={m.profit} /></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--ad-muted)]">By material group</p>
                {s.byGroup.length === 0 ? <Empty>No sales yet.</Empty> : (
                  <div className="ad-table-wrap">
                    <table className="ad-table compact">
                      <thead><tr><th>Group</th><th className="text-right">Sold</th><th className="text-right">Sales</th><th className="text-right">Profit</th></tr></thead>
                      <tbody>{s.byGroup.map((g) => (
                        <tr key={g.group}><td>{GROUP_LABEL[g.group] || g.group}</td><td className="text-right tabular-nums">{kgText(g.kg)}</td><td className="text-right tabular-nums">{inr(g.sales)}</td><td className="text-right"><ProfitText value={g.profit} /></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </Section>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="GST collected" value={inr(s.gst.collected)} />
            <Stat label="GST deposited" value={inr(s.gst.paid)} hint={'Record as expense type "GST payment"'} />
            <Stat label="GST still to deposit" value={inr(s.gst.payable)} tone={s.gst.payable > 0 ? "bad" : "neutral"} hint="Not counted as profit" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Section title="Expenses" subtitle="Running costs that reduce profit (labour, rent, fuel...).">
              {!expenses.data ? <Loading /> : expenses.data.expenses.length === 0 ? <Empty>No expenses yet.</Empty> : (
                <div className="ad-table-wrap">
                  <table className="ad-table compact">
                    <thead><tr><th>Date</th><th>Type</th><th className="text-right">Amount</th><th /></tr></thead>
                    <tbody>{expenses.data.expenses.map((e) => (
                      <tr key={e.id}>
                        <td>{e.exp_date}</td>
                        <td>{e.category}{e.note ? <span className="block text-[11px] text-[var(--ad-muted)]">{e.note}</span> : null}</td>
                        <td className="text-right tabular-nums">{inr(e.amount, 2)}</td>
                        <td>{canWrite ? <button className="ad-icon-btn ad-icon-btn-danger" aria-label="Delete" onClick={() => removeExpense(e.id)}><Trash2 size={14} /></button> : null}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Section>
            {canWrite ? (
              <Section title="Add expense">
                <div className="space-y-3">
                  <Field label="Date"><input type="date" className="ad-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                  <Field label="Type">
                    <select className="ad-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                      {(expenses.data?.categories || ["Labour", "Other"]).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Amount (₹)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                  <Field label="Note"><input className="ad-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  <button className="ad-btn ad-btn-primary w-full" disabled={!(Number(amount) > 0)} onClick={addExpense}>Save expense</button>
                </div>
              </Section>
            ) : null}
          </div>

          <Section title="Cash book" subtitle="Every rupee in or out, with the balance after each entry.">
            {!ledger.data ? <Loading /> : ledger.data.entries.length === 0 ? <Empty>No cash movement yet.</Empty> : (
              <div className="ad-table-wrap">
                <table className="ad-table compact">
                  <thead><tr><th>Date</th><th>What</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th><th /></tr></thead>
                  <tbody>{ledger.data.entries.map((l) => (
                    <tr key={l.id}>
                      <td>{l.entry_date}</td>
                      <td>{KIND_LABEL[l.kind] || l.kind}<span className="block text-[11px] text-[var(--ad-muted)]">{l.party_name ? l.party_name + ", " : ""}{l.description}</span></td>
                      <td className="text-right tabular-nums text-emerald-400">{l.direction === "in" ? inr(l.amount, 2) : ""}</td>
                      <td className="text-right tabular-nums text-red-400">{l.direction === "out" ? inr(l.amount, 2) : ""}</td>
                      <td className="text-right tabular-nums">{inr(l.balance, 2)}</td>
                      <td>{canWrite && (l.kind === "purchase_payment" || l.kind === "sale_receipt") ? <button className="ad-icon-btn ad-icon-btn-danger" aria-label="Remove" onClick={() => removeSettlement(l.id)}><Trash2 size={14} /></button> : null}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </AdminShell>
  );
}
