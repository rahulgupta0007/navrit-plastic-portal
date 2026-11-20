import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { askNavi, naviStatus } from "@/lib/navi/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, assistant: naviStatus() });
}

export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(4000),
    })).min(1).max(40),
  }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Send a chat message for Navi" }, { status: 400 });
  }

  try {
    const result = await askNavi(parsed.data.messages);
    return NextResponse.json({
      ok: true,
      reply: result.reply,
      mode: result.mode,
      toolsUsed: result.toolsUsed,
      assistant: naviStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Navi stumbled";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
