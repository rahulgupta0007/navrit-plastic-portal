import { sqlite } from "@/db";
import { allocateByKg, r2 } from "@/lib/business/math";

export { allocateByKg, r2 };

/**
 * NAVRIT 2.0 business engine. Reads and writes only nv_* tables.
 * Every money-moving operation runs inside one SQLite transaction so stock lots,
 * sale cost and the cash ledger can never drift apart.
 */

export class BizError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type PartyKind = "supplier" | "customer" | "both";
export type MaterialGroup = "PET" | "PLASTIC" | "OTHER";

const EPS = 1e-6;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanDate(v: unknown) {
  const s = String(v || "").trim();
  if (!s) return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BizError("Date must look like YYYY-MM-DD");
  return s;
}

function tx<T>(fn: () => T): T {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    sqlite.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      sqlite.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}

function now() {
  return new Date().toISOString();
}

function lastId() {
  return Number((sqlite.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
}

function all(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).all(...(params as never[])) as Row[];
}
function one(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).get(...(params as never[])) as Row | undefined;
}
function run(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).run(...(params as never[]));
}

/* ----------------------------- parties / materials ---------------------------- */

export type PartyRef = { partyId?: number; partyName?: string };

function resolveParty(ref: PartyRef, role: "supplier" | "customer"): number {
  if (ref.partyId) {
    const row = one("SELECT id, kind FROM nv_parties WHERE id=?", ref.partyId);
    if (!row) throw new BizError("Party not found", 404);
    const kind = String(row.kind) as PartyKind;
    if (kind !== "both" && kind !== role) {
      run("UPDATE nv_parties SET kind='both' WHERE id=?", ref.partyId);
    }
    return Number(row.id);
  }
  const name = String(ref.partyName || "").trim();
  if (!name) throw new BizError(role === "supplier" ? "Supplier name is required" : "Customer name is required");
  const existing = one("SELECT id, kind FROM nv_parties WHERE name=?", name);
  if (existing) {
    const kind = String(existing.kind) as PartyKind;
    if (kind !== "both" && kind !== role) {
      run("UPDATE nv_parties SET kind='both' WHERE id=?", Number(existing.id));
    }
    return Number(existing.id);
  }
  run("INSERT INTO nv_parties (name, kind, created_at) VALUES (?,?,?)", name, role, now());
  return lastId();
}

function resolveMaterial(name: string, group: MaterialGroup | undefined, create: boolean): number {
  const clean = String(name || "").trim();
  if (!clean) throw new BizError("Material name is required");
  const existing = one("SELECT id FROM nv_materials WHERE name=?", clean);
  if (existing) return Number(existing.id);
  if (!create) throw new BizError(`No stock of "${clean}" - buy it first`);
  const grp: MaterialGroup = group === "PET" || group === "OTHER" ? group : "PLASTIC";
  run("INSERT INTO nv_materials (name, grp, created_at) VALUES (?,?,?)", clean, grp, now());
  return lastId();
}

export function savePartyDetails(input: { id?: number; name: string; phone?: string; kind?: PartyKind; notes?: string }) {
  const name = String(input.name || "").trim();
  if (!name) throw new BizError("Name is required");
  const kind: PartyKind = input.kind === "supplier" || input.kind === "customer" ? input.kind : "both";
  return tx(() => {
    if (input.id) {
      const dup = one("SELECT id FROM nv_parties WHERE name=? AND id<>?", name, input.id);
      if (dup) throw new BizError("Another party already has this name");
      run(
        "UPDATE nv_parties SET name=?, phone=?, kind=?, notes=? WHERE id=?",
        name,
        String(input.phone || "").trim(),
        kind,
        String(input.notes || "").trim(),
        input.id
      );
      return input.id;
    }
    const dup = one("SELECT id FROM nv_parties WHERE name=?", name);
    if (dup) throw new BizError("A party with this name already exists");
    run(
      "INSERT INTO nv_parties (name, phone, kind, notes, created_at) VALUES (?,?,?,?,?)",
      name,
      String(input.phone || "").trim(),
      kind,
      String(input.notes || "").trim(),
      now()
    );
    return lastId();
  });
}

export function deleteParty(id: number) {
  const used =
    one("SELECT 1 AS x FROM nv_purchases WHERE party_id=? LIMIT 1", id) ||
    one("SELECT 1 AS x FROM nv_sales WHERE party_id=? LIMIT 1", id);
  if (used) throw new BizError("This party has purchases or sales and cannot be deleted");
  run("DELETE FROM nv_parties WHERE id=?", id);
}

/* --------------------------------- purchases --------------------------------- */

export type PurchaseLineInput = { materialName: string; group?: MaterialGroup; kg: number; rate: number };
export type PurchaseInput = PartyRef & {
  date?: string;
  transport?: number;
  loading?: number;
  otherCharges?: number;
  notes?: string;
  paidNow?: number;
  lines: PurchaseLineInput[];
};

