import { readRoute } from "@/lib/business/http";
import { getLegacyTotals, getSummary } from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => ({ ...getSummary(), legacy: getLegacyTotals() }));
}
