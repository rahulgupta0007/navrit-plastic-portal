/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Read-only snapshots of Navrit portal data for Navi (the assistant).
 * Never mutates the database.
 */
import { sqlite } from "@/db";
import { ACCOUNT_PERSONS } from "@/lib/account-persons";

function n(v: unknown) {
  return Number(v || 0);
}
function money(v: number) {
  return Math.round(v * 100) / 100;
}

function sumSql(sql: string, ...params: Array<string | number>) {
  return n((sqlite.prepare(sql).get(...params) as any)?.n);
}

export function getCompanyOverview() {
  const petSales = sumSql("SELECT COALESCE(SUM(total_amount),0) as n FROM sales WHERE mode='PET'");
  const plasticSales = sumSql("SELECT COALESCE(SUM(total_amount),0) as n FROM sales WHERE mode='PLASTIC'");
  const petPurchases = sumSql("SELECT COALESCE(SUM(total_amount),0) as n FROM purchases WHERE mode='PET'");
  const plasticPurchases = sumSql("SELECT COALESCE(SUM(total_amount),0) as n FROM purchases WHERE mode='PLASTIC'");
  const petSoldKg = sumSql("SELECT COALESCE(SUM(quantity_kg),0) as n FROM sales WHERE mode='PET'");
  const plasticSoldKg = sumSql("SELECT COALESCE(SUM(quantity_kg),0) as n FROM sales WHERE mode='PLASTIC'");
  const vendorDues = sumSql("SELECT COALESCE(SUM(credit_amount),0) as n FROM purchases WHERE credit_amount>0.005");
  const buyerPending = sumSql("SELECT COALESCE(SUM(credit_amount),0) as n FROM sales WHERE credit_amount>0.005");
  const sharedElec = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE mode='SHARED' AND expense_type='Electricity'");
  const stock = sqlite.prepare(`
    SELECT mode,
      CASE WHEN material_name LIKE 'Natural Bottles%' THEN 'Natural Bottles' ELSE material_name END as material,
      ROUND(SUM(quantity_kg),3) as kg
    FROM inventory_transactions
    GROUP BY mode, CASE WHEN material_name LIKE 'Natural Bottles%' THEN 'Natural Bottles' ELSE material_name END
    HAVING ABS(SUM(quantity_kg)) > 0.001
    ORDER BY mode, material
  `).all();

  return {
    sales: { PET: money(petSales), PLASTIC: money(plasticSales), total: money(petSales + plasticSales) },
    purchases: { PET: money(petPurchases), PLASTIC: money(plasticPurchases), total: money(petPurchases + plasticPurchases) },
    soldKg: { PET: money(petSoldKg), PLASTIC: money(plasticSoldKg) },
    vendorDuesOutstanding: money(vendorDues),
    buyerCreditPending: money(buyerPending),
    sharedElectricityBills: money(sharedElec),
    stock,
  };
}

export function getCashAndPartners() {
  const saleCash = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM sale_payments WHERE COALESCE(payment_mode,'')<>'Advance'");
  const buyerAdv = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM buyer_advances");
  const partnerAdv = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances");
  const vendorPaid = sumSql(`
    SELECT COALESCE(SUM(amount),0) as n FROM vendor_payments
    WHERE NOT (payment_type='CREDIT_SETTLEMENT' AND payment_mode='Advance')
      AND COALESCE(funding_source,'COMPANY')='COMPANY'
  `);
  const expenses = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM other_expenses WHERE COALESCE(funding_source,'COMPANY')='COMPANY'");
  const labourCash = sumSql(`
    SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour
    WHERE COALESCE(funding_source,'COMPANY')='COMPANY'
      AND COALESCE(NULLIF(payment_kind,''),'WAGE') IN ('WAGE','ADVANCE')
  `);
  const partnerSettled = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM partner_settlements");
  const borrowed = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM borrowings");
  const repaid = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM borrowing_repayments");
  const book = money(saleCash + buyerAdv + partnerAdv - vendorPaid - expenses - labourCash - partnerSettled + borrowed - repaid);

  const partners = ACCOUNT_PERSONS.map((person) => {
    const received = sumSql(
      "SELECT COALESCE(SUM(amount),0) as n FROM sale_payments WHERE received_by=? AND COALESCE(payment_mode,'')<>'Advance'",
      person
    ) + sumSql("SELECT COALESCE(SUM(amount),0) as n FROM buyer_advances WHERE received_by=?", person)
      + sumSql("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances WHERE COALESCE(NULLIF(held_by,''),person)=?", person);
    const settled = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM partner_settlements WHERE person=?", person);
    const lent = sumSql("SELECT COALESCE(SUM(amount),0) as n FROM partner_advances WHERE person=?", person);
    return { person, cashTouchesApprox: money(received), settled: money(settled), lentToCompany: money(lent) };
  });

  return {
    companyBookApprox: book,
    parts: {
      salesReceived: money(saleCash),
      buyerAdvances: money(buyerAdv),
      partnerAdvances: money(partnerAdv),
      vendorPayments: money(vendorPaid),
      otherExpenses: money(expenses),
      labourCash: money(labourCash),
      partnerSettled: money(partnerSettled),
      borrowed: money(borrowed),
      loanRepaid: money(repaid),
    },
    partners,
    note: "Approximate company cash book from portal ledgers. Prefer Accounts page for exact reconciliation.",
  };
}

