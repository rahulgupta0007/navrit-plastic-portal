"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell, adminToast } from "@/components/admin-shell";
import { useBusinessMode } from "@/components/business-mode-provider";
import { Plus, WalletCards, X } from "lucide-react";

type Worker = { id: number; name: string; active: number };
type Labour = { id: number; batch_id: number | null; worker_id: number; workerName: string; amount: number; payment_date: string; paid_by: string; task_type: string; mode: string; notes?: string };
type ApiResponse = { ok?: boolean; error?: string; labourWorkers?: Worker[]; manualLabour?: Labour[] };
type PostBody = Record<string, string | number | boolean | number[] | undefined>;

export default function ProcessingPage() {
  const { mode } = useBusinessMode();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [labour, setLabour] = useState<Labour[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [taskType, setTaskType] = useState("Cap Removal");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paidBy, setPaidBy] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/inventory", { cache: "no-store" });
    const data: ApiResponse = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load labour data.");
    setWorkers(data.labourWorkers ?? []);
    setLabour((data.manualLabour ?? []).filter((entry) => entry.mode === mode));
  }, [mode]);

  useEffect(() => {
    void load().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "Unable to load labour data.";
      setMessage(text);
      adminToast(text);
    });
  }, [load]);

  const active = workers.filter((worker) => worker.active);
  const total = useMemo(() => selected.length * Number(amount || 0), [selected.length, amount]);

  const workerStats = useMemo(() => {
    return active.map((worker) => {
      const entries = labour.filter((entry) => entry.worker_id === worker.id);
      const totalEarned = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const attendance = entries.length;
      return { ...worker, attendance, totalEarned, pendingWage: totalEarned };
    });
  }, [active, labour]);

  const selectedWorker = selectedWorkerId === null ? null : workerStats.find((worker) => worker.id === selectedWorkerId) || null;

  async function post(body: PostBody): Promise<boolean> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: ApiResponse = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      await load();
      setMessage("Saved successfully.");
      adminToast("Saved successfully.");
      return true;
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Something went wrong.";
      setMessage(text);
      adminToast(text);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    if (await post({ action: "addLabourWorker", name })) {
      setName("");
      setShowAdd(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.length || Number(amount) <= 0) {
      setMessage("Select at least one labourer and enter a valid wage.");
      return;
    }

    const ok = await post({
      action: "addManualLabour",
      mode,
      workerIds: selected,
      taskType,
      amountPerWorker: Number(amount),
      paymentDate,
      paidBy,
      notes,
    });

    if (ok) {
      setSelected([]);
      setAmount("");
      setPaymentDate(today);
      setPaidBy("");
      setNotes("");
    }
  }

  async function disableWorker(worker: Worker) {
    const yes = window.confirm(
      `Disable ${worker.name}? This keeps all attendance and wage history. The worker can be reactivated later.`
    );
    if (!yes) return;
    await post({ action: "setLabourWorkerStatus", workerId: worker.id, active: false });
    if (selectedWorkerId === worker.id) setSelectedWorkerId(null);
  }

  return (
    <AdminShell
      title="Labour Management"
      subtitle="Manage labour, attendance and wage payments"
      actions={
        <button
          type="button"
          className="ad-btn ad-btn-primary"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={15} /> Add Labour
        </button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="ad-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Labour</h2>
              <p className="ad-muted text-xs">{active.length} active workers</p>
            </div>
            <button type="button" className="ad-btn ad-btn-ghost !px-2" onClick={() => setShowAdd(true)} aria-label="Add labour">
              <Plus size={15} />
            </button>
          </div>

          <div className="space-y-2">
            {workerStats.map((worker) => (
              <button
                key={worker.id}
                type="button"
                onClick={() => setSelectedWorkerId(worker.id)}
                className="w-full rounded-xl border border-[var(--ad-border)] p-3 text-left transition hover:bg-[var(--ad-hover)]"
                data-selected={selectedWorkerId === worker.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{worker.name}</span>
                  <span className="rounded-full bg-[var(--ad-accent-dim)] px-2 py-0.5 text-[10px] font-bold text-[var(--ad-accent)]">
                    ACTIVE
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="ad-muted">Attendance</p>
                    <p className="font-semibold">{worker.attendance}</p>
                  </div>
                  <div>
                    <p className="ad-muted">Pending wage</p>
                    <p className="font-semibold">₹{worker.pendingWage.toFixed(2)}</p>
                  </div>
                </div>
              </button>
            ))}
            {!workerStats.length && <p className="ad-muted text-sm">No active labour. Add the first worker.</p>}
          </div>
        </aside>

        <section className="space-y-5">
          {selectedWorker && (
            <div className="ad-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="ad-muted text-xs uppercase tracking-wide">Labour profile</p>
                  <h2 className="mt-1 text-xl font-semibold">{selectedWorker.name}</h2>
                  <p className="ad-muted mt-1 text-sm">Attendance and wage history for {mode}</p>
                </div>
                <button
                  type="button"
                  className="ad-btn ad-btn-danger"
                  disabled={busy}
                  onClick={() => void disableWorker(selectedWorker)}
                >
                  Disable Labour
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--ad-border)] bg-[var(--ad-input)] p-4">
                  <p className="ad-muted text-xs">Total attendance</p>
                  <p className="mt-1 text-2xl font-bold">{selectedWorker.attendance}</p>
                </div>
                <div className="rounded-xl border border-[var(--ad-border)] bg-[var(--ad-input)] p-4">
                  <p className="ad-muted text-xs">Total wage recorded</p>
                  <p className="mt-1 text-2xl font-bold">₹{selectedWorker.totalEarned.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-[var(--ad-border)] bg-[var(--ad-input)] p-4">
                  <p className="ad-muted text-xs">Pending wage</p>
                  <p className="mt-1 text-2xl font-bold text-[var(--ad-warning)]">₹{selectedWorker.pendingWage.toFixed(2)}</p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="ad-table w-full">
                  <thead>
                    <tr><th>Date</th><th>Batch</th><th>Task</th><th>Wage</th><th>Paid By</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {labour.filter((entry) => entry.worker_id === selectedWorker.id).map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.payment_date}</td>
                        <td>{entry.batch_id ? `#${entry.batch_id}` : "Direct Labour"}</td>
                        <td>{entry.task_type || "Manual Labour"}</td>
                        <td>₹{Number(entry.amount).toFixed(2)}</td>
                        <td>{entry.paid_by || "—"}</td>
                        <td>{entry.notes || "—"}</td>
                      </tr>
                    ))}
                    {!labour.some((entry) => entry.worker_id === selectedWorker.id) && (
                      <tr><td colSpan={6} className="ad-muted">No attendance recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <section className="ad-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Record Attendance</h2>
                <p className="ad-muted mt-1 text-sm">Record labour attendance for cap removal or sorting.</p>
              </div>
              <WalletCards size={18} className="text-[var(--ad-muted)]" />
            </div>

            <form onSubmit={save} className="space-y-3">
              <p className="rounded-lg border border-[var(--ad-border)] bg-[var(--ad-input)] p-3 text-xs ad-muted">Record labour for cap removal or sorting directly. A processing batch is not required.</p>

              <div className="grid grid-cols-2 gap-3">
                <select className="ad-input" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                  <option>Cap Removal</option>
                  <option>Sorting</option>
                </select>
                <input
                  className="ad-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="₹ / worker"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input className="ad-input" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                <select className="ad-input" value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>
                  <option value="">Paid by</option>
                  <option>Rahul</option>
                  <option>Devesh</option>
                  <option>Nitin</option>
                </select>
              </div>

              <input className="ad-input w-full" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" />

              <div className="rounded-lg border border-[var(--ad-border)] p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-medium">
                  <span>Select labour</span>
                  <span>{selected.length} selected</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {active.map((worker) => (
                    <label key={worker.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-[var(--ad-hover)]">
                      <input
                        type="checkbox"
                        checked={selected.includes(worker.id)}
                        onChange={(event) =>
                          setSelected(event.target.checked ? [...selected, worker.id] : selected.filter((id) => id !== worker.id))
                        }
                      />
                      <span>{worker.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span>Total manual labour</span>
                <strong>₹{total.toFixed(2)}</strong>
              </div>

              <button className="ad-btn ad-btn-primary w-full" disabled={busy || !selected.length || Number(amount) <= 0}>
                Save Attendance & Labour
              </button>
            </form>
          </section>

          <section className="ad-card p-5">
            <div>
              <h2 className="text-lg font-semibold">Recent Labour Entries</h2>
              <p className="ad-muted text-sm">Latest attendance and wage entries for {mode}</p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="ad-table w-full">
                <thead><tr><th>Date</th><th>Batch</th><th>Worker</th><th>Task</th><th>Wage</th><th>Paid By</th></tr></thead>
                <tbody>
                  {labour.slice(0, 100).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.payment_date}</td>
                      <td>#{entry.batch_id}</td>
                      <td>{entry.workerName}</td>
                      <td>{entry.task_type || "Manual Labour"}</td>
                      <td>₹{Number(entry.amount).toFixed(2)}</td>
                      <td>{entry.paid_by || "—"}</td>
                    </tr>
                  ))}
                  {!labour.length && <tr><td colSpan={6} className="ad-muted">No labour entries yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>

      {showAdd && (
        <div className="drawer-backdrop" onClick={() => setShowAdd(false)}>
          <div className="drawer-panel bg-[var(--ad-card)] p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Add Labour</h2>
                <p className="ad-muted mt-1 text-sm">Create a labour profile once, then use attendance for every batch.</p>
              </div>
              <button type="button" className="ad-btn ad-btn-ghost !px-2" onClick={() => setShowAdd(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={addWorker} className="mt-5 space-y-3">
              <input
                autoFocus
                className="ad-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Labour name"
              />
              <button className="ad-btn ad-btn-primary w-full" disabled={busy || name.trim().length < 2}>
                <Plus size={15} /> Add Labour
              </button>
            </form>

            <div className="mt-6 rounded-lg border border-[var(--ad-border)] p-3 text-xs ad-muted">
              Labour cannot be deleted while wage history exists. Use Disable to retain historical attendance and payments.
            </div>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-sm">{message}</p>}
    </AdminShell>
  );
}
