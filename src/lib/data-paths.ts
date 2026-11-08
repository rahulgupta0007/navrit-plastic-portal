import fs from "fs";
import path from "path";

/**
 * Resolve where SQLite lives.
 *
 * CRITICAL (Railway): the git repo contains `data/`, so `/app/data` exists inside
 * the container image even WITHOUT a Volume. Writes there are wiped on every deploy.
 * We detect that by comparing filesystem device IDs — a real Volume mount is a
 * different device from `/app`.
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

/** True when dataDir is on the same disk as the app image (ephemeral). */
export function isEphemeralAppStorage(dataDir: string): boolean {
  if (process.env.NAVRIT_ALLOW_EPHEMERAL_DB === "1") return false;

  try {
    const appRoot = process.cwd();
    if (!fs.existsSync(dataDir)) {
      // Missing dir on Railway usually means no volume — treat as ephemeral until mounted.
      return isProductionRuntime();
    }
    const dataDev = fs.statSync(dataDir).dev;
    const appDev = fs.statSync(appRoot).dev;
    if (dataDev !== appDev) return false; // different device ⇒ volume (or bind mount)

    // Same device as /app — also check /proc/mounts for an explicit mount on this path
    if (isPathExplicitlyMounted(dataDir)) return false;

    return true;
  } catch {
    return isProductionRuntime();
  }
}

function isPathExplicitlyMounted(target: string): boolean {
  try {
    const resolved = fs.realpathSync(target);
    const mounts = fs.readFileSync("/proc/mounts", "utf8").split("\n");
    for (const line of mounts) {
      const parts = line.split(/\s+/);
      const mountPoint = parts[1];
      if (!mountPoint) continue;
      let decoded = mountPoint.replace(/\\040/g, " ");
      try {
        decoded = fs.realpathSync(decoded);
      } catch {
        /* keep decoded */
      }
      if (decoded === resolved) return true;
    }
  } catch {
    /* /proc/mounts unavailable */
  }
  return false;
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

export function volumeSetupError(dataDir: string): string {
  return [
    `NAVRIT REFUSING TO USE EPHEMERAL DISK at ${dataDir}.`,
    "Railway deletes container files on every deploy — that is why your data keeps disappearing.",
    "Fix (required):",
    "1) Railway → navrit-plastic-portal → Settings → Volumes",
    "2) Add / attach a volume with mount path exactly: /app/data",
    "3) Redeploy",
    "4) Admin → Backup → Import your navrit-migration-*.zip (RESTORE)",
    "5) Redeploy again — data must still be there",
    "Optional: set NAVRIT_DATA_DIR to your volume mount path if it is not /app/data.",
  ].join(" ");
}

export function assertPersistentDataDir(dataDir: string) {
  if (!isProductionRuntime()) return;

  if (isEphemeralAppStorage(dataDir)) {
    throw new Error(volumeSetupError(dataDir));
  }

  if (!fs.existsSync(dataDir)) {
    throw new Error(volumeSetupError(dataDir));
  }

  try {
    const stamp = path.join(dataDir, ".navrit-persistent");
    fs.writeFileSync(
      stamp,
      JSON.stringify({ at: new Date().toISOString(), dir: dataDir }, null, 2)
    );
  } catch (e) {
    throw new Error(
      `Data directory is not writable: ${dataDir} (${e instanceof Error ? e.message : "error"}). ${volumeSetupError(dataDir)}`
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
  const ephemeral = isEphemeralAppStorage(dataDir);
  return {
    dataDir,
    dbFile,
    backupDir,
    dbExists,
    dbSize,
    backupCount,
    railway: isRailwayRuntime(),
    production: isProductionRuntime(),
    ephemeral,
    persistentOk: !ephemeral && fs.existsSync(dataDir),
    volumeMountEnv: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
    navritDataDirEnv: process.env.NAVRIT_DATA_DIR || null,
    setupError: ephemeral ? volumeSetupError(dataDir) : null,
  };
}
