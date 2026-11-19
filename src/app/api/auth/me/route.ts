import { NextResponse } from "next/server";
import { getSession, canWrite } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    username: session.username,
    role: session.role,
    canWrite: canWrite(session),
  });
}
