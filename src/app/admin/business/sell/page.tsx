"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import {
  Empty, ErrorBox, Field, Loading, ProfitText, Section, inr, kgText, postBiz, todayStr, useBizData, useCanWrite,
} from "@/components/business/common";
import { Pencil, Plus, Trash2, X } from "lucide-react";

type SaleLine = { id: number; material: string; kg: number; rate: number; amount: number; cogs: number; profit: number };
type Sale = {
  id: number; sale_date: string; party_id: number; party_name: string; gst_percent: number; gst_amount: number; side_costs: number;
  notes: string; gross: number; total: number; received: number; due: number; profit: number; margin: number; total_kg: number;
  lines: SaleLine[];
};
type PartyRow = { id: number; name: string; kind: string };
type StockRes = { materials: Array<{ name: string; grp: string; kg: number; avgCost: number }> };
type PreviewLine = { materialName: string; ready: boolean; known: boolean; available: number; amount: number; cogs: number; profit: number; avgCost: number; short: boolean };
type Preview = { lines: PreviewLine[]; gross: number; gst: number; total: number; cogs: number; sideCosts: number; profit: number; margin: number; anyShort: boolean };

type FormLine = { materialName: string; kg: string; rate: string };
const emptyLine = (): FormLine => ({ materialName: "", kg: "", rate: "" });
const GST_CHOICES = [5, 12, 18];

