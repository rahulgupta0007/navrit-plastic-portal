import { readRoute, writeRoute, idOf } from "@/lib/business/http";
import {
  BizError,
  createSale,
  deleteSale,
  listSales,
  previewSale,
  receiveSales,
  updateSale,
  type SaleInput,
} from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ sales: listSales() }));
}

export async function POST(req: Request) {
  return writeRoute(req, (b) => {
    switch (b.action) {
      case "create":
        return createSale(b as unknown as SaleInput);
      case "update":
        return updateSale(idOf(b.id), b as unknown as SaleInput);
      case "delete":
        return deleteSale(idOf(b.id));
      case "preview":
        return previewSale(b as unknown as SaleInput & { excludeSaleId?: number });
      case "receive":
        return receiveSales({ saleId: idOf(b.saleId), amount: Number(b.amount), date: String(b.date || "") });
      default:
        throw new BizError("Unknown action");
    }
  });
}
