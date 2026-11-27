import { readRoute, writeRoute, idOf } from "@/lib/business/http";
import { BizError, EXPENSE_CATEGORIES, addExpense, deleteExpense, listExpenses } from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ expenses: listExpenses(), categories: EXPENSE_CATEGORIES }));
}

export async function POST(req: Request) {
  return writeRoute(req, (b) => {
    switch (b.action) {
      case "add":
        return addExpense({
          date: String(b.date || ""),
          category: String(b.category || "Other"),
          amount: Number(b.amount),
          note: String(b.note || ""),
        });
      case "delete":
        return deleteExpense(idOf(b.id));
      default:
        throw new BizError("Unknown action");
    }
  });
}
