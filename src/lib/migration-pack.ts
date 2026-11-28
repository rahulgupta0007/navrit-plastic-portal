import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import { closeDb } from "@/db";
import { BACKUP_DIR, DATA_DIR, DB_FILE, createBackup, formatBytes } from "@/lib/backup";
import {
  assertPersistentDataDir,
  getDataPersistenceInfo,
  resolveDataDir,
} from "@/lib/data-paths";

/** Env keys we care about for an exact Railway copy. */
export const MIGRATION_ENV_KEYS = [
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "READONLY_USERNAME",
  "READONLY_PASSWORD",
  "AUTH_SECRET",
  "NAVRIT_DATA_DIR",
  "NAVRIT_DB_PATH",
  "NAVI_API_KEY",
  "OPENAI_API_KEY",
  "NAVI_API_BASE",
  "NAVI_MODEL",
  "NEXT_PUBLIC_BUSINESS_NAME",
  "NEXT_PUBLIC_BUSINESS_TAGLINE",
  "NEXT_PUBLIC_OWNER_NAME",
  "NEXT_PUBLIC_PHONE",
  "NEXT_PUBLIC_WHATSAPP",
  "NEXT_PUBLIC_EMAIL",
  "NEXT_PUBLIC_ADDRESS",
  "NEXT_PUBLIC_GSTIN",
  "NEXT_PUBLIC_MAPS_EMBED_URL",
  "NEXT_PUBLIC_MAPS_LINK",
  "NEXT_PUBLIC_BUSINESS_HOURS",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "NOTIFY_EMAIL",
  "NOTIFY_EMAILS",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_PURCHASE_TEMPLATE",
  "WHATSAPP_PAYMENT_TEMPLATE",
  "WHATSAPP_TEMPLATE_LANG",
  "WHATSAPP_OFFICE_NOTIFY_PHONES",
] as const;

const SECRET_ENV_KEYS = new Set([
  "ADMIN_PASSWORD",
  "READONLY_PASSWORD",
  "AUTH_SECRET",
  "NAVI_API_KEY",
  "OPENAI_API_KEY",
  "GMAIL_APP_PASSWORD",
  "RESEND_API_KEY",
  "WHATSAPP_TOKEN",
]);

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function collectTableCounts(dbPath: string): Record<string, number> {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get() as { n: number };
        counts[t.name] = Number(row?.n || 0);
      } catch {
        counts[t.name] = -1;
      }
    }
    return counts;
  } finally {
    db.close();
  }
}