export default function SellPage() {
  const canWrite = useCanWrite();
  const sales = useBizData<{ sales: Sale[] }>("/api/admin/business/sales");
  const parties = useBizData<{ parties: PartyRow[] }>("/api/admin/business/parties");
  const stock = useBizData<StockRes>("/api/admin/business/stock");

  const [editId, setEditId] = useState<number | null>(null);
  const [date, setDate] = useState(todayStr());
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<FormLine[]>([emptyLine()]);
  const [withGst, setWithGst] = useState(false);
  const [gstChoice, setGstChoice] = useState<string>("18");
  const [gstCustom, setGstCustom] = useState("");
  const [sideCosts, setSideCosts] = useState("");
  const [receivedNow, setReceivedNow] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [recvAmt, setRecvAmt] = useState<Record<number, string>>({});

  const gstPercent = !withGst ? 0 : gstChoice === "custom" ? Number(gstCustom) || 0 : Number(gstChoice);

  const previewKey = JSON.stringify({ lines, gstPercent, sideCosts, editId });
  useEffect(() => {
    if (!canWrite) return;
    const usable = lines.some((l) => l.materialName.trim() && Number(l.kg) > 0);
    if (!usable) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/admin/business/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            excludeSaleId: editId ?? undefined,
            gstPercent,
            sideCosts: Number(sideCosts) || 0,
            lines: lines.map((l) => ({ materialName: l.materialName, kg: Number(l.kg) || 0, rate: Number(l.rate) || 0 })),
          }),
        });
        const j = await r.json();
        if (!cancelled && r.ok) setPreview(j.result as Preview);
      } catch {
        /* preview is best-effort */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, canWrite]);

  const materialOptions = useMemo(() => stock.data?.materials || [], [stock.data]);

  function reset() {
    setEditId(null);
    setDate(todayStr());
    setCustomer("");
    setNotes("");
    setLines([emptyLine()]);
    setWithGst(false);
    setGstChoice("18");
    setGstCustom("");
    setSideCosts("");
    setReceivedNow("");
    setPreview(null);
  }

  function startEdit(s: Sale) {
    setEditId(s.id);
    setDate(s.sale_date);
    setCustomer(s.party_name);
    setNotes(s.notes || "");
    setLines(s.lines.map((l) => ({ materialName: l.material, kg: String(l.kg), rate: String(l.rate) })));
    const pct = Number(s.gst_percent) || 0;
    setWithGst(pct > 0);
    if (GST_CHOICES.includes(pct)) setGstChoice(String(pct));
    else if (pct > 0) {
      setGstChoice("custom");
      setGstCustom(String(pct));
    }
    setSideCosts(s.side_costs ? String(s.side_costs) : "");
    setReceivedNow("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setLine(i: number, patch: Partial<FormLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function save() {
    setSaving(true);
    const res = await postBiz(
      "/api/admin/business/sales",
      {
        action: editId ? "update" : "create",
        id: editId ?? undefined,
        date,
        partyName: customer,
        notes,
        gstPercent,
        sideCosts: Number(sideCosts) || 0,
        receivedNow: Number(receivedNow) || 0,
        lines: lines.map((l) => ({ materialName: l.materialName, kg: Number(l.kg) || 0, rate: Number(l.rate) || 0 })),
      },
      editId ? "Sale updated" : "Sale saved"
    );
    setSaving(false);
    if (res.ok) {
      reset();
      sales.reload();
      parties.reload();
      stock.reload();
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this sale? The stock goes back and the receipts are removed.")) return;
    const res = await postBiz("/api/admin/business/sales", { action: "delete", id }, "Sale deleted");
    if (res.ok) {
      if (editId === id) reset();
      sales.reload();
      stock.reload();
    }
  }

  async function receive(s: Sale) {
    const amount = Number(recvAmt[s.id] ?? s.due);
    const res = await postBiz("/api/admin/business/sales", { action: "receive", saleId: s.id, amount, date: todayStr() }, "Receipt saved");
    if (res.ok) {
      setRecvAmt((m) => ({ ...m, [s.id]: "" }));
      sales.reload();
    }
  }

  const customers = parties.data?.parties.filter((p) => p.kind !== "supplier") || [];
  const canSave = canWrite && customer.trim() && lines.every((l) => l.materialName.trim() && Number(l.kg) > 0) && !preview?.anyShort;
  const err = sales.error || parties.error;

  return (
    <AdminShell title="Sell" subtitle="See the real profit, based on what the stock actually cost, before you save.">
      {err ? <ErrorBox message={err} /> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {canWrite ? (
          <Section
            title={editId ? `Edit sale #${editId}` : "New sale"}
            actions={editId ? <button className="ad-btn ad-btn-ghost" onClick={reset}><X size={14} /> Cancel edit</button> : undefined}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date"><input type="date" className="ad-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Customer">
                <input className="ad-input" list="nv-customers" placeholder="Type or pick a customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
                <datalist id="nv-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </Field>
            </div>

            <div className="mt-4 space-y-3">
              {lines.map((l, i) => {
                const pl = preview?.lines[i];
                return (
                  <div key={i} className="rounded-xl border border-[var(--ad-border)] p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.6fr)_7rem_7rem]">
                      <Field label="Material" className="col-span-2 sm:col-span-1">
                        <select className="ad-input" value={l.materialName} onChange={(e) => setLine(i, { materialName: e.target.value })}>
                          <option value="">Choose material</option>
                          {materialOptions.map((m) => (
                            <option key={m.name} value={m.name}>{m.name} ({kgText(m.kg)} in stock)</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Weight (kg)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={l.kg} onChange={(e) => setLine(i, { kg: e.target.value })} /></Field>
                      <Field label="Rate (₹/kg)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></Field>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <span className={pl?.short ? "text-red-400" : "text-[var(--ad-muted)]"}>
                        {pl?.ready ? (
                          pl.short ? (
                            <>Only {kgText(pl.available)} in stock</>
                          ) : (
                            <>
                              Cost {inr(pl.cogs, 2)} ({inr(pl.avgCost, 2)}/kg), line profit <ProfitText value={pl.profit} />
                              {Number(l.rate) > 0 && pl.avgCost > Number(l.rate) ? <span className="ml-1 text-amber-400">Rate is below cost</span> : null}
                            </>
                          )
                        ) : (
                          "Pick a material and weight"
                        )}
                      </span>
                      {lines.length > 1 ? (
                        <button type="button" className="ad-icon-btn ad-icon-btn-danger" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus size={14} /> Add material
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--ad-border)] p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={withGst} onChange={(e) => setWithGst(e.target.checked)} />
                Sell with GST
              </label>
              {withGst ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {GST_CHOICES.map((g) => (
                    <button key={g} type="button" className={"ad-btn " + (gstChoice === String(g) ? "ad-btn-primary" : "ad-btn-ghost")} onClick={() => setGstChoice(String(g))}>{g}%</button>
                  ))}
                  <button type="button" className={"ad-btn " + (gstChoice === "custom" ? "ad-btn-primary" : "ad-btn-ghost")} onClick={() => setGstChoice("custom")}>Custom</button>
                  {gstChoice === "custom" ? (
                    <input type="number" min="0" step="any" className="ad-input !w-24" placeholder="%" value={gstCustom} onChange={(e) => setGstCustom(e.target.value)} />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Loading / freight you paid (₹)"><input type="number" inputMode="decimal" min="0" step="any" className="ad-input" value={sideCosts} onChange={(e) => setSideCosts(e.target.value)} /></Field>
              {!editId ? (
                <Field label="Received now (₹)">
                  <div className="flex gap-2">
                    <input type="number" inputMode="decimal" min="0" step="any" className="ad-input" placeholder="0 = on credit" value={receivedNow} onChange={(e) => setReceivedNow(e.target.value)} />
                    <button type="button" className="ad-btn ad-btn-ghost shrink-0" onClick={() => setReceivedNow(String(preview?.total ?? 0))}>Full</button>
                  </div>
                </Field>
              ) : null}
              <Field label="Notes"><input className="ad-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>

            <div className="mt-4 rounded-xl bg-[var(--ad-accent-dim)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ad-muted)]">Live profit</p>
              {preview && preview.gross > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <p>Sale <strong className="tabular-nums">{inr(preview.gross, 2)}</strong></p>
                  <p>GST <strong className="tabular-nums">{inr(preview.gst, 2)}</strong></p>
                  <p>Customer pays <strong className="tabular-nums">{inr(preview.total, 2)}</strong></p>
                  <p>Stock cost <strong className="tabular-nums">{inr(preview.cogs, 2)}</strong></p>
                  <p>Side costs <strong className="tabular-nums">{inr(preview.sideCosts, 2)}</strong></p>
                  <p>Real profit <ProfitText value={preview.profit} className="text-base" /> <span className="text-xs text-[var(--ad-muted)]">({preview.margin}%)</span></p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-[var(--ad-muted)]">Fill in material, weight and rate to see the profit.</p>
              )}
              <div className="mt-3 flex justify-end">
                <button type="button" className="ad-btn ad-btn-primary" disabled={!canSave || saving} onClick={save}>
                  {saving ? "Saving…" : editId ? "Update sale" : "Save sale"}
                </button>
              </div>
              {preview?.anyShort ? <p className="mt-2 text-xs text-red-400">Not enough stock for one of the lines.</p> : null}
            </div>
          </Section>
        ) : null}

        <Section title="Sales" subtitle="Profit is fixed at the time of sale, using the cost of the stock sold.">
          {!sales.data ? <Loading /> : sales.data.sales.length === 0 ? (
            <Empty>No sales yet.</Empty>
          ) : (
            <div className="ad-table-wrap">
              <table className="ad-table compact">
                <thead>
                  <tr><th>Date</th><th>Customer</th><th className="text-right">Total</th><th className="text-right">Profit</th><th /></tr>
                </thead>
                <tbody>
                  {sales.data.sales.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="cursor-pointer" onClick={() => setOpen(open === s.id ? null : s.id)}>
                        <td>{s.sale_date}</td>
                        <td>
                          {s.party_name}
                          <span className="block text-[11px] text-[var(--ad-muted)]">
                            {kgText(s.total_kg)}{s.gst_percent > 0 ? `, GST ${s.gst_percent}%` : ""}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">
                          {inr(s.total, 2)}
                          {s.due > 0.004 ? <span className="ad-status-unpaid ml-1">{inr(s.due)} due</span> : null}
                        </td>
                        <td className="text-right"><ProfitText value={s.profit} /></td>
                        <td>
                          {canWrite ? (
                            <div className="ad-row-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="ad-icon-btn" aria-label="Edit" onClick={() => startEdit(s)}><Pencil size={14} /></button>
                              <button className="ad-icon-btn ad-icon-btn-danger" aria-label="Delete" onClick={() => remove(s.id)}><Trash2 size={14} /></button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                      {open === s.id ? (
                        <tr>
                          <td colSpan={5} className="bg-[var(--ad-input)]">
                            <table className="w-full text-xs">
                              <tbody>
                                {s.lines.map((l) => (
                                  <tr key={l.id}>
                                    <td className="py-1">{l.material}</td>
                                    <td className="py-1 text-right tabular-nums">{kgText(l.kg)} x {inr(l.rate, 2)}</td>
                                    <td className="py-1 text-right tabular-nums">cost {inr(l.cogs, 2)}</td>
                                    <td className="py-1 text-right"><ProfitText value={l.profit} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mt-2 text-xs text-[var(--ad-muted)]">
                              Sale {inr(s.gross, 2)} + GST {inr(s.gst_amount, 2)}. Side costs {inr(s.side_costs, 2)}. Margin {s.margin}%. Received {inr(s.received, 2)}.
                            </p>
                            {canWrite && s.due > 0.004 ? (
                              <div className="mt-2 flex items-center gap-2">
                                <input type="number" min="0" step="any" className="ad-input !w-32" value={recvAmt[s.id] ?? String(s.due)} onChange={(e) => setRecvAmt((m) => ({ ...m, [s.id]: e.target.value }))} />
                                <button className="ad-btn ad-btn-primary" onClick={() => receive(s)}>Receive</button>
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
