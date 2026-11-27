import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { assertPersistentDataDir, resolveBackupDir, resolveDataDir } from "@/lib/data-paths";
import { ensureBusinessSchema } from "@/db/business-schema";

/**
 * NAVRIT 2.0 lives in its own SQLite file (navrit2.db), completely separate from the
 * PET / Plastic database (plastic-rates.db). Nothing here opens, reads or writes the old file.
 */

const dataDir = resolveDataDir();

export const BIZ_DB_FILE = process.env.NAVRIT2_DB_PATH?.trim() || path.join(dataDir, "navrit2.db");

const globalForBizDb = globalThis as unknown as { __navrit2Db?: DatabaseSync };

function shouldUseMemory() {
  return (
    process.env.NAVRIT_SQLITE_MEMORY === "1" ||
    process.env.npm_lifecycle_event === "build" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  );
}

function createBizDb() {
  const memory = shouldUseMemory();
  if (!memory) {
    assertPersistentDataDir(dataDir);
    fs.mkdirSync(path.dirname(BIZ_DB_FILE), { recursive: true });
  }
  const db = new DatabaseSync(memory ? ":memory:" : BIZ_DB_FILE);
  db.exec("PRAGMA busy_timeout = 10000;");
  if (!memory) {
    try {
      db.exec("PRAGMA journal_mode = WAL;");
    } catch {
      /* another process may hold the lock briefly */
    }
    db.exec("PRAGMA synchronous = FULL;");
  }
  db.exec("PRAGMA foreign_keys = ON;");
  ensureBusinessSchema(db);
  return db;
}

function getBizDb() {
  if (!globalForBizDb.__navrit2Db) globalForBizDb.__navrit2Db = createBizDb();
  return globalForBizDb.__navrit2Db;
}

export function closeBizDb() {
  const db = globalForBizDb.__navrit2Db;
  if (!db) return;
  db.close();
  delete globalForBizDb.__navrit2Db;
}

export const bizDb = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const db = getBizDb();
    const value = Reflect.get(db, prop, db);
    return typeof value === "function" ? value.bind(db) : value;
  },
});

const MAX_BIZ_BACKUPS = 30;

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Consistent copy of navrit2.db into the shared backup folder. */
export function createBizBackup(reason = "manual") {
  if (shouldUseMemory() || !fs.existsSync(BIZ_DB_FILE)) return null;
  const dir = resolveBackupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `navrit2-${stamp()}-${reason.replace(/[^a-z0-9_-]/gi, "")}.db`;
  const dest = path.join(dir, filename);
  getBizDb().prepare("VACUUM INTO ?").run(dest);
  const all = listBizBackups();
  for (const old of all.slice(MAX_BIZ_BACKUPS)) {
    try {
      fs.unlinkSync(path.join(dir, old.filename));
    } catch {
      /* ignore */
    }
  }
  return filename;
}

export function listBizBackups() {
  const dir = resolveBackupDir(dataDir);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("navrit2-") && f.endsWith(".db"))
      .sort()
      .reverse()
      .map((filename) => {
        const stat = fs.statSync(path.join(dir, filename));
        return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}