function assertSqliteFile(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    const header = buf.toString("utf8");
    if (!header.startsWith("SQLite format 3")) {
      throw new Error("Uploaded file is not a valid SQLite database");
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function buildEnvSnapshot(includeSecretValues: boolean) {
  const variables: Array<{
    key: string;
    set: boolean;
    secret: boolean;
    value?: string;
  }> = [];

  for (const key of MIGRATION_ENV_KEYS) {
    const raw = process.env[key];
    const set = raw !== undefined && String(raw).length > 0;
    const secret = SECRET_ENV_KEYS.has(key);
    const entry: { key: string; set: boolean; secret: boolean; value?: string } = {
      key,
      set,
      secret,
    };
    if (set) {
      if (!secret || includeSecretValues) {
        entry.value = String(raw);
      } else {
        entry.value = "***SET***";
      }
    }
    variables.push(entry);
  }

  // Also capture any other NAVRIT_ / NEXT_PUBLIC_ keys present at runtime
  for (const key of Object.keys(process.env).sort()) {
    if (MIGRATION_ENV_KEYS.includes(key as (typeof MIGRATION_ENV_KEYS)[number])) continue;
    if (!/^(NAVRIT_|NEXT_PUBLIC_|ADMIN_|AUTH_|NAVI_|GMAIL_|RESEND_|NOTIFY_|SMTP_|WHATSAPP_)/.test(key)) {
      continue;
    }
    const raw = process.env[key];
    if (raw === undefined || String(raw).length === 0) continue;
    const secret = /PASSWORD|SECRET|TOKEN|KEY|APP_PASSWORD/i.test(key);
    variables.push({
      key,
      set: true,
      secret,
      value: includeSecretValues || !secret ? String(raw) : "***SET***",
    });
  }

  return variables;
}

export function envSnapshotToDotEnv(
  variables: ReturnType<typeof buildEnvSnapshot>,
  opts?: { redactSecrets?: boolean }
) {
  const lines = [
    "# NAVRIT Railway / env migration file",
    `# Generated: ${new Date().toISOString()}`,
    "# Paste these into Railway → Variables (or .env.local).",
    "# SECRET values included only in full migration packs — keep this file private.",
    "",
  ];
  for (const v of variables) {
    if (!v.set) {
      lines.push(`# ${v.key}=`);
      continue;
    }
    const val = opts?.redactSecrets && v.secret ? "REPLACE_ME" : (v.value ?? "");
    const needsQuotes = /[\s#"']/.test(val) || val.includes("<") || val.includes(">");
    lines.push(`${v.key}=${needsQuotes ? JSON.stringify(val) : val}`);
  }
  lines.push("");
  return lines.join("\n");
}

export type MigrationPackMeta = {
  app: string;
  version: number;
  createdAt: string;
  dbFilename: string;
  dbChecksum: string;
  dbSize: number;
  tableCounts: Record<string, number>;
  envKeysSet: string[];
  envKeysMissing: string[];
  notes: string[];
};

/**
 * Build a zip migration pack: full SQLite DB + railway-variables.env + manifest.json + README.
 * Includes secret values so a new Railway can be an exact copy (admin-only download).
 */
export async function createMigrationPackBuffer(): Promise<{
  filename: string;
  buffer: Buffer;
  meta: MigrationPackMeta;
  sizeLabel: string;
}> {
  ensureDirs();
  const backup = createBackup("migration");
  const dbPath = path.join(BACKUP_DIR, backup.filename);
  const dbBuf = fs.readFileSync(dbPath);
  const tableCounts = collectTableCounts(dbPath);
  const envVars = buildEnvSnapshot(true);
  const envKeysSet = envVars.filter((v) => v.set).map((v) => v.key);
  const envKeysMissing = envVars.filter((v) => !v.set).map((v) => v.key);

  const meta: MigrationPackMeta = {
    app: "navrit-plastic-portal",
    version: 1,
    createdAt: new Date().toISOString(),
    dbFilename: "plastic-rates.db",
    dbChecksum: backup.checksum,
    dbSize: backup.size,
    tableCounts,
    envKeysSet,
    envKeysMissing,
    notes: [
      "1. Create a new Railway project from the same GitHub repo.",
      "2. Attach a persistent volume at /app/data (same as current).",
      "3. Paste variables from railway-variables.env into Railway → Variables.",
      "4. Deploy once so the app starts.",
      "5. Login → Backup → Import migration pack (or upload plastic-rates.db) and confirm RESTORE.",
      "6. Redeploy/restart so SQLite reloads the imported file.",
      "NEVER commit railway-variables.env to git — it contains secrets.",
    ],
  };

  const readme = [
    "# NAVRIT migration pack",
    "",
    `Created: ${meta.createdAt}`,
    `DB checksum (SHA-256): ${meta.dbChecksum}`,
    `DB size: ${formatBytes(meta.dbSize)}`,
    "",
    "## Contents",
    "- `plastic-rates.db` — full business data (purchases, sales, labour, accounts, …)",
    "- `railway-variables.env` — Railway env vars including secrets (keep private)",
    "- `manifest.json` — checksums + row counts for verification",
    "",
    "## Restore on a new Railway",
    ...meta.notes.map((n) => `- ${n}`),
    "",
    "## Table row counts at export",
    ...Object.entries(tableCounts).map(([k, v]) => `- ${k}: ${v}`),
    "",
  ].join("\n");

  const zip = new JSZip();
  zip.file("plastic-rates.db", dbBuf);
  zip.file("plastic-rates.db.sha256", `${backup.checksum}  plastic-rates.db\n`);
  zip.file("railway-variables.env", envSnapshotToDotEnv(envVars));
  zip.file("manifest.json", JSON.stringify(meta, null, 2));
  zip.file("README-MIGRATE.md", readme);

  const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const filename = `navrit-migration-${stamp()}.zip`;
  // Keep a server copy too
  fs.writeFileSync(path.join(BACKUP_DIR, filename), buffer);

  return {
    filename,
    buffer,
    meta,
    sizeLabel: formatBytes(buffer.length),
  };
}

export function listMigrationPacks() {
  ensureDirs();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("navrit-migration-") && f.endsWith(".zip"))
    .sort()
    .reverse()
    .map((filename) => {
      const full = path.join(BACKUP_DIR, filename);
      const stat = fs.statSync(full);
      return {
        filename,
        size: stat.size,
        sizeLabel: formatBytes(stat.size),
        createdAt: stat.mtime.toISOString(),
      };
    });
}

export function resolveMigrationPackPath(filename: string) {
  const safe = path.basename(filename);
  if (!safe.startsWith("navrit-migration-") || !safe.endsWith(".zip")) {
    throw new Error("Invalid migration pack filename");
  }
  const full = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(full)) throw new Error("Migration pack not found");
  if (!full.startsWith(BACKUP_DIR)) throw new Error("Invalid path");
  return full;
}

/**
 * Import a raw SQLite DB buffer (from laptop upload or unzipped pack).
 * Replaces live DB after safety backup. Requires confirmToken === "RESTORE".
 */
export function importDatabaseBuffer(buf: Buffer, label = "upload") {
  // Never import onto ephemeral image disk — that is how data "imports then vanishes".
  assertPersistentDataDir(resolveDataDir());
  ensureDirs();
  if (!buf || buf.length < 100) throw new Error("Empty or invalid database upload");
  const header = buf.subarray(0, 16).toString("utf8");
  if (!header.startsWith("SQLite format 3")) {
    throw new Error("File is not a valid SQLite database (expected SQLite format 3 header)");
  }

  const tmpName = `plastic-rates-${stamp()}-import-${label.replace(/[^a-z0-9_-]/gi, "")}.db`;
  const tmpPath = path.join(BACKUP_DIR, tmpName);
  fs.writeFileSync(tmpPath, buf);
  assertSqliteFile(tmpPath);

  // Quick integrity: open read-only and count tables
  const counts = collectTableCounts(tmpPath);
  const checksum = crypto.createHash("sha256").update(buf).digest("hex");
  fs.writeFileSync(tmpPath + ".sha256", `${checksum}  ${tmpName}\n`, "utf8");

  closeDb();
  if (fs.existsSync(DB_FILE)) {
    createBackup("pre-import");
  }

  try {
    const live = new DatabaseSync(DB_FILE);
    live.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    live.close();
  } catch {
    /* may not exist */
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_FILE + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  fs.copyFileSync(tmpPath, DB_FILE);
  closeDb();

  return {
    ok: true as const,
    importedAs: tmpName,
    checksum,
    tableCounts: counts,
    sizeLabel: formatBytes(buf.length),
  };
}

/**
 * Import a migration zip (contains plastic-rates.db). Env file is returned for display — not applied automatically.
 */
export async function importMigrationPackBuffer(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const dbEntry =
    zip.file("plastic-rates.db") ||
    Object.values(zip.files).find((f) => !f.dir && f.name.endsWith(".db") && !f.name.includes("/"));
  if (!dbEntry) throw new Error("Migration pack missing plastic-rates.db");

  const dbBuf = Buffer.from(await dbEntry.async("nodebuffer"));
  const result = importDatabaseBuffer(dbBuf, "pack");

  let envText = "";
  const envEntry = zip.file("railway-variables.env");
  if (envEntry) envText = await envEntry.async("string");

  let manifest: MigrationPackMeta | null = null;
  const manEntry = zip.file("manifest.json");
  if (manEntry) {
    try {
      manifest = JSON.parse(await manEntry.async("string")) as MigrationPackMeta;
    } catch {
      manifest = null;
    }
  }

  return { ...result, envText, manifest };
}

export function getMigrationStatus() {
  const envVars = buildEnvSnapshot(false);
  let dbSize = 0;
  let dbExists = false;
  let tableCounts: Record<string, number> = {};
  if (fs.existsSync(DB_FILE)) {
    dbExists = true;
    dbSize = fs.statSync(DB_FILE).size;
    try {
      tableCounts = collectTableCounts(DB_FILE);
    } catch {
      tableCounts = {};
    }
  }
  const purchases = Number(tableCounts.purchases || 0);
  const sales = Number(tableCounts.sales || 0);
  const persistence = getDataPersistenceInfo();
  const looksEmpty = dbExists && purchases === 0 && sales === 0 && Number(tableCounts.inventory_transactions || 0) === 0;

  return {
    dbExists,
    dbPath: DB_FILE,
    dataDir: DATA_DIR,
    dbSize,
    dbSizeLabel: formatBytes(dbSize),
    tableCounts,
    env: envVars,
    envSetCount: envVars.filter((v) => v.set).length,
    envMissing: envVars.filter((v) => !v.set).map((v) => v.key),
    migrationPacks: listMigrationPacks(),
    persistence,
    looksEmpty,
    emptyWarning: looksEmpty
      ? "Database looks empty (no purchases/sales). If this followed a deploy, the Railway Volume may be missing or new — import a migration pack, or remount the old volume at /app/data."
      : null,
  };
}
