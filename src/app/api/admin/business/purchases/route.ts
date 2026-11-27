import { readRoute, writeRoute, idOf } from "@/lib/business/http";
import {
  BizError,
  createPurchase,
  deletePurchase,
  listPurchases,
  payPurchases,
  updatePurchase,
  type PurchaseInput,
} from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ purchases: listPurchases() }));
}

export async function POST(req: Request) {
  return writeRoute(req, (b) => {
    switch (b.action) {
      case "create":
        return createPurchase(b as unknown as PurchaseInput);
      case "update":
        return updatePurchase(idOf(b.id), b as unknown as PurchaseInput);
      case "delete":
        return deletePurchase(idOf(b.id));
      case "pay":
        return payPurchases({ purchaseId: idOf(b.purchaseId), amount: Number(b.amount), date: String(b.date || "") });
      default:
        throw new BizError("Unknown action");
    }
  });
}