export function getSalesReport(opts: { mode?: string; from?: string; to?: string; limit?: number } = {}) {
  const mode = opts.mode === "PLASTIC" || opts.mode === "PET" ? opts.mode : null;
  const from = opts.from || "2000-01-01";
  const to = opts.to || "2999-12-31";
  const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
  const rows = mode
    ? sqlite.prepare(`
        SELECT id, mode, customer_name, quantity_kg, gross_amount, labour_charges, loading_charges,
               total_amount, received_amount, credit_amount, sale_date, COALESCE(labour_mode,'CONTRACT') as labour_mode
        FROM sales WHERE mode=? AND sale_date BETWEEN ? AND ?
        ORDER BY sale_date DESC, id DESC LIMIT ?
      `).all(mode, from, to, limit)
    : sqlite.prepare(`
        SELECT id, mode, customer_name, quantity_kg, gross_amount, labour_charges, loading_charges,
               total_amount, received_amount, credit_amount, sale_date, COALESCE(labour_mode,'CONTRACT') as labour_mode
        FROM sales WHERE sale_date BETWEEN ? AND ?
        ORDER BY sale_date DESC, id DESC LIMIT ?
      `).all(from, to, limit);

  const totals = mode
    ? (sqlite.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount),0) as revenue, COALESCE(SUM(quantity_kg),0) as kg,
               COALESCE(SUM(received_amount),0) as received, COALESCE(SUM(credit_amount),0) as pending
        FROM sales WHERE mode=? AND sale_date BETWEEN ? AND ?
      `).get(mode, from, to) as any)
    : (sqlite.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount),0) as revenue, COALESCE(SUM(quantity_kg),0) as kg,
               COALESCE(SUM(received_amount),0) as received, COALESCE(SUM(credit_amount),0) as pending
        FROM sales WHERE sale_date BETWEEN ? AND ?
      `).get(from, to) as any);

  return {
    filter: { mode: mode || "ALL", from, to },
    summary: {
      salesCount: n(totals.cnt),
      revenue: money(n(totals.revenue)),
      kg: money(n(totals.kg)),
      received: money(n(totals.received)),
      pending: money(n(totals.pending)),
    },
    recent: rows,
  };
}

export function getPurchasesReport(opts: { mode?: string; from?: string; to?: string; limit?: number } = {}) {
  const mode = opts.mode === "PLASTIC" || opts.mode === "PET" ? opts.mode : null;
  const from = opts.from || "2000-01-01";
  const to = opts.to || "2999-12-31";
  const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
  const rows = mode
    ? sqlite.prepare(`
        SELECT p.id, p.mode, p.material_name, p.quantity_kg, p.rate_per_kg, p.total_amount, p.paid_amount, p.credit_amount,
               p.purchase_date, s.name as vendor
        FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.mode=? AND p.purchase_date BETWEEN ? AND ?
        ORDER BY p.purchase_date DESC, p.id DESC LIMIT ?
      `).all(mode, from, to, limit)
    : sqlite.prepare(`
        SELECT p.id, p.mode, p.material_name, p.quantity_kg, p.rate_per_kg, p.total_amount, p.paid_amount, p.credit_amount,
               p.purchase_date, s.name as vendor
        FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.purchase_date BETWEEN ? AND ?
        ORDER BY p.purchase_date DESC, p.id DESC LIMIT ?
      `).all(from, to, limit);

  const dues = sqlite.prepare(`
    SELECT s.name as vendor, p.mode, ROUND(SUM(p.credit_amount),2) as unpaid
    FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.credit_amount > 0.005
    GROUP BY s.id, p.mode
    ORDER BY unpaid DESC LIMIT 20
  `).all();

  return { filter: { mode: mode || "ALL", from, to }, recent: rows, vendorDues: dues };
}

