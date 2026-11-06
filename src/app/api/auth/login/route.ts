import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { sqlite } from "@/db";
import { createSession, type SessionRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function requestKey(req: NextRequest) {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function rateLimit(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.firstAt >= WINDOW_MS) {
    attempts.set(key, { count: 0, firstAt: now });
    return true;
  }
  return current.count < MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.firstAt >= WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
  } else {
    current.count += 1;
  }
}

function clearFailures(key: string) {
  attempts.delete(key);
}

function safeEqual(a: string, b: string) {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

function envCredsMatch(username: string, password: string, envUser?: string, envPass?: string) {
  if (!envUser || !envPass) return false;
  if (envUser.length === 0 || envPass.length === 0) return false;
  return safeEqual(username, envUser) && safeEqual(password, envPass);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const key = requestKey(req);
  if (!rateLimit(key)) {
    return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429 });
  }

  const { username, password } = parsed.data;
  const adminUser = process.env.ADMIN_USERNAME?.trim();
  const adminPass = process.env.ADMIN_PASSWORD;
  const readonlyUser = process.env.READONLY_USERNAME?.trim();
  const readonlyPass = process.env.READONLY_PASSWORD;

  let role: SessionRole | null = null;
  let sessionUser = username;

  if (envCredsMatch(username, password, adminUser, adminPass)) {
    role = "admin";
    sessionUser = adminUser!;
  } else if (envCredsMatch(username, password, readonlyUser, readonlyPass)) {
    role = "readonly";
    sessionUser = readonlyUser!;
  }

  if (role) {
    clearFailures(key);
    await createSession(sessionUser, role);
    return NextResponse.json({ ok: true, role });
  }

  // Production-style: when admin env creds exist, do not fall through to DB users.
  if (adminUser && adminPass) {
    recordFailure(key);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const admin = sqlite
    .prepare(`SELECT username, password_hash FROM admins WHERE username = ?`)
    .get(username) as { username: string; password_hash: string } | undefined;

  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    recordFailure(key);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  clearFailures(key);
  await createSession(admin.username, "admin");
  return NextResponse.json({ ok: true, role: "admin" as const });
}
