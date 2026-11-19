/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
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

export default function MachinesPage() {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"machines" | "setups">("machines");
  const [message, setMessage] = useState("");
  const [machine, setMachine] = useState(emptyMachine);
  const [setup, setSetup] = useState(emptySetup);
  const [editingMachine, setEditingMachine] = useState<number | null>(null);
  const [editingSetup, setEditingSetup] = useState<number | null>(null);

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
    // Default new rows to current business mode when not editing.
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
  const totals = data?.totals || { machines: 0, setups: 0, all: 0, machineCount: 0, setupCount: 0 };

  const machineOptions = useMemo(
    () => [
      { value: "", label: "No linked machine (general setup)" },
      ...machines.map((m) => ({ value: String(m.id), label: `#${m.id} ${m.name}` })),
    ],
    [machines]
  );

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
      setMessage("Enter a valid purchase amount");
      return;
    }
    if (machine.fundingSource === "OWN_POCKET" && !machine.paidBy) {
      setMessage("Select Payment done by for own-pocket payment");
      return;
    }
    const payload = {
      mode: machine.mode,
      name: machine.name.trim(),
      vendorName: machine.vendorName.trim(),
      purchaseDate: machine.purchaseDate,
      amount,
      paidBy: machine.paidBy || undefined,
      fundingSource: machine.fundingSource,
      notes: machine.notes,
    };
    const ok = editingMachine
      ? await post("updateMachine", { machineId: editingMachine, ...payload })
      : await post("addMachine", payload);
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
      paidBy: m.paid_by || "",
      fundingSource: (m.funding_source as FundingSource) || "COMPANY",
      notes: m.notes || "",
    });
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

  async function deleteMachine(m: Machine) {
    const yes = window.confirm(`Delete machine "${m.name}" (₹${Number(m.amount).toFixed(2)})? This also removes it from the cash book.`);
    if (!yes) return;
    const ok = await post("deleteMachine", { machineId: m.id });
    if (ok && editingMachine === m.id) resetMachineForm();
  }

  async function deleteSetup(s: Setup) {
    const yes = window.confirm(`Delete setup "${s.title}" (₹${Number(s.amount).toFixed(2)})? This also removes it from the cash book.`);
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
      subtitle="Buy new machines and record factory / installation setup costs. Amounts hit Accounts cash book like expenses."
    >
      {message && <div className="mb-4 text-xs text-[var(--ad-accent)]">{message}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Machines bought</p>
          <p className="mt-1 text-2xl font-bold">{totals.machineCount}</p>
          <p className="ad-muted mt-1 text-xs">{money(totals.machines)}</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Setup spend</p>
          <p className="mt-1 text-2xl font-bold">{totals.setupCount}</p>
          <p className="ad-muted mt-1 text-xs">{money(totals.setups)}</p>
        </div>
        <div className="ad-card p-4">
          <p className="ad-muted text-xs">Total capital outlay</p>
          <p className="mt-1 text-2xl font-bold">{money(totals.all)}</p>
          <p className="ad-muted mt-1 text-xs">Company / partner pocket as chosen</p>
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
                  placeholder="e.g. PET crusher, Plastic extruder"
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
                <span className="ad-field-label">Purchase date *</span>
                <input
                  className="ad-input"
                  type="date"
                  value={machine.purchaseDate}
                  onChange={(e) => setMachine({ ...machine, purchaseDate: e.target.value })}
                />
              </label>
              <label className="ad-field">
                <span className="ad-field-label">Amount *</span>
                <input
                  className="ad-input"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Purchase amount"
                  value={machine.amount}
                  onChange={(e) => setMachine({ ...machine, amount: e.target.value })}
                />
              </label>
              <PersonSelect value={machine.paidBy} onChange={(v) => setMachine({ ...machine, paidBy: v })} />
              <FundingSelect
                value={machine.fundingSource}
                onChange={(v) => setMachine({ ...machine, fundingSource: v })}
              />
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
              Saved amount goes to Accounts cash book as <b>Machine purchase</b>. Use Payment done by so partner balances stay correct.
            </p>
          </div>

          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Machine</th>
                  <th>Vendor</th>
                  <th>Line</th>
                  <th>Amount</th>
                  <th>By</th>
                  <th>Fund</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {machines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="ad-muted">
                      No machines yet — add the first purchase above.
                    </td>
                  </tr>
                )}
                {machines.map((m) => (
                  <tr key={m.id}>
                    <td>{m.purchase_date}</td>
                    <td>{m.name}</td>
                    <td>{m.vendor_name || "—"}</td>
                    <td>{m.mode}</td>
                    <td>{money(m.amount)}</td>
                    <td>{m.paid_by || "—"}</td>
                    <td>{m.funding_source === "OWN_POCKET" ? "Own pocket" : "Company"}</td>
                    <td>
                      <div className="ad-row-actions">
                        <button type="button" className="ad-icon-btn ad-icon-btn-accent" onClick={() => startEditMachine(m)}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button type="button" className="ad-icon-btn ad-icon-btn-danger" onClick={() => void deleteMachine(m)}>
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
