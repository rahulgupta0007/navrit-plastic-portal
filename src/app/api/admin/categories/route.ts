import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireWriteSession } from "@/lib/auth";
import { listCategories, nowIso } from "@/lib/rates";
import { sqlite, type Category } from "@/db";

export const dynamic = "force-dynamic";

async function guard() {
  return getSession();
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const categories = listCategories(true).map((c) => {
    const count = (
      sqlite
        .prepare(`SELECT count(*) as c FROM materials WHERE category_id = ?`)
        .get(c.id) as { c: number }
    ).c;
    return { ...c, materialCount: count };
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const body = await req.json().catch(() => null);
  const s = z
    .object({
      nameEn: z.string().min(1),
      nameHi: z.string().min(1),
      icon: z.string().optional(),
      sortOrder: z.number().default(0),
      active: z.boolean().default(true),
    })
    .safeParse(body);
  if (!s.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const r = sqlite
    .prepare(
      `INSERT INTO categories (name_en, name_hi, icon, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      s.data.nameEn,
      s.data.nameHi,
      s.data.icon ?? null,
      s.data.sortOrder,
      s.data.active ? 1 : 0,
      nowIso(),
      nowIso()
    );
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const body = await req.json().catch(() => null);
  const s = z
    .object({
      id: z.number(),
      nameEn: z.string().optional(),
      nameHi: z.string().optional(),
      icon: z.string().nullable().optional(),
      sortOrder: z.number().optional(),
      active: z.boolean().optional(),
    })
    .safeParse(body);
  if (!s.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const current = sqlite.prepare(`SELECT * FROM categories WHERE id = ?`).get(s.data.id) as
    | Category
    | undefined;
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  sqlite
    .prepare(
      `UPDATE categories SET name_en = ?, name_hi = ?, icon = ?, sort_order = ?, active = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      s.data.nameEn ?? current.name_en,
      s.data.nameHi ?? current.name_hi,
      s.data.icon === undefined ? current.icon : s.data.icon,
      s.data.sortOrder ?? current.sort_order,
      s.data.active === undefined ? current.active : s.data.active ? 1 : 0,
      nowIso(),
      s.data.id
    );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  // Soft-disable instead of hard delete if materials exist
  const mats = sqlite.prepare(`SELECT count(*) as c FROM materials WHERE category_id = ?`).get(id) as {
    c: number;
  };
  if (mats.c > 0) {
    sqlite
      .prepare(`UPDATE categories SET active = 0, updated_at = ? WHERE id = ?`)
      .run(nowIso(), id);
    return NextResponse.json({ ok: true, disabled: true });
  }
  sqlite.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
  return NextResponse.json({ ok: true });
}
