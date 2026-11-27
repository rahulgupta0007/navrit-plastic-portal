import { readRoute, writeRoute, idOf } from "@/lib/business/http";
import {
  BizError,
  deleteParty,
  listParties,
  payPurchases,
  receiveSales,
  savePartyDetails,
} from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ parties: listParties() }));
}

export async function POST(req: Request) {
  return writeRoute(req, (b) => {
    switch (b.action) {
      case "save":
        return savePartyDetails({
          id: b.id ? idOf(b.id) : undefined,
          name: String(b.name || ""),
          phone: String(b.phone || ""),
          kind: b.kind as "supplier" | "customer" | "both",
          notes: String(b.notes || ""),
        });
      case "delete":
        return deleteParty(idOf(b.id));
      case "pay":
        return payPurchases({ partyId: idOf(b.partyId), amount: Number(b.amount), date: String(b.date || "") });
      case "receive":
        return receiveSales({ partyId: idOf(b.partyId), amount: Number(b.amount), date: String(b.date || "") });
      default:
        throw new BizError("Unknown action");
    }
  });
}
