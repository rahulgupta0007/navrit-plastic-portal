/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Wallet } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AdminSelect } from "@/components/admin-select";
import { FundingSelect } from "@/components/funding-select";
import { PersonSelect } from "@/components/person-select";
import { useBusinessMode } from "@/components/business-mode-provider";
import type { FundingSource } from "@/lib/funding";

type Machine = {
  id: number;
  mode: string;
  name: string;
  vendor_name: string;
  purchase_date: string;
  amount: number;
  paid_amount: number;
  credit_amount: number;
  paid_by: string;
  funding_source: string;
  notes: string;
};

type Setup = {
  id: number;
  mode: string;
  machine_id: number | null;
  machine_name?: string;
  title: string;
  setup_date: string;
  amount: number;
  paid_by: string;
  funding_source: string;
  notes: string;
};

const emptyMachine = {
  mode: "SHARED" as "PET" | "PLASTIC" | "SHARED",
  name: "",
  vendorName: "",
  purchaseDate: new Date().toISOString().slice(0, 10),
  amount: "",
  paidAmount: "",
  paidBy: "",
  fundingSource: "COMPANY" as FundingSource,
  notes: "",
};

const emptySetup = {
  mode: "SHARED" as "PET" | "PLASTIC" | "SHARED",
  machineId: "",
  title: "",
  setupDate: new Date().toISOString().slice(0, 10),
  amount: "",
  paidBy: "",
  fundingSource: "COMPANY" as FundingSource,
  notes: "",
};

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentStatus(m: Machine) {
  const order = Number(m.amount) || 0;
  const paid = Number(m.paid_amount) || 0;
  const due = Number(m.credit_amount) || Math.max(0, order - paid);
  if (due <= 0.005) return { label: "PAID", due: 0, className: "ad-status-paid" };
  if (paid <= 0.005) return { label: "ORDER / UNPAID", due, className: "ad-status-unpaid" };
  return { label: "PARTIAL", due, className: "ad-status-unpaid" };
}

