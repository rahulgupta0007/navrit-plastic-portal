import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { enterDbScope } from "@/lib/db-context";
import { DEMO_USERNAME } from "@/lib/demo-data";

const COOKIE = "plastic_admin_session";
const DEMO_DB_COOKIE = "navrit_demo_db";

export type SessionRole = "admin" | "readonly";
export type Session = { username: string; role: SessionRole; demo?: boolean };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

function isDemoUsername(username: string) {
  return username.trim().toLowerCase() === DEMO_USERNAME.trim().toLowerCase();
}

export async function createSession(username: string, role: SessionRole = "admin") {
  const demo = isDemoUsername(username);
  const token = await new SignJWT({ username, role, demo })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  if (demo) {
    jar.set(DEMO_DB_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    enterDbScope("demo");
  } else {
    jar.delete(DEMO_DB_COOKIE);
    enterDbScope("live");
  }
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(DEMO_DB_COOKIE);
  enterDbScope("live");
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) {
    enterDbScope("live");
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.username !== "string") {
      enterDbScope("live");
      return null;
    }
    const role: SessionRole = payload.role === "readonly" ? "readonly" : "admin";
    const demo = payload.demo === true || isDemoUsername(payload.username);
    enterDbScope(demo ? "demo" : "live");
    return { username: payload.username, role, demo };
  } catch {
    enterDbScope("live");
    return null;
  }
}

export function canWrite(session: Session | null | undefined) {
  return !!session && session.role === "admin";
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** 401 if logged out; 403 if view-only. */
export async function requireWriteSession(): Promise<
  { session: Session; error: null } | { session: Session | null; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.role !== "admin") {
    return {
      session,
      error: NextResponse.json(
        { error: "View-only account — changes are not allowed" },
        { status: 403 }
      ),
    };
  }
  return { session, error: null };
}
