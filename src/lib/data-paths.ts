import fs from "fs";
import path from "path";

/**
 * Resolve where SQLite lives.
 *
 * On Railway, the container filesystem is wiped every deploy. Data must sit on a
 * Volume mounted at /app/data (or NAVRIT_DATA_DIR / RAILWAY_VOLUME_MOUNT_PATH).
 */
export function isRailwayRuntime() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH
  );
}

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || isRailwayRuntime();
}

export function resolveDataDir() {
  const configured = process.env.NAVRIT_DATA_DIR?.trim();
  if (configured) return configured;

  const railwayMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayMount) return railwayMount;

  if (isProductionRuntime()) return "/app/data";
  return path.join(process.cwd(), "data");
}

export function resolveDbFile(dataDir = resolveDataDir()) {
  return process.env.NAVRIT_DB_PATH?.trim() || path.join(dataDir, "plastic-rates.db");
}

export function resolveBackupDir(dataDir = resolveDataDir()) {
  return path.join(dataDir, "backups");
}

/** Look for an existing DB if the configured path is empty (path migration / wrong mount). */
export function findExistingDbCandidates(preferred: string): string[] {
  const extras = [
    preferred,
    "/app/data/plastic-rates.db",
    "/data/plastic-rates.db",
    path.join(process.cwd(), "data", "plastic-rates.db"),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of extras) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * If the live DB file is missing but a VACUUM backup exists on the volume,
 * copy the newest backup into place before the app opens SQLite.
 */
export function tryRestoreDbFromBackups(dbFile: string, backupDir: string): string | null {
  if (fs.existsSync(dbFile) && fs.statSync(dbFile).size > 100) return null;
  if (!fs.existsSync(backupDir)) return null;

  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith("plastic-rates-") && f.endsWith(".db"))
    .map((f) => {
      const full = path.join(backupDir, f);
      return { full, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
    })
    .filter((b) => b.size > 100)
    .sort((a, b) => b.mtime - a.mtime);

  const newest = backups[0];
  if (!newest) return null;

  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.copyFileSync(newest.full, dbFile);
  console.warn(
    `[navrit] Restored missing database from backup ${path.basename(newest.full)} → ${dbFile}`
  );
  return newest.full;
}

export function assertPersistentDataDir(dataDir: string) {
  if (!isProductionRuntime()) return;

  if (!fs.existsSync(dataDir)) {
    throw new Error(
      [
        `Persistent data directory missing: ${dataDir}`,
        "On Railway: attach a Volume to this service with mount path /app/data",
        "(or set NAVRIT_DATA_DIR to your volume mount path), then redeploy.",
        "Without a volume, every deploy wipes the SQLite database.",
      ].join(" ")
    );
  }

  // Detect ephemeral container storage when possible (Railway volume mounts are typically not under /app except /app/data).
  try {
    const testFile = path.join(dataDir, ".navrit-volume-check");
    fs.writeFileSync(testFile, String(Date.now()));
    // leave the marker — proves writability across restarts when volume works
  } catch (e) {
    throw new Error(
      `Data directory is not writable: ${dataDir} (${e instanceof Error ? e.message : "error"})`
    );
  }
}

export function getDataPersistenceInfo() {
  const dataDir = resolveDataDir();
  const dbFile = resolveDbFile(dataDir);
  const backupDir = resolveBackupDir(dataDir);
  let dbExists = false;
  let dbSize = 0;
  let backupCount = 0;
  if (fs.existsSync(dbFile)) {
    dbExists = true;
    dbSize = fs.statSync(dbFile).size;
  }
  if (fs.existsSync(backupDir)) {
    backupCount = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith(".db") || f.endsWith(".zip")).length;
  }
  return {
    dataDir,
    dbFile,
    backupDir,
    dbExists,
    dbSize,
    backupCount,
    railway: isRailwayRuntime(),
    production: isProductionRuntime(),
    volumeMountEnv: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
    navritDataDirEnv: process.env.NAVRIT_DATA_DIR || null,
  };
}
