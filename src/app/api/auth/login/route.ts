import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { sqlite } from "@/db";
import { createSession } from "@/lib/auth";

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

  // Railway production credentials are supplied through environment variables.
  // Keep the database-backed admin as a fallback for local/development setups.
  const envUsername = process.env.ADMIN_USERNAME;
  const envPassword = process.env.ADMIN_PASSWORD;

  if (envUsername && envPassword) {
    if (!safeEqual(parsed.data.username, envUsername) || !safeEqual(parsed.data.password, envPassword)) {
      recordFailure(key);
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    clearFailures(key);
    await createSession(envUsername);
    return NextResponse.json({ ok: true });
  }

  const admin = sqlite
    .prepare(`SELECT username, password_hash FROM admins WHERE username = ?`)
    .get(parsed.data.username) as { username: string; password_hash: string } | undefined;

  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.password_hash))) {
    recordFailure(key);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  clearFailures(key);
  await createSession(admin.username);
  return NextResponse.json({ ok: true });
}
