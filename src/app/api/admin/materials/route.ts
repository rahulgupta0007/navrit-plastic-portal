import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireWriteSession } from "@/lib/auth";
import {
  duplicateYesterdayRates,
  listMaterials,
  todayStr,
  upsertTodayRate,
  nowIso,
} from "@/lib/rates";
import { sqlite, type Material } from "@/db";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

async function guard() {
  const session = await getSession();
  if (!session) return null;
  return session;
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = todayStr();
  const yesterday = format(subDays(new Date(date + "T12:00:00"), 1), "yyyy-MM-dd");
  const materials = listMaterials(true);
  const rates = sqlite
    .prepare(`SELECT material_id, rate, updated_at FROM rate_snapshots WHERE rate_date = ?`)
    .all(date) as Array<{ material_id: number; rate: number; updated_at: string }>;
  const yRates = sqlite
    .prepare(`SELECT material_id, rate FROM rate_snapshots WHERE rate_date = ?`)
    .all(yesterday) as Array<{ material_id: number; rate: number }>;
  const rateMap = Object.fromEntries(rates.map((r) => [r.material_id, r.rate]));
  const updatedMap = Object.fromEntries(rates.map((r) => [r.material_id, r.updated_at]));
  const yMap = Object.fromEntries(yRates.map((r) => [r.material_id, r.rate]));

  return NextResponse.json({
    date,
    yesterday,
    materials: JSON.parse(
      JSON.stringify(
        materials.map((m) => ({
          id: m.id,
          nameEn: m.name_en,
          nameHi: m.name_hi,
          categoryId: m.category_id,
          categoryEn: m.category_en,
          categoryHi: m.category_hi,
          unit: m.unit,
          sortOrder: m.sort_order,
          active: !!m.active,
          todayRate: rateMap[m.id] ?? null,
          yesterdayRate: yMap[m.id] ?? null,
          updatedAt: updatedMap[m.id] ?? null,
        }))
      )
    ),
  });
}

const upsertSchema = z.object({
  rates: z.array(
    z.object({
      materialId: z.number(),
      rate: z.number().nonnegative(),
    })
  ),
  date: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const body = await req.json().catch(() => null);

  if (body?.action === "duplicate") {
    const count = duplicateYesterdayRates(body.date || todayStr());
    return NextResponse.json({ ok: true, count });
  }

  if (body?.action === "createMaterial") {
    const s = z
      .object({
        categoryId: z.number(),
        nameEn: z.string().min(1),
        nameHi: z.string().min(1),
        unit: z.string().default("₹/kg"),
        sortOrder: z.number().default(0),
        active: z.boolean().default(true),
        rate: z.number().optional(),
      })
      .safeParse(body);
    if (!s.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const r = sqlite
      .prepare(
        `INSERT INTO materials (category_id, name_en, name_hi, unit, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        s.data.categoryId,
        s.data.nameEn,
        s.data.nameHi,
        s.data.unit,
        s.data.sortOrder,
        s.data.active ? 1 : 0,
        nowIso(),
        nowIso()
      );
    const id = Number(r.lastInsertRowid);
    if (s.data.rate != null) upsertTodayRate(id, s.data.rate);
    return NextResponse.json({ ok: true, id });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const date = parsed.data.date || todayStr();
  for (const row of parsed.data.rates) {
    upsertTodayRate(row.materialId, row.rate, date);
  }
  return NextResponse.json({ ok: true, count: parsed.data.rates.length });
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
      categoryId: z.number().optional(),
      unit: z.string().optional(),
      sortOrder: z.number().optional(),
      active: z.boolean().optional(),
    })
    .safeParse(body);
  if (!s.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const current = sqlite.prepare(`SELECT * FROM materials WHERE id = ?`).get(s.data.id) as
    | Material
    | undefined;
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  sqlite
    .prepare(
      `UPDATE materials SET name_en = ?, name_hi = ?, category_id = ?, unit = ?, sort_order = ?, active = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      s.data.nameEn ?? current.name_en,
      s.data.nameHi ?? current.name_hi,
      s.data.categoryId ?? current.category_id,
      s.data.unit ?? current.unit,
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
  sqlite.prepare(`DELETE FROM rate_snapshots WHERE material_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM materials WHERE id = ?`).run(id);
  return NextResponse.json({ ok: true });
}
