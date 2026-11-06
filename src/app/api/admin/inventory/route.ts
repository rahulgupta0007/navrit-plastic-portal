/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireWriteSession } from "@/lib/auth";
import { sqlite } from "@/db";
import { listMaterials, nowIso, todayStr } from "@/lib/rates";
import { ACCOUNT_PERSONS, optionalAccountPersonSchema, accountPersonSchema } from "@/lib/account-persons";
import { optionalFundingSourceSchema } from "@/lib/funding";
import { friendlyZodError } from "@/lib/api-errors";
import { LABOUR_TASKS } from "@/lib/labour-tasks";
import { attendanceEarnedAmount, halfDayRate } from "@/lib/labour-math";
import { notifyPurchaseEmail, type NotifyKind } from "@/lib/email/notify-purchase";
import { emailConfigDiagnostics, isEmailConfigured, sendTestEmail } from "@/lib/email/gmail";

function workerWageDue(workerId: number, dailyRate: number, mode?: string) {
  const rows = mode
    ? (sqlite.prepare(
        "SELECT payment_kind, attendance_type, hours, amount FROM processing_manual_labour WHERE worker_id=? AND mode=?"
      ).all(workerId, mode) as Array<{ payment_kind: string; attendance_type: string; hours: number; amount: number }>)
    : (sqlite.prepare(
        "SELECT payment_kind, attendance_type, hours, amount FROM processing_manual_labour WHERE worker_id=?"
      ).all(workerId) as Array<{ payment_kind: string; attendance_type: string; hours: number; amount: number }>);
  let earned = 0;
  let wagesPaid = 0;
  let advances = 0;
  for (const row of rows) {
    const kind = row.payment_kind || "WAGE";
    if (kind === "ATTENDANCE") {
      earned += attendanceEarnedAmount(dailyRate, row.attendance_type, Number(row.hours || 0));
    } else if (kind === "ADVANCE") {
      advances += Number(row.amount || 0);
    } else {
      wagesPaid += Number(row.amount || 0);
    }
  }
  earned = Math.round(earned * 100) / 100;
  wagesPaid = Math.round(wagesPaid * 100) / 100;
  advances = Math.round(advances * 100) / 100;
  return {
    earned,
    wagesPaid,
    advances,
    due: Math.round((earned - wagesPaid - advances) * 100) / 100,
  };
}

export const dynamic = "force-dynamic";

async function guard() {
  return await getSession();
}

const modeSchema = z.enum(["PET", "PLASTIC"]);
/** Business expense can be mode-specific or SHARED across PET + Plastic (e.g. electricity). */
const expenseModeSchema = z.enum(["PET", "PLASTIC", "SHARED"]);
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

const RED_SALE_VARIANTS = ["Red Bottle", "Red Bottle Cap", "Red"] as const;

function isRedSaleVariant(variant: string) {
  return (RED_SALE_VARIANTS as readonly string[]).includes(variant.trim());
}

/** PET ledger stock key: Natural (mixed) or Red Bottles pool. */
function saleMaterialName(materialCategory: string, materialVariant: string) {
  if (materialCategory === "Red Bottles" || isRedSaleVariant(materialVariant)) return "Red Bottles";
  return "Natural Bottles";
}

function requireActivePlasticType(name: string) {
  const row = sqlite.prepare(
    "SELECT id, name FROM plastic_material_types WHERE mode='PLASTIC' AND active=1 AND lower(name)=lower(?)"
  ).get(name.trim()) as { id: number; name: string } | undefined;
  if (!row) throw new Error("Unknown or inactive Plastic material type. Add it under Plastic Inventory first.");
  return row.name;
}

/**
 * Purchase / pre-stock stock key.
 * PET: Natural mixed or Red. Plastic: user-defined material type name.
 */
function purchaseStockName(mode: string, materialName: string, materialVariant: string) {
  const name = materialName.trim();
  const variant = materialVariant.trim();
  if (mode === "PLASTIC") {
    return requireActivePlasticType(name);
  }
  if (name === "Red Bottles" || variant === "Red") {
    if (variant && variant !== "Red" && variant !== "Mixed") {
      throw new Error("Red Bottles must use the Red type");
    }
    return "Red Bottles";
  }
  if (name === "Natural Bottles" || name.startsWith("Natural Bottles")) {
    // Accept legacy Green/White/White Milk labels but store as one mixed Natural pool.
    return "Natural Bottles";
  }
  // Legacy free-text materials keep their purchased name as the stock key.
  return name;
}

function resolveSaleStockName(mode: string, materialCategory: string, materialVariant: string) {
  if (mode === "PLASTIC") return requireActivePlasticType(materialCategory);
  return saleMaterialName(materialCategory, materialVariant);
}

function isNaturalStockName(materialName: string) {
  return materialName === "Natural Bottles" || materialName.startsWith("Natural Bottles");
}

/** Transport (driver) + Loading (outside labour) — not paid to vendor; hits company cash via other_expenses. */
function syncPurchaseSideCosts(opts: {
  mode: string;
  purchaseId: number;
  transportCharges: number;
  loadingCharges: number;
  expenseDate: string;
  paidBy: string;
  fundingSource: string;
}) {
  const transport = Math.round(Math.max(0, Number(opts.transportCharges) || 0) * 100) / 100;
  const loading = Math.round(Math.max(0, Number(opts.loadingCharges) || 0) * 100) / 100;
  sqlite
    .prepare("DELETE FROM other_expenses WHERE purchase_id=? AND expense_type IN ('Transport','Loading')")
    .run(opts.purchaseId);
  const insert = sqlite.prepare(`
    INSERT INTO other_expenses
    (mode,purchase_id,expense_type,description,amount,expense_date,expense_frequency,paid_by,created_at,billing_month,billing_start_date,billing_end_date,funding_source)
    VALUES (?,?,?,?,?,?,'ONE_TIME',?,?,?,?,?,?)
  `);
  if (transport > 0.005) {
    insert.run(
      opts.mode,
      opts.purchaseId,
      "Transport",
      `Driver / transport for purchase #${opts.purchaseId}`,
      transport,
      opts.expenseDate,
      opts.paidBy || "",
      nowIso(),
      "",
      "",
      "",
      opts.fundingSource || "COMPANY"
    );
  }
  if (loading > 0.005) {
    insert.run(
      opts.mode,
      opts.purchaseId,
      "Loading",
      `Outside loading labour for purchase #${opts.purchaseId}`,
      loading,
      opts.expenseDate,
      opts.paidBy || "",
      nowIso(),
      "",
      "",
      "",
      opts.fundingSource || "COMPANY"
    );
  }
  return { transport, loading, landedExtra: Math.round((transport + loading) * 100) / 100 };
}

function getAvailableStock(mode: string, materialName: string, date: string, excludeSaleId?: number) {
  // Natural buys are mixed; include legacy colour rows so older data still counts.
  if (isNaturalStockName(materialName)) {
    const row = excludeSaleId === undefined
      ? sqlite.prepare(`
          SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions
          WHERE mode=? AND transaction_date<=?
            AND (material_name='Natural Bottles' OR material_name LIKE 'Natural Bottles - %')
        `).get(mode, date) as any
      : sqlite.prepare(`
          SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions
          WHERE mode=? AND transaction_date<=?
            AND (material_name='Natural Bottles' OR material_name LIKE 'Natural Bottles - %')
            AND COALESCE(sale_id,0)<>?
        `).get(mode, date, excludeSaleId) as any;
    return Number(row?.kg || 0);
  }
  const row = excludeSaleId === undefined
    ? sqlite.prepare("SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=?").get(mode,date,materialName) as any
    : sqlite.prepare("SELECT COALESCE(SUM(quantity_kg),0) as kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=? AND COALESCE(sale_id,0)<>?").get(mode,date,materialName,excludeSaleId) as any;
  return Number(row?.kg || 0);
}

function stockRowsForMaterial(mode: string, materialName: string) {
  return isNaturalStockName(materialName)
    ? (sqlite.prepare(`
        SELECT quantity_kg, transaction_date FROM inventory_transactions
        WHERE mode=? AND (material_name='Natural Bottles' OR material_name LIKE 'Natural Bottles - %')
        ORDER BY transaction_date ASC, id ASC
      `).all(mode) as Array<{ quantity_kg: number; transaction_date: string }>)
    : (sqlite.prepare(
        "SELECT quantity_kg, transaction_date FROM inventory_transactions WHERE mode=? AND material_name=? ORDER BY transaction_date ASC, id ASC"
      ).all(mode, materialName) as Array<{ quantity_kg: number; transaction_date: string }>);
}

function assertNoNegativeStock(mode: string, materialNames: string[]) {
  const normalized = [...new Set(materialNames.map((name) => (isNaturalStockName(name) ? "Natural Bottles" : name)))];
  for (const materialName of normalized) {
    const rows = stockRowsForMaterial(mode, materialName);
    let balance = 0;
    for (const row of rows) {
      balance += Number(row.quantity_kg || 0);
      if (balance < -0.005) {
        throw new Error("Stock cannot go negative for " + materialName + ". Resulting balance: " + balance.toFixed(3) + " kg");
      }
    }
  }
}

/** For purchase edits / material corrections: only require final ledger balance >= 0.
 * Chronological dips (e.g. Red sold before a mis-tagged Natural purchase is moved to Red)
 * should not block fixing the purchase type — user can also backdate the purchase if needed.
 */
function assertEndingStockNonNegative(mode: string, materialNames: string[]) {
  const normalized = [...new Set(materialNames.map((name) => (isNaturalStockName(name) ? "Natural Bottles" : name)))];
  for (const materialName of normalized) {
    const rows = stockRowsForMaterial(mode, materialName);
    let balance = 0;
    let worst = 0;
    for (const row of rows) {
      balance += Number(row.quantity_kg || 0);
      if (balance < worst) worst = balance;
    }
    if (balance < -0.005) {
      throw new Error(
        `Stock cannot go negative for ${materialName}. Ending balance: ${balance.toFixed(3)} kg` +
          (worst < -0.005
            ? ` (lowest mid-history ${worst.toFixed(3)} kg — set purchase date earlier than Red sales, or add Red stock first)`
            : "")
      );
    }
  }
}

const companyFundedVendorSql = `SELECT COALESCE(SUM(amount),0) as n FROM vendor_payments
  WHERE mode=? AND NOT (payment_type='CREDIT_SETTLEMENT' AND payment_mode='Advance')
  AND COALESCE(funding_source,'COMPANY')='COMPANY'`;
const companyFundedExpenseSql = `SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE mode=? AND COALESCE(funding_source,'COMPANY')='COMPANY'`;
const companyFundedProcessingSql = `SELECT COALESCE(SUM(amount),0) as n FROM processing_expenses WHERE mode=? AND COALESCE(funding_source,'COMPANY')='COMPANY'`;
const companyFundedSaleProcSql = `SELECT COALESCE(SUM(labour_cost + loading_cost),0) as n FROM sale_processing_costs WHERE mode=? AND COALESCE(funding_source,'COMPANY')='COMPANY'`;
// Attendance-only rows do not hit cash; WAGE + ADVANCE (+ legacy blank kind) do.
const companyFundedLabourSql = `SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour
  WHERE mode=? AND COALESCE(funding_source,'COMPANY')='COMPANY'
  AND COALESCE(NULLIF(payment_kind,''),'WAGE') IN ('WAGE','ADVANCE')`;
const companyFundedContractorCashSql = `SELECT COALESCE(SUM(amount),0) as n FROM processing_contractor_ledger
  WHERE mode=? AND entry_type IN ('ADVANCE','SETTLEMENT') AND COALESCE(funding_source,'COMPANY')='COMPANY'`;

/** Company cash book parts. Pre-stock is inventory-only and never included. */
function modeCashflowParts(m: string) {
  const salesReceived = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM sale_payments WHERE mode=? AND COALESCE(payment_mode,'')<>'Advance'").get(m) as any)?.n || 0);
  const buyerAdvances = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM buyer_advances WHERE mode=?").get(m) as any)?.n || 0);
  const partnerAdvances = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances WHERE mode=?").get(m) as any)?.n || 0);
  const vendorPayments = Number((sqlite.prepare(companyFundedVendorSql).get(m) as any)?.n || 0);
  const borrowed = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM borrowings WHERE mode=?").get(m) as any)?.n || 0);
  const loanRepaid = Number((sqlite.prepare("SELECT COALESCE(SUM(br.amount),0) as n FROM borrowing_repayments br JOIN borrowings b ON b.id=br.borrowing_id WHERE b.mode=?").get(m) as any)?.n || 0);
  const processingExpenses = Number((sqlite.prepare(companyFundedProcessingSql).get(m) as any)?.n || 0);
  const saleProcessing = Number((sqlite.prepare(companyFundedSaleProcSql).get(m) as any)?.n || 0);
  const otherExpenses = Number((sqlite.prepare(companyFundedExpenseSql).get(m) as any)?.n || 0);
  const manualLabour = Number((sqlite.prepare(companyFundedLabourSql).get(m) as any)?.n || 0);
  const contractorCash = Number((sqlite.prepare(companyFundedContractorCashSql).get(m) as any)?.n || 0);
  const partnerSettled = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_settlements WHERE mode=?").get(m) as any)?.n || 0);
  const book = Math.round((salesReceived + buyerAdvances + partnerAdvances - vendorPayments + borrowed - loanRepaid - processingExpenses - saleProcessing - otherExpenses - manualLabour - contractorCash - partnerSettled) * 100) / 100;
  return {
    salesReceived, buyerAdvances, partnerAdvances, vendorPayments, borrowed, loanRepaid, processingExpenses, saleProcessing,
    otherExpenses, manualLabour, contractorCash, partnerSettled, book,
  };
}

/** Cash earned/spent by the business itself, ignoring financing (loans, partner settle/lend). */
function operatingContribution(p: CashflowParts) {
  return Math.round((p.salesReceived + p.buyerAdvances - p.vendorPayments - p.processingExpenses - p.saleProcessing
    - p.otherExpenses - p.manualLabour - p.contractorCash) * 100) / 100;
}

function normBuyer(name: string) {
  return name.trim().toLowerCase();
}

function buyerAdvanceAvailable(mode: string, buyerName: string) {
  return Math.round(Number((sqlite.prepare(
    "SELECT COALESCE(SUM(amount-used_amount),0) as n FROM buyer_advances WHERE mode=? AND lower(trim(buyer_name))=?"
  ).get(mode, normBuyer(buyerName)) as any)?.n || 0) * 100) / 100;
}

