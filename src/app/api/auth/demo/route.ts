import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/db";
import { createSession } from "@/lib/auth";
import { DEMO_USERNAME, ensureDemoBusinessData } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

// Public showcase entry point: creates ONLY a view-only demo session.
// Existing privileged admin login continues to require regular credentials.
const attempts = new Map<string, { at: number; count: number }>();

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") || req.nextUrl.host;
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
        return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
    }
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site request not allowed" }, { status: 403 });
  }

  const ip = (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  ).slice(0, 100);
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && now - current.at < 15 * 60 * 1000 && current.count >= 30) {
    return NextResponse.json({ error: "Please try again later" }, { status: 429 });
  }
  attempts.set(ip, !current || now - current.at >= 15 * 60 * 1000
    ? { at: now, count: 1 }
    : { at: current.at, count: current.count + 1 });
  if (attempts.size > 2500) {
    for (const [key, entry] of attempts) {
      if (now - entry.at > 16 * 60 * 1000) attempts.delete(key);
    }
  }

  // The existing built-in demo dataset is idempotently initialized.
  // Never issue an admin role or expose privileged login credentials.
  try {
    ensureDemoBusinessData(sqlite);
    await createSession(DEMO_USERNAME, "readonly");
  } catch {
    return NextResponse.json({ error: "Unable to start demo" }, { status: 503 });
  }

  return NextResponse.json(
    { ok: true, demo: true, role: "readonly" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
