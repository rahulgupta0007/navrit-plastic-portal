"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell, adminToast } from "@/components/admin-shell";
import { AdminSelect } from "@/components/admin-select";
import { PersonSelect } from "@/components/person-select";
import { useBusinessMode } from "@/components/business-mode-provider";
import { labourTasksForMode } from "@/lib/labour-tasks";
import {
  attendanceDayUnits,
  attendanceEarnedAmount,
  halfDayRate,
} from "@/lib/labour-math";
import { Pencil, Plus, Trash2, Users, X } from "lucide-react";

type Worker = {
  id: number;
  name: string;
  active: number;
  daily_rate?: number;
  half_day_rate?: number;
};
type Labour = {
  id: number;
  worker_id: number;
  workerName: string;
  amount: number;
  payment_date: string;
  paid_by: string;
  task_type: string;
  mode: string;
  notes?: string;
  attendance_type?: string;
  payment_kind?: string;
  hours?: number;
};
type WorkerSummary = {
  worker: Worker;
  days: number;
  earned: number;
  wagesPaid: number;
  advances: number;
  due: number;
  entries: Labour[];
};
type ApiResponse = {
  ok?: boolean;
  error?: string;
  labourWorkers?: Worker[];
  manualLabour?: Labour[];
};
type PostBody = Record<string, string | number | boolean | number[] | undefined>;
type AttendanceType = "FULL_DAY" | "HALF_DAY";

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function kindLabel(kind?: string) {
  if (kind === "ATTENDANCE") return "Attendance";
  if (kind === "ADVANCE") return "Advance";
  return "Wage";
}

function dayLabel(type?: string, hours?: number) {
  const ot = Number(hours || 0);
  const otText = ot > 0 ? ` + ${ot}h OT` : "";
  if (type === "HALF_DAY") return `Half day${otText}`;
  if (type === "FULL_DAY") return `Full day${otText}`;
  if (type === "CUSTOM_HOURS") return `${ot || 0}h`;
  return ot > 0 ? `${ot}h OT` : "—";
}

