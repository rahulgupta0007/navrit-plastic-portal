"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminShell, adminToast } from "@/components/admin-shell";
import {
  Download,
  HardDrive,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";

type BackupRow = {
  filename: string;
  size: number;
  sizeLabel: string;
  createdAt: string;
  checksum: string;
};

type PackRow = {
  filename: string;
  size: number;
  sizeLabel: string;
  createdAt: string;
};

type EnvRow = {
  key: string;
  set: boolean;
  secret: boolean;
  value?: string;
};

type Status = {
  dbExists: boolean;
  dbPath: string;
  dataDir: string;
  dbSizeLabel: string;
  tableCounts: Record<string, number>;
  env: EnvRow[];
  envSetCount: number;
  envMissing: string[];
};

export default function AdminBackupPage() {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/backup");
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    const data = await res.json();
    setBackups(data.backups || []);
    setPacks(data.migrationPacks || []);
    setStatus(data.status || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    const res = await fetch("/api/admin/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "admin" }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      adminToast(data.error || "Backup failed");
      return;
    }
    adminToast(`Backup saved · ${data.backup.filename}`);
    load();
  }

  async function downloadMigrationPack() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "downloadMigrationPack" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        adminToast(data.error || "Migration pack failed");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match?.[1] || `navrit-migration-${Date.now()}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      adminToast(`Downloaded ${filename} — keep it private (includes secrets)`);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function restore(filename: string) {
    if (
      !window.confirm(
        `Restore ${filename}?\n\nThis replaces the live database. A safety backup of the current DB is created first. Restart the server after restore.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", filename }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        adminToast(data.error || `Restore failed (HTTP ${res.status})`);
        return;
      }
      adminToast("Restored. Restart / redeploy the app to reload connections.");
      load();
    } catch (e) {
      adminToast(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    const file = importFile;
    if (!file) {
      adminToast("Choose a .zip or .db file first");
      fileRef.current?.focus();
      return;
    }
    if (confirmText.trim() !== "RESTORE") {
      adminToast("Type RESTORE in the confirm box before importing");
      return;
    }
    if (
      !window.confirm(
        `Import ${file.name}?\n\nThis REPLACES all live business data. A safety backup is created first. After import, restart/redeploy the app.`
      )
    ) {
      return;
    }

    setBusy(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.set("confirm", "RESTORE");
      form.set("file", file);
      const res = await fetch("/api/admin/backup", { method: "POST", body: form });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        adminToast(`Import failed (HTTP ${res.status})`);
        return;
      }
      if (!res.ok) {
        adminToast(String(data.error || "Import failed"));
        return;
      }

      const tableCounts = (data.tableCounts || {}) as Record<string, number>;
      const counts = Object.entries(tableCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      const lines = [
        String(data.message || "Import complete"),
        `Checksum: ${data.checksum || "—"}`,
        `Size: ${data.sizeLabel || "—"}`,
        counts ? `Rows — ${counts}` : "",
      ].filter(Boolean);

      if (data.envText) {
        lines.push(
          "",
          "Env file was inside the zip — paste railway-variables.env into Railway → Variables on the new project (secrets are not auto-applied)."
        );
      }

      setImportResult(lines.join("\n"));
      adminToast("Import complete — restart/redeploy the app");
      setConfirmText("");
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e) {
      adminToast(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const tableEntries = status?.tableCounts
    ? Object.entries(status.tableCounts).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <AdminShell
      title="Backup & Recovery"
      subtitle="Full migration packs · SQLite snapshots · SHA-256 verified"
      actions={
        <>
          <button type="button" className="ad-btn ad-btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button type="button" className="ad-btn ad-btn-ghost" onClick={create} disabled={busy}>
            <HardDrive size={14} /> {busy ? "Working…" : "DB snapshot"}
          </button>
          <button
            type="button"
            className="ad-btn ad-btn-primary"
            onClick={downloadMigrationPack}
            disabled={busy}
          >
            <Package size={14} /> {busy ? "Working…" : "Export migration pack"}
          </button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="ad-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">
            Live database
          </p>
          <p className="mt-1 text-sm">{status?.dbSizeLabel || "—"}</p>
          <p className="mt-1 truncate text-xs text-[var(--ad-muted)]" title={status?.dbPath}>
            {status?.dbPath || "data/plastic-rates.db"}
          </p>
        </div>
        <div className="ad-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">
            Env variables
          </p>
          <p className="mt-1 text-sm">
            {status ? `${status.envSetCount} set` : "—"}
            {status?.envMissing?.length ? (
              <span className="text-[var(--ad-muted)]"> · {status.envMissing.length} empty</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-[var(--ad-muted)]">Included in migration pack</p>
        </div>
        <div className="ad-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">
            Retention
          </p>
          <p className="mt-1 text-sm">Last 30 DB snapshots</p>
          <p className="mt-1 text-xs text-[var(--ad-muted)]">Migration zips kept on volume</p>
        </div>
      </div>

      <div className="ad-card mb-4 border border-[var(--ad-accent)]/30 p-4 text-sm text-[var(--ad-muted)]">
        <p className="inline-flex items-center gap-2 font-semibold text-[var(--ad-text)]">
          <ShieldCheck size={16} className="text-[var(--ad-accent)]" />
          Migrate to a new Railway account
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Click <strong className="text-[var(--ad-text)]">Export migration pack</strong> and save
            the zip on your laptop (contains every table + Railway variables with secrets).
          </li>
          <li>
            Create the new Railway project from the same GitHub repo, attach volume at{" "}
            <code className="text-[var(--ad-accent)]">/app/data</code>, paste{" "}
            <code className="text-[var(--ad-accent)]">railway-variables.env</code> into Variables,
            deploy once.
          </li>
          <li>
            On the new site → Backup → upload the zip, type <code>RESTORE</code>, import, then
            redeploy/restart.
          </li>
        </ol>
        <p className="mt-2 text-xs">
          Never commit the zip or <code>railway-variables.env</code> to git. Keep a local copy as
          your off-site backup.
        </p>
      </div>

      <div className="ad-card mb-4 p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ad-text)]">
          <Upload size={16} className="text-[var(--ad-accent)]" />
          Import on this system
        </p>
        <p className="mt-1 text-xs text-[var(--ad-muted)]">
          1) Choose a <code>navrit-migration-*.zip</code> or <code>plastic-rates*.db</code> · 2) Type{" "}
          <strong className="text-[var(--ad-text)]">RESTORE</strong> · 3) Click Import. Replaces live
          data after a safety snapshot.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-xs">
            <span className="mb-1 block text-[var(--ad-muted)]">Migration file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.db,application/zip,application/octet-stream"
              className="ad-input w-full cursor-pointer text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--ad-accent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
            {importFile ? (
              <span className="mt-1 block truncate font-mono text-[10px] text-[var(--ad-accent)]">
                Selected: {importFile.name} ({Math.max(1, Math.round(importFile.size / 1024))} KB)
              </span>
            ) : (
              <span className="mt-1 block text-[10px] text-[var(--ad-muted)]">No file selected yet</span>
            )}
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-[var(--ad-muted)]">
              Type <strong className="text-[var(--ad-text)]">RESTORE</strong> to unlock
            </span>
            <input
              className="ad-input w-full font-mono"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESTORE"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ad-btn ad-btn-danger"
              disabled={busy || !importFile || confirmText.trim() !== "RESTORE"}
              onClick={runImport}
            >
              <Upload size={14} /> {busy ? "Importing…" : "Import / Restore"}
            </button>
            <a href="/api/admin/backup?envTemplate=1" className="ad-btn ad-btn-ghost">
              <Download size={14} /> Env template
            </a>
          </div>
        </div>
        {importResult ? (
          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-[var(--ad-bg)] p-3 text-[11px] leading-relaxed text-[var(--ad-muted)] whitespace-pre-wrap">
            {importResult}
          </pre>
        ) : null}
      </div>

      {tableEntries.length > 0 ? (
        <div className="ad-card mb-4 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ad-muted)]">
            Live table row counts
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {tableEntries.map(([name, n]) => (
              <span key={name} className="font-mono text-[var(--ad-muted)]">
                <span className="text-[var(--ad-text)]">{name}</span> {n}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {status?.env?.length ? (
        <div className="ad-card mb-4 overflow-hidden">
          <div className="border-b border-[var(--ad-border)] px-4 py-3">
            <p className="text-sm font-semibold text-[var(--ad-text)]">Configuration snapshot</p>
            <p className="text-xs text-[var(--ad-muted)]">
              Values shown redacted here · full secrets only inside the migration zip download
            </p>
          </div>
          <div className="ad-table-wrap max-h-64 overflow-auto">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Status</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {status.env.map((e) => (
                  <tr key={e.key}>
                    <td className="font-mono text-xs">{e.key}</td>
                    <td className="text-xs">
                      {e.set ? (
                        <span className="text-[var(--ad-accent)]">set{e.secret ? " · secret" : ""}</span>
                      ) : (
                        <span className="text-[var(--ad-muted)]">empty</span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate font-mono text-[10px] text-[var(--ad-muted)]">
                      {e.set ? e.value || "—" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--ad-text)]">Migration packs on server</h2>
      </div>
      {loading ? (
        <div className="mb-4 space-y-2">
          <div className="ad-skeleton h-12" />
        </div>
      ) : packs.length === 0 ? (
        <div className="ad-card mb-4 p-6 text-center text-sm text-[var(--ad-muted)]">
          No migration packs on the volume yet. Use Export migration pack to create one (also
          downloads to your laptop).
        </div>
      ) : (
        <div className="ad-table-wrap mb-4">
          <table className="ad-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.filename}>
                  <td className="font-mono text-xs">{p.filename}</td>
                  <td>{p.sizeLabel}</td>
                  <td className="text-[var(--ad-muted)]">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <a
                      href={`/api/admin/backup?migrationDownload=${encodeURIComponent(p.filename)}`}
                      className="ad-btn ad-btn-ghost !py-1 !text-xs"
                    >
                      <Download size={12} /> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--ad-text)]">Database snapshots</h2>
      </div>
      <div className="ad-card mb-4 p-4 text-sm text-[var(--ad-muted)]">
        <p>
          Snapshots use SQLite <code className="text-[var(--ad-accent)]">VACUUM INTO</code>. For a
          full Railway move prefer the migration pack (DB + variables). Or run{" "}
          <code className="text-[var(--ad-accent)]">npm run deploy:safe</code> before upgrades.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="ad-skeleton h-12" />
          <div className="ad-skeleton h-12" />
        </div>
      ) : backups.length === 0 ? (
        <div className="ad-card p-8 text-center text-sm text-[var(--ad-muted)]">
          No DB snapshots yet. Create one before deploying a new version, or export a migration pack.
        </div>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Created</th>
                <th>Checksum</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.filename}>
                  <td className="font-mono text-xs">{b.filename}</td>
                  <td>{b.sizeLabel}</td>
                  <td className="text-[var(--ad-muted)]">
                    {new Date(b.createdAt).toLocaleString()}
                  </td>
                  <td className="font-mono text-[10px] text-[var(--ad-muted)]">
                    {b.checksum.slice(0, 16)}…
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/admin/backup?download=${encodeURIComponent(b.filename)}`}
                        className="ad-btn ad-btn-ghost !py-1 !text-xs"
                      >
                        <Download size={12} /> Download
                      </a>
                      <button
                        type="button"
                        className="ad-btn ad-btn-danger !py-1 !text-xs"
                        disabled={busy}
                        onClick={() => restore(b.filename)}
                      >
                        <RotateCcw size={12} /> Restore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
