import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireWriteSession } from "@/lib/auth";
import { getSiteContent, updateSiteContent } from "@/lib/content";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getSiteContent());
}

const schema = z.object({
  mission: z.object({ en: z.string(), hi: z.string() }),
  vision: z.object({ en: z.string(), hi: z.string() }),
  why_us: z.object({ en: z.string(), hi: z.string() }),
});

export async function PUT(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  updateSiteContent(parsed.data);
  return NextResponse.json({ ok: true });
}
