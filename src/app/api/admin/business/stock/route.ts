import { readRoute } from "@/lib/business/http";
import { getStock } from "@/lib/business/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return readRoute(() => getStock());
}