function validateLines(lines: PurchaseLineInput[]) {
  if (!Array.isArray(lines) || lines.length === 0) throw new BizError("Add at least one material line");
  return lines.map((l, i) => {
    const kg = r3(num(l.kg));
    const rate = num(l.rate);
    if (kg <= 0) throw new BizError(`Line ${i + 1}: weight must be more than 0`);
    if (rate < 0) throw new BizError(`Line ${i + 1}: rate cannot be negative`);
    return { materialName: String(l.materialName || ""), group: l.group, kg, rate };
  });
}

function insertPurchaseLines(purchaseId: number, date: string, input: PurchaseInput) {
  const lines = validateLines(input.lines);
  const charges = r2(num(input.transport) + num(input.loading) + num(input.otherCharges));
  const alloc = allocateByKg(charges, lines.map((l) => l.kg));
  lines.forEach((l, i) => {
    const materialId = resolveMaterial(l.materialName, l.group, true);
    const lineCost = r2(l.kg * l.rate);
    const landed = (lineCost + alloc[i]) / l.kg;
    run(
      `INSERT INTO nv_purchase_lines (purchase_id, material_id, kg, rate, line_cost, alloc_charges, landed_per_kg)
       VALUES (?,?,?,?,?,?,?)`,
      purchaseId, materialId, l.kg, l.rate, lineCost, alloc[i], landed
    );
    const lineId = lastId();
    run(
      `INSERT INTO nv_stock_lots (purchase_line_id, material_id, lot_date, kg_in, kg_left, cost_per_kg, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      lineId, materialId, date, l.kg, l.kg, landed, now()
    );
  });
}

function purchaseTotal(id: number) {
  return num(one("SELECT COALESCE(SUM(line_cost + alloc_charges),0) AS t FROM nv_purchase_lines WHERE purchase_id=?", id)?.t);
}
function purchasePaid(id: number) {
  return num(
    one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_cash_ledger WHERE ref_type='purchase' AND ref_id=? AND direction='out'", id)?.t
  );
}

function addLedger(entry: {
  date: string;
  kind: string;
  direction: "in" | "out";
  amount: number;
  refType?: string;
  refId?: number | null;
  partyId?: number | null;
  description?: string;
}) {
  const amount = r2(entry.amount);
  if (amount <= 0) return;
  run(
    `INSERT INTO nv_cash_ledger (entry_date, kind, direction, amount, ref_type, ref_id, party_id, description, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    entry.date, entry.kind, entry.direction, amount, entry.refType || "", entry.refId ?? null, entry.partyId ?? null,
    entry.description || "", now()
  );
}

export function createPurchase(input: PurchaseInput) {
  return tx(() => {
    const date = cleanDate(input.date);
    const partyId = resolveParty(input, "supplier");
    run(
      `INSERT INTO nv_purchases (purchase_date, party_id, transport, loading, other_charges, notes, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      date, partyId, r2(num(input.transport)), r2(num(input.loading)), r2(num(input.otherCharges)),
      String(input.notes || "").trim(), now()
    );
    const id = lastId();
    insertPurchaseLines(id, date, input);
    const total = purchaseTotal(id);
    const paid = r2(num(input.paidNow));
    if (paid > total + 0.005) throw new BizError("Paid amount is more than the purchase total");
    addLedger({ date, kind: "purchase_payment", direction: "out", amount: paid, refType: "purchase", refId: id, partyId, description: `Purchase #${id}` });
    return id;
  });
}

function lotsUntouched(purchaseId: number) {
  const touched = one(
    `SELECT 1 AS x FROM nv_stock_lots l JOIN nv_purchase_lines pl ON pl.id = l.purchase_line_id
     WHERE pl.purchase_id=? AND l.kg_left < l.kg_in - ? LIMIT 1`,
    purchaseId, EPS
  );
  return !touched;
}

export function updatePurchase(id: number, input: PurchaseInput) {
  return tx(() => {
    const existing = one("SELECT id FROM nv_purchases WHERE id=?", id);
    if (!existing) throw new BizError("Purchase not found", 404);
    if (!lotsUntouched(id)) {
      throw new BizError("Part of this stock is already sold, so the purchase lines cannot be changed. Delete the linked sales first.");
    }
    const date = cleanDate(input.date);
    const partyId = resolveParty(input, "supplier");
    run("DELETE FROM nv_purchase_lines WHERE purchase_id=?", id);
    run(
      `UPDATE nv_purchases SET purchase_date=?, party_id=?, transport=?, loading=?, other_charges=?, notes=? WHERE id=?`,
      date, partyId, r2(num(input.transport)), r2(num(input.loading)), r2(num(input.otherCharges)),
      String(input.notes || "").trim(), id
    );
    insertPurchaseLines(id, date, input);
    run("UPDATE nv_cash_ledger SET party_id=? WHERE ref_type='purchase' AND ref_id=?", partyId, id);
    if (purchasePaid(id) > purchaseTotal(id) + 0.005) {
      throw new BizError("New total is lower than what is already paid. Remove a payment first.");
    }
  });
}

export function deletePurchase(id: number) {
  tx(() => {
    if (!one("SELECT id FROM nv_purchases WHERE id=?", id)) throw new BizError("Purchase not found", 404);
    if (!lotsUntouched(id)) {
      throw new BizError("Part of this stock is already sold, so the purchase cannot be deleted. Delete the linked sales first.");
    }
    run("DELETE FROM nv_cash_ledger WHERE ref_type='purchase' AND ref_id=?", id);
    run("DELETE FROM nv_purchases WHERE id=?", id);
  });
}

type DueRow = { id: number; due: number };

function purchaseDues(partyId: number): DueRow[] {
  return all(
    `SELECT p.id,
       COALESCE((SELECT SUM(line_cost + alloc_charges) FROM nv_purchase_lines WHERE purchase_id=p.id),0)
       - COALESCE((SELECT SUM(amount) FROM nv_cash_ledger WHERE ref_type='purchase' AND ref_id=p.id AND direction='out'),0) AS due
     FROM nv_purchases p WHERE p.party_id=? ORDER BY p.purchase_date, p.id`,
    partyId
  )
    .map((r) => ({ id: Number(r.id), due: r2(num(r.due)) }))
    .filter((r) => r.due > 0.004);
}

function saleDues(partyId: number): DueRow[] {
  return all(
    `SELECT s.id,
       COALESCE((SELECT SUM(amount) FROM nv_sale_lines WHERE sale_id=s.id),0) + s.gst_amount
       - COALESCE((SELECT SUM(amount) FROM nv_cash_ledger WHERE ref_type='sale' AND ref_id=s.id AND direction='in'),0) AS due
     FROM nv_sales s WHERE s.party_id=? ORDER BY s.sale_date, s.id`,
    partyId
  )
    .map((r) => ({ id: Number(r.id), due: r2(num(r.due)) }))
    .filter((r) => r.due > 0.004);
}

function settle(
  dues: DueRow[],
  amount: number,
  apply: (id: number, part: number) => void
) {
  const total = r2(dues.reduce((a, d) => a + d.due, 0));
  if (amount > total + 0.005) throw new BizError(`Amount is more than the pending ${total.toFixed(2)}`);
  let left = amount;
  for (const d of dues) {
    if (left <= 0.004) break;
    const part = r2(Math.min(left, d.due));
    apply(d.id, part);
    left = r2(left - part);
  }
}

export function payPurchases(input: { partyId?: number; purchaseId?: number; amount: number; date?: string }) {
  const amount = r2(num(input.amount));
  if (amount <= 0) throw new BizError("Enter an amount more than 0");
  const date = cleanDate(input.date);
  tx(() => {
    let partyId = input.partyId;
    let dues: DueRow[];
    if (input.purchaseId) {
      const p = one("SELECT party_id FROM nv_purchases WHERE id=?", input.purchaseId);
      if (!p) throw new BizError("Purchase not found", 404);
      partyId = Number(p.party_id);
      dues = purchaseDues(partyId).filter((d) => d.id === input.purchaseId);
    } else {
      if (!partyId) throw new BizError("Choose a supplier");
      dues = purchaseDues(partyId);
    }
    settle(dues, amount, (id, part) =>
      addLedger({ date, kind: "purchase_payment", direction: "out", amount: part, refType: "purchase", refId: id, partyId, description: `Purchase #${id}` })
    );
  });
}

/* ----------------------------------- sales ----------------------------------- */

export type SaleLineInput = { materialName: string; kg: number; rate: number };
export type SaleInput = PartyRef & {
  date?: string;
  gstPercent?: number;
  sideCosts?: number;
  notes?: string;
  receivedNow?: number;
  lines: SaleLineInput[];
};

function consumeFifo(materialId: number, kg: number, name: string) {
  const lots = all(
    "SELECT id, kg_left, cost_per_kg FROM nv_stock_lots WHERE material_id=? AND kg_left > ? ORDER BY lot_date, id",
    materialId, EPS
  );
  const available = lots.reduce((a, l) => a + num(l.kg_left), 0);
  if (kg > available + EPS) {
    throw new BizError(`Only ${r3(available)} kg of ${name} in stock, you are selling ${kg} kg`);
  }
  let need = kg;
  let cost = 0;
  const used: Array<{ lotId: number; kg: number; cost: number }> = [];
  for (const lot of lots) {
    if (need <= EPS) break;
    const take = Math.min(need, num(lot.kg_left));
    const c = take * num(lot.cost_per_kg);
    used.push({ lotId: Number(lot.id), kg: take, cost: c });
    cost += c;
    need -= take;
    run("UPDATE nv_stock_lots SET kg_left = MAX(0, kg_left - ?) WHERE id=?", take, Number(lot.id));
  }
  return { cost: r2(cost), used };
}

function insertSaleLines(saleId: number, input: SaleInput) {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new BizError("Add at least one material line");
  let gross = 0;
  input.lines.forEach((l, i) => {
    const kg = r3(num(l.kg));
    const rate = num(l.rate);
    if (kg <= 0) throw new BizError(`Line ${i + 1}: weight must be more than 0`);
    if (rate < 0) throw new BizError(`Line ${i + 1}: rate cannot be negative`);
    const name = String(l.materialName || "").trim();
    const materialId = resolveMaterial(name, undefined, false);
    const amount = r2(kg * rate);
    const { cost, used } = consumeFifo(materialId, kg, name);
    run(
      "INSERT INTO nv_sale_lines (sale_id, material_id, kg, rate, amount, cogs) VALUES (?,?,?,?,?,?)",
      saleId, materialId, kg, rate, amount, cost
    );
    const lineId = lastId();
    for (const u of used) {
      run("INSERT INTO nv_lot_consumption (sale_line_id, lot_id, kg, cost) VALUES (?,?,?,?)", lineId, u.lotId, u.kg, u.cost);
    }
    gross += amount;
  });
  const pct = Math.max(0, num(input.gstPercent));
  const gst = r2((gross * pct) / 100);
  run("UPDATE nv_sales SET gst_percent=?, gst_amount=? WHERE id=?", pct, gst, saleId);
  return r2(gross + gst);
}

/**
 * Dry run of a sale: shows FIFO cost and profit for the lines as typed, then rolls
 * everything back. When editing, the sale being edited is put back into stock first.
 */
export function previewSale(input: SaleInput & { excludeSaleId?: number }) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    if (input.excludeSaleId) reverseSale(input.excludeSaleId);
    let gross = 0;
    let cogs = 0;
    const lines = (Array.isArray(input.lines) ? input.lines : []).map((l) => {
      const name = String(l.materialName || "").trim();
      const kg = r3(num(l.kg));
      const rate = num(l.rate);
      const amount = r2(kg * rate);
      const material = name ? one("SELECT id FROM nv_materials WHERE name=?", name) : undefined;
      if (!name || kg <= 0) return { materialName: name, ready: false, known: !!material, available: 0, amount, cogs: 0, profit: 0, avgCost: 0, short: false };
      if (!material) return { materialName: name, ready: false, known: false, available: 0, amount, cogs: 0, profit: 0, avgCost: 0, short: true };
      const available = r3(num(one("SELECT COALESCE(SUM(kg_left),0) AS t FROM nv_stock_lots WHERE material_id=?", Number(material.id))?.t));
      const take = Math.min(kg, available);
      const cost = take > EPS ? consumeFifo(Number(material.id), take, name).cost : 0;
      gross += amount;
      cogs += cost;
      return {
        materialName: name, ready: true, known: true, available, amount, cogs: cost,
        profit: r2(amount - cost), avgCost: kg > 0 ? r2(cost / take || 0) : 0, short: kg > available + EPS,
      };
    });
    const pct = Math.max(0, num(input.gstPercent));
    const gst = r2((gross * pct) / 100);
    const side = r2(num(input.sideCosts));
    const profit = r2(gross - cogs - side);
    return {
      lines, gross: r2(gross), gst, total: r2(gross + gst), cogs: r2(cogs), sideCosts: side, profit,
      margin: gross > 0 ? r2((profit / gross) * 100) : 0,
      anyShort: lines.some((l) => l.short),
    };
  } finally {
    sqlite.exec("ROLLBACK");
  }
}

function sideCostLedger(saleId: number, date: string, partyId: number, amount: number) {
  run("DELETE FROM nv_cash_ledger WHERE ref_type='sale_cost' AND ref_id=?", saleId);
  addLedger({ date, kind: "sale_cost", direction: "out", amount, refType: "sale_cost", refId: saleId, partyId, description: `Sale #${saleId} loading/freight` });
}

export function createSale(input: SaleInput) {
  return tx(() => {
    const date = cleanDate(input.date);
    const partyId = resolveParty(input, "customer");
    run(
      "INSERT INTO nv_sales (sale_date, party_id, side_costs, notes, created_at) VALUES (?,?,?,?,?)",
      date, partyId, r2(num(input.sideCosts)), String(input.notes || "").trim(), now()
    );
    const id = lastId();
    const total = insertSaleLines(id, input);
    const received = r2(num(input.receivedNow));
    if (received > total + 0.005) throw new BizError("Received amount is more than the sale total");
    addLedger({ date, kind: "sale_receipt", direction: "in", amount: received, refType: "sale", refId: id, partyId, description: `Sale #${id}` });
    sideCostLedger(id, date, partyId, r2(num(input.sideCosts)));
    return id;
  });
}

function reverseSale(id: number) {
  const used = all(
    `SELECT lc.lot_id, lc.kg FROM nv_lot_consumption lc
     JOIN nv_sale_lines sl ON sl.id = lc.sale_line_id WHERE sl.sale_id=?`,
    id
  );
  for (const u of used) {
    run("UPDATE nv_stock_lots SET kg_left = MIN(kg_in, kg_left + ?) WHERE id=?", num(u.kg), Number(u.lot_id));
  }
  run("DELETE FROM nv_sale_lines WHERE sale_id=?", id);
}

function saleReceived(id: number) {
  return num(
    one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_cash_ledger WHERE ref_type='sale' AND ref_id=? AND direction='in'", id)?.t
  );
}

export function updateSale(id: number, input: SaleInput) {
  tx(() => {
    if (!one("SELECT id FROM nv_sales WHERE id=?", id)) throw new BizError("Sale not found", 404);
    const date = cleanDate(input.date);
    const partyId = resolveParty(input, "customer");
    reverseSale(id);
    run(
      "UPDATE nv_sales SET sale_date=?, party_id=?, side_costs=?, notes=? WHERE id=?",
      date, partyId, r2(num(input.sideCosts)), String(input.notes || "").trim(), id
    );
    const total = insertSaleLines(id, input);
    if (saleReceived(id) > total + 0.005) {
      throw new BizError("New total is lower than what is already received. Remove a receipt first.");
    }
    run("UPDATE nv_cash_ledger SET party_id=? WHERE ref_type='sale' AND ref_id=?", partyId, id);
    sideCostLedger(id, date, partyId, r2(num(input.sideCosts)));
  });
}

export function deleteSale(id: number) {
  tx(() => {
    if (!one("SELECT id FROM nv_sales WHERE id=?", id)) throw new BizError("Sale not found", 404);
    reverseSale(id);
    run("DELETE FROM nv_cash_ledger WHERE ref_type IN ('sale','sale_cost') AND ref_id=?", id);
    run("DELETE FROM nv_sales WHERE id=?", id);
  });
}

export function receiveSales(input: { partyId?: number; saleId?: number; amount: number; date?: string }) {
  const amount = r2(num(input.amount));
  if (amount <= 0) throw new BizError("Enter an amount more than 0");
  const date = cleanDate(input.date);
  tx(() => {
    let partyId = input.partyId;
    let dues: DueRow[];
    if (input.saleId) {
      const s = one("SELECT party_id FROM nv_sales WHERE id=?", input.saleId);
      if (!s) throw new BizError("Sale not found", 404);
      partyId = Number(s.party_id);
      dues = saleDues(partyId).filter((d) => d.id === input.saleId);
    } else {
      if (!partyId) throw new BizError("Choose a customer");
      dues = saleDues(partyId);
    }
    settle(dues, amount, (id, part) =>
      addLedger({ date, kind: "sale_receipt", direction: "in", amount: part, refType: "sale", refId: id, partyId, description: `Sale #${id}` })
    );
  });
}

export function deleteSettlement(ledgerId: number) {
  const row = one("SELECT kind FROM nv_cash_ledger WHERE id=?", ledgerId);
  if (!row) throw new BizError("Entry not found", 404);
  if (row.kind !== "purchase_payment" && row.kind !== "sale_receipt") {
    throw new BizError("Only payments and receipts can be removed here");
  }
  run("DELETE FROM nv_cash_ledger WHERE id=?", ledgerId);
}

/* ------------------------------ investment / expenses ------------------------ */

export function addInvestment(input: { date?: string; investor: string; amount: number; kind?: string; note?: string }) {
  const investor = String(input.investor || "").trim();
  const amount = r2(num(input.amount));
  if (!investor) throw new BizError("Investor name is required");
  if (amount <= 0) throw new BizError("Amount must be more than 0");
  const kind = input.kind === "loan" || input.kind === "drawing" ? input.kind : "equity";
  return tx(() => {
    const date = cleanDate(input.date);
    run(
      "INSERT INTO nv_investments (inv_date, investor, amount, kind, note, created_at) VALUES (?,?,?,?,?,?)",
      date, investor, amount, kind, String(input.note || "").trim(), now()
    );
    const id = lastId();
    addLedger({
      date, kind, direction: kind === "drawing" ? "out" : "in", amount, refType: "investment", refId: id,
      description: `${kind === "drawing" ? "Drawing by" : kind === "loan" ? "Loan from" : "Capital from"} ${investor}`,
    });
    return id;
  });
}

export function deleteInvestment(id: number) {
  tx(() => {
    run("DELETE FROM nv_cash_ledger WHERE ref_type='investment' AND ref_id=?", id);
    run("DELETE FROM nv_investments WHERE id=?", id);
  });
}

export const EXPENSE_CATEGORIES = ["Labour", "Rent", "Fuel", "Salary", "Electricity", "Repair", "GST payment", "Other"] as const;

export function addExpense(input: { date?: string; category: string; amount: number; note?: string }) {
  const category = String(input.category || "").trim() || "Other";
  const amount = r2(num(input.amount));
  if (amount <= 0) throw new BizError("Amount must be more than 0");
  return tx(() => {
    const date = cleanDate(input.date);
    run(
      "INSERT INTO nv_expenses (exp_date, category, amount, note, created_at) VALUES (?,?,?,?,?)",
      date, category, amount, String(input.note || "").trim(), now()
    );
    const id = lastId();
    addLedger({ date, kind: "expense", direction: "out", amount, refType: "expense", refId: id, description: `${category}${input.note ? " - " + input.note : ""}` });
    return id;
  });
}

export function deleteExpense(id: number) {
  tx(() => {
    run("DELETE FROM nv_cash_ledger WHERE ref_type='expense' AND ref_id=?", id);
    run("DELETE FROM nv_expenses WHERE id=?", id);
  });
}

/* ----------------------------------- reads ----------------------------------- */

export function listParties(): Row[] {
  const parties = all("SELECT id, name, phone, kind, notes FROM nv_parties ORDER BY name COLLATE NOCASE");
  return parties.map((p) => {
    const id = Number(p.id);
    const payable = r2(purchaseDues(id).reduce((a, d) => a + d.due, 0));
    const receivable = r2(saleDues(id).reduce((a, d) => a + d.due, 0));
    const bought = num(
      one(
        `SELECT COALESCE(SUM(l.line_cost + l.alloc_charges),0) AS t FROM nv_purchase_lines l
         JOIN nv_purchases p ON p.id=l.purchase_id WHERE p.party_id=?`, id
      )?.t
    );
    const sold = num(
      one(
        `SELECT COALESCE(SUM(l.amount),0) AS t FROM nv_sale_lines l JOIN nv_sales s ON s.id=l.sale_id WHERE s.party_id=?`, id
      )?.t
    );
    return { ...p, id, payable, receivable, bought: r2(bought), sold: r2(sold) };
  });
}

export function listPurchases(limit = 200): Row[] {
  const rows = all(
    `SELECT p.id, p.purchase_date, p.party_id, pa.name AS party_name, p.transport, p.loading, p.other_charges, p.notes,
       COALESCE((SELECT SUM(line_cost + alloc_charges) FROM nv_purchase_lines WHERE purchase_id=p.id),0) AS total,
       COALESCE((SELECT SUM(kg) FROM nv_purchase_lines WHERE purchase_id=p.id),0) AS total_kg,
       COALESCE((SELECT SUM(amount) FROM nv_cash_ledger WHERE ref_type='purchase' AND ref_id=p.id AND direction='out'),0) AS paid
     FROM nv_purchases p JOIN nv_parties pa ON pa.id = p.party_id
     ORDER BY p.purchase_date DESC, p.id DESC LIMIT ?`,
    limit
  );
  return rows.map((p) => {
    const id = Number(p.id);
    const lines = all(
      `SELECT l.id, m.name AS material, m.grp, l.kg, l.rate, l.line_cost, l.alloc_charges, l.landed_per_kg, lot.kg_left
       FROM nv_purchase_lines l JOIN nv_materials m ON m.id=l.material_id
       LEFT JOIN nv_stock_lots lot ON lot.purchase_line_id = l.id WHERE l.purchase_id=? ORDER BY l.id`,
      id
    );
    const payments = all(
      "SELECT id, entry_date, amount FROM nv_cash_ledger WHERE ref_type='purchase' AND ref_id=? AND direction='out' ORDER BY entry_date, id",
      id
    );
    const total = r2(num(p.total));
    const paid = r2(num(p.paid));
    return { ...p, id, total, paid, due: r2(total - paid), lines, payments };
  });
}

export function listSales(limit = 200): Row[] {
  const rows = all(
    `SELECT s.id, s.sale_date, s.party_id, pa.name AS party_name, s.gst_percent, s.gst_amount, s.side_costs, s.notes,
       COALESCE((SELECT SUM(amount) FROM nv_sale_lines WHERE sale_id=s.id),0) AS gross,
       COALESCE((SELECT SUM(cogs) FROM nv_sale_lines WHERE sale_id=s.id),0) AS cogs,
       COALESCE((SELECT SUM(kg) FROM nv_sale_lines WHERE sale_id=s.id),0) AS total_kg,
       COALESCE((SELECT SUM(amount) FROM nv_cash_ledger WHERE ref_type='sale' AND ref_id=s.id AND direction='in'),0) AS received
     FROM nv_sales s JOIN nv_parties pa ON pa.id = s.party_id
     ORDER BY s.sale_date DESC, s.id DESC LIMIT ?`,
    limit
  );
  return rows.map((s) => {
    const id = Number(s.id);
    const lines = all(
      `SELECT l.id, m.name AS material, m.grp, l.kg, l.rate, l.amount, l.cogs
       FROM nv_sale_lines l JOIN nv_materials m ON m.id=l.material_id WHERE l.sale_id=? ORDER BY l.id`,
      id
    ).map((l) => ({ ...l, profit: r2(num(l.amount) - num(l.cogs)) }));
    const payments = all(
      "SELECT id, entry_date, amount FROM nv_cash_ledger WHERE ref_type='sale' AND ref_id=? AND direction='in' ORDER BY entry_date, id",
      id
    );
    const gross = r2(num(s.gross));
    const total = r2(gross + num(s.gst_amount));
    const profit = r2(gross - num(s.cogs) - num(s.side_costs));
    const received = r2(num(s.received));
    return {
      ...s, id, gross, total, received, due: r2(total - received), profit,
      margin: gross > 0 ? r2((profit / gross) * 100) : 0, lines, payments,
    };
  });
}

export function getStock(): { materials: Row[]; totalKg: number; totalValue: number } {
  const materials = all(
    `SELECT m.id, m.name, m.grp,
       COALESCE((SELECT SUM(kg_left) FROM nv_stock_lots WHERE material_id=m.id),0) AS kg,
       COALESCE((SELECT SUM(kg_left * cost_per_kg) FROM nv_stock_lots WHERE material_id=m.id),0) AS value
     FROM nv_materials m WHERE m.active=1 ORDER BY m.grp, m.name COLLATE NOCASE`
  ).map((m) => {
    const kg = r3(num(m.kg));
    const value = r2(num(m.value));
    const lots = all(
      `SELECT id, lot_date, kg_in, kg_left, cost_per_kg FROM nv_stock_lots
       WHERE material_id=? AND kg_left > ? ORDER BY lot_date, id`,
      Number(m.id), EPS
    );
    return { ...m, kg, value, avgCost: kg > 0 ? r2(value / kg) : 0, lots };
  });
  return { materials, totalKg: r3(materials.reduce((a, m) => a + m.kg, 0)), totalValue: r2(materials.reduce((a, m) => a + m.value, 0)) };
}

export function listInvestments() {
  return all("SELECT id, inv_date, investor, amount, kind, note FROM nv_investments ORDER BY inv_date DESC, id DESC");
}

export function listExpenses(limit = 200) {
  return all("SELECT id, exp_date, category, amount, note FROM nv_expenses ORDER BY exp_date DESC, id DESC LIMIT ?", limit);
}

export function listLedger(limit = 300) {
  const rows = all(
    `SELECT l.id, l.entry_date, l.kind, l.direction, l.amount, l.ref_type, l.ref_id, l.description, p.name AS party_name
     FROM nv_cash_ledger l LEFT JOIN nv_parties p ON p.id = l.party_id ORDER BY l.entry_date, l.id`
  );
  let balance = 0;
  const withBalance = rows.map((r) => {
    balance = r2(balance + (r.direction === "in" ? num(r.amount) : -num(r.amount)));
    return { ...r, balance };
  });
  return withBalance.slice(-limit).reverse();
}

function periodProfit(from: string, to: string) {
  const sales = one(
    `SELECT COALESCE(SUM(l.amount),0) AS gross, COALESCE(SUM(l.cogs),0) AS cogs
     FROM nv_sale_lines l JOIN nv_sales s ON s.id=l.sale_id WHERE s.sale_date BETWEEN ? AND ?`,
    from, to
  );
  const side = num(one("SELECT COALESCE(SUM(side_costs),0) AS t FROM nv_sales WHERE sale_date BETWEEN ? AND ?", from, to)?.t);
  const exp = num(
    one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_expenses WHERE category<>'GST payment' AND exp_date BETWEEN ? AND ?", from, to)?.t
  );
  const gross = num(sales?.gross);
  const cogs = num(sales?.cogs);
  const salesProfit = r2(gross - cogs - side);
  return { gross: r2(gross), cogs: r2(cogs), sideCosts: r2(side), salesProfit, expenses: r2(exp), profit: r2(salesProfit - exp) };
}

export function getSummary() {
  const t = today();
  const monthStart = t.slice(0, 8) + "01";

  const inv = all("SELECT investor, kind, SUM(amount) AS total FROM nv_investments GROUP BY investor, kind");
  const sumKind = (k: string) => r2(inv.filter((r) => r.kind === k).reduce((a, r) => a + num(r.total), 0));
  const equity = sumKind("equity");
  const loans = sumKind("loan");
  const drawings = sumKind("drawing");
  const investorMap = new Map<string, { investor: string; equity: number; loan: number; drawing: number }>();
  for (const r of inv) {
    const key = String(r.investor);
    const cur = investorMap.get(key) || { investor: key, equity: 0, loan: 0, drawing: 0 };
    const k = String(r.kind) as "equity" | "loan" | "drawing";
    cur[k] = r2(cur[k] + num(r.total));
    investorMap.set(key, cur);
  }

  const cashRow = one(
    "SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS c FROM nv_cash_ledger"
  );
  const cash = r2(num(cashRow?.c));

  const stock = getStock();

  const payables = r2(
    num(
      one(
        `SELECT COALESCE(SUM(line_cost + alloc_charges),0) AS t FROM nv_purchase_lines`
      )?.t
    ) - num(one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_cash_ledger WHERE ref_type='purchase' AND direction='out'")?.t)
  );
  const grossAll = num(one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_sale_lines")?.t);
  const gstCollected = r2(num(one("SELECT COALESCE(SUM(gst_amount),0) AS t FROM nv_sales")?.t));
  const receivables = r2(
    grossAll + gstCollected - num(one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_cash_ledger WHERE ref_type='sale' AND direction='in'")?.t)
  );
  const gstPaid = r2(num(one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_expenses WHERE category='GST payment'")?.t));
  const gstPayable = r2(gstCollected - gstPaid);

  const allTime = periodProfit("0000-01-01", "9999-12-31");
  const todayP = periodProfit(t, t);
  const monthP = periodProfit(monthStart, t);

  const assets = r2(cash + stock.totalValue + receivables);
  const liabilities = r2(payables + loans + gstPayable);
  const ownerFunds = r2(equity - drawings + allTime.profit);
  const checkDiff = r2(assets - liabilities - ownerFunds);

  const months = all(
    `SELECT substr(s.sale_date,1,7) AS month,
       SUM(l.amount) AS gross, SUM(l.cogs) AS cogs
     FROM nv_sale_lines l JOIN nv_sales s ON s.id=l.sale_id GROUP BY month ORDER BY month DESC LIMIT 6`
  ).map((m) => {
    const month = String(m.month);
    const side = num(one("SELECT COALESCE(SUM(side_costs),0) AS t FROM nv_sales WHERE substr(sale_date,1,7)=?", month)?.t);
    const exp = num(
      one("SELECT COALESCE(SUM(amount),0) AS t FROM nv_expenses WHERE category<>'GST payment' AND substr(exp_date,1,7)=?", month)?.t
    );
    const salesProfit = r2(num(m.gross) - num(m.cogs) - side);
    return { month, sales: r2(num(m.gross)), salesProfit, expenses: r2(exp), profit: r2(salesProfit - exp) };
  });

  const byGroup = all(
    `SELECT m.grp AS grp, SUM(l.amount) AS gross, SUM(l.cogs) AS cogs, SUM(l.kg) AS kg
     FROM nv_sale_lines l JOIN nv_materials m ON m.id=l.material_id GROUP BY m.grp`
  ).map((g) => ({ group: String(g.grp), sales: r2(num(g.gross)), profit: r2(num(g.gross) - num(g.cogs)), kg: r3(num(g.kg)) }));

  return {
    date: t,
    capital: { equity, loans, drawings, net: r2(equity - drawings), investors: Array.from(investorMap.values()) },
    cash,
    stock: { totalKg: stock.totalKg, totalValue: stock.totalValue },
    receivables,
    payables,
    gst: { collected: gstCollected, paid: gstPaid, payable: gstPayable },
    profit: { today: todayP, month: monthP, allTime },
    check: { assets, liabilities, ownerFunds, difference: checkDiff, balanced: Math.abs(checkDiff) < 0.05 },
    months,
    byGroup,
    recentSales: listSales(5),
    counts: {
      purchases: num(one("SELECT COUNT(*) AS c FROM nv_purchases")?.c),
      sales: num(one("SELECT COUNT(*) AS c FROM nv_sales")?.c),
    },
  };
}

/** Read-only look at the legacy books for the optional combined card. */
export function getLegacyTotals() {
  const safe = (sql: string) => {
    try {
      return num(one(sql)?.t);
    } catch {
      return 0;
    }
  };
  return {
    purchases: safe("SELECT COUNT(*) AS t FROM purchases"),
    sales: safe("SELECT COUNT(*) AS t FROM sales"),
    purchaseAmount: r2(safe("SELECT COALESCE(SUM(total_amount),0) AS t FROM purchases")),
    saleAmount: r2(safe("SELECT COALESCE(SUM(total_amount),0) AS t FROM sales")),
  };
}
