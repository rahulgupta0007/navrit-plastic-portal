import type { DatabaseSync } from "node:sqlite";

/**
 * Remove sample rows previously inserted into the LIVE database by the first
 * demo-seed implementation. Safe patterns only (Demo* names / DEMO notes).
 * Does not change company_balances (those may need a manual check / backup restore).
 */
export function purgeDemoPollutionFromLiveDb(db: DatabaseSync): { purged: boolean; detail: string } {
  let marker = false;
  try {
    const row = db
      .prepare("SELECT value_en FROM site_content WHERE key = ?")
      .get("demo_business_seeded") as { value_en?: string } | undefined;
    marker = row?.value_en === "1";
  } catch {
    /* ignore */
  }

  const demoSupplierCount = Number(
    (
      db
        .prepare("SELECT COUNT(*) AS c FROM suppliers WHERE name LIKE 'Demo %' OR notes LIKE 'DEMO%'")
        .get() as { c?: number } | undefined
    )?.c || 0
  );

  if (!marker && demoSupplierCount === 0) {
    return { purged: false, detail: "nothing-to-purge" };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    // Sales stack
    db.exec(`
      DELETE FROM sale_payments
      WHERE sale_id IN (
        SELECT id FROM sales
        WHERE notes LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
      )
    `);
    db.exec(`
      DELETE FROM sale_items
      WHERE sale_id IN (
        SELECT id FROM sales
        WHERE notes LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
      )
    `);
    db.exec(`
      DELETE FROM sale_processing_costs
      WHERE sale_id IN (
        SELECT id FROM sales
        WHERE notes LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
      )
    `);
    db.exec(`
      DELETE FROM inventory_transactions
      WHERE sale_id IN (
        SELECT id FROM sales
        WHERE notes LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
      )
      OR notes LIKE 'DEMO%'
      OR notes LIKE 'PRE-STOCK — DEMO%'
      OR notes LIKE 'SALE #%Demo%'
      OR material_name LIKE 'Demo %'
    `);
    db.exec(`DELETE FROM sales WHERE notes LIKE 'DEMO%' OR customer_name LIKE 'Demo %'`);

    // Purchases / vendors
    db.exec(`
      DELETE FROM vendor_payments
      WHERE notes LIKE 'DEMO%'
         OR supplier_id IN (SELECT id FROM suppliers WHERE name LIKE 'Demo %' OR notes LIKE 'DEMO%')
         OR purchase_id IN (SELECT id FROM purchases WHERE notes LIKE 'DEMO%')
    `);
    db.exec(`
      DELETE FROM inventory_transactions
      WHERE purchase_id IN (SELECT id FROM purchases WHERE notes LIKE 'DEMO%')
    `);
    db.exec(`DELETE FROM purchases WHERE notes LIKE 'DEMO%'`);
    db.exec(`DELETE FROM vendor_advances WHERE supplier_id IN (SELECT id FROM suppliers WHERE name LIKE 'Demo %' OR notes LIKE 'DEMO%')`);
    db.exec(`DELETE FROM suppliers WHERE name LIKE 'Demo %' OR notes LIKE 'DEMO%'`);

    // Expenses / labour / partners / buyers / plastic types
    db.exec(`DELETE FROM other_expenses WHERE description LIKE 'DEMO%'`);
    db.exec(`
      DELETE FROM processing_manual_labour
      WHERE notes LIKE 'DEMO%'
         OR worker_id IN (SELECT id FROM manual_labour_workers WHERE name LIKE 'Demo %')
    `);
    db.exec(`DELETE FROM manual_labour_workers WHERE name LIKE 'Demo %'`);
    db.exec(`DELETE FROM partner_advances WHERE notes LIKE 'DEMO%'`);
    try {
      db.exec(`DELETE FROM buyers WHERE name LIKE 'Demo %' OR notes LIKE 'DEMO%'`);
    } catch {
      /* ignore */
    }
    try {
      db.exec(`DELETE FROM plastic_material_types WHERE name LIKE 'Demo %' OR notes LIKE 'Sample plastic%'`);
    } catch {
      /* ignore */
    }

    db.exec(`DELETE FROM site_content WHERE key = 'demo_business_seeded'`);
    db.exec("COMMIT");
    return { purged: true, detail: "removed-demo-rows-from-live-db" };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    return {
      purged: false,
      detail: error instanceof Error ? error.message : "purge-failed",
    };
  }
}
