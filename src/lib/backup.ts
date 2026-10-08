import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import { closeDb } from "@/db";

const configuredDataDir = process.env.NAVRIT_DATA_DIR?.trim();
export const DATA_DIR =
  configuredDataDir ||
  (process.env.NODE_ENV === "production" ? "/app/data" : path.join(process.cwd(), "data"));
export const DB_FILE =
  process.env.NAVRIT_DB_PATH?.trim() || path.join(DATA_DIR, "plastic-rates.db");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");

const MAX_BACKUPS = 30;

export type BackupInfo = {
  filename: string;
  size: number;
  createdAt: string;
  checksum: string;
};

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Safe online backup via SQLite VACUUM INTO (consistent snapshot). */
export function createBackup(reason = "manual"): BackupInfo {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    throw new Error("Database file not found. Run npm run db:seed first.");
  }

  const filename = `plastic-rates-${stamp()}-${reason.replace(/[^a-z0-9_-]/gi, "")}.db`;
  const dest = path.join(BACKUP_DIR, filename);

  // Use a short-lived connection so VACUUM INTO works even if app has the DB open
  const db = new DatabaseSync(DB_FILE);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.prepare(`VACUUM INTO ?`).run(dest);
  } finally {
    db.close();
  }

  const checksum = sha256File(dest);
  const metaPath = dest + ".sha256";
  fs.writeFileSync(metaPath, `${checksum}  ${filename}\n`, "utf8");

  pruneOldBackups();

  const stat = fs.statSync(dest);
  return {
    filename,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
    checksum,
  };
}

export function listBackups(): BackupInfo[] {
  ensureDirs();
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db") && f.startsWith("plastic-rates-"))
    .sort()
    .reverse();

  return files.map((filename) => {
    const full = path.join(BACKUP_DIR, filename);
    const stat = fs.statSync(full);
    const meta = full + ".sha256";
    let checksum = "";
    if (fs.existsSync(meta)) {
      checksum = fs.readFileSync(meta, "utf8").split(/\s+/)[0] || "";
    } else {
      checksum = sha256File(full);
    }
    return {
      filename,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
      checksum,
    };
  });
}

export function resolveBackupPath(filename: string) {
  const safe = path.basename(filename);
  if (!safe.startsWith("plastic-rates-") || !safe.endsWith(".db")) {
    throw new Error("Invalid backup filename");
  }
  const full = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(full)) throw new Error("Backup not found");
  // Prevent path escape
  if (!full.startsWith(BACKUP_DIR)) throw new Error("Invalid backup path");
  return full;
}

export function verifyBackup(filename: string) {
  const full = resolveBackupPath(filename);
  const actual = sha256File(full);
  const meta = full + ".sha256";
  if (!fs.existsSync(meta)) return { ok: true, actual, expected: null as string | null };
  const expected = fs.readFileSync(meta, "utf8").split(/\s+/)[0];
  return { ok: actual === expected, actual, expected };
}

/**
 * Restore replaces live DB. Always creates a safety backup of current DB first.
 * Caller must stop the app (or accept brief inconsistency) for safest restore.
 */
export function restoreBackup(filename: string) {
  ensureDirs();
  const source = resolveBackupPath(filename);
  const check = verifyBackup(filename);
  if (!check.ok) {
    throw new Error(`Checksum mismatch — backup may be corrupt (${check.actual} ≠ ${check.expected})`);
  }

  // Disconnect the app's singleton before replacing the live database.
  // The singleton must be reset or future writes can continue against the old inode.
  closeDb();

  // Safety net: backup current DB before overwrite
  if (fs.existsSync(DB_FILE)) {
    createBackup("pre-restore");
  }

  // Checkpoint and close any WAL, then replace.
  try {
    const live = new DatabaseSync(DB_FILE);
    live.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    live.close();
  } catch {
    /* db may not exist yet */
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_FILE + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  fs.copyFileSync(source, DB_FILE);
  closeDb();
  return { restored: filename, safetyBackup: true };
}

function pruneOldBackups() {
  const all = listBackups();
  if (all.length <= MAX_BACKUPS) return;
  for (const old of all.slice(MAX_BACKUPS)) {
    const full = path.join(BACKUP_DIR, old.filename);
    try {
      fs.unlinkSync(full);
      if (fs.existsSync(full + ".sha256")) fs.unlinkSync(full + ".sha256");
    } catch {
      /* ignore */
    }
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