export default function ProcessingPage() {
  const { mode } = useBusinessMode();
  const tasks = labourTasksForMode(mode);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [labour, setLabour] = useState<Labour[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  const [showAdd, setShowAdd] = useState(false);
  const [detailWorkerId, setDetailWorkerId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [taskType, setTaskType] = useState<string>(tasks[0]);
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("FULL_DAY");
  const [overtimeHours, setOvertimeHours] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editEntry, setEditEntry] = useState<Labour | null>(null);

  // Popup pay / advance
  const [popupPaidBy, setPopupPaidBy] = useState("");
  const [popupWageAmount, setPopupWageAmount] = useState("");
  const [popupPayOutstanding, setPopupPayOutstanding] = useState(true);
  const [popupAdvanceAmount, setPopupAdvanceAmount] = useState("");
  const [popupAdvancePaidBy, setPopupAdvancePaidBy] = useState("");
  const [popupAdvanceDate, setPopupAdvanceDate] = useState(today);
  const [popupDate, setPopupDate] = useState(today);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/inventory", { cache: "no-store" });
    const data: ApiResponse = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load labour data.");
    setWorkers(data.labourWorkers ?? []);
    setLabour((data.manualLabour ?? []).filter((entry) => entry.mode === mode));
  }, [mode]);

  useEffect(() => {
    setTaskType(labourTasksForMode(mode)[0]);
    setSelected([]);
    setEditEntry(null);
    setDetailWorkerId(null);
    setAttendanceType("FULL_DAY");
    setOvertimeHours("");
  }, [mode]);

  useEffect(() => {
    void load().catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "Unable to load labour data.";
      setMessage(text);
      adminToast(text);
    });
  }, [load]);

  const active = workers.filter((w) => w.active);
  const inactive = workers.filter((w) => !w.active);

  const summaries = useMemo(() => {
    const byId = new Map<number, WorkerSummary>();
    for (const worker of active) {
      byId.set(worker.id, {
        worker,
        days: 0,
        earned: 0,
        wagesPaid: 0,
        advances: 0,
        due: 0,
        entries: [],
      });
    }
    for (const entry of labour) {
      const row = byId.get(entry.worker_id);
      if (!row) continue;
      row.entries.push(entry);
      const kind = entry.payment_kind || "WAGE";
      const daily = Number(row.worker.daily_rate || 0);
      if (kind === "ATTENDANCE") {
        row.days += attendanceDayUnits(entry.attendance_type, Number(entry.hours || 0));
        row.earned += attendanceEarnedAmount(daily, entry.attendance_type, Number(entry.hours || 0));
      } else if (kind === "ADVANCE") {
        row.advances += Number(entry.amount || 0);
      } else {
        row.wagesPaid += Number(entry.amount || 0);
      }
    }
    for (const row of byId.values()) {
      row.days = Math.round(row.days * 100) / 100;
      row.earned = Math.round(row.earned * 100) / 100;
      row.wagesPaid = Math.round(row.wagesPaid * 100) / 100;
      row.advances = Math.round(row.advances * 100) / 100;
      row.due = Math.round((row.earned - row.wagesPaid - row.advances) * 100) / 100;
    }
    return Array.from(byId.values()).sort((a, b) => a.worker.name.localeCompare(b.worker.name));
  }, [active, labour]);

  const detail = useMemo(
    () => (detailWorkerId == null ? null : summaries.find((s) => s.worker.id === detailWorkerId) || null),
    [detailWorkerId, summaries]
  );

  const totalPreview = useMemo(() => {
    const ot = Number(overtimeHours || 0);
    return Math.round(
      selected.reduce((n, id) => {
        const worker = active.find((w) => w.id === id);
        if (!worker) return n;
        return n + attendanceEarnedAmount(Number(worker.daily_rate || 0), attendanceType, ot);
      }, 0) * 100
    ) / 100;
  }, [selected, active, attendanceType, overtimeHours]);

  const recent = useMemo(() => labour.slice(0, 40), [labour]);

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
      setMessage("Saved.");
      adminToast("Saved.");
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

  async function addWorker(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const daily = Number(dailyRate || 0);
    if (
      await post({
        action: "addLabourWorker",
        name: name.trim(),
        dailyRate: daily,
        halfDayRate: halfDayRate(daily),
      })
    ) {
      setName("");
      setDailyRate("");
      setShowAdd(false);
    }
  }

  async function saveAttendance(event: FormEvent) {
    event.preventDefault();
    if (!selected.length) {
      setMessage("Select at least one worker.");
      return;
    }
    const ok = await post({
      action: "addManualLabour",
      mode,
      workerIds: selected,
      taskType,
      attendanceType,
      hours: Number(overtimeHours || 0),
      paymentKind: "ATTENDANCE",
      paymentDate,
      notes: "",
    });
    if (ok) {
      setSelected([]);
      setOvertimeHours("");
      setAttendanceType("FULL_DAY");
    }
  }

  async function payWageFromPopup() {
    if (!detail) return;
    if (!popupPaidBy) {
      setMessage("Choose who paid.");
      return;
    }
    const useOutstanding = popupPayOutstanding && !popupWageAmount;
    let amountPerWorker: number | undefined;
    if (popupWageAmount) {
      amountPerWorker = Number(popupWageAmount);
      if (!(amountPerWorker > 0)) {
        setMessage("Enter wage amount.");
        return;
      }
    }
    const ok = await post({
      action: "addManualLabour",
      mode,
      workerIds: [detail.worker.id],
      taskType: tasks[0],
      paymentKind: "WAGE",
      payOutstanding: useOutstanding,
      amountPerWorker,
      paymentDate: popupDate,
      paidBy: popupPaidBy,
      notes: "",
    });
    if (ok) {
      setPopupWageAmount("");
      setPopupPayOutstanding(true);
      setPopupPaidBy("");
    }
  }

  async function giveAdvanceFromPopup() {
    if (!detail) return;
    if (!popupAdvancePaidBy) {
      setMessage("Choose who paid the advance.");
      return;
    }
    const amountPerWorker = Number(popupAdvanceAmount || 0);
    if (!(amountPerWorker > 0)) {
      setMessage("Enter advance amount.");
      return;
    }
    const ok = await post({
      action: "addManualLabour",
      mode,
      workerIds: [detail.worker.id],
      taskType: tasks[0],
      paymentKind: "ADVANCE",
      amountPerWorker,
      paymentDate: popupAdvanceDate,
      paidBy: popupAdvancePaidBy,
      notes: "",
    });
    if (ok) {
      setPopupAdvanceAmount("");
      setPopupAdvancePaidBy("");
      setPopupAdvanceDate(today);
    }
  }

  async function saveEdit() {
    if (!editEntry) return;
    const kind = (editEntry.payment_kind || "WAGE") as string;
    if (kind !== "ATTENDANCE" && !editEntry.paid_by) {
      setMessage("For wage/advance choose who paid.");
      return;
    }
    if (!(Number(editEntry.amount) > 0)) {
      setMessage("Amount must be greater than 0.");
      return;
    }
    const ok = await post({
      action: "updateManualLabour",
      labourId: editEntry.id,
      mode,
      taskType: editEntry.task_type,
      attendanceType: kind === "ADVANCE" ? "" : (editEntry.attendance_type || "FULL_DAY"),
      hours: Number(editEntry.hours || 0),
      amount: Number(editEntry.amount),
      paymentKind: kind,
      paymentDate: editEntry.payment_date,
      ...(kind === "ATTENDANCE" ? { clearPaidBy: true } : { paidBy: editEntry.paid_by }),
      notes: editEntry.notes || "",
    });
    if (ok) setEditEntry(null);
  }

  async function deleteEntry(entry: Labour) {
    if (!window.confirm("Delete this entry?")) return;
    await post({ action: "deleteManualLabour", labourId: entry.id, mode });
  }

  async function disableWorker(worker: Worker) {
    if (!window.confirm(`Disable ${worker.name}? History is kept.`)) return;
    await post({ action: "setLabourWorkerStatus", workerId: worker.id, active: false });
  }

  async function reactivateWorker(worker: Worker) {
    await post({ action: "setLabourWorkerStatus", workerId: worker.id, active: true });
  }

  function dueAcrossLoaded(workerId: number, daily: number) {
    let earned = 0;
    let wagesPaid = 0;
    let advances = 0;
    for (const entry of labour) {
      if (entry.worker_id !== workerId) continue;
      const kind = entry.payment_kind || "WAGE";
      if (kind === "ATTENDANCE") {
        earned += attendanceEarnedAmount(daily, entry.attendance_type, Number(entry.hours || 0));
      } else if (kind === "ADVANCE") {
        advances += Number(entry.amount || 0);
      } else {
        wagesPaid += Number(entry.amount || 0);
      }
    }
    return Math.round((earned - wagesPaid - advances) * 100) / 100;
  }

  async function deleteWorker(worker: Worker) {
    const due = dueAcrossLoaded(worker.id, Number(worker.daily_rate || 0));
    if (Math.abs(due) > 0.009) {
      setMessage(
        due > 0
          ? `Cannot delete ${worker.name} — ${money(due)} wage still due. Pay wage first.`
          : `Cannot delete ${worker.name} — ${money(Math.abs(due))} advance still open.`
      );
      return;
    }
    if (!window.confirm(`Delete ${worker.name}? Only allowed when dues are clear.`)) return;
    const ok = await post({ action: "deleteLabourWorker", workerId: worker.id });
    if (ok && detailWorkerId === worker.id) setDetailWorkerId(null);
  }

  async function editRates(worker: Worker) {
    const daily = window.prompt(`Daily rate for ${worker.name}`, String(worker.daily_rate || 0));
    if (daily == null) return;
    await post({
      action: "updateLabourWorker",
      workerId: worker.id,
      dailyRate: Number(daily || 0),
      halfDayRate: halfDayRate(Number(daily || 0)),
    });
  }

  function openWorker(workerId: number) {
    setDetailWorkerId(workerId);
    setPopupPaidBy("");
    setPopupWageAmount("");
    setPopupPayOutstanding(true);
    setPopupAdvanceAmount("");
    setPopupAdvancePaidBy("");
    setPopupAdvanceDate(today);
    setPopupDate(today);
  }

  function toggleAll() {
    setSelected(selected.length === active.length ? [] : active.map((w) => w.id));
  }

  return (
    <AdminShell
      title="Labour Management"
      subtitle={`Mark attendance for ${mode}. Open a worker for wage / advance and full calculation.`}
      actions={
        <button type="button" className="ad-btn ad-btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={15} /> Add worker
        </button>
      }
    >
      {message && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            /saved/i.test(message)
              ? "border-[var(--ad-success)] text-[var(--ad-success)]"
              : "border-[var(--ad-danger)] text-[var(--ad-danger)]"
          }`}
        >
          {message}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="ad-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Workers</h2>
              <p className="ad-muted text-xs">{mode} · {active.length} active · tap for details</p>
            </div>
            <button type="button" className="ad-btn ad-btn-ghost !px-2" onClick={() => setShowAdd(true)}>
              <Plus size={15} />
            </button>
          </div>
          <div className="space-y-2">
            {summaries.map(({ worker, days, due }) => (
              <button
                key={worker.id}
                type="button"
                onClick={() => openWorker(worker.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  detailWorkerId === worker.id
                    ? "border-[var(--ad-accent)] bg-[var(--ad-accent-dim)]"
                    : "border-[var(--ad-border)] hover:bg-[var(--ad-hover)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{worker.name}</p>
                    <p className="ad-muted text-xs">
                      ₹{Number(worker.daily_rate || 0)}/day · half ₹{halfDayRate(Number(worker.daily_rate || 0))}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="ad-muted">{days} day{days === 1 ? "" : "s"}</p>
                    <p className={`font-semibold ${due > 0.009 ? "text-[var(--ad-danger)]" : ""}`}>
                      {due > 0.009 ? `Due ${money(due)}` : due < -0.009 ? `Adv ${money(Math.abs(due))}` : "Clear"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
            {!active.length && (
              <p className="ad-muted text-sm">
                {mode === "PLASTIC"
                  ? "Add workers for Plastic sorting, loading, or grinding."
                  : "Add workers for PET sorting, loading, cap removal, or bale creation."}
              </p>
            )}
          </div>
          {inactive.length > 0 && (
            <div className="mt-4 border-t border-[var(--ad-border)] pt-3">
              <p className="ad-muted mb-2 text-xs uppercase tracking-wide">Disabled</p>
              {inactive.map((worker) => (
                <div key={worker.id} className="mb-2 flex items-center justify-between gap-2 text-sm">
                  <span className="ad-muted">{worker.name}</span>
                  <div className="flex gap-1">
                    <button type="button" className="ad-btn ad-btn-ghost !px-2 !py-1 text-xs" onClick={() => void reactivateWorker(worker)}>
                      Reactivate
                    </button>
                    <button type="button" className="ad-btn ad-btn-ghost !px-2 !py-1 text-xs text-[var(--ad-danger)]" onClick={() => void deleteWorker(worker)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="space-y-5">
          <form onSubmit={saveAttendance} className="ad-card space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">Mark attendance</h2>
              <p className="ad-muted text-sm">Full / half day + optional overtime. Pay wage and advance are inside each worker.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AdminSelect
                label="Task"
                value={taskType}
                onChange={setTaskType}
                options={tasks.map((t) => ({ value: t, label: t }))}
              />
              <AdminSelect
                label="Day"
                value={attendanceType}
                onChange={(v) => setAttendanceType(v as AttendanceType)}
                options={[
                  { value: "FULL_DAY", label: "Full day" },
                  { value: "HALF_DAY", label: "Half day" },
                ]}
              />
              <label className="ad-field">
                <span className="ad-field-label">Overtime hours</span>
                <input
                  className="ad-input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={overtimeHours}
                  onChange={(e) => setOvertimeHours(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="ad-field">
                <span className="ad-field-label">Date</span>
                <input
                  className="ad-input"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </label>
            </div>

            {Number(overtimeHours || 0) > 0 && (
              <p className="ad-muted text-xs">OT = (daily rate ÷ 9) × hours, added on top of full/half day.</p>
            )}

            <div className="rounded-xl border border-[var(--ad-border)] p-3">
              <div className="mb-2 flex items-center justify-between text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <Users size={14} /> Select workers
                </span>
                <button type="button" className="ad-btn ad-btn-ghost !px-2 !py-1 text-xs" onClick={toggleAll}>
                  {selected.length === active.length && active.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {active.map((worker) => (
                  <label key={worker.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-[var(--ad-hover)]">
                    <input
                      type="checkbox"
                      checked={selected.includes(worker.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, worker.id]
                            : selected.filter((id) => id !== worker.id)
                        )
                      }
                    />
                    <span className="text-sm">{worker.name}</span>
                    <span className="ad-muted text-xs">₹{Number(worker.daily_rate || 0)}/d</span>
                  </label>
                ))}
                {!active.length && <p className="ad-muted text-sm">Add a worker first.</p>}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Selected <b>{selected.length}</b>
                {selected.length > 0 ? <> · earned preview {money(totalPreview)}</> : null}
              </p>
              <button type="submit" className="ad-btn ad-btn-primary" disabled={busy || !selected.length}>
                Save attendance
              </button>
            </div>
          </form>

          {editEntry && (
            <div className="ad-card border border-[var(--ad-accent)] p-5">
              <h3 className="mb-3 font-semibold">Edit entry #{editEntry.id}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <AdminSelect
                  label="Kind"
                  value={editEntry.payment_kind || "WAGE"}
                  onChange={(v) =>
                    setEditEntry({
                      ...editEntry,
                      payment_kind: v,
                      paid_by: v === "ATTENDANCE" ? "" : editEntry.paid_by,
                    })
                  }
                  options={[
                    { value: "ATTENDANCE", label: "Attendance" },
                    { value: "WAGE", label: "Wage" },
                    { value: "ADVANCE", label: "Advance" },
                  ]}
                />
                <AdminSelect
                  label="Task"
                  value={editEntry.task_type || tasks[0]}
                  onChange={(v) => setEditEntry({ ...editEntry, task_type: v })}
                  options={tasks.map((t) => ({ value: t, label: t }))}
                />
                {(editEntry.payment_kind || "WAGE") !== "ADVANCE" && (
                  <>
                    <AdminSelect
                      label="Day"
                      value={editEntry.attendance_type || "FULL_DAY"}
                      onChange={(v) => setEditEntry({ ...editEntry, attendance_type: v })}
                      options={[
                        { value: "FULL_DAY", label: "Full day" },
                        { value: "HALF_DAY", label: "Half day" },
                      ]}
                    />
                    <label className="ad-field">
                      <span className="ad-field-label">Overtime hours</span>
                      <input
                        className="ad-input"
                        type="number"
                        min="0"
                        step="0.5"
                        value={String(editEntry.hours || "")}
                        onChange={(e) => setEditEntry({ ...editEntry, hours: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label className="ad-field">
                  <span className="ad-field-label">Date</span>
                  <input
                    className="ad-input"
                    type="date"
                    value={editEntry.payment_date}
                    onChange={(e) => setEditEntry({ ...editEntry, payment_date: e.target.value })}
                  />
                </label>
                <label className="ad-field">
                  <span className="ad-field-label">Amount</span>
                  <input
                    className="ad-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={String(editEntry.amount || "")}
                    onChange={(e) => setEditEntry({ ...editEntry, amount: Number(e.target.value) })}
                  />
                </label>
                {(editEntry.payment_kind || "WAGE") !== "ATTENDANCE" && (
                  <PersonSelect
                    value={editEntry.paid_by || ""}
                    onChange={(v) => setEditEntry({ ...editEntry, paid_by: v })}
                    required
                    label="Payment done by"
                  />
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" className="ad-btn ad-btn-primary" disabled={busy} onClick={() => void saveEdit()}>
                  Update
                </button>
                <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setEditEntry(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="ad-card p-5">
            <h2 className="mb-3 font-semibold">Recent {mode} entries</h2>
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Worker</th>
                    <th>Type</th>
                    <th>Day</th>
                    <th>Task</th>
                    <th>Amount</th>
                    <th>Done by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.payment_date}</td>
                      <td>{entry.workerName}</td>
                      <td>{kindLabel(entry.payment_kind)}</td>
                      <td>{dayLabel(entry.attendance_type, entry.hours)}</td>
                      <td>{entry.task_type || "—"}</td>
                      <td>{money(entry.amount)}</td>
                      <td>{entry.paid_by || "—"}</td>
                      <td>
                        <div className="ad-row-actions">
                          <button
                            type="button"
                            className="ad-icon-btn ad-icon-btn-accent"
                            onClick={() => setEditEntry({ ...entry })}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="ad-icon-btn ad-icon-btn-danger"
                            onClick={() => void deleteEntry(entry)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!recent.length && (
                    <tr>
                      <td colSpan={8} className="ad-muted">
                        No labour entries yet for {mode}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="ad-card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{detail.worker.name}</h3>
                <p className="ad-muted text-sm">
                  ₹{Number(detail.worker.daily_rate || 0)}/day · half ₹{halfDayRate(Number(detail.worker.daily_rate || 0))}
                  {" · "}OT = daily ÷ 9
                </p>
              </div>
              <button type="button" className="ad-btn ad-btn-ghost !px-2" onClick={() => setDetailWorkerId(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-[var(--ad-border)] p-3 text-sm">
              <span className="ad-muted">Attendance</span>
              <span className="text-right font-medium">{detail.days} day{detail.days === 1 ? "" : "s"}</span>
              <span className="ad-muted">Earned</span>
              <span className="text-right">{money(detail.earned)}</span>
              <span className="ad-muted">Wage paid</span>
              <span className="text-right">{money(detail.wagesPaid)}</span>
              <span className="ad-muted">Advance</span>
              <span className="text-right">{money(detail.advances)}</span>
              <span className="font-medium">Due to pay</span>
              <span className={`text-right font-semibold ${detail.due > 0.009 ? "text-[var(--ad-danger)]" : ""}`}>
                {money(detail.due)}
              </span>
            </div>

            <div className="mb-4 space-y-3 rounded-xl border border-[var(--ad-border)] p-3">
              <h4 className="font-semibold">Pay wage</h4>
              <label className="ad-field">
                <span className="ad-field-label">Date</span>
                <input className="ad-input" type="date" value={popupDate} onChange={(e) => setPopupDate(e.target.value)} />
              </label>
              <PersonSelect value={popupPaidBy} onChange={setPopupPaidBy} required label="Payment done by" />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`ad-btn ${popupPayOutstanding && !popupWageAmount ? "ad-btn-primary" : "ad-btn-ghost"}`}
                  onClick={() => {
                    setPopupPayOutstanding(true);
                    setPopupWageAmount("");
                  }}
                >
                  Pay due {money(Math.max(0, detail.due))}
                </button>
                <input
                  className="ad-input min-w-[8rem] flex-1"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Or custom ₹"
                  value={popupWageAmount}
                  onChange={(e) => {
                    setPopupWageAmount(e.target.value);
                    if (e.target.value) setPopupPayOutstanding(false);
                  }}
                />
              </div>
              <button
                type="button"
                className="ad-btn ad-btn-primary w-full"
                disabled={busy || (popupPayOutstanding && !(detail.due > 0.009) && !popupWageAmount)}
                onClick={() => void payWageFromPopup()}
              >
                Save wage payment
              </button>
            </div>

            <div className="mb-4 space-y-3 rounded-xl border border-[var(--ad-border)] p-3">
              <h4 className="font-semibold">Give advance</h4>
              <label className="ad-field">
                <span className="ad-field-label">Date</span>
                <input
                  className="ad-input"
                  type="date"
                  value={popupAdvanceDate}
                  onChange={(e) => setPopupAdvanceDate(e.target.value)}
                />
              </label>
              <PersonSelect
                value={popupAdvancePaidBy}
                onChange={setPopupAdvancePaidBy}
                required
                label="Payment done by"
              />
              <input
                className="ad-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="Advance ₹"
                value={popupAdvanceAmount}
                onChange={(e) => setPopupAdvanceAmount(e.target.value)}
              />
              <button
                type="button"
                className="ad-btn ad-btn-primary w-full"
                disabled={busy || !(Number(popupAdvanceAmount) > 0) || !popupAdvancePaidBy}
                onClick={() => void giveAdvanceFromPopup()}
              >
                Save advance
              </button>
            </div>

            <div className="mb-2 flex flex-wrap gap-2">
              <button type="button" className="ad-btn ad-btn-ghost text-xs" onClick={() => void editRates(detail.worker)}>
                Edit rate
              </button>
              <button type="button" className="ad-btn ad-btn-ghost text-xs" onClick={() => void disableWorker(detail.worker)}>
                Disable
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-ghost text-xs text-[var(--ad-danger)]"
                onClick={() => void deleteWorker(detail.worker)}
              >
                Delete
              </button>
            </div>

            <div className="ad-table-wrap mt-3">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Day</th>
                    <th>₹</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.entries.slice(0, 20).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.payment_date}</td>
                      <td>{kindLabel(entry.payment_kind)}</td>
                      <td>{dayLabel(entry.attendance_type, entry.hours)}</td>
                      <td>{money(entry.amount)}</td>
                    </tr>
                  ))}
                  {!detail.entries.length && (
                    <tr>
                      <td colSpan={4} className="ad-muted">
                        No entries yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={addWorker} className="ad-card w-full max-w-md space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Add worker</h3>
              <button type="button" className="ad-btn ad-btn-ghost !px-2" onClick={() => setShowAdd(false)}>
                <X size={16} />
              </button>
            </div>
            <input
              className="ad-input"
              placeholder="Worker name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="ad-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Daily rate ₹"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
            />
            <p className="ad-muted text-xs">
              Half day = daily ÷ 2. OT = daily ÷ 9 × hours.
            </p>
            <button type="submit" className="ad-btn ad-btn-primary w-full" disabled={busy}>
              Save worker
            </button>
          </form>
        </div>
      )}
    </AdminShell>
  );
}
