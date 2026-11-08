/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useMemo, useState } from "react";
import { PersonSelect } from "@/components/person-select";

type Mode = "PET" | "PLASTIC";

const money = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

export default function BuyerManagement({
  data,
  mode,
  post,
}: {
  data: any;
  mode: Mode;
  post: (action: string, body: any) => Promise<boolean>;
}) {
  const buyers = useMemo(() => ((data?.buyerSummary || []) as any[]).filter((b) => b.mode === mode), [data?.buyerSummary, mode]);
  const advances = useMemo(() => ((data?.buyerAdvances || []) as any[]).filter((a) => a.mode === mode), [data?.buyerAdvances, mode]);
  const sales = useMemo(() => ((data?.sales || []) as any[]).filter((s) => s.mode === mode), [data?.sales, mode]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newBuyer, setNewBuyer] = useState({ name: "", phone: "", location: "", notes: "" });
  const [form, setForm] = useState({ buyerName: "", amount: "", advanceDate: today(), receivedBy: "", paymentMode: "Cash", notes: "" });
  const [busy, setBusy] = useState(false);

  const key = (name: string) => String(name || "").trim().toLowerCase();
  const filtered = buyers.filter((b) => !search.trim() || key(b.name).includes(key(search)));
  const totals = buyers.reduce(
    (a, b) => ({
      sales: a.sales + Number(b.totalSales || 0),
      pending: a.pending + Number(b.pendingCredit || 0),
      advance: a.advance + Number(b.advanceBalance || 0),
    }),
    { sales: 0, pending: 0, advance: 0 }
  );
  const buyer = buyers.find((b) => key(b.name) === selected);
  const buyerAdvances = buyer ? advances.filter((a) => key(a.buyer_name) === selected) : [];
  const buyerSales = buyer ? sales.filter((s) => key(s.customer_name) === selected) : [];

  async function addBuyer() {
    if (!newBuyer.name.trim()) return;
    setBusy(true);
    const ok = await post("addBuyer", {
      mode,
      name: newBuyer.name.trim(),
      phone: newBuyer.phone,
      location: newBuyer.location,
      notes: newBuyer.notes,
    });
    setBusy(false);
    if (ok) {
      setNewBuyer({ name: "", phone: "", location: "", notes: "" });
      setShowAdd(false);
    }
  }

  async function giveAdvance(name?: string) {
    const buyerName = (name ?? form.buyerName).trim();
    if (!buyerName || !(Number(form.amount) > 0) || !form.receivedBy) return;
    setBusy(true);
    const ok = await post("addBuyerAdvance", {
      mode,
      buyerName,
      amount: Number(form.amount),
      advanceDate: form.advanceDate,
      receivedBy: form.receivedBy,
      paymentMode: form.paymentMode,
      notes: form.notes,
    });
    setBusy(false);
    if (ok) setForm({ ...form, buyerName: name ? form.buyerName : "", amount: "", notes: "" });
  }

  const canSave = form.buyerName.trim() && Number(form.amount) > 0 && form.receivedBy;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Buyers</p>
          <p className="mt-1 text-2xl font-bold">{buyers.length}</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Advance held for buyers</p>
          <p className="mt-1 text-2xl font-bold">{money(totals.advance)}</p>
          <p className="ad-muted mt-1 text-xs">Adjusted automatically on the next sale to that buyer</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Pending from buyers</p>
          <p className="mt-1 text-2xl font-bold">{money(totals.pending)}</p>
        </div>
      </div>

      <div className="ad-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Add buyer</h3>
            <p className="ad-muted text-xs">Save buyer here first — Sales form will only pick from this list.</p>
          </div>
          <button type="button" className="ad-btn ad-btn-primary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Close" : "+ Add buyer"}
          </button>
        </div>
        {showAdd && (
          <div className="grid gap-2 md:grid-cols-4">
            <input className="ad-input" placeholder="Buyer name *" value={newBuyer.name} onChange={(e) => setNewBuyer({ ...newBuyer, name: e.target.value })} />
            <input className="ad-input" placeholder="Contact number" value={newBuyer.phone} onChange={(e) => setNewBuyer({ ...newBuyer, phone: e.target.value })} />
            <input className="ad-input" placeholder="Location" value={newBuyer.location} onChange={(e) => setNewBuyer({ ...newBuyer, location: e.target.value })} />
            <input className="ad-input" placeholder="Notes" value={newBuyer.notes} onChange={(e) => setNewBuyer({ ...newBuyer, notes: e.target.value })} />
            <button type="button" className="ad-btn ad-btn-primary md:col-span-4" disabled={busy || !newBuyer.name.trim()} onClick={() => void addBuyer()}>
              Save buyer
            </button>
          </div>
        )}
      </div>

      <div className="ad-card p-4">
        <h3 className="font-semibold">Receive buyer advance</h3>
        <p className="ad-muted mb-3 text-xs">
          Buyer pays in advance. The partner who received it holds the cash, Accounts shows it in the company book, and it is
          adjusted when we sell to the same buyer name.
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          <div>
            <input
              className="ad-input w-full"
              list="buyer-names"
              placeholder="Buyer name"
              value={form.buyerName}
              onChange={(e) => setForm({ ...form, buyerName: e.target.value })}
            />
            <datalist id="buyer-names">
              {buyers.map((b) => (
                <option key={b.name} value={b.name} />
              ))}
            </datalist>
          </div>
          <input className="ad-input" type="number" min="0" placeholder="Advance amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <input className="ad-input" type="date" value={form.advanceDate} onChange={(e) => setForm({ ...form, advanceDate: e.target.value })} />
          <PersonSelect value={form.receivedBy} onChange={(v) => setForm({ ...form, receivedBy: v })} label="Received by" required />
          <select className="ad-input" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
            <option>Cash</option>
            <option>UPI</option>
            <option>Bank Transfer</option>
            <option>Cheque</option>
          </select>
          <input className="ad-input" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <button className="ad-btn ad-btn-primary mt-3" disabled={!canSave || busy} onClick={() => giveAdvance()}>
          Save buyer advance
        </button>
      </div>

      <div className="ad-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{mode === "PET" ? "PET" : "Plastic"} buyers</h3>
          <input className="ad-input w-full sm:w-64" placeholder="Search buyer" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {filtered.length === 0 ? (
          <p className="ad-muted text-sm">
            No buyers yet. Use <b>+ Add buyer</b> above, then pick them on the Sales form.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Sold</th>
                  <th>Sale value</th>
                  <th>Pending</th>
                  <th>Advance given</th>
                  <th>Advance balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.name}>
                    <td>
                      <b>{b.name}</b>
                      {b.phone ? <span className="ad-muted block text-xs">{b.phone}</span> : null}
                    </td>
                    <td>{Number(b.totalKg || 0).toFixed(2)} kg</td>
                    <td>{money(b.totalSales)}</td>
                    <td>{money(b.pendingCredit)}</td>
                    <td>{money(b.advanceGiven)}</td>
                    <td>
                      <b>{money(b.advanceBalance)}</b>
                    </td>
                    <td>
                      <button className="text-xs font-semibold text-[var(--ad-accent)]" onClick={() => setSelected(key(b.name))}>
                        History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {buyer && (
        <div className="ad-card space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold">{buyer.name}</h3>
              <p className="ad-muted text-sm">
                Advance balance {money(buyer.advanceBalance)} · Pending {money(buyer.pendingCredit)}
              </p>
            </div>
            <div className="flex gap-2">
              {Number(buyer.advanceBalance) > 0 && Number(buyer.pendingCredit) > 0 && (
                <button
                  className="ad-btn ad-btn-primary"
                  onClick={() => post("applyBuyerAdvance", { mode, buyerName: buyer.name })}
                >
                  Adjust advance against pending sales
                </button>
              )}
              <button className="ad-btn ad-btn-ghost" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Advances</h4>
            {buyerAdvances.length === 0 ? (
              <p className="ad-muted text-sm">No advance from this buyer.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Used</th>
                      <th>Left</th>
                      <th>Received by</th>
                      <th>Mode</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {buyerAdvances.map((a) => (
                      <tr key={a.id}>
                        <td>{a.advance_date}</td>
                        <td>{money(a.amount)}</td>
                        <td>{money(a.used_amount)}</td>
                        <td>{money(Number(a.amount) - Number(a.used_amount))}</td>
                        <td>{a.received_by || "—"}</td>
                        <td>{a.payment_mode}</td>
                        <td>{a.notes || "—"}</td>
                        <td>
                          {Number(a.used_amount) <= 0 && (
                            <button
                              className="text-xs font-semibold text-red-600"
                              onClick={() => {
                                if (confirm("Delete this advance entry?")) post("deleteBuyerAdvance", { id: a.id });
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">Sales to this buyer</h4>
            {buyerSales.length === 0 ? (
              <p className="ad-muted text-sm">No sales yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Weight</th>
                      <th>Total</th>
                      <th>Received</th>
                      <th>Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyerSales.map((s) => (
                      <tr key={s.id}>
                        <td>{s.sale_date}</td>
                        <td>{Number(s.quantity_kg).toFixed(2)} kg</td>
                        <td>{money(s.total_amount)}</td>
                        <td>{money(s.received_amount)}</td>
                        <td>{money(s.credit_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