/** FIFO-consume buyer advances against a sale; records an 'Advance' sale payment (no new cash). */
function applyBuyerAdvanceToSale(mode: string, buyerName: string, saleId: number, maxAmount: number, date: string) {
  let remaining = Math.min(maxAmount, buyerAdvanceAvailable(mode, buyerName));
  remaining = Math.round(remaining * 100) / 100;
  if (!(remaining > 0.004)) return 0;
  const rows = sqlite.prepare(
    "SELECT id, amount, used_amount FROM buyer_advances WHERE mode=? AND lower(trim(buyer_name))=? AND amount-used_amount>0.004 ORDER BY advance_date ASC, id ASC"
  ).all(mode, normBuyer(buyerName)) as Array<{ id: number; amount: number; used_amount: number }>;
  let applied = 0;
  for (const row of rows) {
    if (remaining <= 0.004) break;
    const take = Math.round(Math.min(remaining, Number(row.amount) - Number(row.used_amount)) * 100) / 100;
    if (!(take > 0)) continue;
    sqlite.prepare("UPDATE buyer_advances SET used_amount=used_amount+? WHERE id=?").run(take, row.id);
    remaining = Math.round((remaining - take) * 100) / 100;
    applied = Math.round((applied + take) * 100) / 100;
  }
  if (applied > 0) {
    sqlite.prepare("INSERT INTO sale_payments (mode,sale_id,amount,payment_date,payment_mode,received_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(mode, saleId, applied, date, "Advance", "", "Buyer advance applied", nowIso());
  }
  return applied;
}

function ensureBuyer(mode: string, name: string, phone = "", location = "") {
  const trimmed = name.trim();
  if (!trimmed) return;
  const existing = sqlite.prepare(
    "SELECT id, phone, location FROM buyers WHERE mode=? AND lower(trim(name))=lower(?)"
  ).get(mode, trimmed) as { id: number; phone: string; location: string } | undefined;
  if (existing) {
    const nextPhone = phone.trim() || existing.phone || "";
    const nextLocation = location.trim() || existing.location || "";
    if (nextPhone !== existing.phone || nextLocation !== existing.location) {
      sqlite.prepare("UPDATE buyers SET phone=?, location=?, updated_at=? WHERE id=?")
        .run(nextPhone, nextLocation, nowIso(), existing.id);
    }
    return existing.id;
  }
  const r = sqlite.prepare(
    "INSERT INTO buyers (mode, name, phone, location, notes, active, created_at, updated_at) VALUES (?,?,?,?, '',1,?,?)"
  ).run(mode, trimmed, phone.trim(), location.trim(), nowIso(), nowIso());
  return Number(r.lastInsertRowid);
}

function buyerSummaryRows() {
  return sqlite.prepare(`
    WITH names AS (
      SELECT mode, lower(trim(name)) AS k, MAX(name) AS name FROM buyers WHERE active=1 GROUP BY mode, lower(trim(name))
      UNION
      SELECT mode, lower(trim(customer_name)) AS k, MAX(customer_name) AS name FROM sales GROUP BY mode, lower(trim(customer_name))
      UNION
      SELECT mode, lower(trim(buyer_name)) AS k, MAX(buyer_name) AS name FROM buyer_advances GROUP BY mode, lower(trim(buyer_name))
    ),
    uniq AS (SELECT mode, k, MAX(name) AS name FROM names GROUP BY mode, k)
    SELECT u.mode, u.name,
      COALESCE((SELECT b.id FROM buyers b WHERE b.mode=u.mode AND lower(trim(b.name))=u.k LIMIT 1), 0) AS id,
      ROUND(COALESCE((SELECT SUM(total_amount) FROM sales s WHERE s.mode=u.mode AND lower(trim(s.customer_name))=u.k),0),2) AS totalSales,
      ROUND(COALESCE((SELECT SUM(credit_amount) FROM sales s WHERE s.mode=u.mode AND lower(trim(s.customer_name))=u.k),0),2) AS pendingCredit,
      ROUND(COALESCE((SELECT SUM(quantity_kg) FROM sales s WHERE s.mode=u.mode AND lower(trim(s.customer_name))=u.k),0),2) AS totalKg,
      ROUND(COALESCE((SELECT SUM(amount) FROM buyer_advances a WHERE a.mode=u.mode AND lower(trim(a.buyer_name))=u.k),0),2) AS advanceGiven,
      ROUND(COALESCE((SELECT SUM(amount-used_amount) FROM buyer_advances a WHERE a.mode=u.mode AND lower(trim(a.buyer_name))=u.k),0),2) AS advanceBalance,
      COALESCE(
        (SELECT phone FROM buyers b WHERE b.mode=u.mode AND lower(trim(b.name))=u.k LIMIT 1),
        (SELECT MAX(phone) FROM sales s WHERE s.mode=u.mode AND lower(trim(s.customer_name))=u.k),
        ''
      ) AS phone,
      COALESCE(
        (SELECT location FROM buyers b WHERE b.mode=u.mode AND lower(trim(b.name))=u.k LIMIT 1),
        (SELECT MAX(location) FROM sales s WHERE s.mode=u.mode AND lower(trim(s.customer_name))=u.k),
        ''
      ) AS location
    FROM uniq u
    ORDER BY u.name COLLATE NOCASE, u.mode
  `).all();
}


/** Activity kg used to split SHARED expenses (PET process input, Plastic sales). */
function sharedExpenseActivityKg() {
  const petKg = Number((sqlite.prepare(`
    SELECT COALESCE(SUM(total_input_kg),0) as n FROM processing_batches WHERE mode='PET'
  `).get() as any)?.n || 0);
  const plasticKg = Number((sqlite.prepare(`
    SELECT COALESCE(SUM(quantity_kg),0) as n FROM sales WHERE mode='PLASTIC'
  `).get() as any)?.n || 0);
  const pet = Math.max(0, petKg);
  const plastic = Math.max(0, plasticKg);
  const total = pet + plastic;
  if (total <= 0.005) return { petKg: 0, plasticKg: 0, petShare: 0.5, plasticShare: 0.5 };
  return {
    petKg: Math.round(pet * 1000) / 1000,
    plasticKg: Math.round(plastic * 1000) / 1000,
    petShare: pet / total,
    plasticShare: plastic / total,
  };
}

function sharedCompanyOtherExpenses() {
  return Number((sqlite.prepare(`
    SELECT COALESCE(SUM(amount),0) as n FROM other_expenses
    WHERE mode='SHARED' AND COALESCE(funding_source,'COMPANY')='COMPANY'
  `).get() as any)?.n || 0);
}

function sharedExpenseAllocation(mode: "PET" | "PLASTIC") {
  const activity = sharedExpenseActivityKg();
  const sharedTotal = sharedCompanyOtherExpenses();
  const share = mode === "PET" ? activity.petShare : activity.plasticShare;
  const allocated = Math.round(sharedTotal * share * 100) / 100;
  return { ...activity, sharedTotal, allocated, sharePct: Math.round(share * 10000) / 100 };
}

function currentProcessingContractor(mode: string) {
  return sqlite.prepare(`
    SELECT * FROM processing_contractors
    WHERE mode=? AND active=1 AND is_current=1
    ORDER BY id DESC LIMIT 1
  `).get(mode) as
    | { id: number; mode: string; name: string; rate_per_kg: number }
    | undefined;
}

function contractorBalance(contractorId: number) {
  const earned = Number((sqlite.prepare(`
    SELECT COALESCE(SUM(amount),0) as n FROM processing_contractor_ledger
    WHERE contractor_id=? AND entry_type IN ('EARN_BATCH','EARN_SALE')
  `).get(contractorId) as any)?.n || 0);
  const advances = Number((sqlite.prepare(`
    SELECT COALESCE(SUM(amount),0) as n FROM processing_contractor_ledger
    WHERE contractor_id=? AND entry_type='ADVANCE'
  `).get(contractorId) as any)?.n || 0);
  const settled = Number((sqlite.prepare(`
    SELECT COALESCE(SUM(amount),0) as n FROM processing_contractor_ledger
    WHERE contractor_id=? AND entry_type='SETTLEMENT'
  `).get(contractorId) as any)?.n || 0);
  // Advances reduce what company still owes; netDue can be negative if advance > earned.
  const netDue = Math.round((earned - advances - settled) * 100) / 100;
  return { earned, advances, settled, netDue };
}

function creditContractorEarn(opts: {
  mode: string;
  entryType: "EARN_BATCH" | "EARN_SALE";
  kg: number;
  batchId?: number | null;
  saleId?: number | null;
  entryDate: string;
  notes?: string;
}) {
  const contractor = currentProcessingContractor(opts.mode);
  if (!contractor || !(opts.kg > 0.005)) return null;
  const rate = Number(contractor.rate_per_kg || 2);
  const amount = Math.round(opts.kg * rate * 100) / 100;
  if (!(amount > 0)) return null;
  sqlite.prepare(`
    INSERT INTO processing_contractor_ledger
    (mode,contractor_id,entry_type,amount,kg,rate_per_kg,batch_id,sale_id,entry_date,paid_by,funding_source,notes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,'','COMPANY',?,?)
  `).run(
    opts.mode, contractor.id, opts.entryType, amount, opts.kg, rate,
    opts.batchId ?? null, opts.saleId ?? null, opts.entryDate,
    opts.notes || "", nowIso()
  );
  return { contractorId: contractor.id, amount, rate };
}

function modeCashflow(m: string) {
  return modeCashflowParts(m).book;
}

type CashflowParts = ReturnType<typeof modeCashflowParts>;

/** One firm-wide cash book = PET activity + Plastic activity. */
function companyCashflowParts(): CashflowParts {
  const pet = modeCashflowParts("PET");
  const plastic = modeCashflowParts("PLASTIC");
  const keys = Object.keys(pet) as (keyof CashflowParts)[];
  const out = {} as CashflowParts;
  for (const key of keys) {
    out[key] = Math.round((Number(pet[key]) + Number(plastic[key])) * 100) / 100;
  }
  // SHARED bills (electricity etc.) hit the company book once — not tagged to PET or Plastic alone.
  const sharedOther = sharedCompanyOtherExpenses();
  out.otherExpenses = Math.round((out.otherExpenses + sharedOther) * 100) / 100;
  out.book = Math.round((out.salesReceived + out.buyerAdvances + out.partnerAdvances - out.vendorPayments
    + out.borrowed - out.loanRepaid - out.processingExpenses - out.saleProcessing
    - out.otherExpenses - out.manualLabour - out.contractorCash - out.partnerSettled) * 100) / 100;
  return out;
}

function companyCashflow() {
  return companyCashflowParts().book;
}

type PersonTotalsRow = {
  received: number;
  buyerAdvanceReceived: number;
  partnerLent: number;
  partnerLentHeld: number;
  purchasesPaid: number;
  expensesPaid: number;
  processingPaid: number;
  saleProcessingPaid: number;
  labourPaid: number;
  contractorPaid: number;
  companyPaid: number;
  ownPocketPaid: number;
  settled: number;
  cashWithPartner: number;
  companyOwesPartner: number;
  paid: number;
  balance: number;
};

/** Partner wallets are company-wide (Rahul/Devesh/Nitin across PET + Plastic). */
function companyPersonAccountTotals(): Record<string, PersonTotalsRow> {
  const totals: Record<string, PersonTotalsRow> = {};
  for (const person of ACCOUNT_PERSONS) {
    const saleReceived = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM sale_payments WHERE received_by=? AND COALESCE(payment_mode,'')<>'Advance'").get(person) as any)?.n || 0);
    const buyerAdvanceReceived = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM buyer_advances WHERE received_by=?").get(person) as any)?.n || 0);
    const partnerLent = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances WHERE person=?").get(person) as any)?.n || 0);
    const partnerLentHeld = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances WHERE COALESCE(NULLIF(held_by,''),person)=?").get(person) as any)?.n || 0);
    const received = Math.round((saleReceived + buyerAdvanceReceived + partnerLentHeld) * 100) / 100;
    const purchasesCompany = Number((sqlite.prepare("SELECT COALESCE(SUM(vp.amount),0) as n FROM vendor_payments vp LEFT JOIN purchases p ON p.id=vp.purchase_id WHERE COALESCE(NULLIF(vp.paid_by,''), p.paid_by, '')=? AND vp.payment_type<>'ADVANCE' AND COALESCE(vp.payment_mode,'')<>'Advance' AND COALESCE(vp.funding_source,'COMPANY')='COMPANY'").get(person) as any)?.n || 0);
    const purchasesPocket = Number((sqlite.prepare("SELECT COALESCE(SUM(vp.amount),0) as n FROM vendor_payments vp LEFT JOIN purchases p ON p.id=vp.purchase_id WHERE COALESCE(NULLIF(vp.paid_by,''), p.paid_by, '')=? AND vp.payment_type<>'ADVANCE' AND COALESCE(vp.payment_mode,'')<>'Advance' AND COALESCE(vp.funding_source,'COMPANY')='OWN_POCKET'").get(person) as any)?.n || 0);
    const expensesCompany = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='COMPANY'").get(person) as any)?.n || 0);
    const expensesPocket = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='OWN_POCKET'").get(person) as any)?.n || 0);
    const processingCompany = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM processing_expenses WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='COMPANY'").get(person) as any)?.n || 0);
    const processingPocket = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM processing_expenses WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='OWN_POCKET'").get(person) as any)?.n || 0);
    const saleProcCompany = Number((sqlite.prepare("SELECT COALESCE(SUM(labour_cost + loading_cost),0) as n FROM sale_processing_costs WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='COMPANY'").get(person) as any)?.n || 0);
    const saleProcPocket = Number((sqlite.prepare("SELECT COALESCE(SUM(labour_cost + loading_cost),0) as n FROM sale_processing_costs WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='OWN_POCKET'").get(person) as any)?.n || 0);
    const labourCompany = Number((sqlite.prepare(`
      SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour
      WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='COMPANY'
        AND COALESCE(NULLIF(payment_kind,''),'WAGE') IN ('WAGE','ADVANCE')
    `).get(person) as any)?.n || 0);
    const labourPocket = Number((sqlite.prepare(`
      SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour
      WHERE paid_by=? AND COALESCE(funding_source,'COMPANY')='OWN_POCKET'
        AND COALESCE(NULLIF(payment_kind,''),'WAGE') IN ('WAGE','ADVANCE')
    `).get(person) as any)?.n || 0);
    const contractorCompany = Number((sqlite.prepare(`
      SELECT COALESCE(SUM(amount),0) as n FROM processing_contractor_ledger
      WHERE paid_by=? AND entry_type IN ('ADVANCE','SETTLEMENT')
        AND COALESCE(funding_source,'COMPANY')='COMPANY'
    `).get(person) as any)?.n || 0);
    const contractorPocket = Number((sqlite.prepare(`
      SELECT COALESCE(SUM(amount),0) as n FROM processing_contractor_ledger
      WHERE paid_by=? AND entry_type IN ('ADVANCE','SETTLEMENT')
        AND COALESCE(funding_source,'COMPANY')='OWN_POCKET'
    `).get(person) as any)?.n || 0);
    const settled = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_settlements WHERE person=?").get(person) as any)?.n || 0);
    const settlementsPaidOut = Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_settlements WHERE paid_by=?").get(person) as any)?.n || 0);
    const companyPaid = purchasesCompany + expensesCompany + processingCompany + saleProcCompany + labourCompany + contractorCompany + settlementsPaidOut;
    const ownPocketPaid = purchasesPocket + expensesPocket + processingPocket + saleProcPocket + labourPocket + contractorPocket;
    const purchasesPaid = purchasesCompany + purchasesPocket;
    const expensesPaid = expensesCompany + expensesPocket;
    const processingPaid = processingCompany + processingPocket;
    const saleProcessingPaid = saleProcCompany + saleProcPocket;
    const labourPaid = labourCompany + labourPocket;
    const contractorPaid = contractorCompany + contractorPocket;
    const paid = companyPaid + ownPocketPaid;
    const cashWithPartner = Math.round((received - companyPaid) * 100) / 100;
    const companyOwesPartner = Math.round((ownPocketPaid + partnerLent - settled) * 100) / 100;
    const balance = Math.round((cashWithPartner - companyOwesPartner) * 100) / 100;
    totals[person] = {
      received, buyerAdvanceReceived, partnerLent, partnerLentHeld, purchasesPaid, expensesPaid, processingPaid, saleProcessingPaid, labourPaid, contractorPaid,
      companyPaid, ownPocketPaid, settled, cashWithPartner, companyOwesPartner, paid, balance,
    };
  }
  return totals;
}

/**
 * Remove orphan CREDIT_SETTLEMENT rows that double-count purchase-linked pays.
 * Keeps at most (sum of purchase.paid_amount − already-linked payments) as orphan cash.
 */
function repairDuplicateVendorPayments(mode: string) {
  const suppliers = sqlite.prepare("SELECT DISTINCT supplier_id as id FROM purchases WHERE mode=? AND supplier_id IS NOT NULL").all(mode) as Array<{ id: number }>;
  let deleted = 0;
  let reduced = 0;
  let linked = 0;
  for (const supplier of suppliers) {
    const target = Number((sqlite.prepare("SELECT COALESCE(SUM(paid_amount),0) as n FROM purchases WHERE mode=? AND supplier_id=?").get(mode, supplier.id) as any)?.n || 0);
    const linkedSum = Number((sqlite.prepare(`
      SELECT COALESCE(SUM(amount),0) as n FROM vendor_payments
      WHERE mode=? AND supplier_id=? AND purchase_id IS NOT NULL
        AND payment_type<>'ADVANCE' AND COALESCE(payment_mode,'')<>'Advance'
    `).get(mode, supplier.id) as any)?.n || 0);
    const orphans = sqlite.prepare(`
      SELECT id, amount, payment_date, paid_by FROM vendor_payments
      WHERE mode=? AND supplier_id=? AND purchase_id IS NULL
        AND payment_type='CREDIT_SETTLEMENT' AND COALESCE(payment_mode,'')<>'Advance'
      ORDER BY payment_date ASC, id ASC
    `).all(mode, supplier.id) as Array<{ id: number; amount: number; payment_date: string; paid_by: string }>;
    if (!orphans.length) continue;

    let need = Math.max(0, Math.round((target - linkedSum) * 100) / 100);
    for (const orphan of orphans) {
      const amt = Number(orphan.amount);
      if (need <= 0.005) {
        sqlite.prepare("DELETE FROM vendor_payments WHERE id=?").run(orphan.id);
        deleted += 1;
        continue;
      }
      const unlinkedPurchase = sqlite.prepare(`
        SELECT p.id, p.paid_amount, p.paid_by FROM purchases p
        WHERE p.mode=? AND p.supplier_id=? AND p.paid_amount>0.005
          AND NOT EXISTS (
            SELECT 1 FROM vendor_payments vp
            WHERE vp.purchase_id=p.id AND vp.payment_type<>'ADVANCE' AND COALESCE(vp.payment_mode,'')<>'Advance'
          )
        ORDER BY p.purchase_date ASC, p.id ASC
        LIMIT 1
      `).get(mode, supplier.id) as { id: number; paid_amount: number; paid_by: string } | undefined;

      if (amt <= need + 0.005) {
        if (unlinkedPurchase && Math.abs(Number(unlinkedPurchase.paid_amount) - amt) < 0.02) {
          sqlite.prepare(`
            UPDATE vendor_payments
            SET purchase_id=?, paid_by=COALESCE(NULLIF(paid_by,''), ?), notes=COALESCE(NULLIF(notes,''), 'Repaired link to purchase')
            WHERE id=?
          `).run(unlinkedPurchase.id, unlinkedPurchase.paid_by || "", orphan.id);
          linked += 1;
        }
        need = Math.round((need - amt) * 100) / 100;
      } else {
        const take = unlinkedPurchase
          ? Math.min(need, Number(unlinkedPurchase.paid_amount))
          : need;
        const leftover = Math.round((amt - take) * 100) / 100;
        if (unlinkedPurchase) {
          sqlite.prepare(`
            UPDATE vendor_payments
            SET purchase_id=?, amount=?, paid_by=COALESCE(NULLIF(paid_by,''), ?), notes=COALESCE(NULLIF(notes,''), 'Repaired link to purchase')
            WHERE id=?
          `).run(unlinkedPurchase.id, take, unlinkedPurchase.paid_by || "", orphan.id);
          linked += 1;
        } else {
          sqlite.prepare("UPDATE vendor_payments SET amount=?, notes=COALESCE(NULLIF(notes,''), 'Reduced duplicate orphan') WHERE id=?")
            .run(take, orphan.id);
          reduced += 1;
        }
        if (leftover > 0.005) deleted += 1; // leftover discarded by shrinking amount
        need = Math.round((need - take) * 100) / 100;
      }
    }
  }
  return { deleted, reduced, linked };
}

/** Orphan cash still needed for a supplier after purchase-linked rows. */
function orphanVendorNeed(mode: string, supplierId: number) {
  const target = Number((sqlite.prepare("SELECT COALESCE(SUM(paid_amount),0) as n FROM purchases WHERE mode=? AND supplier_id=?").get(mode, supplierId) as any)?.n || 0);
  const linkedSum = Number((sqlite.prepare(`
    SELECT COALESCE(SUM(amount),0) as n FROM vendor_payments
    WHERE mode=? AND supplier_id=? AND purchase_id IS NOT NULL
      AND payment_type<>'ADVANCE' AND COALESCE(payment_mode,'')<>'Advance'
  `).get(mode, supplierId) as any)?.n || 0);
  return Math.max(0, Math.round((target - linkedSum) * 100) / 100);
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Heal historical double-counts: orphan CREDIT_SETTLEMENT + Payment-date PURCHASE rows.
  withTransaction(() => {
    repairDuplicateVendorPayments("PET");
    repairDuplicateVendorPayments("PLASTIC");
  });

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
  const partnerSettlements = sqlite.prepare("SELECT * FROM partner_settlements ORDER BY settlement_date DESC, id DESC LIMIT 500").all();
  const partnerAdvances = sqlite.prepare("SELECT * FROM partner_advances ORDER BY advance_date DESC, id DESC LIMIT 500").all();
  const buyerAdvances = sqlite.prepare("SELECT * FROM buyer_advances ORDER BY advance_date DESC, id DESC LIMIT 500").all();
  const buyers = sqlite.prepare("SELECT * FROM buyers WHERE active=1 ORDER BY name COLLATE NOCASE, mode").all();
  const buyerSummary = buyerSummaryRows();
  const borrowingRepayments = sqlite.prepare("SELECT br.*, b.mode FROM borrowing_repayments br JOIN borrowings b ON b.id=br.borrowing_id ORDER BY br.repayment_date DESC, br.id DESC LIMIT 500").all();
  const sales = sqlite.prepare("SELECT * FROM sales ORDER BY sale_date DESC, id DESC LIMIT 200").all();
  const saleItems = sqlite.prepare("SELECT * FROM sale_items ORDER BY sale_id, id").all();
  const salePayments = sqlite.prepare("SELECT sp.*, s.customer_name as customerName, s.material_category as materialCategory, s.material_variant as materialVariant FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id ORDER BY sp.payment_date DESC, sp.id DESC LIMIT 500").all();
  const processingBatches = sqlite.prepare("SELECT * FROM processing_batches ORDER BY batch_date DESC, id DESC LIMIT 200").all();
  const processingBatchItems = sqlite.prepare("SELECT * FROM processing_batch_items ORDER BY batch_id, id").all();
  const processingBatchOutputs = sqlite.prepare("SELECT * FROM processing_batch_outputs ORDER BY batch_id, id").all();
  // Keep half-day = daily/2 and fix attendance amounts that were stored wrong.
  const labourWorkersRaw = sqlite.prepare("SELECT * FROM manual_labour_workers ORDER BY active DESC, name, id").all() as Array<{
    id: number; daily_rate: number; half_day_rate: number;
  }>;
  for (const w of labourWorkersRaw) {
    const half = halfDayRate(Number(w.daily_rate || 0));
    if (Math.abs(Number(w.half_day_rate || 0) - half) > 0.009) {
      sqlite.prepare("UPDATE manual_labour_workers SET half_day_rate=? WHERE id=?").run(half, w.id);
      w.half_day_rate = half;
    }
  }
  const attendanceRows = sqlite.prepare(`
    SELECT ml.id, ml.attendance_type, ml.hours, ml.amount, w.daily_rate
    FROM processing_manual_labour ml
    JOIN manual_labour_workers w ON w.id=ml.worker_id
    WHERE COALESCE(NULLIF(ml.payment_kind,''),'WAGE')='ATTENDANCE'
  `).all() as Array<{ id: number; attendance_type: string; hours: number; amount: number; daily_rate: number }>;
  const fixAmt = sqlite.prepare("UPDATE processing_manual_labour SET amount=? WHERE id=?");
  for (const row of attendanceRows) {
    const correct = attendanceEarnedAmount(Number(row.daily_rate || 0), row.attendance_type, Number(row.hours || 0));
    if (correct > 0 && Math.abs(Number(row.amount || 0) - correct) > 0.009) {
      fixAmt.run(correct, row.id);
    }
  }
  const labourWorkers = sqlite.prepare("SELECT * FROM manual_labour_workers ORDER BY active DESC, name, id").all();
  const manualLabour = sqlite.prepare(`
    SELECT ml.*, w.name as workerName
    FROM processing_manual_labour ml
    JOIN manual_labour_workers w ON w.id=ml.worker_id
    ORDER BY ml.payment_date DESC, ml.id DESC
    LIMIT 1000
  `).all();
  const processingContractors = sqlite.prepare("SELECT * FROM processing_contractors ORDER BY is_current DESC, active DESC, name, id").all();
  const processingContractorLedger = sqlite.prepare(`
    SELECT l.*, c.name as contractorName
    FROM processing_contractor_ledger l
    JOIN processing_contractors c ON c.id=l.contractor_id
    ORDER BY l.entry_date DESC, l.id DESC
    LIMIT 500
  `).all();
  const processingExpenses = sqlite.prepare("SELECT * FROM processing_expenses ORDER BY expense_date DESC, id DESC LIMIT 500").all();
  const saleProcessingCosts = sqlite.prepare("SELECT * FROM sale_processing_costs ORDER BY payment_date DESC, id DESC LIMIT 500").all();
  const otherExpenses = sqlite.prepare("SELECT * FROM other_expenses WHERE mode IN ('PET','PLASTIC','SHARED') ORDER BY expense_date DESC, id DESC LIMIT 500").all();

  const inventory = sqlite.prepare(`
    SELECT mode, NULL as materialId,
           CASE
             WHEN material_name='Natural Bottles' OR material_name LIKE 'Natural Bottles - %' THEN 'Natural Bottles'
             ELSE material_name
           END as materialName,
           ROUND(SUM(quantity_kg), 3) as quantityKg,
           ROUND(SUM(amount), 2) as value
    FROM inventory_transactions
    GROUP BY mode,
      CASE
        WHEN material_name='Natural Bottles' OR material_name LIKE 'Natural Bottles - %' THEN 'Natural Bottles'
        ELSE material_name
      END
    HAVING ABS(SUM(quantity_kg)) > 0.0001
    ORDER BY mode, materialName
  `).all();

  const preStock = sqlite.prepare(`
    SELECT id, mode, material_name as materialName, quantity_kg as quantityKg, amount, transaction_date as stockDate, notes
    FROM inventory_transactions
    WHERE notes LIKE 'PRE-STOCK%'
    ORDER BY transaction_date DESC, id DESC
    LIMIT 100
  `).all();

  const purchases = sqlite.prepare(`
    SELECT p.*, s.name as supplierName, l.name as lenderName,
           ROUND((p.total_amount + COALESCE(p.transport_charges,0) + COALESCE(p.labour_charges,0)) / NULLIF(p.quantity_kg,0), 2) as effective_cost,
           ROUND(p.total_amount + COALESCE(p.transport_charges,0) + COALESCE(p.labour_charges,0), 2) as landed_total,
           (
             SELECT vp.payment_date FROM vendor_payments vp
             WHERE vp.purchase_id = p.id
               AND vp.payment_type <> 'ADVANCE'
               AND COALESCE(vp.payment_mode,'') <> 'Advance'
             ORDER BY vp.payment_date DESC, vp.id DESC
             LIMIT 1
           ) as payment_date,
           (
             SELECT COALESCE(NULLIF(vp.paid_by,''), p.paid_by, '') FROM vendor_payments vp
             WHERE vp.purchase_id = p.id
               AND vp.payment_type <> 'ADVANCE'
               AND COALESCE(vp.payment_mode,'') <> 'Advance'
             ORDER BY vp.payment_date DESC, vp.id DESC
             LIMIT 1
           ) as payment_done_by
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN lenders l ON l.id = p.lender_id
    ORDER BY p.purchase_date DESC, p.id DESC
    LIMIT 200
  `).all();

  const borrowings = sqlite.prepare(`
    SELECT b.*, l.name as lenderName, COALESCE(l.lender_kind,'EXTERNAL') as lenderKind
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

  const externalLoanOutstanding = {
    PET: Number((sqlite.prepare(`SELECT COALESCE(SUM(b.outstanding_amount),0) as n FROM borrowings b JOIN lenders l ON l.id=b.lender_id WHERE b.mode='PET' AND COALESCE(l.lender_kind,'EXTERNAL')='EXTERNAL'`).get() as any)?.n || 0),
    PLASTIC: Number((sqlite.prepare(`SELECT COALESCE(SUM(b.outstanding_amount),0) as n FROM borrowings b JOIN lenders l ON l.id=b.lender_id WHERE b.mode='PLASTIC' AND COALESCE(l.lender_kind,'EXTERNAL')='EXTERNAL'`).get() as any)?.n || 0),
  };

  const personAccountTotalsFlat = companyPersonAccountTotals();
  // Compatibility: old clients read personAccountTotals[mode][person] — mirror shared wallets under both modes.
  const personAccountTotals = {
    COMPANY: personAccountTotalsFlat,
    PET: personAccountTotalsFlat,
    PLASTIC: personAccountTotalsFlat,
    ...personAccountTotalsFlat,
  };

  const buyerAdvanceBalance = Math.round(Number((sqlite.prepare("SELECT COALESCE(SUM(amount-used_amount),0) as n FROM buyer_advances").get() as any)?.n || 0) * 100) / 100;
  const partnerLentTotal = Math.round(Number((sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances").get() as any)?.n || 0) * 100) / 100;
  const companyParts = companyCashflowParts();
  const petParts = modeCashflowParts("PET");
  const plasticParts = modeCashflowParts("PLASTIC");
  const cashflowBreakdown = {
    COMPANY: companyParts,
    PET: petParts,
    PLASTIC: plasticParts,
  };
  const cashWithPartners = ACCOUNT_PERSONS.reduce((n, p) => n + Math.max(0, Number(personAccountTotalsFlat[p]?.balance || 0)), 0);
  const dueToPartners = ACCOUNT_PERSONS.reduce((n, p) => n + Math.max(0, -Number(personAccountTotalsFlat[p]?.balance || 0)), 0);
  const externalLoanTotal = externalLoanOutstanding.PET + externalLoanOutstanding.PLASTIC;
  const reconciliation = {
    COMPANY: {
      companyBook: companyParts.book,
      cashWithPartners,
      dueToPartners,
      externalLoanOutstanding: externalLoanTotal,
    },
    // Compatibility mirrors — same company book regardless of mode toggle.
    PET: {
      companyBook: companyParts.book,
      cashWithPartners,
      dueToPartners,
      externalLoanOutstanding: externalLoanTotal,
    },
    PLASTIC: {
      companyBook: companyParts.book,
      cashWithPartners,
      dueToPartners,
      externalLoanOutstanding: externalLoanTotal,
    },
  };
  const sharedAllocPet = sharedExpenseAllocation("PET");
  const sharedAllocPlastic = sharedExpenseAllocation("PLASTIC");
  const businessSplit = {
    PET: {
      salesReceived: petParts.salesReceived,
      vendorPayments: petParts.vendorPayments,
      expenses: Math.round((petParts.otherExpenses + petParts.processingExpenses + petParts.saleProcessing + sharedAllocPet.allocated) * 100) / 100,
      labourCash: petParts.manualLabour,
      contractorCash: petParts.contractorCash,
      borrowed: petParts.borrowed,
      loanRepaid: petParts.loanRepaid,
      partnerSettled: petParts.partnerSettled,
      buyerAdvances: petParts.buyerAdvances,
      partnerAdvances: petParts.partnerAdvances,
      sharedExpensesAllocated: sharedAllocPet.allocated,
      contribution: Math.round((operatingContribution(petParts) - sharedAllocPet.allocated) * 100) / 100,
    },
    PLASTIC: {
      salesReceived: plasticParts.salesReceived,
      vendorPayments: plasticParts.vendorPayments,
      expenses: Math.round((plasticParts.otherExpenses + plasticParts.processingExpenses + plasticParts.saleProcessing + sharedAllocPlastic.allocated) * 100) / 100,
      labourCash: plasticParts.manualLabour,
      contractorCash: plasticParts.contractorCash,
      borrowed: plasticParts.borrowed,
      loanRepaid: plasticParts.loanRepaid,
      partnerSettled: plasticParts.partnerSettled,
      buyerAdvances: plasticParts.buyerAdvances,
      partnerAdvances: plasticParts.partnerAdvances,
      sharedExpensesAllocated: sharedAllocPlastic.allocated,
      contribution: Math.round((operatingContribution(plasticParts) - sharedAllocPlastic.allocated) * 100) / 100,
    },
  };
  const sharedExpenseSummary = {
    total: sharedAllocPet.sharedTotal,
    petAllocated: sharedAllocPet.allocated,
    plasticAllocated: sharedAllocPlastic.allocated,
    petSharePct: sharedAllocPet.sharePct,
    plasticSharePct: sharedAllocPlastic.sharePct,
    petActivityKg: sharedAllocPet.petKg,
    plasticActivityKg: sharedAllocPlastic.plasticKg,
    basis: "PET process input kg vs Plastic sold kg",
  };

  const plasticMaterialTypes = sqlite.prepare(
    "SELECT * FROM plastic_material_types WHERE mode='PLASTIC' ORDER BY active DESC, sort_order, name, id"
  ).all();

    const processingContractorSummaries = (processingContractors as Array<{ id: number; mode: string }>).map((c) => ({
    ...c,
    ...contractorBalance(c.id),
  }));

  return json({
    materials, suppliers, lenders, inventory, preStock, purchases, borrowings, supplierCredit, vendorSummary, vendorPayments,
    sales, saleItems, salePayments, processingBatches, processingBatchItems, processingBatchOutputs, processingExpenses,
    saleProcessingCosts, otherExpenses, labourWorkers, manualLabour, plasticMaterialTypes, processingContractors, processingContractorLedger,
    processingContractorSummaries, partnerSettlements, partnerAdvances, buyers, buyerAdvances, buyerSummary, borrowingRepayments, totals,
    buyerAdvanceBalance, partnerLentTotal,
    personAccountTotals, personAccountTotalsFlat, externalLoanOutstanding, reconciliation, cashflowBreakdown, businessSplit, sharedExpenseSummary,
    emailConfigured: isEmailConfigured(),
    emailDiagnostics: emailConfigDiagnostics(),
    notifyEmail: emailConfigDiagnostics().notifyEmail,
    // COMPANY is canonical; PET/PLASTIC mirrored so older UI still sees one shared book.
    cashBalance:{
      COMPANY: companyParts.book,
      PET: companyParts.book,
      PLASTIC: companyParts.book,
    },
  });
}

type PendingEmail = {
  purchaseId: number;
  kind: NotifyKind;
  sendEmail?: boolean;
  payment?: {
    amount: number;
    paymentDate: string;
    paymentMode: string;
    paidBy: string;
    notes: string;
  };
};

export async function POST(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;
  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  try {
    // Email helpers do not need a write transaction
    if (body.action === "testEmail") {
      const result = await sendTestEmail();
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, email: { configured: result.diagnostics.configured, ok: false, error: result.error }, diagnostics: result.diagnostics },
          { status: 400 }
        );
      }
      return json({
        ok: true,
        email: { configured: true, skipped: false, ok: true, to: result.to },
        transport: result.transport,
        messageId: result.messageId,
      });
    }

    if (body.action === "resendPurchaseEmail") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        kind: z.enum(["purchase", "purchase_update", "vendor_payment"]).optional().default("purchase"),
      }).parse(body);
      const email = await notifyPurchaseEmail({
        purchaseId: s.purchaseId,
        kind: s.kind,
        sendEmail: true,
      });
      return json({ ok: true, email });
    }

    let pendingEmail: PendingEmail | null = null;
    const response = withTransaction(() => {
    if (body.action === "addSupplier") {
      const s = z.object({
        name: z.string().trim().min(1),
        phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const r = sqlite.prepare(`INSERT INTO suppliers (name, phone, location, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(s.name, s.phone, s.location, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "addLender") {
      const s = z.object({
        name: z.string().trim().min(1),
        phone: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
        lenderKind: z.enum(["EXTERNAL","PARTNER"]).optional().default("EXTERNAL"),
      }).parse(body);
      const r = sqlite.prepare(`INSERT INTO lenders (name, phone, notes, lender_kind, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
        .run(s.name, s.phone, s.notes, s.lenderKind, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "updateSupplier") {
      const s = z.object({ supplierId: z.number().int().positive(), name: z.string().trim().min(1), phone: z.string().trim().optional().default(""), location: z.string().trim().optional().default(""), notes: z.string().trim().optional().default("") }).parse(body);
      sqlite.prepare("UPDATE suppliers SET name=?, phone=?, location=?, notes=?, updated_at=? WHERE id=?").run(s.name, s.phone, s.location, s.notes, nowIso(), s.supplierId);
      return json({ ok: true });
    }

    if (body.action === "addBuyer") {
      const s = z.object({
        mode: modeSchema,
        name: z.string().trim().min(1, "Buyer name is required"),
        phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const exists = sqlite.prepare("SELECT id FROM buyers WHERE mode=? AND lower(trim(name))=lower(?)").get(s.mode, s.name) as {id:number}|undefined;
      if (exists) return NextResponse.json({ error: "Buyer already exists for this mode" }, { status: 400 });
      const r = sqlite.prepare("INSERT INTO buyers (mode, name, phone, location, notes, active, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)")
        .run(s.mode, s.name, s.phone, s.location, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "updateBuyer") {
      const s = z.object({
        buyerId: z.number().int().positive(),
        name: z.string().trim().min(1),
        phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const row = sqlite.prepare("SELECT id, mode FROM buyers WHERE id=?").get(s.buyerId) as {id:number;mode:string}|undefined;
      if (!row) return NextResponse.json({ error: "Buyer not found" }, { status: 404 });
      const clash = sqlite.prepare("SELECT id FROM buyers WHERE mode=? AND lower(trim(name))=lower(?) AND id<>?").get(row.mode, s.name, s.buyerId) as {id:number}|undefined;
      if (clash) return NextResponse.json({ error: "Another buyer already uses this name" }, { status: 400 });
      sqlite.prepare("UPDATE buyers SET name=?, phone=?, location=?, notes=?, updated_at=? WHERE id=?")
        .run(s.name, s.phone, s.location, s.notes, nowIso(), s.buyerId);
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
        mode: expenseModeSchema,
        expenseType: z.enum(["Electricity","Thread","GST / Admin","Infrastructure / Maintenance","Other"]),
        description: z.string().trim().optional().default(""),
        amount: z.number().positive(),
        expenseDate: dateSchema.optional().default(todayStr()),
        billingMonth: z.string().optional(),
        billingStartDate: z.union([dateSchema, z.literal("")]).optional(),
        billingEndDate: z.union([dateSchema, z.literal("")]).optional(),
        paidBy: optionalAccountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
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
      if (x.fundingSource === "OWN_POCKET" && !x.paidBy) {
        return NextResponse.json({error:"Payment done by is required for own-pocket payments"}, {status:400});
      }
      sqlite.prepare(`INSERT INTO other_expenses (mode,purchase_id,expense_type,description,amount,expense_date,expense_frequency,paid_by,created_at,billing_month,billing_start_date,billing_end_date,funding_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(x.mode,null,x.expenseType,x.description,x.amount,x.expenseDate,"ONE_TIME",x.paidBy??"",nowIso(),billingMonth,billingStartDate,billingEndDate,x.fundingSource);
      return json({ok:true});
    }

    if (body.action === "addBorrowing") {
      const s = z.object({
        mode: modeSchema,
        lenderId: z.number().int().positive(),
        amount: z.number().positive(),
        interestRatePercent: z.number().nonnegative().optional().default(0),
        borrowingDate: dateSchema.optional().default(todayStr()),
        dueDate: z.union([dateSchema, z.literal("")]).optional().default(""),
        purpose: z.string().trim().optional().default(""),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const interestAmount = Math.round(s.amount * (s.interestRatePercent / 100) * 100) / 100;
      const outstanding = Math.round((s.amount + interestAmount) * 100) / 100;
      const r = sqlite.prepare(`
        INSERT INTO borrowings
        (mode, lender_id, amount, interest_rate_percent, interest_amount, outstanding_amount, borrowing_date, due_date, purpose, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
      `).run(s.mode, s.lenderId, s.amount, s.interestRatePercent, interestAmount, outstanding, s.borrowingDate, s.dueDate || "", s.purpose, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid), interestAmount, outstanding });
    }

    if (body.action === "repayBorrowing") {
      const s = z.object({
        borrowingId: z.number().int().positive(),
        amount: z.number().positive(),
        repaymentDate: dateSchema.optional().default(todayStr()),
        paidBy: optionalAccountPersonSchema,
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const b = sqlite.prepare("SELECT * FROM borrowings WHERE id = ?").get(s.borrowingId) as { outstanding_amount: number } | undefined;
      if (!b) return NextResponse.json({ error: "Borrowing not found" }, { status: 404 });
      if (s.amount > b.outstanding_amount + 0.005) return NextResponse.json({ error: "Repayment exceeds outstanding amount" }, { status: 400 });
      const outstanding = Math.max(0, Math.round((b.outstanding_amount - s.amount) * 100) / 100);
      sqlite.prepare(`
        INSERT INTO borrowing_repayments (borrowing_id, amount, repayment_date, paid_by, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(s.borrowingId, s.amount, s.repaymentDate, s.paidBy ?? "", s.notes, nowIso());
      sqlite.prepare("UPDATE borrowings SET outstanding_amount=?, status=?, updated_at=? WHERE id=?")
        .run(outstanding, outstanding === 0 ? "PAID" : "PARTIAL", nowIso(), s.borrowingId);
      return json({ ok: true, outstanding });
    }

    if (body.action === "settlePartner") {
      const s = z.object({
        mode: modeSchema,
        person: accountPersonSchema,
        amount: z.number().positive(),
        settlementDate: dateSchema.optional().default(todayStr()),
        paidBy: accountPersonSchema,
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      sqlite.prepare(`INSERT INTO partner_settlements (mode, person, amount, settlement_date, notes, paid_by, created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(s.mode, s.person, s.amount, s.settlementDate, s.notes, s.paidBy, nowIso());
      return json({ ok: true });
    }

    if (body.action === "addPartnerAdvance") {
      const s = z.object({
        mode: modeSchema,
        person: accountPersonSchema,
        heldBy: optionalAccountPersonSchema,
        amount: z.number().positive(),
        advanceDate: dateSchema.optional().default(todayStr()),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      sqlite.prepare("INSERT INTO partner_advances (mode, person, held_by, amount, advance_date, notes, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(s.mode, s.person, s.heldBy || s.person, s.amount, s.advanceDate, s.notes, nowIso());
      return json({ ok: true });
    }

    if (body.action === "deletePartnerAdvance") {
      const s = z.object({ id: z.number().int().positive() }).parse(body);
      sqlite.prepare("DELETE FROM partner_advances WHERE id=?").run(s.id);
      return json({ ok: true });
    }

    if (body.action === "addBuyerAdvance") {
      const s = z.object({
        mode: modeSchema,
        buyerName: z.string().trim().min(1, "Buyer name is required"),
        amount: z.number().positive(),
        advanceDate: dateSchema.optional().default(todayStr()),
        receivedBy: accountPersonSchema,
        paymentMode: z.string().trim().min(1).optional().default("Cash"),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      ensureBuyer(s.mode, s.buyerName);
      sqlite.prepare("INSERT INTO buyer_advances (mode, buyer_name, amount, used_amount, advance_date, received_by, payment_mode, notes, created_at) VALUES (?,?,?,0,?,?,?,?,?)")
        .run(s.mode, s.buyerName, s.amount, s.advanceDate, s.receivedBy, s.paymentMode, s.notes, nowIso());
      return json({ ok: true });
    }

    if (body.action === "deleteBuyerAdvance") {
      const s = z.object({ id: z.number().int().positive() }).parse(body);
      const row = sqlite.prepare("SELECT used_amount FROM buyer_advances WHERE id=?").get(s.id) as { used_amount: number } | undefined;
      if (!row) return NextResponse.json({ error: "Advance not found" }, { status: 404 });
      if (Number(row.used_amount) > 0.004) return NextResponse.json({ error: "This advance is already used against a sale and cannot be deleted" }, { status: 400 });
      sqlite.prepare("DELETE FROM buyer_advances WHERE id=?").run(s.id);
      return json({ ok: true });
    }

    if (body.action === "applyBuyerAdvance") {
      const s = z.object({
        mode: modeSchema,
        buyerName: z.string().trim().min(1),
        applyDate: dateSchema.optional().default(todayStr()),
      }).parse(body);
      const pending = sqlite.prepare(
        "SELECT id, credit_amount FROM sales WHERE mode=? AND lower(trim(customer_name))=? AND credit_amount>0.004 ORDER BY sale_date ASC, id ASC"
      ).all(s.mode, normBuyer(s.buyerName)) as Array<{ id: number; credit_amount: number }>;
      let total = 0;
      for (const sale of pending) {
        const applied = applyBuyerAdvanceToSale(s.mode, s.buyerName, sale.id, Number(sale.credit_amount), s.applyDate);
        if (applied > 0) {
          sqlite.prepare("UPDATE sales SET received_amount=received_amount+?,credit_amount=MAX(0,credit_amount-?),updated_at=? WHERE id=?").run(applied, applied, nowIso(), sale.id);
          total = Math.round((total + applied) * 100) / 100;
        }
      }
      if (total <= 0) return NextResponse.json({ error: "No advance balance or no pending sale for this buyer" }, { status: 400 });
      return json({ ok: true, applied: total });
    }

    if (body.action === "addPurchase") {
      const s = z.object({
        mode: modeSchema,
        materialId: z.number().int().positive().optional(),
        materialName: z.string().trim().min(1, "Please select Material (Natural or Red)"),
        materialVariant: z.string().trim().optional().default(""),
        supplierId: z.number().int().positive().optional(),
        purchaseType: z.enum(["NORMAL", "SUPPLIER_CREDIT", "BORROWED_FUND"]),
        quantityKg: z.number({ required_error: "Please enter Quantity (kg)", invalid_type_error: "Quantity (kg) must be a valid number" }).positive("Quantity (kg) must be greater than 0"),
        ratePerKg: z.number({ required_error: "Please enter Rate / kg", invalid_type_error: "Rate / kg must be a valid number" }).nonnegative("Rate / kg cannot be negative"),
        paidAmount: z.number({ invalid_type_error: "Paid to vendor must be a valid number" }).nonnegative("Paid to vendor cannot be negative").optional(),
        paidBy: optionalAccountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
        lenderId: z.number().int().positive().optional(),
        borrowingId: z.number().int().positive().optional(),
        purchaseDate: dateSchema.optional().default(todayStr()),
        paymentDate: dateSchema.optional(),
        notes: z.string().trim().optional().default(""),
        transportCharges: z.number({ invalid_type_error: "Transport must be a valid number" }).nonnegative("Transport cannot be negative").optional().default(0),
        loadingCharges: z.number({ invalid_type_error: "Loading charges must be a valid number" }).nonnegative("Loading charges cannot be negative").optional().default(0),
      }).parse(body);
      const paymentDoneDate = s.paymentDate || s.purchaseDate;
      const transportCharges = Math.round((s.transportCharges || 0) * 100) / 100;
      const loadingCharges = Math.round((s.loadingCharges || 0) * 100) / 100;

      if (!s.supplierId) {
        return NextResponse.json({ error: "Please select a Vendor before saving the purchase" }, { status: 400 });
      }
      if ((s.paidAmount ?? 0) > 0 && !s.paidBy) {
        return NextResponse.json({ error: "Please select Payment done by when paying the vendor" }, { status: 400 });
      }
      if ((transportCharges > 0 || loadingCharges > 0) && !s.paidBy) {
        return NextResponse.json({ error: "Please select Payment done by when paying transport / loading" }, { status: 400 });
      }
      if (s.purchaseType === "SUPPLIER_CREDIT" && !s.supplierId) {
        return NextResponse.json({ error: "Supplier is required for supplier credit" }, { status: 400 });
      }
      if (s.purchaseType === "BORROWED_FUND" && !s.borrowingId) {
        return NextResponse.json({ error: "Borrowing account is required for borrowed-fund purchase" }, { status: 400 });
      }

      let stockName: string;
      try {
        stockName = purchaseStockName(s.mode, s.materialName, s.materialVariant);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid material variant" }, { status: 400 });
      }
      const variant = stockName === "Red Bottles" ? "Red" : "Mixed";

      // Vendor bill = material only. Transport/loading are separate payees.
      const total = Math.round(s.quantityKg * s.ratePerKg * 100) / 100;
      let cashPaid = s.paidAmount ?? 0;
      if (cashPaid > total) cashPaid = total;
      let advanceApplied=0;
      if(s.supplierId){ const rows=sqlite.prepare("SELECT id,amount,used_amount FROM vendor_advances WHERE mode=? AND supplier_id=? AND amount-used_amount>0.005 ORDER BY advance_date ASC,id ASC").all(s.mode,s.supplierId) as Array<{id:number;amount:number;used_amount:number}>; let rem=Math.max(0,total-cashPaid); for(const a of rows){ if(rem<=0) break; const use=Math.min(a.amount-a.used_amount,rem); if(use>0){sqlite.prepare("UPDATE vendor_advances SET used_amount=used_amount+?,updated_at=? WHERE id=?").run(use,nowIso(),a.id); advanceApplied+=use; rem-=use;}} }
      const paid=Math.round((cashPaid+advanceApplied)*100)/100;
      const credit=Math.round((total-paid)*100)/100;
      const landedTotal = Math.round((total + transportCharges + loadingCharges) * 100) / 100;
      const effectiveRate = s.quantityKg > 0 ? Math.round((landedTotal / s.quantityKg) * 100) / 100 : 0;

      const r = sqlite.prepare(`
        INSERT INTO purchases
        (mode, material_id, material_name, supplier_id, purchase_type, quantity_kg, rate_per_kg,
         total_amount, paid_amount, credit_amount, lender_id, borrowing_id, purchase_date, notes, paid_by, transport_charges, weight_charges, labour_charges, material_variant, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        s.mode, s.materialId ?? null, stockName, s.supplierId ?? null, s.purchaseType,
        s.quantityKg, s.ratePerKg, total, paid, credit, s.lenderId ?? null, s.borrowingId ?? null,
        s.purchaseDate, s.notes, s.paidBy ?? "", transportCharges, 0, loadingCharges, variant, nowIso(), nowIso()
      );
      const purchaseId = Number(r.lastInsertRowid);
      if (s.fundingSource === "OWN_POCKET" && cashPaid > 0 && !s.paidBy) {
        return NextResponse.json({ error: "Payment done by is required for own-pocket payments" }, { status: 400 });
      }
      if(cashPaid>0) sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at,funding_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(s.mode,s.supplierId,purchaseId,"PURCHASE",cashPaid,paymentDoneDate,"Cash",s.notes,s.paidBy ?? "",nowIso(),s.fundingSource);
      if(advanceApplied>0) sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(s.mode,s.supplierId,purchaseId,"CREDIT_SETTLEMENT",advanceApplied,paymentDoneDate,"Advance","Advance applied to purchase #"+purchaseId,nowIso());

      syncPurchaseSideCosts({
        mode: s.mode,
        purchaseId,
        transportCharges,
        loadingCharges,
        expenseDate: s.purchaseDate,
        paidBy: s.paidBy ?? "",
        fundingSource: s.fundingSource || "COMPANY",
      });

      // Stock value uses landed cost (material + transport + loading).
      sqlite.prepare(`
        INSERT INTO inventory_transactions
        (mode, material_id, material_name, transaction_type, quantity_kg, amount, purchase_id, transaction_date, notes, created_at)
        VALUES (?, ?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?)
      `).run(s.mode, s.materialId ?? null, stockName, s.quantityKg, landedTotal, purchaseId, s.purchaseDate, s.notes, nowIso());

      pendingEmail = {
        purchaseId,
        kind: "purchase",
        sendEmail: body.sendEmail !== false,
      };
      return json({
        ok: true,
        id: purchaseId,
        total,
        paid,
        credit,
        transportCharges,
        loadingCharges,
        landedTotal,
        effectiveRate,
        materialName: stockName,
      });
    }

    if (body.action === "updatePurchase") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        mode: modeSchema,
        materialId: z.number().int().positive().optional(),
        materialName: z.string().trim().min(1),
        materialVariant: z.string().trim().optional().default(""),
        supplierId: z.number().int().positive(),
        purchaseType: z.enum(["NORMAL", "SUPPLIER_CREDIT", "BORROWED_FUND"]),
        quantityKg: z.number().positive(),
        ratePerKg: z.number().nonnegative(),
        paidAmount: z.number().nonnegative().optional(),
        purchaseDate: dateSchema,
        paymentDate: dateSchema.optional(),
        paidBy: optionalAccountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
        notes: z.string().trim().optional().default(""),
        transportCharges: z.number().nonnegative().optional().default(0),
        loadingCharges: z.number().nonnegative().optional().default(0),
      }).parse(body);
      const existing = sqlite.prepare("SELECT id, paid_amount, material_id, material_name as existing_material_name, supplier_id as existing_supplier_id, paid_by FROM purchases WHERE id=? AND mode=?").get(s.purchaseId, s.mode) as {id:number;paid_amount:number;material_id:number|null;existing_material_name:string;existing_supplier_id:number|null;paid_by:string} | undefined;
      if (!existing) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
      let stockName: string;
      try {
        stockName = purchaseStockName(s.mode, s.materialName, s.materialVariant);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid material variant" }, { status: 400 });
      }
      const variant = stockName === "Red Bottles" ? "Red" : "Mixed";
      const total = Math.round(s.quantityKg * s.ratePerKg * 100) / 100;
      const transportCharges = Math.round((s.transportCharges || 0) * 100) / 100;
      const loadingCharges = Math.round((s.loadingCharges || 0) * 100) / 100;
      if (!s.supplierId) return NextResponse.json({ error: "Vendor is required for every purchase" }, { status: 400 });

      const advanceApplied = Number((sqlite.prepare(`
        SELECT COALESCE(SUM(amount),0) as n FROM vendor_payments
        WHERE purchase_id=? AND (payment_type='ADVANCE' OR COALESCE(payment_mode,'')='Advance')
      `).get(s.purchaseId) as any)?.n || 0);
      const cashRows = sqlite.prepare(`
        SELECT id, amount, payment_date, paid_by, funding_source FROM vendor_payments
        WHERE purchase_id=? AND payment_type<>'ADVANCE' AND COALESCE(payment_mode,'')<>'Advance'
        ORDER BY id ASC
      `).all(s.purchaseId) as Array<{id:number;amount:number;payment_date:string;paid_by:string;funding_source:string}>;

      let cashPaid: number;
      if (s.paidAmount === undefined) {
        cashPaid = Math.round(cashRows.reduce((n, r) => n + Number(r.amount || 0), 0) * 100) / 100;
      } else {
        cashPaid = Math.min(s.paidAmount, Math.max(0, Math.round((total - advanceApplied) * 100) / 100));
      }
      const paidBy = s.paidBy || existing.paid_by || cashRows[0]?.paid_by || "";
      if (cashPaid > 0.005 && !paidBy) {
        return NextResponse.json({ error: "Please select Payment done by when paying the vendor" }, { status: 400 });
      }
      if ((transportCharges > 0 || loadingCharges > 0) && !paidBy) {
        return NextResponse.json({ error: "Please select Payment done by when paying transport / loading" }, { status: 400 });
      }
      const paid = Math.round((cashPaid + advanceApplied) * 100) / 100;
      if (paid > total + 0.005) {
        return NextResponse.json({ error: "Paid amount cannot exceed purchase total" }, { status: 400 });
      }
      const credit = Math.round((total - paid) * 100) / 100;
      const materialId = s.materialId ?? existing.material_id ?? null;
      const paymentDoneDate = s.paymentDate || cashRows[0]?.payment_date || s.purchaseDate;
      const funding = s.fundingSource || cashRows[0]?.funding_source || "COMPANY";
      const landedTotal = Math.round((total + transportCharges + loadingCharges) * 100) / 100;
      const effectiveRate = s.quantityKg > 0 ? Math.round((landedTotal / s.quantityKg) * 100) / 100 : 0;

      sqlite.prepare(`UPDATE purchases SET material_id=?, material_name=?, supplier_id=?, purchase_type=?, quantity_kg=?, rate_per_kg=?, total_amount=?, paid_amount=?, credit_amount=?, purchase_date=?, paid_by=?, notes=?, material_variant=?, transport_charges=?, labour_charges=?, updated_at=? WHERE id=? AND mode=?`)
        .run(materialId, stockName, s.supplierId, s.purchaseType, s.quantityKg, s.ratePerKg, total, paid, credit, s.purchaseDate, paidBy, s.notes, variant, transportCharges, loadingCharges, nowIso(), s.purchaseId, s.mode);
      sqlite.prepare("UPDATE inventory_transactions SET material_id=?, material_name=?, quantity_kg=?, amount=?, transaction_date=?, notes=? WHERE purchase_id=? AND transaction_type='PURCHASE'")
        .run(materialId, stockName, s.quantityKg, landedTotal, s.purchaseDate, s.notes, s.purchaseId);
      if (s.supplierId !== existing.existing_supplier_id) {
        sqlite.prepare("UPDATE vendor_payments SET supplier_id=? WHERE purchase_id=?").run(s.supplierId, s.purchaseId);
      }

      // Sync cash vendor payment rows with edited paid-to-vendor amount.
      if (cashPaid > 0.005) {
        if (cashRows.length) {
          const [first, ...rest] = cashRows;
          sqlite.prepare("UPDATE vendor_payments SET amount=?, payment_date=?, paid_by=?, funding_source=?, supplier_id=? WHERE id=?")
            .run(cashPaid, paymentDoneDate, paidBy, funding, s.supplierId, first.id);
          for (const row of rest) {
            sqlite.prepare("DELETE FROM vendor_payments WHERE id=?").run(row.id);
          }
        } else {
          sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at,funding_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
            .run(s.mode, s.supplierId, s.purchaseId, "PURCHASE", cashPaid, paymentDoneDate, "Cash", s.notes, paidBy, nowIso(), funding);
        }
      } else {
        for (const row of cashRows) {
          sqlite.prepare("DELETE FROM vendor_payments WHERE id=?").run(row.id);
        }
      }

      syncPurchaseSideCosts({
        mode: s.mode,
        purchaseId: s.purchaseId,
        transportCharges,
        loadingCharges,
        expenseDate: s.purchaseDate,
        paidBy,
        fundingSource: funding,
      });

      // Purchase edits (esp. Natural → Red corrections) use ending-balance check so
      // earlier Red sales don't block fixing a mis-tagged purchase date/type.
      // Throw (don't return) so withTransaction rolls back the edit.
      assertEndingStockNonNegative(s.mode, [existing.existing_material_name, stockName]);
      pendingEmail = {
        purchaseId: s.purchaseId,
        kind: "purchase_update",
        sendEmail: body.sendEmail !== false,
      };
      return json({ ok: true, total, paid, credit, transportCharges, loadingCharges, landedTotal, effectiveRate, materialName: stockName });
    }

    // Fix payment date / done-by on already-paid purchases without rewriting the whole purchase.
    if (body.action === "updatePurchasePayment") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        mode: modeSchema,
        paymentDate: dateSchema,
        paidBy: optionalAccountPersonSchema,
      }).parse(body);
      const existing = sqlite.prepare("SELECT id, paid_amount, supplier_id, paid_by FROM purchases WHERE id=? AND mode=?").get(s.purchaseId, s.mode) as
        | { id: number; paid_amount: number; supplier_id: number | null; paid_by: string }
        | undefined;
      if (!existing) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
      if (!(Number(existing.paid_amount) > 0)) {
        return NextResponse.json({ error: "Purchase has no payment to update — use Pay vendor later first" }, { status: 400 });
      }
      const payRows = sqlite.prepare(`
        SELECT id FROM vendor_payments
        WHERE purchase_id=? AND payment_type<>'ADVANCE' AND COALESCE(payment_mode,'')<>'Advance'
      `).all(s.purchaseId) as Array<{ id: number }>;
      if (payRows.length) {
        for (const row of payRows) {
          sqlite.prepare("UPDATE vendor_payments SET payment_date=?, paid_by=COALESCE(NULLIF(?, ''), paid_by) WHERE id=?")
            .run(s.paymentDate, s.paidBy ?? "", row.id);
        }
      } else if (existing.supplier_id) {
        // Prefer reclaiming an orphan supplier settlement instead of inserting a duplicate cash outflow.
        const orphan = sqlite.prepare(`
          SELECT id, amount FROM vendor_payments
          WHERE mode=? AND supplier_id=? AND purchase_id IS NULL
            AND payment_type='CREDIT_SETTLEMENT' AND COALESCE(payment_mode,'')<>'Advance'
            AND amount+0.005 >= ?
          ORDER BY payment_date ASC, id ASC
          LIMIT 1
        `).get(s.mode, existing.supplier_id, existing.paid_amount) as { id: number; amount: number } | undefined;
        if (orphan) {
          const paid = Number(existing.paid_amount);
          const leftover = Math.round((Number(orphan.amount) - paid) * 100) / 100;
          sqlite.prepare(`
            UPDATE vendor_payments
            SET purchase_id=?, amount=?, payment_date=?, paid_by=COALESCE(NULLIF(?, ''), paid_by), notes=COALESCE(NULLIF(notes,''), 'Linked to purchase')
            WHERE id=?
          `).run(s.purchaseId, paid, s.paymentDate, s.paidBy ?? existing.paid_by ?? "", orphan.id);
          // Keep only orphan cash still needed for other unlinked paid purchases — discard double-count remainder.
          if (leftover > 0.005) {
            const stillNeed = orphanVendorNeed(s.mode, existing.supplier_id);
            const keep = Math.min(leftover, stillNeed);
            if (keep > 0.005) {
              sqlite.prepare(`
                INSERT INTO vendor_payments
                (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at,funding_source)
                VALUES (?,?,NULL,'CREDIT_SETTLEMENT',?,?, 'Cash','Orphan remainder after linking',?,?,?)
              `).run(s.mode, existing.supplier_id, keep, s.paymentDate, s.paidBy ?? "", nowIso(), "COMPANY");
            }
          }
        } else {
          sqlite.prepare(`
            INSERT INTO vendor_payments
            (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at,funding_source)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
          `).run(
            s.mode, existing.supplier_id, s.purchaseId, "PURCHASE", existing.paid_amount,
            s.paymentDate, "Cash", "Payment date corrected", s.paidBy ?? existing.paid_by ?? "", nowIso(), "COMPANY"
          );
        }
      } else {
        return NextResponse.json({ error: "Purchase has no vendor to attach payment" }, { status: 400 });
      }
      if (s.paidBy) {
        sqlite.prepare("UPDATE purchases SET paid_by=?, updated_at=? WHERE id=?").run(s.paidBy, nowIso(), s.purchaseId);
      } else {
        sqlite.prepare("UPDATE purchases SET updated_at=? WHERE id=?").run(nowIso(), s.purchaseId);
      }
      return json({ ok: true, paymentDate: s.paymentDate });
    }

    // One-time / safe cleanup: remove orphan vendor settlements that double-count purchase-linked pays.
    if (body.action === "repairDuplicateVendorPayments") {
      const s = z.object({ mode: modeSchema }).parse(body);
      const result = repairDuplicateVendorPayments(s.mode);
      return json({ ok: true, ...result, cashBalance: companyCashflow() });
    }

    if (body.action === "deletePurchase") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        mode: modeSchema,
      }).parse(body);
      const existing = sqlite.prepare("SELECT id, mode, material_name, supplier_id FROM purchases WHERE id=? AND mode=?").get(s.purchaseId, s.mode) as
        | { id: number; mode: string; material_name: string; supplier_id: number | null }
        | undefined;
      if (!existing) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });

      // Restore any advance that was applied to this purchase.
      const advanceRows = sqlite.prepare(`
        SELECT amount FROM vendor_payments
        WHERE purchase_id=? AND payment_type='CREDIT_SETTLEMENT' AND payment_mode='Advance'
      `).all(s.purchaseId) as Array<{ amount: number }>;
      let restore = advanceRows.reduce((n, row) => n + Number(row.amount || 0), 0);
      if (restore > 0.005 && existing.supplier_id) {
        const advances = sqlite.prepare(`
          SELECT id, used_amount FROM vendor_advances
          WHERE mode=? AND supplier_id=? AND used_amount>0.005
          ORDER BY advance_date DESC, id DESC
        `).all(s.mode, existing.supplier_id) as Array<{ id: number; used_amount: number }>;
        for (const adv of advances) {
          if (restore <= 0) break;
          const giveBack = Math.min(Number(adv.used_amount), restore);
          if (giveBack > 0) {
            sqlite.prepare("UPDATE vendor_advances SET used_amount=used_amount-?, updated_at=? WHERE id=?").run(giveBack, nowIso(), adv.id);
            restore -= giveBack;
          }
        }
      }

      sqlite.prepare("DELETE FROM vendor_payments WHERE purchase_id=?").run(s.purchaseId);
      sqlite.prepare("DELETE FROM inventory_transactions WHERE purchase_id=?").run(s.purchaseId);
      sqlite.prepare("DELETE FROM other_expenses WHERE purchase_id=? AND expense_type IN ('Transport','Loading')").run(s.purchaseId);
      sqlite.prepare("UPDATE other_expenses SET purchase_id=NULL WHERE purchase_id=?").run(s.purchaseId);
      sqlite.prepare("DELETE FROM purchases WHERE id=? AND mode=?").run(s.purchaseId, s.mode);
      assertNoNegativeStock(s.mode, [existing.material_name]);
      return json({ ok: true });
    }

    if (body.action === "payVendor") {
      const s=z.object({
        mode:modeSchema,
        supplierId:z.number().int().positive(),
        amount:z.number().positive(),
        paymentDate:dateSchema.optional().default(todayStr()),
        paymentMode:z.string().trim().min(1).default("Cash"),
        paidBy:accountPersonSchema,
        fundingSource:optionalFundingSourceSchema,
        notes:z.string().trim().optional().default(""),
      }).parse(body);
      const purchases=sqlite.prepare("SELECT id,credit_amount FROM purchases WHERE mode=? AND supplier_id=? AND credit_amount>0 ORDER BY purchase_date ASC,id ASC").all(s.mode,s.supplierId) as Array<{id:number;credit_amount:number}>;
      if(s.amount > purchases.reduce((n,p)=>n+p.credit_amount,0)+0.005) return NextResponse.json({error:"Payment exceeds vendor outstanding balance"},{status:400});
      let rem = s.amount;
      for (const p of purchases) {
        if (rem <= 0) break;
        const use = Math.min(rem, p.credit_amount);
        if (use <= 0) continue;
        sqlite.prepare("UPDATE purchases SET paid_amount=paid_amount+?,credit_amount=credit_amount-?,updated_at=? WHERE id=?").run(use, use, nowIso(), p.id);
        // One ledger row per purchase so Accounts can show later vendor pays with Payment done by.
        sqlite.prepare(`INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at,funding_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(s.mode, s.supplierId, p.id, "CREDIT_SETTLEMENT", use, s.paymentDate, s.paymentMode, s.notes || "Vendor payment (later)", s.paidBy, nowIso(), s.fundingSource);
        rem -= use;
      }
      const firstPurchaseId = purchases[0]?.id;
      if (firstPurchaseId) {
        pendingEmail = {
          purchaseId: firstPurchaseId,
          kind: "vendor_payment",
          sendEmail: body.sendEmail !== false,
          payment: {
            amount: s.amount,
            paymentDate: s.paymentDate,
            paymentMode: s.paymentMode,
            paidBy: s.paidBy,
            notes: s.notes || "Vendor payment",
          },
        };
      }
      return json({ok:true});
    }

    if (body.action === "paySupplierCredit") {
      const s = z.object({
        purchaseId: z.number().int().positive(),
        amount: z.number().positive(),
        paymentDate: dateSchema.optional().default(todayStr()),
        paidBy: accountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
      }).parse(body);
      const p = sqlite.prepare("SELECT credit_amount, mode, supplier_id FROM purchases WHERE id=?").get(s.purchaseId) as { credit_amount:number; mode:string; supplier_id:number } | undefined;
      if (!p) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
      if (s.amount > p.credit_amount + 0.005) return NextResponse.json({ error: "Payment exceeds outstanding credit" }, { status: 400 });
      sqlite.prepare("UPDATE purchases SET paid_amount=paid_amount+?, credit_amount=credit_amount-?, updated_at=? WHERE id=?")
        .run(s.amount, s.amount, nowIso(), s.purchaseId);
      sqlite.prepare("INSERT INTO vendor_payments (mode,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,notes,paid_by,created_at,funding_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(p.mode,p.supplier_id,s.purchaseId,"CREDIT_SETTLEMENT",s.amount,s.paymentDate,"Cash","Vendor payment (later)",s.paidBy,nowIso(),s.fundingSource);
      pendingEmail = {
        purchaseId: s.purchaseId,
        kind: "vendor_payment",
        sendEmail: body.sendEmail !== false,
        payment: {
          amount: s.amount,
          paymentDate: s.paymentDate,
          paymentMode: "Cash",
          paidBy: s.paidBy,
          notes: "Vendor payment (later)",
        },
      };
      return json({ ok: true });
    }


    if (body.action === "upsertPlasticMaterialType") {
      const s = z.object({
        typeId: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(120),
        notes: z.string().trim().optional().default(""),
        sortOrder: z.number().int().optional().default(0),
      }).parse(body);
      if (s.typeId) {
        const existing = sqlite.prepare("SELECT id FROM plastic_material_types WHERE id=? AND mode='PLASTIC'").get(s.typeId);
        if (!existing) return NextResponse.json({ error: "Plastic material type not found" }, { status: 404 });
        const dup = sqlite.prepare("SELECT id FROM plastic_material_types WHERE mode='PLASTIC' AND lower(name)=lower(?) AND id<>?").get(s.name, s.typeId);
        if (dup) return NextResponse.json({ error: "A plastic type with this name already exists" }, { status: 400 });
        sqlite.prepare(
          "UPDATE plastic_material_types SET name=?, notes=?, sort_order=?, updated_at=? WHERE id=? AND mode='PLASTIC'"
        ).run(s.name, s.notes, s.sortOrder, nowIso(), s.typeId);
        return json({ ok: true, id: s.typeId });
      }
      const dup = sqlite.prepare("SELECT id FROM plastic_material_types WHERE mode='PLASTIC' AND lower(name)=lower(?)").get(s.name);
      if (dup) return NextResponse.json({ error: "A plastic type with this name already exists" }, { status: 400 });
      const r = sqlite.prepare(
        "INSERT INTO plastic_material_types (mode,name,active,sort_order,notes,created_at,updated_at) VALUES ('PLASTIC',?,1,?,?,?,?)"
      ).run(s.name, s.sortOrder, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "setPlasticMaterialTypeStatus") {
      const s = z.object({ typeId: z.number().int().positive(), active: z.boolean() }).parse(body);
      const r = sqlite.prepare(
        "UPDATE plastic_material_types SET active=?, updated_at=? WHERE id=? AND mode='PLASTIC'"
      ).run(s.active ? 1 : 0, nowIso(), s.typeId);
      if (!r.changes) return NextResponse.json({ error: "Plastic material type not found" }, { status: 404 });
      return json({ ok: true });
    }

    if (body.action === "addLabourWorker") {
      const s = z.object({
        name: z.string().trim().min(2).max(100),
        dailyRate: z.number().nonnegative().optional().default(0),
        halfDayRate: z.number().nonnegative().optional().default(0),
      }).parse(body);
      const half = halfDayRate(s.dailyRate);
      const existing = sqlite.prepare("SELECT * FROM manual_labour_workers WHERE lower(name)=lower(?)").get(s.name) as any;
      if (existing) {
        if (!existing.active) {
          sqlite.prepare("UPDATE manual_labour_workers SET active=1, daily_rate=?, half_day_rate=?, pay_model='DAILY', updated_at=? WHERE id=?")
            .run(s.dailyRate, half, nowIso(), existing.id);
          return json({ ok: true, id: existing.id, reactivated: true });
        }
        return NextResponse.json({ error: "Worker already exists" }, { status: 400 });
      }
      const r = sqlite.prepare("INSERT INTO manual_labour_workers (name,active,daily_rate,half_day_rate,pay_model,created_at,updated_at) VALUES (?,1,?,?,'DAILY',?,?)")
        .run(s.name, s.dailyRate, half, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "updateLabourWorker") {
      const s = z.object({
        workerId: z.number().int().positive(),
        name: z.string().trim().min(2).max(100).optional(),
        dailyRate: z.number().nonnegative().optional(),
        halfDayRate: z.number().nonnegative().optional(),
      }).parse(body);
      const existing = sqlite.prepare("SELECT * FROM manual_labour_workers WHERE id=?").get(s.workerId) as any;
      if (!existing) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      const daily = s.dailyRate ?? Number(existing.daily_rate || 0);
      const half = halfDayRate(daily);
      sqlite.prepare("UPDATE manual_labour_workers SET name=?, daily_rate=?, half_day_rate=?, updated_at=? WHERE id=?")
        .run(s.name ?? existing.name, daily, half, nowIso(), s.workerId);
      return json({ ok: true });
    }

    if (body.action === "setLabourWorkerStatus") {
      const s = z.object({ workerId: z.number().int().positive(), active: z.boolean() }).parse(body);
      const r = sqlite.prepare("UPDATE manual_labour_workers SET active=?, updated_at=? WHERE id=?").run(s.active ? 1 : 0,nowIso(),s.workerId);
      if (!r.changes) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      return json({ ok: true });
    }

    if (body.action === "deleteLabourWorker") {
      const s = z.object({ workerId: z.number().int().positive() }).parse(body);
      const existing = sqlite.prepare("SELECT * FROM manual_labour_workers WHERE id=?").get(s.workerId) as any;
      if (!existing) return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      const due = workerWageDue(s.workerId, Number(existing.daily_rate || 0)).due;
      if (Math.abs(due) > 0.009) {
        return NextResponse.json({
          error: due > 0
            ? `Cannot delete — ₹${due.toFixed(2)} wage still due. Pay wage or clear dues first.`
            : `Cannot delete — ₹${Math.abs(due).toFixed(2)} advance still open. Clear dues first.`,
        }, { status: 400 });
      }
      sqlite.prepare("DELETE FROM processing_manual_labour WHERE worker_id=?").run(s.workerId);
      sqlite.prepare("DELETE FROM manual_labour_workers WHERE id=?").run(s.workerId);
      return json({ ok: true });
    }

    if (body.action === "addManualLabour") {
      const s = z.object({
        mode: modeSchema,
        workerIds: z.array(z.number().int().positive()).min(1),
        taskType: z.enum(LABOUR_TASKS),
        attendanceType: z.enum(["FULL_DAY","HALF_DAY","CUSTOM_HOURS"]).optional().default("FULL_DAY"),
        hours: z.number().nonnegative().optional().default(0),
        amountPerWorker: z.number().nonnegative().optional(),
        payOutstanding: z.boolean().optional().default(false),
        paymentKind: z.enum(["ATTENDANCE","WAGE","ADVANCE"]).optional().default("WAGE"),
        paymentDate: dateSchema.optional(),
        paidBy: optionalAccountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
        notes: z.string().trim().max(500).optional().default("")
      }).parse(body);
      if (s.paymentKind !== "ATTENDANCE" && !s.paidBy) {
        return NextResponse.json({ error: "Payment done by is required for wage or advance payments" }, { status: 400 });
      }
      if (s.attendanceType === "CUSTOM_HOURS" && !(s.hours > 0) && s.paymentKind !== "ADVANCE" && !s.payOutstanding) {
        return NextResponse.json({ error: "Please enter custom hours greater than 0" }, { status: 400 });
      }
      const ids=[...new Set(s.workerIds)];
      const placeholders=ids.map(()=>"?").join(",");
      const workers=sqlite.prepare("SELECT id,name,daily_rate,half_day_rate FROM manual_labour_workers WHERE active=1 AND id IN ("+placeholders+")");
      const found=workers.all(...ids) as Array<{id:number;name:string;daily_rate:number;half_day_rate:number}>;
      if (found.length !== ids.length) return NextResponse.json({error:"One or more selected workers are inactive or missing"},{status:400});

      // Only block double attendance for the same task+date. Wage/advance settle dues anytime.
      if (s.paymentKind === "ATTENDANCE") {
        const existing=sqlite.prepare(`
          SELECT worker_id FROM processing_manual_labour
          WHERE batch_id IS NULL AND mode=? AND payment_date=? AND task_type=?
            AND COALESCE(NULLIF(payment_kind,''),'WAGE')='ATTENDANCE'
            AND worker_id IN (${placeholders})
        `).all(s.mode,s.paymentDate ?? todayStr(),s.taskType,...ids) as any[];
        if (existing.length) return NextResponse.json({error:"Attendance already marked for one or more selected workers for this task and date"},{status:400});
      }

      let total = 0;
      let saved = 0;
      for (const worker of found) {
        let amount = Number(s.amountPerWorker || 0);
        if (s.paymentKind === "ADVANCE") {
          if (!(amount > 0)) return NextResponse.json({ error: "Enter advance amount per worker" }, { status: 400 });
        } else if (s.payOutstanding && s.paymentKind === "WAGE") {
          amount = workerWageDue(worker.id, Number(worker.daily_rate || 0), s.mode).due;
          if (!(amount > 0.009)) continue;
        } else if (!(amount > 0)) {
          const daily = Number(worker.daily_rate || 0);
          amount = attendanceEarnedAmount(daily, s.attendanceType, Number(s.hours || 0));
          if (!(amount > 0)) {
            return NextResponse.json({
              error: `Set a daily rate for ${worker.name} or enter the wage amount`,
            }, { status: 400 });
          }
        }
        total += amount;
        saved += 1;
        const storeHours = s.paymentKind === "ADVANCE" ? 0 : Number(s.hours || 0);
        sqlite.prepare(`
          INSERT INTO processing_manual_labour
          (mode,batch_id,worker_id,amount,payment_date,paid_by,notes,task_type,created_at,funding_source,attendance_type,hours,payment_kind)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          s.mode, null, worker.id, amount, s.paymentDate ?? todayStr(), s.paidBy ?? "", s.notes, s.taskType,
          nowIso(), s.fundingSource, s.paymentKind === "ADVANCE" ? "" : s.attendanceType,
          storeHours, s.paymentKind
        );
      }
      if (s.payOutstanding && s.paymentKind === "WAGE" && saved === 0) {
        return NextResponse.json({ error: "No outstanding wage due for the selected workers" }, { status: 400 });
      }
      return json({ok:true,totalAmount:Math.round(total*100)/100,count:saved,paymentKind:s.paymentKind});
    }

    if (body.action === "updateManualLabour") {
      const s = z.object({
        labourId: z.number().int().positive(),
        mode: modeSchema,
        taskType: z.enum(LABOUR_TASKS).optional(),
        attendanceType: z.enum(["FULL_DAY","HALF_DAY","CUSTOM_HOURS",""]).optional(),
        hours: z.number().nonnegative().optional(),
        amount: z.number().positive().optional(),
        paymentKind: z.enum(["ATTENDANCE","WAGE","ADVANCE"]).optional(),
        paymentDate: dateSchema.optional(),
        paidBy: optionalAccountPersonSchema,
        clearPaidBy: z.boolean().optional().default(false),
        fundingSource: optionalFundingSourceSchema,
        notes: z.string().trim().max(500).optional(),
      }).parse(body);
      const existing = sqlite.prepare("SELECT * FROM processing_manual_labour WHERE id=? AND mode=?").get(s.labourId, s.mode) as any;
      if (!existing) return NextResponse.json({ error: "Attendance / payment entry not found" }, { status: 404 });
      const kind = s.paymentKind ?? (existing.payment_kind || "WAGE");
      // Attendance-only never needs a payer; wage/advance do.
      if (kind !== "ATTENDANCE" && !(s.paidBy || (!s.clearPaidBy && existing.paid_by))) {
        return NextResponse.json({
          error: "Payment done by is required for wage or advance. Switch Kind to Attendance only if this is not a cash payment.",
        }, { status: 400 });
      }
      const nextPaidBy = kind === "ATTENDANCE" || s.clearPaidBy
        ? ""
        : (s.paidBy || existing.paid_by || "");
      sqlite.prepare(`
        UPDATE processing_manual_labour SET
          task_type=COALESCE(?, task_type),
          attendance_type=COALESCE(?, attendance_type),
          hours=COALESCE(?, hours),
          amount=COALESCE(?, amount),
          payment_kind=?,
          payment_date=COALESCE(?, payment_date),
          paid_by=?,
          funding_source=COALESCE(?, funding_source),
          notes=COALESCE(?, notes)
        WHERE id=?
      `).run(
        s.taskType ?? null,
        s.attendanceType ?? null,
        s.hours ?? null,
        s.amount ?? null,
        kind,
        s.paymentDate ?? null,
        nextPaidBy,
        s.fundingSource ?? null,
        s.notes ?? null,
        s.labourId
      );
      return json({ ok: true });
    }

    if (body.action === "deleteManualLabour") {
      const s = z.object({ labourId: z.number().int().positive(), mode: modeSchema }).parse(body);
      const r = sqlite.prepare("DELETE FROM processing_manual_labour WHERE id=? AND mode=?").run(s.labourId, s.mode);
      if (!r.changes) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      return json({ ok: true });
    }

    if (body.action === "upsertProcessingContractor") {
      const s = z.object({
        mode: modeSchema,
        contractorId: z.number().int().positive().optional(),
        name: z.string().trim().min(2).max(100),
        phone: z.string().trim().optional().default(""),
        ratePerKg: z.number().nonnegative().optional().default(2),
        setCurrent: z.boolean().optional().default(true),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      if (s.contractorId) {
        sqlite.prepare("UPDATE processing_contractors SET name=?, phone=?, rate_per_kg=?, notes=?, updated_at=? WHERE id=? AND mode=?")
          .run(s.name, s.phone, s.ratePerKg, s.notes, nowIso(), s.contractorId, s.mode);
        if (s.setCurrent) {
          sqlite.prepare("UPDATE processing_contractors SET is_current=0 WHERE mode=?").run(s.mode);
          sqlite.prepare("UPDATE processing_contractors SET is_current=1, active=1, updated_at=? WHERE id=?").run(nowIso(), s.contractorId);
        }
        return json({ ok: true, id: s.contractorId });
      }
      if (s.setCurrent) sqlite.prepare("UPDATE processing_contractors SET is_current=0 WHERE mode=?").run(s.mode);
      const r = sqlite.prepare(`
        INSERT INTO processing_contractors (mode,name,phone,rate_per_kg,active,is_current,notes,created_at,updated_at)
        VALUES (?,?,?,?,1,?,?,?,?)
      `).run(s.mode, s.name, s.phone, s.ratePerKg, s.setCurrent ? 1 : 0, s.notes, nowIso(), nowIso());
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (body.action === "setCurrentProcessingContractor") {
      const s = z.object({ mode: modeSchema, contractorId: z.number().int().positive() }).parse(body);
      const existing = sqlite.prepare("SELECT id FROM processing_contractors WHERE id=? AND mode=?").get(s.contractorId, s.mode);
      if (!existing) return NextResponse.json({ error: "Contractor not found" }, { status: 404 });
      sqlite.prepare("UPDATE processing_contractors SET is_current=0 WHERE mode=?").run(s.mode);
      sqlite.prepare("UPDATE processing_contractors SET is_current=1, active=1, updated_at=? WHERE id=?").run(nowIso(), s.contractorId);
      return json({ ok: true });
    }

    if (body.action === "addContractorAdvance" || body.action === "settleContractor") {
      const isAdvance = body.action === "addContractorAdvance";
      const s = z.object({
        mode: modeSchema,
        contractorId: z.number().int().positive().optional(),
        amount: z.number().positive(),
        entryDate: dateSchema.optional().default(todayStr()),
        paidBy: accountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      const contractorId = s.contractorId || currentProcessingContractor(s.mode)?.id;
      if (!contractorId) return NextResponse.json({ error: "Add / select a current processing contractor first" }, { status: 400 });
      sqlite.prepare(`
        INSERT INTO processing_contractor_ledger
        (mode,contractor_id,entry_type,amount,kg,rate_per_kg,batch_id,sale_id,entry_date,paid_by,funding_source,notes,created_at)
        VALUES (?,?,?,?,0,2,NULL,NULL,?,?,?,?,?)
      `).run(
        s.mode, contractorId, isAdvance ? "ADVANCE" : "SETTLEMENT", s.amount, s.entryDate,
        s.paidBy, s.fundingSource, s.notes || (isAdvance ? "Contractor advance" : "Contractor settlement"), nowIso()
      );
      return json({ ok: true, balance: contractorBalance(contractorId) });
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
      if (s.mode === "PLASTIC") {
        return NextResponse.json({ error: "Processing batches are PET-only for now. Use Plastic Inventory for buy/sell." }, { status: 400 });
      }
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

      if (s.mode === "PLASTIC") {
        return NextResponse.json({ error: "Processing batches are PET-only for now" }, { status: 400 });
      }
      const batch = sqlite.prepare("SELECT * FROM processing_batches WHERE id=? AND mode=?").get(s.batchId,s.mode) as any;
      if (!batch) return NextResponse.json({error:"Processing batch not found"},{status:404});
      if (Number(batch.total_output_kg) > 0 || Number(batch.waste_kg) > 0) {
        return NextResponse.json({error:"This processing batch is already completed"},{status:400});
      }

      const inputItems = sqlite.prepare("SELECT material_variant, quantity_kg FROM processing_batch_items WHERE batch_id=?").all(s.batchId) as Array<{material_variant:string;quantity_kg:number}>;
      const inputKg = Number(batch.total_input_kg);
      for (const item of inputItems) {
        const materialName = item.material_variant === "Red" ? "Red Bottles" : "Natural Bottles";
        const available = getAvailableStock(s.mode, materialName, batch.batch_date);
        if (Number(item.quantity_kg) > available + 0.005) {
          return NextResponse.json({error:"Insufficient stock for processing " + item.material_variant + ". Available up to " + batch.batch_date + ": " + available.toFixed(2) + " kg"}, {status:400});
        }
      }
      const outputKg = Math.round(s.outputs.reduce((n,x)=>n+x.quantityKg,0)*1000)/1000;
      const wasteKg = Math.round((inputKg-outputKg)*1000)/1000;
      if (wasteKg < -0.005) return NextResponse.json({error:"Output cannot be greater than batch input"}, {status:400});

      for (const item of s.outputs) {
        const allowed = s.mode === "PET" ? ["Green","White","White Milk","Mixed"] : ["Green","White","White Milk","Red","Mixed"];
        if (!allowed.includes(item.materialVariant)) return NextResponse.json({error:"Invalid output material for this mode"}, {status:400});
      }

        for (const item of inputItems) {
          const materialName = item.material_variant === "Red" ? "Red Bottles" : "Natural Bottles";
          sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .run(s.mode,null,materialName,"ADJUSTMENT",-Number(item.quantity_kg),0,null,null,batch.batch_date,"PROCESSING INPUT #"+s.batchId,nowIso());
        }
        for (const item of s.outputs) {
          const materialName = item.materialVariant === "Red" ? "Red Bottles" : "Natural Bottles";
          sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .run(s.mode,null,materialName,"ADJUSTMENT",item.quantityKg,0,null,null,batch.batch_date,"PROCESSING OUTPUT #"+s.batchId,nowIso());
          sqlite.prepare("INSERT INTO processing_batch_outputs (batch_id,material_variant,quantity_kg,created_at) VALUES (?,?,?,?)")
            .run(s.batchId,item.materialVariant,item.quantityKg,nowIso());
        }
        sqlite.prepare("UPDATE processing_batches SET total_output_kg=?, waste_kg=?, processing_cost=?, status='SOLD' WHERE id=?")
          .run(outputKg,Math.max(0,wasteKg),s.processingCost,s.batchId);
      // Contractor earns ₹2/kg on completed processing batch (input kg).
      const earn = creditContractorEarn({
        mode: s.mode,
        entryType: "EARN_BATCH",
        kg: inputKg,
        batchId: s.batchId,
        entryDate: batch.batch_date,
        notes: `Processing batch #${s.batchId} earn`,
      });
      return json({ok:true,batchId:s.batchId,inputKg,outputKg,wasteKg:Math.max(0,wasteKg),contractorEarn:earn});
    }

    if (body.action === "addProcessingExpense") {
      const s = z.object({
        mode: modeSchema,
        expenseType: z.enum(["Electricity","Thread","Other"]),
        description: z.string().trim().optional().default(""),
        amount: z.number().positive(),
        expenseDate: dateSchema.optional().default(todayStr()),
        paidBy: optionalAccountPersonSchema,
        fundingSource: optionalFundingSourceSchema,
      }).parse(body);
      if (s.fundingSource === "OWN_POCKET" && !s.paidBy) return NextResponse.json({error:"Payment done by is required for own-pocket payments"},{status:400});
      sqlite.prepare("INSERT INTO processing_expenses (mode,expense_type,description,amount,expense_date,paid_by,created_at,funding_source) VALUES (?,?,?,?,?,?,?,?)").run(s.mode,s.expenseType,s.description,s.amount,s.expenseDate,s.paidBy??"",nowIso(),s.fundingSource);
      return json({ok:true});
    }

    if (body.action === "addSale") {
      const s = z.object({
        mode: modeSchema, customerName: z.string().trim().min(1), phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        items: z.array(z.object({
          materialCategory: z.string().trim().min(1),
          materialVariant: z.string().trim().optional().default(""),
          quantityKg: z.number().positive(),
          ratePerKg: z.number().nonnegative()
        })).min(1),
        receivedAmount: z.number().nonnegative().optional(),
        saleDate: dateSchema.optional().default(todayStr()),
        paymentDate: dateSchema.optional(),
        receivedBy: optionalAccountPersonSchema,
        paymentMode: z.string().trim().min(1).optional().default("Cash"),
        loadingCharges: z.number().nonnegative().optional().default(0),
        labourMode: z.enum(["CONTRACT","DAILY_WAGE"]).optional().default("CONTRACT"),
        useAdvance: z.boolean().optional().default(true),
        notes: z.string().trim().optional().default("")
      }).parse(body);
      const receiptDate = s.paymentDate || s.saleDate;

      for (const item of s.items) {
        if (s.mode === "PET") {
          if (!["Natural Bottles","Red Bottles"].includes(item.materialCategory)) {
            return NextResponse.json({
              error: `PET sales use Natural Bottles or Red Bottles (got "${item.materialCategory || "empty"}"). Re-select material on the Sales form — a Plastic type may have been left over.`,
            }, { status: 400 });
          }
          if (item.materialCategory === "Natural Bottles" && !["Green","White","White Milk",""].includes(item.materialVariant)) {
            return NextResponse.json({ error: "Natural Bottles can be Green, White or White Milk" }, { status: 400 });
          }
          if (item.materialCategory === "Red Bottles" && !isRedSaleVariant(item.materialVariant || "Red Bottle")) {
            return NextResponse.json({ error: "Red Bottles subtype must be Red Bottle or Red Bottle Cap" }, { status: 400 });
          }
        } else {
          try { requireActivePlasticType(item.materialCategory); }
          catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid plastic type" }, { status: 400 }); }
        }
      }

      const lineTotals = s.items.map(item => Math.round(item.quantityKg * item.ratePerKg * 100) / 100);
      const grossAmount = Math.round(lineTotals.reduce((n, x) => n + x, 0) * 100) / 100;
      const totalWeight = Math.round(s.items.reduce((n, x) => n + x.quantityKg, 0) * 1000) / 1000;
      const labourMode = s.mode === "PET" ? s.labourMode : "CONTRACT";
      const labourCharges = s.mode === "PET" && labourMode === "CONTRACT" ? Math.round(totalWeight * 2 * 100) / 100 : 0;
      const loadingCharges = s.loadingCharges;
      const total = Math.round(Math.max(0, grossAmount - labourCharges - loadingCharges) * 100) / 100;
      const requiredByMaterial = new Map<string, number>();
      try {
        for (const item of s.items) {
          const materialName = resolveSaleStockName(s.mode, item.materialCategory, item.materialVariant || "");
          requiredByMaterial.set(materialName,(requiredByMaterial.get(materialName)||0)+item.quantityKg);
        }
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid material" }, { status: 400 });
      }
      for (const [materialName,requiredKg] of requiredByMaterial) {
        const available = getAvailableStock(s.mode,materialName,s.saleDate);
        if (requiredKg > available + 0.005) {
          return NextResponse.json({ error: "Insufficient stock for " + materialName + ". Available up to " + s.saleDate + ": " + available.toFixed(2) + " kg" }, {status:400});
        }
      }

      const plannedAdvance = s.useAdvance
        ? Math.round(Math.min(buyerAdvanceAvailable(s.mode, s.customerName), total) * 100) / 100
        : 0;
      const cashReceived = Math.round(Math.min(s.receivedAmount ?? (total - plannedAdvance), total - plannedAdvance) * 100) / 100;
      const received = Math.round((plannedAdvance + cashReceived) * 100) / 100;
      const credit = Math.round((total - received) * 100) / 100;
      const primary = s.items[0];
      const primaryVariant = s.mode === "PLASTIC" ? "" : (s.items.length===1?primary.materialVariant:"MIXED");
      const r = sqlite.prepare("INSERT INTO sales (mode,customer_name,phone,location,material_category,material_variant,quantity_kg,rate_per_kg,gross_amount,labour_charges,loading_charges,total_amount,received_amount,credit_amount,sale_date,notes,created_at,updated_at,labour_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(s.mode,s.customerName,s.phone,s.location,primary.materialCategory,primaryVariant,totalWeight,0,grossAmount,labourCharges,loadingCharges,total,received,credit,s.saleDate,s.notes,nowIso(),nowIso(),labourMode);
      const saleId = Number(r.lastInsertRowid);
      ensureBuyer(s.mode, s.customerName, s.phone, s.location);

      for (let i = 0; i < s.items.length; i++) {
        const item = s.items[i];
        const variant = s.mode === "PLASTIC" ? "" : item.materialVariant;
        sqlite.prepare("INSERT INTO sale_items (sale_id,material_category,material_variant,quantity_kg,rate_per_kg,amount) VALUES (?,?,?,?,?,?)")
          .run(saleId,item.materialCategory,variant,item.quantityKg,item.ratePerKg,lineTotals[i]);
        const materialName = resolveSaleStockName(s.mode, item.materialCategory, item.materialVariant || "");
        sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(s.mode,null,materialName,"ADJUSTMENT",-item.quantityKg,-lineTotals[i],null,saleId,s.saleDate,"SALE #"+saleId+(s.notes ? " - "+s.notes : ""),nowIso());
      }
      const advanceApplied = plannedAdvance > 0 ? applyBuyerAdvanceToSale(s.mode, s.customerName, saleId, plannedAdvance, receiptDate) : 0;
      if (cashReceived > 0) sqlite.prepare("INSERT INTO sale_payments (mode,sale_id,amount,payment_date,payment_mode,received_by,notes,created_at) VALUES (?,?,?,?,?,?,?,?)").run(s.mode,saleId,cashReceived,receiptDate,s.paymentMode,s.receivedBy ?? "",s.notes,nowIso());
      // Contractor earns ₹2/kg only when this sale used contract labour.
      const earn = s.mode === "PET" && labourMode === "CONTRACT" ? creditContractorEarn({
        mode: s.mode,
        entryType: "EARN_SALE",
        kg: totalWeight,
        saleId,
        entryDate: s.saleDate,
        notes: `Sale #${saleId} labour earn`,
      }) : null;
      return json({ok:true,id:saleId,grossAmount,labourCharges,loadingCharges,total,received,credit,advanceApplied,labourMode,contractorEarn:earn});
    }

    if (body.action === "updateSale") {
      const s = z.object({
        saleId: z.number().int().positive(),
        mode: modeSchema,
        customerName: z.string().trim().min(1),
        phone: z.string().trim().optional().default(""),
        location: z.string().trim().optional().default(""),
        items: z.array(z.object({
          materialCategory: z.string().trim().min(1),
          materialVariant: z.string().trim().optional().default(""),
          quantityKg: z.number().positive(),
          ratePerKg: z.number().nonnegative()
        })).min(1),
        saleDate: dateSchema,
        loadingCharges: z.number().nonnegative().default(0),
        labourMode: z.enum(["CONTRACT","DAILY_WAGE"]).optional().default("CONTRACT"),
        receivedBy: optionalAccountPersonSchema,
        paymentMode: z.string().trim().min(1).optional(),
        notes: z.string().trim().optional().default("")
      }).parse(body);

      const existing = sqlite.prepare("SELECT * FROM sales WHERE id=? AND mode=?").get(s.saleId,s.mode) as any;
      if (!existing) return NextResponse.json({error:"Sale not found"},{status:404});

      for (const item of s.items) {
        if (s.mode === "PET") {
          if (!["Natural Bottles","Red Bottles"].includes(item.materialCategory)) {
            return NextResponse.json({
              error: `PET sales use Natural Bottles or Red Bottles (got "${item.materialCategory || "empty"}"). Re-select material — a Plastic type may have been left over.`,
            }, { status: 400 });
          }
          if (item.materialCategory === "Natural Bottles" && !["Green","White","White Milk",""].includes(item.materialVariant)) {
            return NextResponse.json({error:"Natural Bottles can be Green, White or White Milk"},{status:400});
          }
          if (item.materialCategory === "Red Bottles" && !isRedSaleVariant(item.materialVariant || "Red Bottle")) {
            return NextResponse.json({error:"Red Bottles subtype must be Red Bottle or Red Bottle Cap"},{status:400});
          }
        } else {
          try { requireActivePlasticType(item.materialCategory); }
          catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid plastic type" }, { status: 400 }); }
        }
      }

      const lineTotals = s.items.map(item => Math.round(item.quantityKg * item.ratePerKg * 100) / 100);
      const grossAmount = Math.round(lineTotals.reduce((n,x)=>n+x,0) * 100) / 100;
      const totalWeight = Math.round(s.items.reduce((n,x)=>n+x.quantityKg,0) * 1000) / 1000;
      const labourMode = s.mode === "PET" ? s.labourMode : "CONTRACT";
      const labourCharges = s.mode === "PET" && labourMode === "CONTRACT" ? Math.round(totalWeight * 2 * 100) / 100 : 0;
      const loadingCharges = s.loadingCharges;
      const total = Math.round(Math.max(0,grossAmount-labourCharges-loadingCharges) * 100) / 100;
      if (Number(existing.received_amount) > total + 0.005) {
        return NextResponse.json({error:"Final sale amount cannot be less than payment already received"},{status:400});
      }

      const requiredByMaterial = new Map<string, number>();
      for (const item of s.items) {
        const materialName = resolveSaleStockName(s.mode, item.materialCategory, item.materialVariant || "");
        requiredByMaterial.set(materialName,(requiredByMaterial.get(materialName)||0)+item.quantityKg);
      }
      for (const [materialName,requiredKg] of requiredByMaterial) {
        const available = getAvailableStock(s.mode,materialName,s.saleDate,s.saleId);
        if (requiredKg > available + 0.005) {
          return NextResponse.json({error:"Insufficient stock for "+materialName+". Available up to "+s.saleDate+": "+available.toFixed(2)+" kg"},{status:400});
        }
      }

        const primaryVariant = s.mode === "PLASTIC" ? "" : (s.items.length===1?s.items[0].materialVariant:"MIXED");
        sqlite.prepare("UPDATE sales SET customer_name=?,phone=?,location=?,material_category=?,material_variant=?,quantity_kg=?,rate_per_kg=?,gross_amount=?,labour_charges=?,loading_charges=?,total_amount=?,credit_amount=?,sale_date=?,notes=?,updated_at=?,labour_mode=? WHERE id=? AND mode=?")
          .run(s.customerName,s.phone,s.location,s.items[0].materialCategory,primaryVariant,totalWeight,0,grossAmount,labourCharges,loadingCharges,total,Math.round((total-Number(existing.received_amount))*100)/100,s.saleDate,s.notes,nowIso(),labourMode,s.saleId,s.mode);

        sqlite.prepare("DELETE FROM sale_items WHERE sale_id=?").run(s.saleId);
        sqlite.prepare("DELETE FROM inventory_transactions WHERE sale_id=? AND transaction_type='ADJUSTMENT'").run(s.saleId);

        for (let i=0;i<s.items.length;i++) {
          const item=s.items[i];
          const variant = s.mode === "PLASTIC" ? "" : item.materialVariant;
          sqlite.prepare("INSERT INTO sale_items (sale_id,material_category,material_variant,quantity_kg,rate_per_kg,amount) VALUES (?,?,?,?,?,?)")
            .run(s.saleId,item.materialCategory,variant,item.quantityKg,item.ratePerKg,lineTotals[i]);
          const materialName=resolveSaleStockName(s.mode, item.materialCategory, item.materialVariant || "");
          sqlite.prepare("INSERT INTO inventory_transactions (mode,material_id,material_name,transaction_type,quantity_kg,amount,purchase_id,sale_id,transaction_date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .run(s.mode,null,materialName,"ADJUSTMENT",-item.quantityKg,-lineTotals[i],null,s.saleId,s.saleDate,"SALE #"+s.saleId+(s.notes ? " - "+s.notes : ""),nowIso());
        }

        if (s.receivedBy !== undefined || s.paymentMode !== undefined) {
          sqlite.prepare("UPDATE sale_payments SET received_by=COALESCE(?,received_by),payment_mode=COALESCE(?,payment_mode) WHERE id=(SELECT id FROM sale_payments WHERE sale_id=? AND COALESCE(payment_mode,'')<>'Advance' ORDER BY id DESC LIMIT 1)")
            .run(s.receivedBy ?? null,s.paymentMode ?? null,s.saleId);
        }

      // Keep sale-linked contractor earn in sync with updated kg (PET only).
      sqlite.prepare("DELETE FROM processing_contractor_ledger WHERE sale_id=? AND entry_type='EARN_SALE'").run(s.saleId);
      const earn = s.mode === "PET" && labourMode === "CONTRACT" ? creditContractorEarn({
        mode: s.mode,
        entryType: "EARN_SALE",
        kg: totalWeight,
        saleId: s.saleId,
        entryDate: s.saleDate,
        notes: `Sale #${s.saleId} labour earn`,
      }) : null;

      return json({ok:true,id:s.saleId,grossAmount,labourCharges,loadingCharges,total,received:Number(existing.received_amount),credit:Math.round((total-Number(existing.received_amount))*100)/100,labourMode,contractorEarn:earn});
    }

    if (body.action === "receiveSalePayment") {
      const s = z.object({mode:modeSchema,saleId:z.number().int().positive(),amount:z.number().positive(),paymentDate:dateSchema.optional().default(todayStr()),paymentMode:z.string().trim().min(1).default("Cash"),receivedBy:optionalAccountPersonSchema,notes:z.string().trim().optional().default("")}).parse(body);
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

    // Opening physical stock before audit start — weight + rate only, no vendor/payment.
    if (body.action === "addPreStock") {
      const s = z.object({
        mode: modeSchema,
        materialName: z.string().trim().min(1),
        materialVariant: z.string().trim().optional().default(""),
        quantityKg: z.number().positive(),
        ratePerKg: z.number().nonnegative(),
        stockDate: dateSchema.optional().default("2026-09-30"),
        notes: z.string().trim().optional().default(""),
      }).parse(body);
      let stockName: string;
      try {
        stockName = purchaseStockName(s.mode, s.materialName, s.materialVariant);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid material" }, { status: 400 });
      }
      const amount = Math.round(s.quantityKg * s.ratePerKg * 100) / 100;
      const note = s.notes
        ? `PRE-STOCK — ${s.notes}`
        : `PRE-STOCK — opening stock before audit @ ₹${s.ratePerKg}/kg`;
      sqlite.prepare(`
        INSERT INTO inventory_transactions
        (mode, material_id, material_name, transaction_type, quantity_kg, amount, transaction_date, notes, created_at)
        VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?)
      `).run(s.mode, null, stockName, s.quantityKg, amount, s.stockDate, note, nowIso());
      return json({ ok: true, materialName: stockName, quantityKg: s.quantityKg, amount });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    });

    if (pendingEmail && response.ok) {
      const base = await response.json().catch(() => ({ ok: true }));
      // Never let SMTP hang kill the purchase save (Railway/proxy timeouts become generic client errors).
      try {
        const email = await Promise.race([
          notifyPurchaseEmail(pendingEmail),
          new Promise<Awaited<ReturnType<typeof notifyPurchaseEmail>>>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  configured: true,
                  skipped: false,
                  ok: false,
                  error: "Email timed out — purchase saved. Check Gmail App Password or use RESEND_API_KEY",
                }),
              12000
            )
          ),
        ]);
        return NextResponse.json({ ...base, email });
      } catch (mailError) {
        return NextResponse.json({
          ...base,
          email: {
            configured: true,
            skipped: false,
            ok: false,
            error: mailError instanceof Error ? mailError.message : "Email failed",
          },
        });
      }
    }
    return response;
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: friendlyZodError(e) }, { status: 400 });
    const msg = e instanceof Error ? e.message : "Something went wrong — please try again";
    const stockIssue = /stock cannot go negative/i.test(msg);
    return NextResponse.json({ error: msg }, { status: stockIssue ? 400 : 500 });
  }
}
