"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { adminToast } from "@/components/admin-shell";

export { inr, kgText } from "@/lib/business/math";

export function useCanWrite() {
  const [canWrite, setCanWrite] = useState(true);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setCanWrite(d.canWrite !== false && d.role !== "readonly");
      })
      .catch(() => undefined);
  }, []);
  return canWrite;
}

export function useBizData<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load");
      setData(j as T);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, reload: load };
}

export async function postBiz(url: string, body: Record<string, unknown>, successText = "Saved") {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      adminToast(j.error || "Could not save");
      return { ok: false as const, error: String(j.error || "Could not save"), result: null };
    }
    if (successText) adminToast(successText);
    return { ok: true as const, error: "", result: j.result };
  } catch {
    adminToast("Network problem. Please try again.");
    return { ok: false as const, error: "Network problem", result: null };
  }
}

export const todayStr = () => new Date().toISOString().slice(0, 10);

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="ad-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">{label}</p>
      <p
        className={clsx(
          "mt-1 text-xl font-bold tabular-nums sm:text-2xl",
          tone === "good" && "text-emerald-400",
          tone === "bad" && "text-red-400"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-[var(--ad-muted)]">{hint}</p> : null}
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("ad-field", className)}>
      <span className="ad-field-label">{label}</span>
      {children}
    </label>
  );
}

export function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="ad-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">{title}</h2>
          {subtitle ? <p className="ad-muted mt-0.5 text-xs">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-[var(--ad-border)] px-4 py-6 text-center text-sm text-[var(--ad-muted)]">{children}</p>;
}

export function Loading() {
  return <div className="ad-card p-6 text-sm text-[var(--ad-muted)]">Loading…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="ad-card border-red-500/40 p-4 text-sm text-red-400">{message}</div>;
}

export function ProfitText({ value, className }: { value: number; className?: string }) {
  return <span className={clsx(value < 0 ? "text-red-400" : "text-emerald-400", "font-semibold tabular-nums", className)}>{value < 0 ? "-" : ""}₹{Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>;
}
