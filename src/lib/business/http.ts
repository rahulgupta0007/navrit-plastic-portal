import { NextResponse } from "next/server";
import { getSession, requireWriteSession } from "@/lib/auth";
import { BizError } from "@/lib/business/engine";

type Body = Record<string, unknown>;

function fail(error: unknown) {
  if (error instanceof BizError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[navrit2]", error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** Reads are open to every signed-in user, including the view-only account. */
export async function readRoute(fn: () => unknown) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(fn());
  } catch (error) {
    return fail(error);
  }
}

/** Writes need the full admin account; the viewer is rejected with 403. */
export async function writeRoute(req: Request, fn: (body: Body) => unknown) {
  const guard = await requireWriteSession();
  if (guard.error) return guard.error;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, result: fn(body) ?? null });
  } catch (error) {
    return fail(error);
  }
}

export const idOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BizError("Invalid id");
  return n;
};