export function getLabourOverview(mode?: string) {
  const m = mode === "PLASTIC" || mode === "PET" ? mode : null;
  const workers = m
    ? sqlite.prepare("SELECT id, name, daily_rate, half_day_rate, active FROM manual_labour_workers ORDER BY active DESC, name").all()
    : sqlite.prepare("SELECT id, name, daily_rate, half_day_rate, active FROM manual_labour_workers ORDER BY active DESC, name").all();

  const recent = m
    ? sqlite.prepare(`
        SELECT ml.payment_date, ml.payment_kind, ml.attendance_type, ml.hours, ml.amount, ml.task_type, ml.paid_by, w.name as worker, ml.mode
        FROM processing_manual_labour ml JOIN manual_labour_workers w ON w.id=ml.worker_id
        WHERE ml.mode=?
        ORDER BY ml.payment_date DESC, ml.id DESC LIMIT 40
      `).all(m)
    : sqlite.prepare(`
        SELECT ml.payment_date, ml.payment_kind, ml.attendance_type, ml.hours, ml.amount, ml.task_type, ml.paid_by, w.name as worker, ml.mode
        FROM processing_manual_labour ml JOIN manual_labour_workers w ON w.id=ml.worker_id
        ORDER BY ml.payment_date DESC, ml.id DESC LIMIT 40
      `).all();

  const cashPaid = m
    ? sumSql(`
        SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour
        WHERE mode=? AND COALESCE(NULLIF(payment_kind,''),'WAGE') IN ('WAGE','ADVANCE')
      `, m)
    : sumSql(`
        SELECT COALESCE(SUM(amount),0) as n FROM processing_manual_labour
        WHERE COALESCE(NULLIF(payment_kind,''),'WAGE') IN ('WAGE','ADVANCE')
      `);

  return {
    mode: m || "ALL",
    workers,
    labourCashPaid: money(cashPaid),
    recentEntries: recent,
    note: "Daily-wage PET sales do not deduct ₹2/kg; wages are paid here in Labour Management.",
  };
}

export function getProfitSnapshot(mode: "PET" | "PLASTIC" = "PET", from = "2000-01-01", to = "2999-12-31") {
  const purchases = sumSql("SELECT COALESCE(SUM(total_amount),0) as n FROM purchases WHERE mode=? AND purchase_date BETWEEN ? AND ?", mode, from, to);
  const revenue = sumSql("SELECT COALESCE(SUM(total_amount),0) as n FROM sales WHERE mode=? AND sale_date BETWEEN ? AND ?", mode, from, to);
  const soldKg = sumSql("SELECT COALESCE(SUM(quantity_kg),0) as n FROM sales WHERE mode=? AND sale_date BETWEEN ? AND ?", mode, from, to);
  const purchasedKg = sumSql("SELECT COALESCE(SUM(quantity_kg),0) as n FROM purchases WHERE mode=? AND purchase_date BETWEEN ? AND ?", mode, from, to);
  const expenses = sumSql(`
    SELECT COALESCE(SUM(amount),0) as n FROM other_expenses
    WHERE mode=? AND (
      (expense_type='Electricity' AND billing_month BETWEEN substr(?,1,7) AND substr(?,1,7))
      OR (expense_type!='Electricity' AND expense_date BETWEEN ? AND ?)
    )
  `, mode, from, to, from, to);
  const shared = sumSql(`
    SELECT COALESCE(SUM(amount),0) as n FROM other_expenses
    WHERE mode='SHARED' AND (
      (expense_type='Electricity' AND billing_month BETWEEN substr(?,1,7) AND substr(?,1,7))
      OR (expense_type!='Electricity' AND expense_date BETWEEN ? AND ?)
    )
  `, from, to, from, to);
  const labourChargesOnSales = sumSql(
    "SELECT COALESCE(SUM(labour_charges),0) as n FROM sales WHERE mode=? AND sale_date BETWEEN ? AND ?",
    mode, from, to
  );
  const roughGross = money(revenue - purchases - expenses - shared * 0.5 - labourChargesOnSales);

  return {
    mode,
    period: { from, to },
    revenue: money(revenue),
    purchaseCost: money(purchases),
    modeExpenses: money(expenses),
    sharedExpensesHalfForSketch: money(shared * 0.5),
    labourChargesDeductedOnSales: money(labourChargesOnSales),
    soldKg: money(soldKg),
    purchasedKg: money(purchasedKg),
    roughProfitSketch: roughGross,
    disclaimer:
      "Rough sketch only. For exact PET cost/kg and shared electricity allocation open Material & Profit Analysis.",
  };
}

