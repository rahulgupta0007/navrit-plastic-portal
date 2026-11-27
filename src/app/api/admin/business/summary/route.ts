import { readRoute } from "@/lib/business/http";
import { getSummary } from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => getSummary());
}
