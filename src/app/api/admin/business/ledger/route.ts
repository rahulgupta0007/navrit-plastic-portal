import { readRoute, writeRoute, idOf } from "@/lib/business/http";
import { deleteSettlement, listLedger } from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ entries: listLedger() }));
}

export async function POST(req: Request) {
  return writeRoute(req, (b) => {
    if (b.action === "removeSettlement") return deleteSettlement(idOf(b.id));
    return null;
  });
}
