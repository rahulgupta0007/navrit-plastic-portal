import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireWriteSession } from "@/lib/auth";
import {
  createArticle,
  deleteArticle,
  listAllArticles,
  listPublishedArticles,
  serializeArticles,
  updateArticle,
} from "@/lib/articles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const all = req.nextUrl.searchParams.get("all") === "1";
  if (all) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ articles: serializeArticles(listAllArticles()) });
  }
  return NextResponse.json({ articles: serializeArticles(listPublishedArticles()) });
}

const createSchema = z.object({
  titleEn: z.string().min(1),
  titleHi: z.string().min(1),
  excerptEn: z.string().default(""),
  excerptHi: z.string().default(""),
  bodyEn: z.string().default(""),
  bodyHi: z.string().default(""),
  imageUrl: z.string().optional(),
  published: z.boolean().optional(),
  publishedAt: z.string().optional(),
  slug: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const id = createArticle(parsed.data);
  return NextResponse.json({ ok: true, id });
}

const patchSchema = createSchema.partial().extend({ id: z.number() });

export async function PATCH(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const { id, ...rest } = parsed.data;
  const ok = updateArticle(id, rest);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  deleteArticle(id);
  return NextResponse.json({ ok: true });
}
