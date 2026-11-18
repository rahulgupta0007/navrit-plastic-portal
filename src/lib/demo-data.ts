import type { DatabaseSync } from "node:sqlite";

export const DEMO_USERNAME = (process.env.DEMO_USERNAME || "demo").trim() || "demo";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo123";

const MARKER_KEY = "demo_business_seeded";

function todayOffset(daysAgo: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function monthOffset(monthsAgo: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 7);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Idempotent sample ledger so the demo login has something to browse.
 * Safe on production: skips if already seeded. Does not delete real rows.
 */
export function ensureDemoBusinessData(db: DatabaseSync): { seeded: boolean; reason: string } {
  try {
    const marker = db
      .prepare("SELECT value_en FROM site_content WHERE key = ?")
      .get(MARKER_KEY) as { value_en?: string } | undefined;
    if (marker?.value_en === "1") {
      return { seeded: false, reason: "already-seeded" };
    }
  } catch {
    /* site_content may be missing briefly */
  }

  const ts = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Re-check inside txn
    const marker = db
      .prepare("SELECT value_en FROM site_content WHERE key = ?")
      .get(MARKER_KEY) as { value_en?: string } | undefined;
    if (marker?.value_en === "1") {
      db.exec("COMMIT");
      return { seeded: false, reason: "already-seeded" };
    }

    // Plastic material types
    try {
      db.prepare(
        `INSERT OR IGNORE INTO plastic_material_types (mode, name, active, sort_order, notes, created_at, updated_at)
         VALUES ('PLASTIC', ?, 1, ?, ?, ?, ?)`
      ).run("Demo HDPE Grind", 1, "Sample plastic type", ts, ts);
      db.prepare(
        `INSERT OR IGNORE INTO plastic_material_types (mode, name, active, sort_order, notes, created_at, updated_at)
         VALUES ('PLASTIC', ?, 1, ?, ?, ?, ?)`
      ).run("Demo PP Regrind", 2, "Sample plastic type", ts, ts);
    } catch {
      /* table may differ */
    }

    // Suppliers
    const insertSupplier = db.prepare(
      `INSERT INTO suppliers (name, phone, location, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    );
    const supplierPet = Number(
      insertSupplier.run("Demo Baheri Scrap Yard", "9876500001", "Baheri, Bareilly", "DEMO vendor — PET bottles", ts, ts)
        .lastInsertRowid
    );
    const supplierPlastic = Number(
      insertSupplier.run("Demo Plastic Trader Co", "9876500002", "Bareilly", "DEMO vendor — plastic grind", ts, ts)
        .lastInsertRowid
    );

    // Buyers
    try {
      const insertBuyer = db.prepare(
        `INSERT OR IGNORE INTO buyers (mode, name, phone, location, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      );
      insertBuyer.run("PET", "Demo Recycle Mart", "9876500011", "Rudrapur", "DEMO buyer", ts, ts);
      insertBuyer.run("PLASTIC", "Demo Flake Buyer", "9876500012", "Kanpur", "DEMO buyer", ts, ts);
    } catch {
      /* buyers table optional on very old DBs */
    }

    // Company balances
    try {
      db.prepare(
        `INSERT INTO company_balances (mode, opening_balance, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(mode) DO UPDATE SET opening_balance = excluded.opening_balance, updated_at = excluded.updated_at`
      ).run("PET", 50000, ts);
      db.prepare(
        `INSERT INTO company_balances (mode, opening_balance, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(mode) DO UPDATE SET opening_balance = excluded.opening_balance, updated_at = excluded.updated_at`
      ).run("PLASTIC", 25000, ts);
    } catch {
      /* ignore */
    }

    // Pre-stock / opening inventory
    const insertInv = db.prepare(
      `INSERT INTO inventory_transactions
       (mode, material_id, material_name, transaction_type, quantity_kg, amount, purchase_id, sale_id, transaction_date, notes, created_at)
       VALUES (?, NULL, ?, 'ADJUSTMENT', ?, ?, NULL, NULL, ?, ?, ?)`
    );
    insertInv.run(
      "PET",
      "Natural Bottles - Green",
      1200,
      36000,
      todayOffset(40),
      "PRE-STOCK — DEMO opening stock @ ₹30/kg",
      ts
    );
    insertInv.run(
      "PET",
      "Natural Bottles - White",
      800,
      28000,
      todayOffset(40),
      "PRE-STOCK — DEMO opening stock @ ₹35/kg",
      ts
    );
    insertInv.run(
      "PLASTIC",
      "Demo HDPE Grind",
      500,
      20000,
      todayOffset(35),
      "PRE-STOCK — DEMO opening stock @ ₹40/kg",
      ts
    );

    // Purchases
    const insertPurchase = db.prepare(
      `INSERT INTO purchases
       (mode, material_id, material_name, supplier_id, purchase_type, quantity_kg, rate_per_kg,
        total_amount, paid_amount, credit_amount, lender_id, borrowing_id, purchase_date, notes, paid_by,
        transport_charges, weight_charges, labour_charges, material_variant, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    );

    const petPurchaseQty = 450;
    const petRate = 32;
    const petTotal = petPurchaseQty * petRate;
    const petPurchaseId = Number(
      insertPurchase.run(
        "PET",
        "Natural Bottles",
        supplierPet,
        "NORMAL",
        petPurchaseQty,
        petRate,
        petTotal,
        petTotal,
        0,
        todayOffset(12),
        "DEMO purchase — Natural Green bottles",
        "Rahul",
        800,
        300,
        "Green",
        ts,
        ts
      ).lastInsertRowid
    );
    insertInv.run(
      "PET",
      "Natural Bottles - Green",
      petPurchaseQty,
      petTotal,
      todayOffset(12),
      `DEMO purchase #${petPurchaseId}`,
      ts
    );
    try {
      db.prepare(
        `UPDATE inventory_transactions SET purchase_id = ? WHERE notes = ?`
      ).run(petPurchaseId, `DEMO purchase #${petPurchaseId}`);
    } catch {
      /* ignore */
    }

    const plasticPurchaseQty = 300;
    const plasticRate = 38;
    const plasticTotal = plasticPurchaseQty * plasticRate;
    const plasticPurchaseId = Number(
      insertPurchase.run(
        "PLASTIC",
        "Demo HDPE Grind",
        supplierPlastic,
        "SUPPLIER_CREDIT",
        plasticPurchaseQty,
        plasticRate,
        plasticTotal,
        5000,
        plasticTotal - 5000,
        todayOffset(8),
        "DEMO purchase — plastic grind on credit",
        "Devesh",
        500,
        0,
        "",
        ts,
        ts
      ).lastInsertRowid
    );
    insertInv.run(
      "PLASTIC",
      "Demo HDPE Grind",
      plasticPurchaseQty,
      plasticTotal,
      todayOffset(8),
      `DEMO purchase #${plasticPurchaseId}`,
      ts
    );

    // Vendor payment for PET purchase
    try {
      db.prepare(
        `INSERT INTO vendor_payments
         (mode, supplier_id, purchase_id, payment_type, amount, payment_date, payment_mode, notes, created_at, paid_by, funding_source)
         VALUES (?, ?, ?, 'PURCHASE', ?, ?, 'Cash', ?, ?, ?, 'COMPANY')`
      ).run("PET", supplierPet, petPurchaseId, petTotal, todayOffset(12), "DEMO full payment", ts, "Rahul");
    } catch {
      db.prepare(
        `INSERT INTO vendor_payments
         (mode, supplier_id, purchase_id, payment_type, amount, payment_date, payment_mode, notes, created_at)
         VALUES (?, ?, ?, 'PURCHASE', ?, ?, 'Cash', ?, ?)`
      ).run("PET", supplierPet, petPurchaseId, petTotal, todayOffset(12), "DEMO full payment", ts);
    }

    // Sales
    const saleQty = 200;
    const saleRate = 48;
    const gross = saleQty * saleRate;
    const labour = saleQty * 2;
    const loading = 400;
    const net = gross - labour - loading;
    const insertSale = db.prepare(
      `INSERT INTO sales
       (mode, customer_name, phone, location, material_category, material_variant, quantity_kg, rate_per_kg,
        total_amount, gross_amount, labour_charges, loading_charges, labour_mode, received_amount, credit_amount,
        sale_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONTRACT', ?, ?, ?, ?, ?, ?)`
    );
    const saleId = Number(
      insertSale.run(
        "PET",
        "Demo Recycle Mart",
        "9876500011",
        "Rudrapur",
        "Natural Bottles",
        "Green",
        saleQty,
        saleRate,
        net,
        gross,
        labour,
        loading,
        net - 5000,
        5000,
        todayOffset(5),
        "DEMO sale — partial received",
        ts,
        ts
      ).lastInsertRowid
    );
    try {
      db.prepare(
        `INSERT INTO sale_items (sale_id, material_category, material_variant, quantity_kg, rate_per_kg, amount)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(saleId, "Natural Bottles", "Green", saleQty, saleRate, gross);
    } catch {
      /* ignore */
    }
    insertInv.run(
      "PET",
      "Natural Bottles - Green",
      -saleQty,
      -net,
      todayOffset(5),
      `SALE #${saleId}`,
      ts
    );
    try {
      db.prepare(`UPDATE inventory_transactions SET sale_id = ? WHERE notes = ?`).run(saleId, `SALE #${saleId}`);
    } catch {
      /* ignore */
    }
    try {
      db.prepare(
        `INSERT INTO sale_payments (mode, sale_id, amount, payment_date, payment_mode, received_by, notes, created_at)
         VALUES (?, ?, ?, ?, 'Cash', ?, ?, ?)`
      ).run("PET", saleId, net - 5000, todayOffset(5), "Nitin", "DEMO sale receipt", ts);
    } catch {
      /* ignore */
    }

    // Business expenses
    const insertExpense = db.prepare(
      `INSERT INTO other_expenses
       (mode, purchase_id, expense_type, description, amount, expense_date, created_at,
        expense_frequency, paid_by, billing_month, billing_start_date, billing_end_date, funding_source)
       VALUES (?, NULL, ?, ?, ?, ?, ?, 'ONE_TIME', ?, ?, ?, ?, ?)`
    );
    const billMonth = monthOffset(0);
    insertExpense.run(
      "SHARED",
      "Electricity",
      "DEMO — both machines power bill",
      8500,
      todayOffset(3),
      ts,
      "Rahul",
      billMonth,
      `${billMonth}-01`,
      todayOffset(1),
      "COMPANY"
    );
    insertExpense.run(
      "PET",
      "Thread",
      "DEMO — baling thread",
      1200,
      todayOffset(6),
      ts,
      "Devesh",
      "",
      "",
      "",
      "COMPANY"
    );
    insertExpense.run(
      "SHARED",
      "WIFI",
      "DEMO — office internet",
      999,
      todayOffset(2),
      ts,
      "Nitin",
      "",
      "",
      "",
      "COMPANY"
    );
    insertExpense.run(
      "PET",
      "Other",
      "DEMO — outside loading labour",
      300,
      todayOffset(4),
      ts,
      "Rahul",
      "",
      "",
      "",
      "COMPANY"
    );

    // Labour workers + attendance
    try {
      const insertWorker = db.prepare(
        `INSERT OR IGNORE INTO manual_labour_workers
         (name, active, created_at, updated_at, daily_rate, half_day_rate, pay_model)
         VALUES (?, 1, ?, ?, ?, ?, 'DAILY')`
      );
      insertWorker.run("Demo Worker Ramesh", ts, ts, 450, 225);
      insertWorker.run("Demo Worker Suresh", ts, ts, 400, 200);
      const w1 = db
        .prepare("SELECT id FROM manual_labour_workers WHERE name = ?")
        .get("Demo Worker Ramesh") as { id: number } | undefined;
      const w2 = db
        .prepare("SELECT id FROM manual_labour_workers WHERE name = ?")
        .get("Demo Worker Suresh") as { id: number } | undefined;
      if (w1?.id) {
        db.prepare(
          `INSERT INTO processing_manual_labour
           (mode, batch_id, worker_id, amount, payment_date, paid_by, notes, created_at, task_type,
            attendance_type, hours, payment_kind, funding_source)
           VALUES ('PET', NULL, ?, ?, ?, 'Rahul', 'DEMO full day', ?, 'Cap removal', 'FULL', 9, 'ATTENDANCE', 'COMPANY')`
        ).run(w1.id, 450, todayOffset(1), ts);
      }
      if (w2?.id) {
        db.prepare(
          `INSERT INTO processing_manual_labour
           (mode, batch_id, worker_id, amount, payment_date, paid_by, notes, created_at, task_type,
            attendance_type, hours, payment_kind, funding_source)
           VALUES ('PET', NULL, ?, ?, ?, 'Devesh', 'DEMO half day', ?, 'Sorting', 'HALF', 4.5, 'ATTENDANCE', 'COMPANY')`
        ).run(w2.id, 200, todayOffset(1), ts);
      }
    } catch {
      /* labour schema variants */
    }

    // Partner advance sample
    try {
      db.prepare(
        `INSERT INTO partner_advances (mode, person, held_by, amount, advance_date, notes, created_at)
         VALUES ('PET', 'Rahul', 'Rahul', 5000, ?, 'DEMO partner advance for cash float', ?)`
      ).run(todayOffset(20), ts);
    } catch {
      /* ignore */
    }

    db.prepare(
      `INSERT OR REPLACE INTO site_content (key, value_en, value_hi, updated_at) VALUES (?, '1', '1', ?)`
    ).run(MARKER_KEY, ts);

    db.exec("COMMIT");
    return { seeded: true, reason: "ok" };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("[navrit] demo data seed failed", error);
    return {
      seeded: false,
      reason: error instanceof Error ? error.message : "seed-failed",
    };
  }
}

export function isDemoCredentials(username: string, password: string) {
  const u = username.trim();
  const p = password;
  if (!DEMO_USERNAME || !DEMO_PASSWORD) return false;
  return u === DEMO_USERNAME && p === DEMO_PASSWORD;
}
