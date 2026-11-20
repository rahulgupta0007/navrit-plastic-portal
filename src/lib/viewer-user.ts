import bcrypt from "bcryptjs";
import { sqlite } from "@/db";

export const DEFAULT_VIEWER_USERNAME = "viewer";

export function viewerUsername() {
  return (process.env.READONLY_USERNAME || DEFAULT_VIEWER_USERNAME).trim() || DEFAULT_VIEWER_USERNAME;
}

export function ensureAdminsRoleColumn() {
  try {
    sqlite.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  } catch {
    /* exists */
  }
}

/** Upsert the single view-only DB user (password required). */
export async function setViewerPassword(password: string, username = viewerUsername()) {
  ensureAdminsRoleColumn();
  const user = username.trim();
  const pass = password.trim();
  if (!user) throw new Error("Viewer username is required");
  if (pass.length < 6) throw new Error("Viewer password must be at least 6 characters");
  const hash = await bcrypt.hash(pass, 10);
  const now = new Date().toISOString();
  const existing = sqlite.prepare("SELECT id FROM admins WHERE username = ?").get(user) as
    | { id: number }
    | undefined;
  if (existing) {
    sqlite.prepare("UPDATE admins SET password_hash = ?, role = 'readonly' WHERE id = ?").run(hash, existing.id);
  } else {
    sqlite.prepare("INSERT INTO admins (username, password_hash, created_at, role) VALUES (?, ?, ?, 'readonly')")
      .run(user, hash, now);
  }
  return { username: user };
}

/** Keep env password in sync with DB viewer when READONLY_PASSWORD is set. */
export async function syncViewerFromEnv() {
  ensureAdminsRoleColumn();
  const pass = process.env.READONLY_PASSWORD;
  if (!pass || !pass.trim()) return null;
  return setViewerPassword(pass, viewerUsername());
}

export function getViewerStatus() {
  ensureAdminsRoleColumn();
  const user = viewerUsername();
  const row = sqlite.prepare("SELECT username, role FROM admins WHERE lower(username)=lower(?)").get(user) as
    | { username: string; role: string }
    | undefined;
  const envConfigured = Boolean(process.env.READONLY_USERNAME?.trim() && process.env.READONLY_PASSWORD);
  return {
    username: user,
    dbConfigured: Boolean(row && row.role === "readonly"),
    envConfigured,
    ready: Boolean((row && row.role === "readonly") || envConfigured),
  };
}
