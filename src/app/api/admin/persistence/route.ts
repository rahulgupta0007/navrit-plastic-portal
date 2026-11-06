import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDataPersistenceInfo } from "@/lib/data-paths";

export const dynamic = "force-dynamic";

/** Admin-only: shows whether SQLite is on a real Railway Volume. */
export async function GET() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const info = getDataPersistenceInfo();
  return NextResponse.json({
    ...info,
    ok: info.persistentOk,
    message: info.persistentOk
      ? "Persistent volume OK — deploys will keep your database."
      : info.setupError,
  });
}