export default function MachinesPage() {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"machines" | "setups">("machines");
  const [message, setMessage] = useState("");
  const [machine, setMachine] = useState(emptyMachine);
  const [setup, setSetup] = useState(emptySetup);
  const [editingMachine, setEditingMachine] = useState<number | null>(null);
  const [editingSetup, setEditingSetup] = useState<number | null>(null);
  const [payForm, setPayForm] = useState<{
    machineId: number;
    name: string;
    due: number;
    amount: string;
    paymentDate: string;
    paidBy: string;
    fundingSource: FundingSource;
  } | null>(null);

  async function load() {
    const r = await fetch("/api/admin/machines", { cache: "no-store" });
    if (r.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    setData(await r.json());
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (editingMachine === null) {
      setMachine((m) => ({ ...m, mode: mode === "PET" || mode === "PLASTIC" ? mode : "SHARED" }));
    }
    if (editingSetup === null) {
      setSetup((s) => ({ ...s, mode: mode === "PET" || mode === "PLASTIC" ? mode : "SHARED" }));
    }
  }, [mode, editingMachine, editingSetup]);

  async function post(action: string, body: Record<string, unknown>) {
    const r = await fetch("/api/admin/machines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMessage(j.error || "Could not save");
      return false;
    }
    setMessage("Saved successfully");
    await load();
    return true;
  }

  const machines: Machine[] = useMemo(() => data?.machines || [], [data?.machines]);
  const setups: Setup[] = useMemo(() => data?.setups || [], [data?.setups]);
  const totals = data?.totals || {
    machines: 0,
    machinesPaid: 0,
    machinesDue: 0,
    setups: 0,
    all: 0,
    machineCount: 0,
    setupCount: 0,
  };

  const machineOptions = useMemo(
    () => [
      { value: "", label: "No linked machine (general setup)" },
      ...machines.map((m) => ({ value: String(m.id), label: `#${m.id} ${m.name}` })),
    ],
    [machines]
  );

  const orderAmt = Number(machine.amount) || 0;
  const paidNowAmt = machine.paidAmount === "" ? 0 : Number(machine.paidAmount) || 0;
  const dueNow = Math.max(0, orderAmt - Math.min(orderAmt, paidNowAmt));

  function resetMachineForm() {
    setEditingMachine(null);
    setMachine({
      ...emptyMachine,
      mode: mode === "PET" || mode === "PLASTIC" ? mode : "SHARED",
    });
  }

  function resetSetupForm() {
    setEditingSetup(null);
    setSetup({
      ...emptySetup,
      mode: mode === "PET" || mode === "PLASTIC" ? mode : "SHARED",
    });
  }

  async function saveMachine() {
    if (!machine.name.trim()) {
      setMessage("Enter machine name");
      return;
    }
    const amount = Number(machine.amount);
    if (!(amount > 0)) {
      setMessage("Enter order / machine amount");
      return;
    }
    if (editingMachine) {
      const ok = await post("updateMachine", {
        machineId: editingMachine,
        mode: machine.mode,
        name: machine.name.trim(),
        vendorName: machine.vendorName.trim(),
        purchaseDate: machine.purchaseDate,
        amount,
        notes: machine.notes,
      });
      if (ok) resetMachineForm();
      return;
    }

    const paidAmount = machine.paidAmount === "" ? 0 : Number(machine.paidAmount);
    if (Number.isNaN(paidAmount) || paidAmount < 0) {
      setMessage("Paid now must be 0 or more");
      return;
    }
    if (paidAmount > amount) {
      setMessage("Paid now cannot exceed order amount");
      return;
    }
    if (paidAmount > 0 && !machine.paidBy) {
      setMessage("Select Payment done by for advance / partial / full payment");
      return;
    }
    if (machine.fundingSource === "OWN_POCKET" && paidAmount > 0 && !machine.paidBy) {
      setMessage("Select Payment done by for own-pocket payment");
      return;
    }
    const ok = await post("addMachine", {
      mode: machine.mode,
      name: machine.name.trim(),
      vendorName: machine.vendorName.trim(),
      purchaseDate: machine.purchaseDate,
      amount,
      paidAmount,
      paidBy: machine.paidBy || undefined,
      fundingSource: machine.fundingSource,
      notes: machine.notes,
    });
    if (ok) resetMachineForm();
  }

  async function saveSetup() {
    if (!setup.title.trim()) {
      setMessage("Enter setup title");
      return;
    }
    const amount = Number(setup.amount);
    if (!(amount > 0)) {
      setMessage("Enter a valid setup amount");
      return;
    }
    if (setup.fundingSource === "OWN_POCKET" && !setup.paidBy) {
      setMessage("Select Payment done by for own-pocket payment");
      return;
    }
    const payload = {
      mode: setup.mode,
      machineId: setup.machineId ? Number(setup.machineId) : undefined,
      title: setup.title.trim(),
      setupDate: setup.setupDate,
      amount,
      paidBy: setup.paidBy || undefined,
      fundingSource: setup.fundingSource,
      notes: setup.notes,
    };
    const ok = editingSetup
      ? await post("updateSetup", { setupId: editingSetup, ...payload })
      : await post("addSetup", payload);
    if (ok) resetSetupForm();
  }

  function startEditMachine(m: Machine) {
    setEditingMachine(m.id);
    setMachine({
      mode: (m.mode as "PET" | "PLASTIC" | "SHARED") || "SHARED",
      name: m.name,
      vendorName: m.vendor_name || "",
      purchaseDate: m.purchase_date,
      amount: String(m.amount),
      paidAmount: String(m.paid_amount ?? ""),
      paidBy: m.paid_by || "",
      fundingSource: (m.funding_source as FundingSource) || "COMPANY",
      notes: m.notes || "",
    });
    setPayForm(null);
    setTab("machines");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEditSetup(s: Setup) {
    setEditingSetup(s.id);
    setSetup({
      mode: (s.mode as "PET" | "PLASTIC" | "SHARED") || "SHARED",
      machineId: s.machine_id ? String(s.machine_id) : "",
      title: s.title,
      setupDate: s.setup_date,
      amount: String(s.amount),
      paidBy: s.paid_by || "",
      fundingSource: (s.funding_source as FundingSource) || "COMPANY",
      notes: s.notes || "",
    });
    setTab("setups");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openPayDue(m: Machine) {
    const due = Number(m.credit_amount) || Math.max(0, Number(m.amount) - Number(m.paid_amount || 0));
    setPayForm({
      machineId: m.id,
      name: m.name,
      due,
      amount: String(due),
      paymentDate: new Date().toISOString().slice(0, 10),
      paidBy: "",
      fundingSource: "COMPANY",
    });
    setEditingMachine(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitPayDue() {
    if (!payForm) return;
    const amount = Number(payForm.amount);
    if (!(amount > 0)) {
      setMessage("Enter payment amount");
      return;
    }
    if (!payForm.paidBy) {
      setMessage("Select Payment done by");
      return;
    }
    const ok = await post("payMachineBalance", {
      machineId: payForm.machineId,
      amount,
      paymentDate: payForm.paymentDate,
      paidBy: payForm.paidBy,
      fundingSource: payForm.fundingSource,
    });
    if (ok) setPayForm(null);
  }

  async function deleteMachine(m: Machine) {
    const yes = window.confirm(
      `Delete machine "${m.name}" (order ${money(m.amount)})? This also removes linked payments from the cash book.`
    );
    if (!yes) return;
    const ok = await post("deleteMachine", { machineId: m.id });
    if (ok && editingMachine === m.id) resetMachineForm();
    if (ok && payForm?.machineId === m.id) setPayForm(null);
  }

  async function deleteSetup(s: Setup) {
    const yes = window.confirm(`Delete setup "${s.title}" (${money(s.amount)})? This also removes it from the cash book.`);
    if (!yes) return;
    const ok = await post("deleteSetup", { setupId: s.id });
    if (ok && editingSetup === s.id) resetSetupForm();
  }

  if (!data) {
    return (
      <AdminShell title="Machine & Setup">
        <div className="ad-card p-6">Loading…</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Machine & Setup"
      subtitle="Buy machines with full / advance / partial payment, then clear balance later. Only paid amounts hit the cash book."
    >
      {message && <div className="mb-4 text-xs text-[var(--ad-accent)]">{message}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Machines ordered</p>
          <p className="mt-1 text-2xl font-bold">{totals.machineCount}</p>
          <p className="ad-muted mt-1 text-xs">Order value {money(totals.machines)}</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Paid on machines</p>
          <p className="mt-1 text-2xl font-bold">{money(totals.machinesPaid || 0)}</p>
          <p className="ad-muted mt-1 text-xs">In cash book</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Machine dues</p>
          <p className="mt-1 text-2xl font-bold">{money(totals.machinesDue || 0)}</p>
          <p className="ad-muted mt-1 text-xs">Still to pay vendor</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Setup spend</p>
          <p className="mt-1 text-2xl font-bold">{money(totals.setups)}</p>
          <p className="ad-muted mt-1 text-xs">{totals.setupCount} entries</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={tab === "machines" ? "ad-btn ad-btn-primary" : "ad-btn ad-btn-ghost"}
          onClick={() => setTab("machines")}
        >
          Buy machine
        </button>
        <button
          type="button"
          className={tab === "setups" ? "ad-btn ad-btn-primary" : "ad-btn ad-btn-ghost"}
          onClick={() => setTab("setups")}
        >
          New setup
        </button>
      </div>

      {tab === "machines" && (
        <div className="space-y-5 ad-fade-in">
          <div className="ad-card p-4">
            <h2 className="mb-3 font-semibold">
              {editingMachine ? `Edit machine #${editingMachine}` : "Add new machine purchase"}
            </h2>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="ad-field md:col-span-2">
                <span className="ad-field-label">Machine name *</span>
                <input
                  className="ad-input"
                  placeholder="e.g. Plastic grinder machine"
                  value={machine.name}
                  onChange={(e) => setMachine({ ...machine, name: e.target.value })}
                />
              </label>
              <label className="ad-field">
                <span className="ad-field-label">Vendor / seller</span>
                <input
                  className="ad-input"
                  placeholder="Optional"
                  value={machine.vendorName}
                  onChange={(e) => setMachine({ ...machine, vendorName: e.target.value })}
                />
              </label>
              <AdminSelect
                label="For line"
                value={machine.mode}
                onChange={(v) => setMachine({ ...machine, mode: v as "PET" | "PLASTIC" | "SHARED" })}
                options={[
                  { value: "PET", label: "PET" },
                  { value: "PLASTIC", label: "Plastic" },
                  { value: "SHARED", label: "Shared (both)" },
                ]}
              />
              <label className="ad-field">
                <span className="ad-field-label">Order / purchase date *</span>
                <input
                  className="ad-input"
                  type="date"
                  value={machine.purchaseDate}
                  onChange={(e) => setMachine({ ...machine, purchaseDate: e.target.value })}
                />
              </label>
              <label className="ad-field">
                <span className="ad-field-label">Order amount *</span>
                <input
                  className="ad-input"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Full machine price"
                  value={machine.amount}
                  onChange={(e) => setMachine({ ...machine, amount: e.target.value })}
                />
              </label>
              {!editingMachine && (
                <>
                  <label className="ad-field">
                    <span className="ad-field-label">Paid now (advance / partial)</span>
                    <input
                      className="ad-input"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0 = order only / pay later"
                      value={machine.paidAmount}
                      onChange={(e) => setMachine({ ...machine, paidAmount: e.target.value })}
                    />
                  </label>
                  <div className="ad-field">
                    <span className="ad-field-label">Balance due</span>
                    <div className="ad-input flex items-center text-sm font-semibold">{money(dueNow)}</div>
                  </div>
                  <PersonSelect value={machine.paidBy} onChange={(v) => setMachine({ ...machine, paidBy: v })} />
                  <FundingSelect
                    value={machine.fundingSource}
                    onChange={(v) => setMachine({ ...machine, fundingSource: v })}
                  />
                </>
              )}
              <label className="ad-field md:col-span-2">
                <span className="ad-field-label">Notes</span>
                <input
                  className="ad-input"
                  placeholder="Optional notes"
                  value={machine.notes}
                  onChange={(e) => setMachine({ ...machine, notes: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <button type="button" className="ad-btn ad-btn-primary" onClick={() => void saveMachine()}>
                  {editingMachine ? "Update machine" : "Save machine"}
                </button>
                {editingMachine && (
                  <button type="button" className="ad-btn ad-btn-ghost" onClick={resetMachineForm}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs ad-muted">
              <b>Order amount</b> = full machine price.
              <b> Paid now</b> = advance / partial / full (0 to book order only).
              Only paid money hits Accounts. Use <b>Pay due</b> later for remaining balance.
            </p>
          </div>

          {payForm && (
            <div className="ad-card border border-[var(--ad-accent)] p-4 ad-fade-in">
              <h3 className="mb-1 text-sm font-semibold">Pay machine balance — {payForm.name}</h3>
              <p className="ad-muted mb-3 text-xs">Due {money(payForm.due)}. Enter advance / partial / full settlement.</p>
              <div className="grid gap-3 md:grid-cols-5">
                <label className="ad-field">
                  <span className="ad-field-label">Pay amount</span>
                  <input
                    className="ad-input"
                    type="number"
                    min="0"
                    step="any"
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  />
                </label>
                <label className="ad-field">
                  <span className="ad-field-label">Payment date</span>
                  <input
                    className="ad-input"
                    type="date"
                    value={payForm.paymentDate}
                    onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                  />
                </label>
                <PersonSelect
                  value={payForm.paidBy}
                  onChange={(v) => setPayForm({ ...payForm, paidBy: v })}
                />
                <FundingSelect
                  value={payForm.fundingSource}
                  onChange={(v) => setPayForm({ ...payForm, fundingSource: v })}
                />
                <div className="flex flex-wrap items-end gap-2">
                  <button type="button" className="ad-btn ad-btn-primary" onClick={() => void submitPayDue()}>
                    Save payment
                  </button>
                  <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setPayForm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Machine</th>
                  <th>Vendor</th>
                  <th>Line</th>
                  <th>Order</th>
                  <th>Paid</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {machines.length === 0 && (
                  <tr>
                    <td colSpan={10} className="ad-muted">
                      No machines yet — add the first purchase above.
                    </td>
                  </tr>
                )}
                {machines.map((m) => {
                  const status = paymentStatus(m);
                  return (
                    <tr key={m.id}>
                      <td>{m.purchase_date}</td>
                      <td>{m.name}</td>
                      <td>{m.vendor_name || "—"}</td>
                      <td>{m.mode}</td>
                      <td>{money(m.amount)}</td>
                      <td>{money(m.paid_amount || 0)}</td>
                      <td>{money(status.due)}</td>
                      <td>
                        <span className={status.className}>{status.label}</span>
                      </td>
                      <td>{m.paid_by || "—"}</td>
                      <td>
                        <div className="ad-row-actions">
                          {status.due > 0.005 && (
                            <button
                              type="button"
                              className="ad-icon-btn ad-icon-btn-accent"
                              onClick={() => openPayDue(m)}
                              title="Pay advance / balance"
                            >
                              <Wallet size={13} /> Pay due
                            </button>
                          )}
                          <button type="button" className="ad-icon-btn ad-icon-btn-accent" onClick={() => startEditMachine(m)}>
                            <Pencil size={13} /> Edit
                          </button>
                          <button type="button" className="ad-icon-btn ad-icon-btn-danger" onClick={() => void deleteMachine(m)}>
                            <Trash2 size={13} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "setups" && (
        <div className="space-y-5 ad-fade-in">
          <div className="ad-card p-4">
            <h2 className="mb-3 font-semibold">
              {editingSetup ? `Edit setup #${editingSetup}` : "Add new setup / installation"}
            </h2>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="ad-field md:col-span-2">
                <span className="ad-field-label">Setup title *</span>
                <input
                  className="ad-input"
                  placeholder="e.g. Shed civil work, wiring, foundation"
                  value={setup.title}
                  onChange={(e) => setSetup({ ...setup, title: e.target.value })}
                />
              </label>
              <AdminSelect
                label="Link to machine"
                value={setup.machineId}
                onChange={(v) => setSetup({ ...setup, machineId: v })}
                options={machineOptions}
              />
              <AdminSelect
                label="For line"
                value={setup.mode}
                onChange={(v) => setSetup({ ...setup, mode: v as "PET" | "PLASTIC" | "SHARED" })}
                options={[
                  { value: "PET", label: "PET" },
                  { value: "PLASTIC", label: "Plastic" },
                  { value: "SHARED", label: "Shared (both)" },
                ]}
              />
              <label className="ad-field">
                <span className="ad-field-label">Setup date *</span>
                <input
                  className="ad-input"
                  type="date"
                  value={setup.setupDate}
                  onChange={(e) => setSetup({ ...setup, setupDate: e.target.value })}
                />
              </label>
              <label className="ad-field">
                <span className="ad-field-label">Amount *</span>
                <input
                  className="ad-input"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Setup cost"
                  value={setup.amount}
                  onChange={(e) => setSetup({ ...setup, amount: e.target.value })}
                />
              </label>
              <PersonSelect value={setup.paidBy} onChange={(v) => setSetup({ ...setup, paidBy: v })} />
              <FundingSelect
                value={setup.fundingSource}
                onChange={(v) => setSetup({ ...setup, fundingSource: v })}
              />
              <label className="ad-field md:col-span-2">
                <span className="ad-field-label">Notes</span>
                <input
                  className="ad-input"
                  placeholder="Optional notes"
                  value={setup.notes}
                  onChange={(e) => setSetup({ ...setup, notes: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <button type="button" className="ad-btn ad-btn-primary" onClick={() => void saveSetup()}>
                  {editingSetup ? "Update setup" : "Save setup"}
                </button>
                {editingSetup && (
                  <button type="button" className="ad-btn ad-btn-ghost" onClick={resetSetupForm}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs ad-muted">
              Use this for civil work, wiring, installation labour, tools, and other setup before production. Hits cash book as <b>Machine setup</b>.
            </p>
          </div>

          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Setup</th>
                  <th>Machine</th>
                  <th>Line</th>
                  <th>Amount</th>
                  <th>By</th>
                  <th>Fund</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {setups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="ad-muted">
                      No setup entries yet — add the first one above.
                    </td>
                  </tr>
                )}
                {setups.map((s) => (
                  <tr key={s.id}>
                    <td>{s.setup_date}</td>
                    <td>{s.title}</td>
                    <td>{s.machine_name || "—"}</td>
                    <td>{s.mode}</td>
                    <td>{money(s.amount)}</td>
                    <td>{s.paid_by || "—"}</td>
                    <td>{s.funding_source === "OWN_POCKET" ? "Own pocket" : "Company"}</td>
                    <td>
                      <div className="ad-row-actions">
                        <button type="button" className="ad-icon-btn ad-icon-btn-accent" onClick={() => startEditSetup(s)}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button type="button" className="ad-icon-btn ad-icon-btn-danger" onClick={() => void deleteSetup(s)}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
