"use client";

import { Fragment, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import {
  Empty, ErrorBox, Field, Loading, Section, inr, kgText, postBiz, todayStr, useBizData, useCanWrite,
} from "@/components/business/common";
import { allocateByKg } from "@/lib/business/math";
import { Pencil, Plus, Trash2, X } from "lucide-react";

type Line = { id?: number; material: string; grp: string; kg: number; rate: number; line_cost: number; alloc_charges: number; landed_per_kg: number };
type Purchase = {
  id: number; purchase_date: string; party_id: number; party_name: string; transport: number; loading: number;
  other_charges: number; notes: string; total: number; total_kg: number; paid: number; due: number;
  lines: Line[]; payments: Array<{ id: number; entry_date: string; amount: number }>;
};
type PartyRow = { id: number; name: string; kind: string };
type StockRes = { materials: Array<{ name: string; grp: string }> };

type FormLine = { materialName: string; group: string; kg: string; rate: string };
const emptyLine = (): FormLine => ({ materialName: "", group: "PLASTIC", kg: "", rate: "" });

export default function BuyPage() {
  const canWrite = useCanWrite();
  const purchases = useBizData<{ purchases: Purchase[] }>("/api/admin/business/purchases");
  const parties = useBizData<{ parties: PartyRow[] }>("/api/admin/business/parties");
  const stock = useBizData<StockRes>("/api/admin/business/stock");

  const [editId, setEditId] = useState<number | null>(null);
  const [date, setDate] = useState(todayStr());
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<FormLine[]>([emptyLine()]);
  const [transport, setTransport] = useState("");
  const [loading, setLoading] = useState("");
  const [other, setOther] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [payAmt, setPayAmt] = useState<Record<number, string>>({});

  const knownGroups = useMemo(() => {
    const m = new Map<string, string>();
    stock.data?.materials.forEach((x) => m.set(x.name.toLowerCase(), x.grp));
    return m;
  }, [stock.data]);

  const calc = useMemo(() => {
    const kgs = lines.map((l) => Number(l.kg) || 0);
    const charges = (Number(transport) || 0) + (Number(loading) || 0) + (Number(other) || 0);
    const alloc = allocateByKg(charges, kgs);
    const rows = lines.map((l, i) => {
      const kg = kgs[i];
      const cost = Math.round(kg * (Number(l.rate) || 0) * 100) / 100;
      return { cost, alloc: alloc[i], landed: kg > 0 ? (cost + alloc[i]) / kg : 0 };
    });
    const materialTotal = rows.reduce((a, r) => a + r.cost, 0);
    return { rows, charges, materialTotal, total: materialTotal + charges, totalKg: kgs.reduce((a, b) => a + b, 0) };
  }, [lines, transport, loading, other]);

  function reset() {
    setEditId(null);
    setDate(todayStr());
    setSupplier("");
    setNotes("");
    setLines([emptyLine()]);
    setTransport("");
    setLoading("");
    setOther("");
    setPaidNow("");
  }

  function startEdit(p: Purchase) {
    setEditId(p.id);
    setDate(p.purchase_date);
    setSupplier(p.party_name);
    setNotes(p.notes || "");
    setTransport(p.transport ? String(p.transport) : "");
    setLoading(p.loading ? String(p.loading) : "");
    setOther(p.other_charges ? String(p.other_charges) : "");
    setLines(p.lines.map((l) => ({ materialName: l.material, group: l.grp, kg: String(l.kg), rate: String(l.rate) })));
    setPaidNow("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setLine(i: number, patch: Partial<FormLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function onMaterialChange(i: number, value: string) {
    const grp = knownGroups.get(value.trim().toLowerCase());
    setLine(i, grp ? { materialName: value, group: grp } : { materialName: value });
  }

  async function save() {
    setSaving(true);
    const body = {
      action: editId ? "update" : "create",
      id: editId ?? undefined,
      date,
      partyName: supplier,
      notes,
      transport: Number(transport) || 0,
      loading: Number(loading) || 0,
      otherCharges: Number(other) || 0,
      paidNow: Number(paidNow) || 0,
      lines: lines.map((l) => ({ materialName: l.materialName, group: l.group, kg: Number(l.kg) || 0, rate: Number(l.rate) || 0 })),
    };
    const res = await postBiz("/api/admin/business/purchases", body, editId ? "Purchase updated" : "Purchase saved");
    setSaving(false);
    if (res.ok) {
      reset();
      purchases.reload();
      parties.reload();
      stock.reload();
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this purchase and its payments? Stock from it is removed too.")) return;
    const res = await postBiz("/api/admin/business/purchases", { action: "delete", id }, "Purchase deleted");
    if (res.ok) {
      if (editId === id) reset();
      purchases.reload();
      stock.reload();
    }
  }

  async function pay(p: Purchase) {
    const amount = Number(payAmt[p.id] ?? p.due);
    const res = await postBiz("/api/admin/business/purchases", { action: "pay", purchaseId: p.id, amount, date: todayStr() }, "Payment saved");
    if (res.ok) {
      setPayAmt((m) => ({ ...m, [p.id]: "" }));
      purchases.reload();
    }
  }

  const err = purchases.error || parties.error;
  const suppliers = parties.data?.parties.filter((p) => p.kind !== "customer") || [];
  const canSave = canWrite && supplier.trim() && calc.totalKg > 0 && lines.every((l) => l.materialName.trim() && Number(l.kg) > 0);

  return (
    <AdminShell title="Buy" subtitle="One trip, one entry. Transport and loading are shared across all materials by weight.">
      {err ? <ErrorBox message={err} /> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {canWrite ? (
          <Section
            title={editId ? `Edit purchase #${editId}` : "New purchase"}
            actions={editId ? <button className="ad-btn ad-btn-ghost" onClick={reset}><X size={14} /> Cancel edit</button> : undefined}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date"><input type="date" className="ad-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Supplier">
                <input className="ad-input" list="nv-suppliers" placeholder="Type or pick a supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                <datalist id="nv-suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
              </Field>
            </div>

            <datalist id="nv-materials">{stock.data?.materials.map((m) => <option key={m.name} value={m.name} />)}</datalist>
            <div className="mt-4 space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-[var(--ad-border)] p-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.6fr)_7rem_6rem_6rem]">
                    <Field label="Material" className="col-span-2 sm:col-span-1">
                      <input className="ad-input" list="nv-materials" placeholder="e.g. Safed PPDD" value={l.materialName} onChange={(e) => onMaterialChange(i, e.target.value)} />
                    </Field>
                    <Field label="Group">
                      <select className="ad-input" value={l.group} onChange={(e) => setLine(i, { group: e.target.value })} disabled={knownGroups.has(l.materialName.trim().toLowerCase())}>
                        <option value="PLASTIC">Plastic</option>
                        <option value="PET">PET</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </Field>
                    <Field label="Weight (kg)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={l.kg} onChange={(e) => setLine(i, { kg: e.target.value })} /></Field>
                    <Field label="Rate (₹/kg)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></Field>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-[var(--ad-muted)]">
                    <span>
                      Material {inr(calc.rows[i].cost, 2)}
                      {calc.rows[i].alloc > 0 ? ` + share of charges ${inr(calc.rows[i].alloc, 2)}` : ""}
                      {calc.rows[i].landed > 0 ? <> = <strong className="text-[var(--ad-text)]">{inr(calc.rows[i].landed, 2)}/kg landed</strong></> : null}
                    </span>
                    {lines.length > 1 ? (
                      <button type="button" className="ad-icon-btn ad-icon-btn-danger" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus size={14} /> Add material
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <Field label="Transport (₹)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={transport} onChange={(e) => setTransport(e.target.value)} /></Field>
              <Field label="Loading / labour (₹)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={loading} onChange={(e) => setLoading(e.target.value)} /></Field>
              <Field label="Other (₹)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={other} onChange={(e) => setOther(e.target.value)} /></Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {!editId ? (
                <Field label="Paid now (₹)">
                  <div className="flex gap-2">
                    <input type="number" inputMode="decimal" min="0" step="any" className="ad-input" placeholder="0 = all on credit" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} />
                    <button type="button" className="ad-btn ad-btn-ghost shrink-0" onClick={() => setPaidNow(String(calc.total))}>Full</button>
                  </div>
                </Field>
              ) : null}
              <Field label="Notes"><input className="ad-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--ad-accent-dim)] px-4 py-3">
              <div className="text-sm">
                <p className="text-[var(--ad-muted)]">{kgText(calc.totalKg)} in total</p>
                <p className="text-lg font-bold tabular-nums">{inr(calc.total, 2)}</p>
                {!editId && Number(paidNow) > 0 ? <p className="text-xs text-[var(--ad-muted)]">Credit left: {inr(Math.max(0, calc.total - Number(paidNow)), 2)}</p> : null}
              </div>
              <button type="button" className="ad-btn ad-btn-primary" disabled={!canSave || saving} onClick={save}>
                {saving ? "Saving…" : editId ? "Update purchase" : "Save purchase"}
              </button>
            </div>
          </Section>
        ) : null}

        <Section title="Purchases" subtitle="Each trip is one entry. Pay what is due in one action.">
          {!purchases.data ? <Loading /> : purchases.data.purchases.length === 0 ? (
            <Empty>No purchases yet.</Empty>
          ) : (
            <div className="ad-table-wrap">
              <table className="ad-table compact">
                <thead>
                  <tr><th>Date</th><th>Supplier</th><th className="text-right">Total</th><th className="text-right">Due</th><th /></tr>
                </thead>
                <tbody>
                  {purchases.data.purchases.map((p) => (
                    <Fragment key={p.id}>
                      <tr className="cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                        <td>{p.purchase_date}</td>
                        <td>
                          {p.party_name}
                          <span className="block text-[11px] text-[var(--ad-muted)]">{p.lines.length} material{p.lines.length > 1 ? "s" : ""}, {kgText(p.total_kg)}</span>
                        </td>
                        <td className="text-right tabular-nums">{inr(p.total, 2)}</td>
                        <td className="text-right">{p.due > 0.004 ? <span className="ad-status-unpaid">{inr(p.due, 2)}</span> : <span className="ad-status-paid">PAID</span>}</td>
                        <td>
                          {canWrite ? (
                            <div className="ad-row-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="ad-icon-btn" aria-label="Edit" onClick={() => startEdit(p)}><Pencil size={14} /></button>
                              <button className="ad-icon-btn ad-icon-btn-danger" aria-label="Delete" onClick={() => remove(p.id)}><Trash2 size={14} /></button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                      {open === p.id ? (
                        <tr>
                          <td colSpan={5} className="bg-[var(--ad-input)]">
                            <table className="w-full text-xs">
                              <tbody>
                                {p.lines.map((l) => (
                                  <tr key={l.id}>
                                    <td className="py-1">{l.material}</td>
                                    <td className="py-1 text-right tabular-nums">{kgText(l.kg)} x {inr(l.rate, 2)}</td>
                                    <td className="py-1 text-right tabular-nums">landed {inr(l.landed_per_kg, 2)}/kg</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mt-2 text-xs text-[var(--ad-muted)]">
                              Transport {inr(p.transport)}, loading {inr(p.loading)}, other {inr(p.other_charges)}. Paid {inr(p.paid, 2)}.
                            </p>
                            {canWrite && p.due > 0.004 ? (
                              <div className="mt-2 flex items-center gap-2">
                                <input type="number" min="0" step="any" className="ad-input !w-32" value={payAmt[p.id] ?? String(p.due)} onChange={(e) => setPayAmt((m) => ({ ...m, [p.id]: e.target.value }))} />
                                <button className="ad-btn ad-btn-primary" onClick={() => pay(p)}>Pay</button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </AdminShell>
  );
}
