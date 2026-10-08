/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/db";
import { listMaterials, nowIso, todayStr } from "@/lib/rates";

export const dynamic = "force-dynamic";

async function guard() {
  return await getSession();
}

const modeSchema = z.enum(["PET", "PLASTIC"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function json<T>(value: T) {
  return NextResponse.json(JSON.parse(JSON.stringify(value)));
}

function withTransaction<T>(fn: () => T): T {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    try { sqlite.exec("ROLLBACK"); } catch { /* ignore rollback errors */ }
    throw error;
  }
}

function saleMaterialName(materialCategory: string, materialVariant: string) {
  return materialVariant === "Red" ? "Red Bottles" : "Natural Bottles - " + materialVariant;
}

function getAvailableStock(mode: string, materialName: string, date: string, excludeSaleId?: number) {
  const row = excludeSaleId === undefined
    ? sqlite.prepare("SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=?").get(mode,date,materialName) as any
    : sqlite.prepare("SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=? AND COALESCE(sale_id,0)<>?").get(mode,date,materialName,excludeSaleId) as any;
  return Number(row?.kg || 0);
}

function assertNoNegativeStock(mode: string, materialNames: string[]) {
  for (const materialName of [...new Set(materialNames)]) {
    const rows = sqlite.prepare(
      "SELECT quantity_kg FROM inventory_transactions WHERE mode=? AND material_name=? ORDER BY transaction_date ASC, id ASC"
    ).all(mode,materialName) as Array<{quantity_kg:number}>;
    let balance = 0;
    for (const row of rows) {
      balance += Number(row.quantity_kg || 0);
      if (balance < -0.005) {
        throw new Error("Stock cannot go negative for " + materialName + ". Resulting balance: " + balance.toFixed(3) + " kg");
      }
    }
  }
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const materials = listMaterials(true);
  const suppliers = sqlite.prepare("SELECT * FROM suppliers ORDER BY name").all();
  const vendorPayments = sqlite.prepare(`
    SELECT vp.*,
           s.name as supplierName,
           s.phone as supplierPhone,
           s.location as supplierLocation,
           p.material_name as materialName,
           CASE
             WHEN COALESCE(vp.paid_by, '') <> '' THEN vp.paid_by
             WHEN vp.purchase_id IS NOT NULL THEN COALESCE(p.paid_by, '')
             ELSE ''
           END as paid_by
    FROM vendor_payments vp
    JOIN suppliers s ON s.id=vp.supplier_id
    LEFT JOIN purchases p ON p.id=vp.purchase_id
    ORDER BY vp.payment_date DESC, vp.id DESC
    LIMIT 500
  `).all();
  const lenders = sqlite.prepare("SELECT * FROM lenders ORDER BY name").all();
  const sales = sqlite.prepare("SELECT * FROM sales ORDER BY sale_date DESC, id DESC LIMIT 200").all();
  const saleItems = sqlite.prepare("SELECT * FROM sale_items ORDER BY sale_id, id").all();
  const salePayments = sqlite.prepare("SELECT sp.*, s.customer_name as customerName, s.material_category as materialCategory, s.material_variant as materialVariant FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id ORDER BY sp.payment_date DESC, sp.id DESC LIMIT 500").all();
  const processingBatches = sqlite.prepare("SELECT * FROM processing_batches ORDER BY batch_date DESC, id DESC LIMIT 200").all();
  const processingBatchItems = sqlite.prepare("SELECT * FROM processing_batch_items ORDER BY batch_id, id").all();
  const processingBatchOutputs = sqlite.prepare("SELECT * FROM processing_batch_outputs ORDER BY batch_id, id").all();
  const labourWorkers = sqlite.prepare("SELECT * FROM manual_labour_workers WHERE active=1 ORDER BY name, id").all();
  const manualLabour = sqlite.prepare(`
    SELECT ml.*, w.name as workerName
    FROM processing_manual_labour ml
    JOIN manual_labour_workers w ON w.id=ml.worker_id
    ORDER BY ml.payment_date DESC, ml.id DESC
    LIMIT 500
  `).all();
  const processingExpenses = sqlite.prepare("SELECT * FROM processing_expenses ORDER BY expense_date DESC, id DESC LIMIT 500").all();
  const saleProcessingCosts = sqlite.prepare("SELECT * FROM sale_processing_costs ORDER BY payment_date DESC, id DESC LIMIT 500").all();
  const otherExpenses = sqlite.prepare("SELECT * FROM other_expenses WHERE mode IN ('PET','PLASTIC') ORDER BY expense_date DESC, id DESC LIMIT 500").all();

  const inventory = sqlite.prepare(`
    SELECT mode, material_id as materialId, material_name as materialName,
           ROUND(SUM(quantity_kg), 3) as quantityKg,
           ROUND(SUM(amount), 2) as value
    FROM inventory_transactions
    GROUP BY mode, material_id, material_name
    HAVING ABS(SUM(quantity_kg)) > 0.0001
    ORDER BY mode, materialName
  `).all();

  const purchases = sqlite.prepare(`
    SELECT p.*, s.name as supplierName, l.name as lenderName,
           ROUND(p.total_amount / NULLIF(p.quantity_kg,0), 2) as effective_cost
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN lenders l ON l.id = p.lender_id
    ORDER BY p.purchase_date DESC, p.id DESC
    LIMIT 100
  `).all();

  const borrowings = sqlite.prepare(`
    SELECT b.*, l.name as lenderName
    FROM borrowings b JOIN lenders l ON l.id = b.lender_id
    ORDER BY b.borrowing_date DESC, b.id DESC
    LIMIT 100
  `).all();

  const supplierCredit = sqlite.prepare(`
    SELECT s.id, s.name, ROUND(SUM(p.credit_amount),2) as outstanding
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.credit_amount > 0
    GROUP BY s.id, s.name
    HAVING SUM(p.credit_amount) > 0.005
    ORDER BY outstanding DESC
  `).all();

  const vendorSummary = sqlite.prepare(`
    SELECT
      s.id,
      s.name,
      m.mode,
      ROUND(COALESCE(p.totalKg, 0), 2) as totalKg,
      ROUND(COALESCE(p.totalPurchase, 0), 2) as totalPurchase,
      ROUND(COALESCE(p.totalPaid, 0), 2) as totalPaid,
      ROUND(COALESCE(p.unpaid, 0), 2) as unpaid,
      ROUND(COALESCE(a.advance, 0), 2) as advance
    FROM suppliers s
    CROSS JOIN (SELECT 'PET' AS mode UNION ALL SELECT 'PLASTIC' AS mode) m
    LEFT JOIN (
      SELECT supplier_id, mode,
        SUM(quantity_kg) as totalKg,
        SUM(total_amount) as totalPurchase,
        SUM(paid_amount) as totalPaid,
        SUM(credit_amount) as unpaid
      FROM purchases
      GROUP BY supplier_id, mode
    ) p ON p.supplier_id=s.id AND p.mode=m.mode
    LEFT JOIN (
      SELECT supplier_id, mode, SUM(amount-used_amount) as advance
      FROM vendor_advances
      GROUP BY supplier_id, mode
    ) a ON a.supplier_id=s.id AND a.mode=m.mode
    ORDER BY s.name, m.mode
  `).all();

  const totals = sqlite.prepare(`
    SELECT
      ROUND(COALESCE(SUM(CASE WHEN mode='PET' THEN quantity_kg ELSE 0 END),0),3) as petKg,
      ROUND(COALESCE(SUM(CASE WHEN mode='PLASTIC' THEN quantity_kg ELSE 0 END),0),3) as plasticKg
    FROM inventory_transactions
  `).get();

  const modeCashflow = (m: string) => {
    const opening = Number((sqlite.prepare("SELECT COALESCE(opening_balance,0) as n FROM company_balances WHERE mode=?").get(m) as any)?.n || 0);
    const received = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM sale_payments WHERE mode=?").get(m) as any)?.n || 0);
    const paidVendors = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM vendor_payments WHERE mode=? AND NOT (payment_type='CREDIT_SETTLEMENT' AND payment_mode='Advance')").get(m) as any)?.n || 0);
    const borrowed = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM borrowings WHERE mode=?").get(m) as any)?.n || 0);
    const repaid = Number((sqlite.prepare("SELECT COALESCE(SUM(br.amount),0) as n FROM borrowing_repayments br JOIN borrowings b ON b.id=br.borrowing_id WHERE b.mode=?").get(m) as any)?.n || 0);
    const monthlyProcessing = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM processing_expenses WHERE mode=?").get(m) as any)?.n || 0);
    const saleProcessing = Number((sqlite.prepare("SELECT COALESCE(SUM(labour_cost + loading_cost),0) as n FROM sale_processing_costs WHERE mode=?").get(m) as any)?.n || 0);
    const otherExpenses = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE mode=?").get(m) as any)?.n || 0);
    const manualLabour = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour WHERE mode=?").get(m) as any)?.n || 0);
    return Math.round((opening + received - paidVendors + borrowed - repaid - monthlyProcessing - saleProcessing - otherExpenses - manualLabour) * 100) / 100;
  };
  const openingBalance = { PET: Number((sqlite.prepare("SELECT COALESCE(opening_balance,0) as n FROM company_balances WHERE mode='PET'").get() as any)?.n || 0), PLASTIC: Number((sqlite.prepare("SELECT COALESCE(opening_balance,0) as n FROM company_balances WHERE mode='PLASTIC'").get() as any)?.n || 0) };

  const personAccountTotals: Record<string, Record<string, {
    received:number; purchasesPaid:number; expensesPaid:number; processingPaid:number; saleProcessingPaid:number; paid:number; balance:number;
  }>> = { PET: {}, PLASTIC: {} };
  for (const mode of ["PET","PLASTIC"]) {
    for (const person of ["Rahul","Nitin","Devesh"]) {
      const received = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM sale_payments WHERE mode=? AND received_by=?").get(mode,person) as any)?.n || 0);
      const purchasesPaid = Number((sqlite.prepare("SELECT COALESCE(SUM(vp.amount),0) as n FROM vendor_payments vp LEFT JOIN purchases p ON p.id=vp.purchase_id WHERE vp.mode=? AND COALESCE(NULLIF(vp.paid_by,''), p.paid_by, '')=? AND vp.payment_type<>'ADVANCE' AND COALESCE(vp.payment_mode,'')<>'Advance'").get(mode,person) as any)?.n || 0);
      const expensesPaid = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE mode=? AND paid_by=?").get(mode,person) as any)?.n || 0);
      const processingPaid = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM processing_expenses WHERE mode=? AND paid_by=?").get(mode,person) as any)?.n || 0);
      const saleProcessingPaid = Number((sqlite.prepare("SELECT COALESCE(SUM(labour_cost + loading_cost),0) as n FROM sale_processing_costs WHERE mode=? AND paid_by=?").get(mode,person) as any)?.n || 0);
      const paid = purchasesPaid + expensesPaid + processingPaid + saleProcessingPaid;
      personAccountTotals[mode][person] = { received, purchasesPaid, expensesPaid, processingPaid, saleProcessingPaid, paid, balance: received - paid };
    }
  }

  return json({ materials, suppliers, lenders, inventory, purchases, borrowings, supplierCredit, vendorSummary, vendorPayments, sales, saleItems, salePayments, processingBatches, processingBatchItems, processingBatchOutputs, processingExpenses, saleProcessingCosts, otherExpenses, labourWorkers, manualLabour, totals, openingBalance, personAccountTotals, cashBalance:{PET:modeCashflow("PET"),PLASTIC:modeCashflow("PLASTIC")} });
}

export async function POST(req: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  try {
    return withTransaction(() => {
    if (body.action === "setOpeningBalance") {
      const x = z.object({ mode: modeSchema, amount: z.number().nonnegative() }).parse(body);
      sqlite.prepare("INSERT INTO company_balances(mode,opening_balance,updated_at) VALUES(?,?,?) ON CONFLICT(mode) DO UPDATE SET opening_balance=excluded.opening_balance,updated_at=excluded.updated_at").run(x.mode,x.amount,nowIso());
      return json({ok:true, amount:x.amount});
    }

    if (body.action === "addSupplier" || body.action === "addLender") {
      const s = z.object({
        name: z.string().trim().min(1),
        phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const table = body.action === "addSupplier" ? "suppliers" : "lenders";
      const r = sqlite.prepare(`INSERT INTO ${table} (name, phone, location, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(s.name, s.phone, s.location, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "updateSupplier") {
      const s = z.object({ supplierId: z.number().int().positive(), name: z.string().trim().min(1), phone: z.string().trim().optional().default(""), location: z.string().trim().optional().default(""), notes: z.string().trim().optional().default("") }).parse(body);
      sqlite.prepare("UPDATE suppliers SET name=?, phone=?, location=?, notes=?, updated_at=? WHERE id=?").run(s.name, s.phone, s.location, s.notes, nowIso(), s.supplierId);
      return json({ ok: true });
    }

    if (body.action === "addVendorAdvance") {
      const x = z.object({
        mode: modeSchema, supplierId: z.number().int().positive(), amount: z.number().positive(),
        advanceDate: dateSchema.optional().default(todayStr()), notes: z.string().trim().optional().default("")
      }).parse(body);
      sqlite.prepare(`INSERT INTO vendor_advances (mode,supplier_id,amount,used_amount,advance_date,notes,created_at,updated_at) VALUES (?,?,?,0,?,?,?,?)`).run(x.mode,x.supplierId,x.amount,x.advanceDate,x.notes,nowIso(),nowIso());
      sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,payment_type,amount,payment_date,payment_mode,notes,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(x.mode,x.supplierId,"ADVANCE",x.amount,x.advanceDate,"Cash",x.notes,nowIso());
      return json({ok:true});
    }

    if (body.action === "addOtherExpense") {
      const x = z.object({
        mode: modeSchema,
        expenseType: z.enum(["Electricity","Thread","GST / Admin","Infrastructure / Maintenance","Other"]),
        description: z.string().trim().optional().default(""),
        amount: z.number().positive(),
        expenseDate: dateSchema.optional().default(todayStr()),
        billingMonth: z.string().optional(),
        billingStartDate: z.union([dateSchema, z.literal("")]).optional(),
        billingEndDate: z.union([dateSchema, z.literal("")]).optional(),
        paidBy: z.enum(["Rahul","Devesh","Nitin"]).optional()
      }).parse(body);
      const billingMonth = x.expenseType === "Electricity" ? (x.billingMonth ?? "") : "";
      const billingStartDate = x.expenseType === "Electricity" ? (x.billingStartDate ?? "") : "";
      const billingEndDate = x.expenseType === "Electricity" ? (x.billingEndDate ?? "") : "";
      if (x.expenseType === "Electricity" && ((x.billingStartDate && !x.billingEndDate) || (!x.billingStartDate && x.billingEndDate))) {
        return NextResponse.json({error:"Electricity billing period needs both start and end dates"}, {status:400});
      }
      if (x.expenseType === "Electricity" && x.billingStartDate && x.billingEndDate && x.billingStartDate > x.billingEndDate) {
        return NextResponse.json({error:"Electricity billing start date cannot be after end date"}, {status:400});
      }
      sqlite.prepare(`INSERT INTO other_expenses (mode,purchase_id,expense_type,description,amount,expense_date,expense_frequency,paid_by,created_at,billing_month,billing_start_date,billing_end_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(x.mode,null,x.expenseType,x.description,x.amount,x.expenseDate,"ONE_TIME",x.paidBy??"",nowIso(),billingMonth,billingStartDate,billingEndDate);
      return json({ok:true});
    }

    if (body.action === "addBorrowing") {
      const s = z.object({
        mode: modeSchema,
        lenderId: z.number().int().positive(),
        amount: z.number().positive(),
        borrowingDate: dateSchema.optional().default(todayStr()),
        purpose: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const r = sqlite.prepare(`
        INSERT INTO borrowings
        (mode, lender_id, amount, outstanding_amount, borrowing_date, purpose, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
      `).run(s.mode, s.lenderId, s.amount, s.amount, s.borrowingDate, s.purpose, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "repayBorrowing") {
      const s = z.object({
        borrowingId: z.number().int().positive(),
        amount: z.number().positive(),
        repaymentDate: dateSchema.optional().default(todayStr()),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const b = sqlite.prepare("SELECT * FROM borrowings WHERE id = ?").get(s.borrowingId) as { outstanding_amount: number } | undefined;
      if (!b) return NextResponse.json({ error: "Borrowing not found" }, { status: 404 });
      if (s.amount > b.outstanding_amount + 0.005) return NextResponse.json({ error: "Repayment exceeds outstanding amount" }, { status: 400 });
      const outstanding = Math.max(0, b.outstanding_amount - s.amount);
      sqlite.prepare(`
        INSERT INTO borrowing_repayments (borrowing_id, amount, repayment_date, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(s.borrowingId, s.amount, s.repaymentDate, s.notes, nowIso());
      sqlite.prepare("UPDATE borrowings SET outstanding_amount=?, status=?, updated_at=? WHERE id=?")
        .run(outstanding, outstanding === 0 ? "PAID" : "PARTIAL", nowIso(), s.borrowingId);
      return json({ ok: true, outstanding });
    }

    if (body.action === "addPurchase") {
      const s = z.object({
        mode: modeSchema,
        materialId: z.number().int().positive().optional(),
        materialName: z.string().trim().min(1),
        supplierId: z.number().int().positive().optional(),
        purchaseType: z.enum(["NORMAL", "SUPPLIER_CREDIT", "BORROWED_FUND"]),
        quantityKg: z.number().positive(),
        ratePerKg: z.number().nonnegative(),
        paidAmount: z.number().nonnegative().optional(),
        paidBy: z.enum(["Rahul","Devesh","Nitin"]).optional(),
        lenderId: z.number().int().positive().optional(),
        borrowingId: z.number().int().positive().optional(),
        purchaseDate: dateSchema.optional().default(todayStr()),
        notes: z.string().trim().optional().default(""),
      }).parse(body);

      if (!s.supplierId) {
        return NextResponse.json({ error: "Vendor is required for every purchase" }, { status: 400 });
      }
      if (s.purchaseType === "SUPPLIER_CREDIT" && !s.supplierId) {
        return NextResponse.json({ error: "Supplier is required for supplier credit" }, { status: 400 });
      }
      if (s.purchaseType === "BORROWED_FUND" && !s.borrowingId) {
        return NextResponse.json({ error: "Borrowing account is required for borrowed-fund purchase" }, { status: 400 });
      }

      const total = Math.round(s.quantityKg * s.ratePerKg * 100) / 100;
      let cashPaid = s.paidAmount ?? 0;
      if (cashPaid > total) cashPaid = total;
      let advanceApplied=0;
      if(s.supplierId){ const rows=sqlite.prepare("SELECT id,amount,used_amount FROM vendor_advances WHERE mode=? AND supplier_id=? AND amount-used_amount>0.005 ORDER BY advance_date ASC,id ASC").all(s.mode,s.supplierId) as Array<{id:number;amount:number;used_amount:number}>; let rem=Math.max(0,total-cashPaid); for(const a of rows){ if(rem<=0) break; const use=Math.min(a.amount-a.used_amount,rem); if(use>0){sqlite.prepare("UPDATE vendor_advances SET used_amount=used_amount+?,updated_at=? WHERE id=?").run(use,nowIso(),a.id); advanceApplied+=use; rem-=use;}} }
      const paid=Math.round((cashPaid+advanceApplied)*100)/100;
      const credit=Math.round((total-paid)*100)/100;

      const r = sqlite.prepare(`
        INSERT INTO purchases
        (mode, material_id, material_name, supplier_id, purchase_type, quantity_kg, rate_per_kg,
         total_amount, paid_amount, credit_amount, lender_id, borrowing_id, purchase_date, notes, paid_by, transport_charges, weight_charges, labour_charges, material_variant, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        s.mode, s.materialId ?? null, s.materialName, s.supplierId ?? null, s.purchaseType,
        s.quantityKg, s.ratePerKg, total, paid, credit, s.lenderId ?? null, s.borrowingId ?? null,
        s.purchaseDate, s.notes, s.paidBy ?? "", 0, 0, 0, "", nowIso(), nowIso()
      );
      const purchaseId = Number(r.lastInsertRowid);
      if(cashPaid>0) sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(s.mode,s.supplierId,purchaseId,"PURCHASE",cashPaid,s.purchaseDate,"Cash",s.notes,s.paidBy ?? "",nowIso());
      if(advanceApplied>0) sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(s.mode,s.supplierId,purchaseId,"CREDIT_SETTLEMENT",advanceApplied,s.purchaseDate,"Advance","Advance applied to purchase #"+purchaseId,nowIso());

      sqlite.prepare(`
        INSERT INTO inventory_transactions
        (mode, material_id, material_name, transaction_type, quantity_kg, amount, purchase_id, transaction_date, notes, created_at)
        VALUES (?, ?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?)
      `).run(s.mode, s.materialId ?? null, s.materialName, s.quantityKg, total, purchaseId, s.purchaseDate, s.notes, nowIso());

      return json({ ok: true, id: purchaseId, total, paid, credit });
    }

    if (body.action === "updatePurchase") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        mode: modeSchema,
        materialId: z.number().int().positive().optional(),
        materialName: z.string().trim().min(1),
        supplierId: z.number().int().positive(),
        purchaseType: z.enum(["NORMAL", "SUPPLIER_CREDIT", "BORROWED_FUND"]),
        quantityKg: z.number().positive(),
        ratePerKg: z.number().nonnegative(),
        purchaseDate: dateSchema,
        paidBy: z.enum(["Rahul","Devesh","Nitin"]).optional(),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const existing = sqlite.prepare("SELECT id, paid_amount, material_id, material_name as existing_material_name, supplier_id as existing_supplier_id FROM purchases WHERE id=? AND mode=?").get(s.purchaseId, s.mode) as {id:number;paid_amount:number;material_id:number|null;existing_material_name:string;existing_supplier_id:number|null} | undefined;
      if (!existing) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
      const total = Math.round(s.quantityKg * s.ratePerKg * 100) / 100;
      if (existing.paid_amount > total + 0.005) return NextResponse.json({ error: "Purchase total cannot be less than amount already paid" }, { status: 400 });
      const credit = Math.round((total - existing.paid_amount) * 100) / 100;
      if (!s.supplierId) return NextResponse.json({ error: "Vendor is required for every purchase" }, { status: 400 });
      const materialId = s.materialId ?? existing.material_id ?? null;
      sqlite.prepare(`UPDATE purchases SET material_id=?, material_name=?, supplier_id=?, purchase_type=?, quantity_kg=?, rate_per_kg=?, total_amount=?, credit_amount=?, purchase_date=?, paid_by=?, notes=?, updated_at=? WHERE id=? AND mode=?`)
        .run(materialId, s.materialName, s.supplierId, s.purchaseType, s.quantityKg, s.ratePerKg, total, credit, s.purchaseDate, s.paidBy ?? "", s.notes, nowIso(), s.purchaseId, s.mode);
      sqlite.prepare("UPDATE inventory_transactions SET material_id=?, material_name=?, quantity_kg=?, amount=?, transaction_date=?, notes=? WHERE purchase_id=? AND transaction_type='PURCHASE'")
        .run(materialId, s.materialName, s.quantityKg, total, s.purchaseDate, s.notes, s.purchaseId);
      if (s.supplierId !== existing.existing_supplier_id) {
        sqlite.prepare("UPDATE vendor_payments SET supplier_id=? WHERE purchase_id=?").run(s.supplierId, s.purchaseId);
      }
      assertNoNegativeStock(s.mode, [existing.existing_material_name, s.materialName]);
      return json({ ok: true, total, paid: existing.paid_amount, credit });
    }

    if (body.action === "payVendor") {
      const s=z.object({mode:modeSchema,supplierId:z.number().int().positive(),amount:z.number().positive(),paymentDate:dateSchema.optional().default(todayStr()),paymentMode:z.string().trim().min(1).default("Cash"),paidBy:z.enum(["Rahul","Devesh","Nitin"]).optional(),notes:z.string().trim().optional().default("")}).parse(body);
      const purchases=sqlite.prepare("SELECT id,credit_amount FROM purchases WHERE mode=? AND supplier_id=? AND credit_amount>0 ORDER BY purchase_date ASC,id ASC").all(s.mode,s.supplierId) as Array<{id:number;credit_amount:number}>;
      if(s.amount > purchases.reduce((n,p)=>n+p.credit_amount,0)+0.005) return NextResponse.json({error:"Payment exceeds vendor outstanding balance"},{status:400});
      let rem = s.amount;
      for (const p of purchases) {
        if (rem <= 0) break;
        const use = Math.min(rem, p.credit_amount);
        sqlite.prepare("UPDATE purchases SET paid_amount=paid_amount+?,credit_amount=credit_amount-?,updated_at=? WHERE id=?").run(use, use, nowIso(), p.id);
        rem -= use;
      }
      sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(s.mode, s.supplierId, "CREDIT_SETTLEMENT", s.amount, s.paymentDate, s.paymentMode, s.notes, s.paidBy ?? "", nowIso());
      return json({ok:true});
    }

    if (body.action === "paySupplierCredit") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        amount: z.number().positive(),
        paidBy: z.enum(["Rahul","Devesh","Nitin"]).optional(),
      }).parse(body);
      const p = sqlite.prepare("SELECT credit_amount, mode, supplier_id FROM purchases WHERE id=?").get(s.purchaseId) as { credit_amount:number; mode:string; supplier_id:number } | undefined;
      if (!p) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
      if (s.amount > p.credit_amount + 0.005) return NextResponse.json({ error: "Payment exceeds outstanding credit" }, { status: 400 });
      sqlite.prepare("UPDATE purchases SET paid_amount=paid_amount+?, credit_amount=credit_amount-?, updated_at=? WHERE id=?")
        .run(s.amount, s.amount, nowIso(), s.purchaseId);
      sqlite.prepare("INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(p.mode,p.supplier_id,s.purchaseId,"CREDIT_SETTLEMENT",s.amount,todayStr(),"Cash","Purchase credit payment",s.paidBy ?? "",nowIso());
      return json({ ok: true });
    }

    if (body.action === "addLabourWorker") {
      const s = z.object({ name: z.string().trim().min(2).max(100) }).parse(body);
      const existing = sqlite.prepare("SELECT * FROM manual_labour_workers WHERE lower(name)=lower(?)").get(s.name) as any;
      if (existing) {
        if (!existing.active) {
          sqlite.prepare("UPDATE manual_labour_workers SET active=1, updated_at=? WHERE id=?").run(nowIso(), existing.id);
          return json({ ok: true, id: existing.id, reactivated: true });
        }
        return NextResponse.json({ error: "Worker already exists" }, { status: 400 });
      }
      const r = sqlite.prepare("INSERT INTO manual_labour_workers (name,active,created_at,updated_at) VALUES (?,1,?,?)").run(s.name,nowIso(),nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "setLabourWorkerStatus") {
      const s = z.object({ workerId: z.number().int().positive(), active: z.boolean() }).parse(body);
      const r = sqlite.prepare("UPDATE manual_labour_workers SET active=?, updated_at=? WHERE id=?").run(s.active ? 1 : 0,nowIso(),s.workerId);
      if (!r.changes) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      return json({ ok: true });
    }

    if (body.action === "addManualLabour") {
      const s = z.object({
        mode: modeSchema,
        workerIds: z.array(z.number().int().positive()).min(1),
        taskType: z.enum(["Cap Removal","Sorting","Other"]),
        amountPerWorker: z.number().positive(),
        paymentDate: dateSchema.optional(),
        paidBy: z.string().trim().max(100).optional().default(""),
        notes: z.string().trim().max(500).optional().default("")
      }).parse(body);
      const ids=[...new Set(s.workerIds)];
      const placeholders=ids.map(()=>"?").join(",");
      const workers=sqlite.prepare("SELECT id,name FROM manual_labour_workers WHERE active=1 AND id IN ("+placeholders+")");
      const found=workers.all(...ids) as any[];
      if (found.length !== ids.length) return NextResponse.json({error:"One or more selected workers are inactive or missing"},{status:400});
      const existing=sqlite.prepare("SELECT worker_id FROM processing_manual_labour WHERE batch_id IS NULL AND mode=? AND payment_date=? AND task_type=? AND worker_id IN ("+placeholders+")").all(s.mode,s.paymentDate ?? todayStr(),s.taskType,...ids) as any[];
      if (existing.length) return NextResponse.json({error:"Labour already recorded for one or more selected workers for this task and date"},{status:400});
      for (const id of ids) sqlite.prepare("INSERT INTO processing_manual_labour (mode,batch_id,worker_id,amount,payment_date,paid_by,notes,task_type,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(s.mode,null,id,s.amountPerWorker,s.paymentDate ?? todayStr(),s.paidBy,s.notes,s.taskType,nowIso());
      return json({ok:true,totalAmount:Math.round(ids.length*s.amountPerWorker*100)/100,count:ids.length});
    }

    if (body.action === "addProcessingBatch") {
      const s = z.object({
        mode: modeSchema,
        batchDate: dateSchema.optional().default(todayStr()),
        items: z.array(z.object({
          materialVariant: z.enum(["Green","White","White Milk","Red"]),
          quantityKg: z.number().positive(),
          baleCount: z.number().int().nonnegative().optional().default(0)
        })).min(1),
        notes: z.string().trim().optional().default("")
      }).parse(body);
      if (s.mode === "PET" && s.items.some(x => x.materialVariant === "Red")) return NextResponse.json({error:"Red material is not valid for PET processing"},{status:400});
      const totalInput = Math.round(s.items.reduce((n,x)=>n+x.quantityKg,0)*1000)/1000;
      const labourRate = 2;
      const labourCost = Math.round(totalInput * labourRate * 100)/100;
      const r = sqlite.prepare("INSERT INTO processing_batches (mode,batch_date,total_input_kg,labour_rate,labour_cost,status,notes,created_at) VALUES (?,?,?,?,?,'READY',?,?)").run(s.mode,s.batchDate,totalInput,labourRate,labourCost,s.notes,nowIso());
      const batchId = Number(r.lastInsertRowid);
      for (const item of s.items) sqlite.prepare("INSERT INTO processing_batch_items (batch_id,material_variant,quantity_kg,bale_count) VALUES (?,?,?,?)").run(batchId,item.materialVariant,item.quantityKg,item.baleCount);
      return json({ok:true,id:batchId,totalInput,labourCost});
    }

    if (body.action === "completeProcessingBatch") {
      const s = z.object({
        mode: modeSchema,
        batchId: z.number().int().positive(),
        outputs: z.array(z.object({
          materialVariant: z.enum(["Green","White","White Milk","Red"]),
          quantityKg: z.number().positive()
        })).min(1),
        processingCost: z.number().nonnegative().default(0)
      }).parse(body);

      const batch = sqlite.prepare("SELECT * FROM processing_batches WHERE id=? AND mode=?").get(s.batchId,s.mode) as any;
      if (!batch) return NextResponse.json({error:"Processing batch not found"},{status:404});
      if (Number(batch.total_output_kg) > 0 || Number(batch.waste_kg) > 0) {
        return NextResponse.json({error:"This processing batch is already completed"},{status:400});
      }

      const inputItems = sqlite.prepare("SELECT material_variant, quantity_kg FROM processing_batch_items WHERE batch_id=?").all(s.batchId) as Array<{material_variant:string;quantity_kg:number}>;
      const inputKg = Number(batch.total_input_kg);
      for (const item of inputItems) {
        const materialName = item.material_variant === "Red" ? "Red Bottles" : "Natural Bottles - " + item.material_variant;
        const available = Number((sqlite.prepare("SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=?").get(s.mode,batch.batch_date,materialName) as any)?.kg || 0);
        if (Number(item.quantity_kg) > available + 0.005) {
          return NextResponse.json({error:"Insufficient stock for processing " + item.material_variant + ". Available up to " + batch.batch_date + ": " + available.toFixed(2) + " kg"}, {status:400});
        }
      }
      const outputKg = Math.round(s.outputs.reduce((n,x)=>n+x.quantityKg,0)*1000)/1000;
      const wasteKg = Math.round((inputKg-outputKg)*1000)/1000;
      if (wasteKg < -0.005) return NextResponse.json({error:"Output cannot be greater than batch input"}, {status:400});

      for (const item of s.outputs) {
        const allowed = s.mode === "PET" ? ["Green","White","White Milk"] : ["Green","White","White Milk","Red"];
        if (!allowed.includes(item.materialVariant)) return NextResponse.json({error:"Invalid output material for this mode"}, {status:400});
      }

        for (const item of inputItems) {
          const materialName = item.material_variant === "Red" ? "Red Bottles" : "Natural Bottles - " + item.material_variant;
          sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .run(s.mode,null,materialName,"ADJUSTMENT",-Number(item.quantity_kg),0,null,null,batch.batch_date,"PROCESSING INPUT #"+s.batchId,nowIso());
        }
        for (const item of s.outputs) {
          const materialName = item.materialVariant === "Red" ? "Red Bottles" : "Natural Bottles - " + item.materialVariant;
          sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .run(s.mode,null,materialName,"ADJUSTMENT",item.quantityKg,0,null,null,batch.batch_date,"PROCESSING OUTPUT #"+s.batchId,nowIso());
          sqlite.prepare("INSERT INTO processing_batch_outputs (batch_id,material_variant,quantity_kg,created_at) VALUES (?,?,?,?)")
            .run(s.batchId,item.materialVariant,item.quantityKg,nowIso());
        }
        sqlite.prepare("UPDATE processing_batches SET total_output_kg=?, waste_kg=?, processing_cost=?, status='SOLD' WHERE id=?")
          .run(outputKg,Math.max(0,wasteKg),s.processingCost,s.batchId);
      return json({ok:true,batchId:s.batchId,inputKg,outputKg,wasteKg:Math.max(0,wasteKg)});
    }

    if (body.action === "addProcessingExpense") {
      const s = z.object({
        mode: modeSchema,
        expenseType: z.enum(["Electricity","Thread","Other"]),
        description: z.string().trim().optional().default(""),
        amount: z.number().positive(),
        expenseDate: dateSchema.optional().default(todayStr()),
        paidBy: z.enum(["Rahul","Devesh","Nitin"]).optional()
      }).parse(body);
      sqlite.prepare("INSERT INTO processing_expenses (mode,expense_type,description,amount,expense_date,paid_by,created_at) VALUES (?,?,?,?,?,?,?)").run(s.mode,s.expenseType,s.description,s.amount,s.expenseDate,s.paidBy??"",nowIso());
      return json({ok:true});
    }

    if (body.action === "addSale") {
      const s = z.object({
        mode: modeSchema, customerName: z.string().trim().min(1), phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        items: z.array(z.object({
          materialCategory: z.enum(["Natural Bottles","Red Bottles"]),
          materialVariant: z.enum(["Green","White","Red","White Milk"]),
          quantityKg: z.number().positive(),
          ratePerKg: z.number().nonnegative()
        })).min(1),
        receivedAmount: z.number().nonnegative().optional(),
        saleDate: dateSchema.optional().default(todayStr()), receivedBy: z.enum(["Rahul","Devesh","Nitin"]).optional(),
        paymentMode: z.string().trim().min(1).optional().default("Cash"),
        loadingCharges: z.number().nonnegative().optional().default(0),
        notes: z.string().trim().optional().default("")
      }).parse(body);

      for (const item of s.items) {
        if (item.materialCategory === "Natural Bottles" && !["Green","White","White Milk"].includes(item.materialVariant)) {
          return NextResponse.json({ error: "Natural Bottles can be Green, White or White Milk" }, { status: 400 });
        }
        if (item.materialCategory === "Red Bottles" && item.materialVariant !== "Red") {
          return NextResponse.json({ error: "Red Bottles must use Red type" }, { status: 400 });
        }
      }

      const lineTotals = s.items.map(item => Math.round(item.quantityKg * item.ratePerKg * 100) / 100);
      const grossAmount = Math.round(lineTotals.reduce((n, x) => n + x, 0) * 100) / 100;
      const totalWeight = Math.round(s.items.reduce((n, x) => n + x.quantityKg, 0) * 1000) / 1000;
      const labourCharges = Math.round(totalWeight * 2 * 100) / 100;
      const loadingCharges = s.loadingCharges;
      const total = Math.round(Math.max(0, grossAmount - labourCharges - loadingCharges) * 100) / 100;
      const requiredByMaterial = new Map<string, number>();
      for (const item of s.items) {
        const materialName = saleMaterialName(item.materialCategory,item.materialVariant);
        requiredByMaterial.set(materialName,(requiredByMaterial.get(materialName)||0)+item.quantityKg);
      }
      for (const [materialName,requiredKg] of requiredByMaterial) {
        const available = getAvailableStock(s.mode,materialName,s.saleDate);
        if (requiredKg > available + 0.005) {
          return NextResponse.json({ error: "Insufficient stock for " + materialName + ". Available up to " + s.saleDate + ": " + available.toFixed(2) + " kg" }, {status:400});
        }
      }

      const received = Math.min(s.receivedAmount ?? total, total);
      const credit = Math.round((total - received) * 100) / 100;
      const primary = s.items[0];
      const r = sqlite.prepare("INSERT INTO sales (mode,customer_name,phone,location,material_category,material_variant,quantity_kg,rate_per_kg,gross_amount,labour_charges,loading_charges,total_amount,received_amount,credit_amount,sale_date,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(s.mode,s.customerName,s.phone,s.location,primary.materialCategory,s.items.length===1?primary.materialVariant:"MIXED",totalWeight,0,grossAmount,labourCharges,loadingCharges,total,received,credit,s.saleDate,s.notes,nowIso(),nowIso());
      const saleId = Number(r.lastInsertRowid);

      for (let i = 0; i < s.items.length; i++) {
        const item = s.items[i];
        sqlite.prepare("INSERT INTO sale_items (sale_id,material_category,material_variant,quantity_kg,rate_per_kg,amount) VALUES (?,?,?,?,?,?)")
          .run(saleId,item.materialCategory,item.materialVariant,item.quantityKg,item.ratePerKg,lineTotals[i]);
        const materialName = item.materialVariant === "Red" ? "Red Bottles" : "Natural Bottles - " + item.materialVariant;
        sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(s.mode,null,materialName,"ADJUSTMENT",-item.quantityKg,-lineTotals[i],null,saleId,s.saleDate,"SALE #"+saleId+(s.notes ? " - "+s.notes : ""),nowIso());
      }
      if (received > 0) sqlite.prepare("INSERT INTO sale_payments (mode,sale_id,amount,payment_date,payment_mode,received_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?)").run(s.mode,saleId,received,s.saleDate,s.paymentMode,s.receivedBy ?? "",s.notes,nowIso());
      return json({ok:true,id:saleId,grossAmount,labourCharges,loadingCharges,total,received,credit});
    }

    if (body.action === "updateSale") {
      const s = z.object({
        saleId: z.number().int().positive(),
        mode: modeSchema,
        customerName: z.string().trim().min(1),
        phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        items: z.array(z.object({
          materialCategory: z.enum(["Natural Bottles","Red Bottles"]),
          materialVariant: z.enum(["Green","White","Red","White Milk"]),
          quantityKg: z.number().positive(),
          ratePerKg: z.number().nonnegative()
        })).min(1),
        saleDate: dateSchema,
        loadingCharges: z.number().nonnegative().default(0),
        receivedBy: z.enum(["Rahul","Devesh","Nitin"]).optional(),
        paymentMode: z.string().trim().min(1).optional(),
        notes: z.string().trim().optional().default("")
      }).parse(body);

      const existing = sqlite.prepare("SELECT * FROM sales WHERE id=? AND mode=?").get(s.saleId,s.mode) as any;
      if (!existing) return NextResponse.json({error:"Sale not found"},{status:404});

      for (const item of s.items) {
        if (item.materialCategory === "Natural Bottles" && !["Green","White","White Milk"].includes(item.materialVariant)) {
          return NextResponse.json({error:"Natural Bottles can be Green, White or White Milk"},{status:400});
        }
        if (item.materialCategory === "Red Bottles" && item.materialVariant !== "Red") {
          return NextResponse.json({error:"Red Bottles must use Red type"},{status:400});
        }
      }

      const lineTotals = s.items.map(item => Math.round(item.quantityKg * item.ratePerKg * 100) / 100);
      const grossAmount = Math.round(lineTotals.reduce((n,x)=>n+x,0) * 100) / 100;
      const totalWeight = Math.round(s.items.reduce((n,x)=>n+x.quantityKg,0) * 1000) / 1000;
      const labourCharges = Math.round(totalWeight * 2 * 100) / 100;
      const loadingCharges = s.loadingCharges;
      const total = Math.round(Math.max(0,grossAmount-labourCharges-loadingCharges) * 100) / 100;
      if (Number(existing.received_amount) > total + 0.005) {
        return NextResponse.json({error:"Final sale amount cannot be less than payment already received"},{status:400});
      }

      const requiredByMaterial = new Map<string, number>();
      for (const item of s.items) {
        const materialName = saleMaterialName(item.materialCategory,item.materialVariant);
        requiredByMaterial.set(materialName,(requiredByMaterial.get(materialName)||0)+item.quantityKg);
      }
      for (const [materialName,requiredKg] of requiredByMaterial) {
        const available = getAvailableStock(s.mode,materialName,s.saleDate,s.saleId);
        if (requiredKg > available + 0.005) {
          return NextResponse.json({error:"Insufficient stock for "+materialName+". Available up to "+s.saleDate+": "+available.toFixed(2)+" kg"},{status:400});
        }
      }

        sqlite.prepare("UPDATE sales SET customer_name=?,phone=?,location=?,material_category=?,material_variant=?,quantity_kg=?,rate_per_kg=?,gross_amount=?,labour_charges=?,loading_charges=?,total_amount=?,credit_amount=?,sale_date=?,notes=?,updated_at=? WHERE id=? AND mode=?")
          .run(s.customerName,s.phone,s.location,s.items[0].materialCategory,s.items.length===1?s.items[0].materialVariant:"MIXED",totalWeight,0,grossAmount,labourCharges,loadingCharges,total,Math.round((total-Number(existing.received_amount))*100)/100,s.saleDate,s.notes,nowIso(),s.saleId,s.mode);

        sqlite.prepare("DELETE FROM sale_items WHERE sale_id=?").run(s.saleId);
        sqlite.prepare("DELETE FROM inventory_transactions WHERE sale_id=? AND transaction_type='ADJUSTMENT'").run(s.saleId);

        for (let i=0;i<s.items.length;i++) {
          const item=s.items[i];
          sqlite.prepare("INSERT INTO sale_items (sale_id,material_category,material_variant,quantity_kg,rate_per_kg,amount) VALUES (?,?,?,?,?,?)")
            .run(s.saleId,item.materialCategory,item.materialVariant,item.quantityKg,item.ratePerKg,lineTotals[i]);
          const materialName=item.materialVariant==="Red" ? "Red Bottles" : "Natural Bottles - "+item.materialVariant;
          sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .run(s.mode,null,materialName,"ADJUSTMENT",-item.quantityKg,-lineTotals[i],null,s.saleId,s.saleDate,"SALE #"+s.saleId+(s.notes ? " - "+s.notes : ""),nowIso());
        }

        if (s.receivedBy !== undefined || s.paymentMode !== undefined) {
          sqlite.prepare("UPDATE sale_payments SET received_by=COALESCE(?,received_by),payment_mode=COALESCE(?,payment_mode) WHERE id=(SELECT id FROM sale_payments WHERE sale_id=? ORDER BY id DESC LIMIT 1)")
            .run(s.receivedBy ?? null,s.paymentMode ?? null,s.saleId);
        }

      return json({ok:true,id:s.saleId,grossAmount,labourCharges,loadingCharges,total,received:Number(existing.received_amount),credit:Math.round((total-Number(existing.received_amount))*100)/100});
    }

    if (body.action === "receiveSalePayment") {
      const s = z.object({mode:modeSchema,saleId:z.number().int().positive(),amount:z.number().positive(),paymentDate:dateSchema.optional().default(todayStr()),paymentMode:z.string().trim().min(1).default("Cash"),receivedBy:z.enum(["Rahul","Devesh","Nitin"]).optional(),notes:z.string().trim().optional().default("")}).parse(body);
      const sale = sqlite.prepare("SELECT credit_amount FROM sales WHERE id=? AND mode=?").get(s.saleId,s.mode) as any;
      if (!sale) return NextResponse.json({error:"Sale not found"},{status:404});
      if (s.amount > Number(sale.credit_amount) + 0.005) return NextResponse.json({error:"Payment exceeds pending amount"},{status:400});
      sqlite.prepare("UPDATE sales SET received_amount=received_amount+?,credit_amount=credit_amount-?,updated_at=? WHERE id=?").run(s.amount,s.amount,nowIso(),s.saleId);
      sqlite.prepare("INSERT INTO sale_payments (mode,sale_id,amount,payment_date,payment_mode,received_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?)").run(s.mode,s.saleId,s.amount,s.paymentDate,s.paymentMode,s.receivedBy ?? "",s.notes,nowIso());
      return json({ok:true});
    }
    if (body.action === "adjustInventory") {
      const s = z.object({
        mode: modeSchema,
        materialId: z.number().int().positive().optional(),
        materialName: z.string().trim().min(1),
        quantityKg: z.number(),
        amount: z.number().default(0),
        transactionDate: dateSchema.optional().default(todayStr()),
        notes: z.string().trim().min(1),
      }).parse(body);
      sqlite.prepare(`
        INSERT INTO inventory_transactions
        (mode, material_id, material_name, transaction_type, quantity_kg, amount, transaction_date, notes, created_at)
        VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?)
      `).run(s.mode, s.materialId ?? null, s.materialName, s.quantityKg, s.amount, s.transactionDate, s.notes, nowIso());
      return json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0]?.message || "Invalid data" }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Operation failed" }, { status: 500 });
  }
}