export function getBuyersAndVendors() {
  const buyers = sqlite.prepare(`
    SELECT mode, name, phone, location FROM buyers WHERE active=1 ORDER BY name COLLATE NOCASE LIMIT 100
  `).all();
  const vendors = sqlite.prepare(`
    SELECT id, name, phone, location FROM suppliers ORDER BY name COLLATE NOCASE LIMIT 100
  `).all();
  const buyerAdvances = sumSql("SELECT COALESCE(SUM(amount-used_amount),0) as n FROM buyer_advances");
  const vendorAdvances = sumSql("SELECT COALESCE(SUM(amount-used_amount),0) as n FROM vendor_advances");
  return {
    buyers,
    vendors,
    buyerAdvanceBalance: money(buyerAdvances),
    vendorAdvanceBalance: money(vendorAdvances),
  };
}

export function searchPortal(query: string) {
  const q = `%${query.trim()}%`;
  if (query.trim().length < 2) return { error: "Query too short" };
  const sales = sqlite.prepare(`
    SELECT id, mode, customer_name, total_amount, sale_date FROM sales
    WHERE customer_name LIKE ? OR notes LIKE ? OR phone LIKE ?
    ORDER BY sale_date DESC LIMIT 15
  `).all(q, q, q);
  const purchases = sqlite.prepare(`
    SELECT p.id, p.mode, p.material_name, p.total_amount, p.purchase_date, s.name as vendor
    FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.material_name LIKE ? OR p.notes LIKE ? OR s.name LIKE ?
    ORDER BY p.purchase_date DESC LIMIT 15
  `).all(q, q, q);
  const buyers = sqlite.prepare(`
    SELECT mode, name, phone, location FROM buyers WHERE name LIKE ? OR phone LIKE ? OR location LIKE ? LIMIT 15
  `).all(q, q, q);
  const vendors = sqlite.prepare(`
    SELECT name, phone, location FROM suppliers WHERE name LIKE ? OR phone LIKE ? OR location LIKE ? LIMIT 15
  `).all(q, q, q);
  const workers = sqlite.prepare(`
    SELECT name, daily_rate, active FROM manual_labour_workers WHERE name LIKE ? LIMIT 15
  `).all(q);
  return { query, sales, purchases, buyers, vendors, workers };
}

export async function searchWeb(query: string) {
  const q = query.trim();
  if (q.length < 2) return { error: "Query too short" };
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Navrit-Navi/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { error: `Web search failed (${res.status})`, query: q };
    const data = await res.json() as any;
    const related = Array.isArray(data.RelatedTopics)
      ? data.RelatedTopics.slice(0, 6).map((t: any) => ({
          text: t.Text || t.Name || "",
          url: t.FirstURL || "",
        })).filter((t: any) => t.text)
      : [];
    return {
      query: q,
      heading: data.Heading || "",
      abstract: data.AbstractText || "",
      abstractSource: data.AbstractSource || "",
      abstractUrl: data.AbstractURL || "",
      answer: data.Answer || "",
      related,
      note: "Internet snippets from DuckDuckGo. Verify important facts before business decisions.",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Web search unavailable",
      query: q,
      tip: "Portal answers still work offline. Internet needs outbound network access.",
    };
  }
}
