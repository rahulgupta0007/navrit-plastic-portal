import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE = "plastic_admin_session";

export type SessionRole = "admin" | "readonly";
export type Session = { username: string; role: SessionRole };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createSession(username: string, role: SessionRole = "admin") {
  const token = await new SignJWT({ username, role })
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
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.username !== "string") return null;
    const role: SessionRole = payload.role === "readonly" ? "readonly" : "admin";
    return { username: payload.username, role };
  } catch {
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
