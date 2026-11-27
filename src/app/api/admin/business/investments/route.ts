import { readRoute, writeRoute, idOf } from "@/lib/business/http";
import { BizError, addInvestment, deleteInvestment, listInvestments } from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ investments: listInvestments() }));
}

export async function POST(req: Request) {
  return writeRoute(req, (b) => {
    switch (b.action) {
      case "add":
        return addInvestment({
          date: String(b.date || ""),
          investor: String(b.investor || ""),
          amount: Number(b.amount),
          kind: String(b.kind || "equity"),
          note: String(b.note || ""),
        });
      case "delete":
        return deleteInvestment(idOf(b.id));
      default:
        throw new BizError("Unknown action");
    }
  });
}
