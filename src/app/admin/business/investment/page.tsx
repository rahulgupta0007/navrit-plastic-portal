"use client";

import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Empty, ErrorBox, Field, Loading, Section, Stat, inr, postBiz, todayStr, useBizData, useCanWrite } from "@/components/business/common";
import { ACCOUNT_PERSONS } from "@/lib/account-persons";
import { Trash2 } from "lucide-react";

type Inv = { id: number; inv_date: string; investor: string; amount: number; kind: string; note: string };
type Summary = { capital: { equity: number; loans: number; drawings: number; net: number; investors: Array<{ investor: string; equity: number; loan: number; drawing: number }> } };

const KIND_LABEL: Record<string, string> = { equity: "Capital", loan: "Loan", drawing: "Withdrawal" };

export default function InvestmentPage() {
  const canWrite = useCanWrite();
  const list = useBizData<{ investments: Inv[] }>("/api/admin/business/investments");
  const summary = useBizData<Summary>("/api/admin/business/summary");
  const [date, setDate] = useState(todayStr());
  const [investor, setInvestor] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("equity");
  const [note, setNote] = useState("");

  async function add() {
    const res = await postBiz("/api/admin/business/investments", { action: "add", date, investor, amount: Number(amount), kind, note }, "Saved");
    if (res.ok) {
      setInvestor("");
      setAmount("");
      setNote("");
      list.reload();
      summary.reload();
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this entry? The cash book is adjusted.")) return;
    const res = await postBiz("/api/admin/business/investments", { action: "delete", id }, "Deleted");
    if (res.ok) {
      list.reload();
      summary.reload();
    }
  }

  const cap = summary.data?.capital;

  return (
    <AdminShell title="Investment" subtitle="Money that came into the business or went back to owners. This is never counted as profit.">
      {list.error ? <ErrorBox message={list.error} /> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {cap ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Capital put in" value={inr(cap.equity)} />
              <Stat label="Withdrawn" value={inr(cap.drawings)} />
              <Stat label="Net capital" value={inr(cap.net)} tone="good" />
              <Stat label="Loans taken" value={inr(cap.loans)} hint="Has to be repaid" />
            </div>
          ) : null}

          {cap && cap.investors.length > 0 ? (
            <Section title="By investor">
              <div className="ad-table-wrap">
                <table className="ad-table compact">
                  <thead><tr><th>Investor</th><th className="text-right">Capital</th><th className="text-right">Loan</th><th className="text-right">Withdrawn</th></tr></thead>
                  <tbody>
                    {cap.investors.map((i) => (
                      <tr key={i.investor}>
                        <td className="font-medium">{i.investor}</td>
                        <td className="text-right tabular-nums">{inr(i.equity)}</td>
                        <td className="text-right tabular-nums">{inr(i.loan)}</td>
                        <td className="text-right tabular-nums">{inr(i.drawing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          <Section title="Timeline">
            {!list.data ? <Loading /> : list.data.investments.length === 0 ? (
              <Empty>No investment recorded yet. Add the first one to start the cash book.</Empty>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table compact">
                  <thead><tr><th>Date</th><th>Investor</th><th>Type</th><th className="text-right">Amount</th><th /></tr></thead>
                  <tbody>
                    {list.data.investments.map((i) => (
                      <tr key={i.id}>
                        <td>{i.inv_date}</td>
                        <td>{i.investor}{i.note ? <span className="block text-[11px] text-[var(--ad-muted)]">{i.note}</span> : null}</td>
                        <td>{KIND_LABEL[i.kind] || i.kind}</td>
                        <td className={"text-right tabular-nums " + (i.kind === "drawing" ? "text-red-400" : "")}>{i.kind === "drawing" ? "-" : ""}{inr(i.amount, 2)}</td>
                        <td>{canWrite ? <button className="ad-icon-btn ad-icon-btn-danger" aria-label="Delete" onClick={() => remove(i.id)}><Trash2 size={14} /></button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        {canWrite ? (
          <Section title="Add entry">
            <div className="space-y-3">
              <Field label="Date"><input type="date" className="ad-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Investor">
                <input className="ad-input" list="nv-investors" value={investor} onChange={(e) => setInvestor(e.target.value)} />
                <datalist id="nv-investors">{ACCOUNT_PERSONS.map((p) => <option key={p} value={p} />)}</datalist>
              </Field>
              <Field label="Type">
                <select className="ad-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="equity">Capital (owner money in)</option>
                  <option value="loan">Loan (to be repaid)</option>
                  <option value="drawing">Withdrawal (money taken out)</option>
                </select>
              </Field>
              <Field label="Amount (₹)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Note"><input className="ad-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <button className="ad-btn ad-btn-primary w-full" disabled={!investor.trim() || !(Number(amount) > 0)} onClick={add}>Save entry</button>
            </div>
          </Section>
        ) : null}
      </div>
    </AdminShell>
  );
}
