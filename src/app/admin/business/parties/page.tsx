"use client";

import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Empty, ErrorBox, Field, Loading, Section, inr, postBiz, todayStr, useBizData, useCanWrite } from "@/components/business/common";
import { Pencil, Trash2, X } from "lucide-react";

type Party = { id: number; name: string; phone: string; kind: string; notes: string; payable: number; receivable: number; bought: number; sold: number };

export default function PartiesPage() {
  const canWrite = useCanWrite();
  const { data, error, reload } = useBizData<{ parties: Party[] }>("/api/admin/business/parties");
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState("both");
  const [notes, setNotes] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");

  function reset() {
    setEditId(null);
    setName("");
    setPhone("");
    setKind("both");
    setNotes("");
  }

  async function save() {
    const res = await postBiz("/api/admin/business/parties", { action: "save", id: editId ?? undefined, name, phone, kind, notes }, "Party saved");
    if (res.ok) {
      reset();
      reload();
    }
  }

  async function remove(p: Party) {
    if (!confirm(`Delete ${p.name}?`)) return;
    const res = await postBiz("/api/admin/business/parties", { action: "delete", id: p.id }, "Party deleted");
    if (res.ok) reload();
  }

  async function settle(p: Party, action: "pay" | "receive") {
    const key = `${action}-${p.id}`;
    const due = action === "pay" ? p.payable : p.receivable;
    const amount = Number(amounts[key] ?? due);
    const res = await postBiz("/api/admin/business/parties", { action, partyId: p.id, amount, date: todayStr() }, action === "pay" ? "Payment saved" : "Receipt saved");
    if (res.ok) {
      setAmounts((m) => ({ ...m, [key]: "" }));
      reload();
    }
  }

  const rows = (data?.parties || []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <AdminShell title="Parties" subtitle="Suppliers and customers in one list. Parties are created automatically when you buy or sell.">
      {error ? <ErrorBox message={error} /> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section title="Directory">
          <input className="ad-input mb-3" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          {!data ? <Loading /> : rows.length === 0 ? (
            <Empty>{data.parties.length === 0 ? "No parties yet. They appear when you record a purchase or sale." : "No match."}</Empty>
          ) : (
            <div className="space-y-3">
              {rows.map((p) => (
                <div key={p.id} className="rounded-xl border border-[var(--ad-border)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-[var(--ad-muted)]">
                        {p.kind === "both" ? "Supplier and customer" : p.kind === "supplier" ? "Supplier" : "Customer"}
                        {p.phone ? `, ${p.phone}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ad-muted)]">Bought from: {inr(p.bought)}, sold to: {inr(p.sold)}</p>
                    </div>
                    {canWrite ? (
                      <div className="ad-row-actions">
                        <button className="ad-icon-btn" aria-label="Edit" onClick={() => { setEditId(p.id); setName(p.name); setPhone(p.phone); setKind(p.kind); setNotes(p.notes); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Pencil size={14} /></button>
                        <button className="ad-icon-btn ad-icon-btn-danger" aria-label="Delete" onClick={() => remove(p)}><Trash2 size={14} /></button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {p.payable > 0.004 ? (
                      <div className="flex items-center gap-2">
                        <span className="ad-status-unpaid">You owe {inr(p.payable, 2)}</span>
                        {canWrite ? (
                          <>
                            <input type="number" min="0" step="any" className="ad-input !w-28" value={amounts[`pay-${p.id}`] ?? String(p.payable)} onChange={(e) => setAmounts((m) => ({ ...m, [`pay-${p.id}`]: e.target.value }))} />
                            <button className="ad-btn ad-btn-primary" onClick={() => settle(p, "pay")}>Pay all due</button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {p.receivable > 0.004 ? (
                      <div className="flex items-center gap-2">
                        <span className="ad-status-unpaid">Owes you {inr(p.receivable, 2)}</span>
                        {canWrite ? (
                          <>
                            <input type="number" min="0" step="any" className="ad-input !w-28" value={amounts[`receive-${p.id}`] ?? String(p.receivable)} onChange={(e) => setAmounts((m) => ({ ...m, [`receive-${p.id}`]: e.target.value }))} />
                            <button className="ad-btn ad-btn-primary" onClick={() => settle(p, "receive")}>Receive</button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {p.payable <= 0.004 && p.receivable <= 0.004 ? <span className="ad-status-paid">SETTLED</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {canWrite ? (
          <Section title={editId ? "Edit party" : "Add party"} actions={editId ? <button className="ad-btn ad-btn-ghost" onClick={reset}><X size={14} /> Cancel</button> : undefined}>
            <div className="space-y-3">
              <Field label="Name"><input className="ad-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Phone"><input className="ad-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <Field label="Type">
                <select className="ad-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="both">Supplier and customer</option>
                  <option value="supplier">Supplier</option>
                  <option value="customer">Customer</option>
                </select>
              </Field>
              <Field label="Notes"><input className="ad-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <button className="ad-btn ad-btn-primary w-full" disabled={!name.trim()} onClick={save}>{editId ? "Update party" : "Add party"}</button>
            </div>
          </Section>
        ) : null}
      </div>
    </AdminShell>
  );
}
