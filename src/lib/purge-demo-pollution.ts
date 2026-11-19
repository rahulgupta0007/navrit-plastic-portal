import type { DatabaseSync } from "node:sqlite";

/**
 * Remove ONLY demo-seeded sample rows from the live company database.
 * Matches Demo* names and DEMO notes from the temporary demo feature.
 * Never deletes other real vendor/worker/purchase rows.
 */
export function purgeDemoPollutionFromLiveDb(db: DatabaseSync): {
  purged: boolean;
  detail: string;
  removed: Record<string, number>;
} {
  const removed: Record<string, number> = {};
  const count = (sql: string) =>
    Number((db.prepare(sql).get() as { c?: number } | undefined)?.c || 0);

  const before =
    count("SELECT COUNT(*) AS c FROM suppliers WHERE name LIKE 'Demo %' OR IFNULL(notes,'') LIKE 'DEMO%'") +
    count("SELECT COUNT(*) AS c FROM manual_labour_workers WHERE name LIKE 'Demo %'") +
    count("SELECT COUNT(*) AS c FROM purchases WHERE IFNULL(notes,'') LIKE 'DEMO%' OR material_name LIKE 'Demo %'") +
    count("SELECT COUNT(*) AS c FROM other_expenses WHERE IFNULL(description,'') LIKE 'DEMO%'") +
    count("SELECT COUNT(*) AS c FROM plastic_material_types WHERE name LIKE 'Demo %'");

  if (before === 0) {
    try {
      db.prepare("DELETE FROM site_content WHERE key = ?").run("demo_business_seeded");
    } catch {
      /* ignore */
    }
    return { purged: false, detail: "nothing-to-purge", removed };
  }

  const del = (label: string, sql: string) => {
    try {
      const r = db.prepare(sql).run();
      removed[label] = Number(r.changes || 0);
    } catch {
      removed[label] = 0;
    }
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    // Sales stack tied to demo customers / notes
    del(
      "sale_payments",
      `DELETE FROM sale_payments WHERE sale_id IN (
         SELECT id FROM sales WHERE IFNULL(notes,'') LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
       )`
    );
    del(
      "sale_items",
      `DELETE FROM sale_items WHERE sale_id IN (
         SELECT id FROM sales WHERE IFNULL(notes,'') LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
       )`
    );
    del(
      "sale_processing_costs",
      `DELETE FROM sale_processing_costs WHERE sale_id IN (
         SELECT id FROM sales WHERE IFNULL(notes,'') LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
       )`
    );
    del(
      "inventory_sale",
      `DELETE FROM inventory_transactions WHERE sale_id IN (
         SELECT id FROM sales WHERE IFNULL(notes,'') LIKE 'DEMO%' OR customer_name LIKE 'Demo %'
       )`
    );
    del(
      "sales",
      `DELETE FROM sales WHERE IFNULL(notes,'') LIKE 'DEMO%' OR customer_name LIKE 'Demo %'`
    );

    // Purchases / vendor payments for demo suppliers or demo materials
    del(
      "vendor_payments",
      `DELETE FROM vendor_payments WHERE
         IFNULL(notes,'') LIKE 'DEMO%'
         OR supplier_id IN (SELECT id FROM suppliers WHERE name LIKE 'Demo %' OR IFNULL(notes,'') LIKE 'DEMO%')
         OR purchase_id IN (
           SELECT id FROM purchases
           WHERE IFNULL(notes,'') LIKE 'DEMO%' OR material_name LIKE 'Demo %'
         )`
    );
    del(
      "inventory_purchase",
      `DELETE FROM inventory_transactions WHERE
         purchase_id IN (
           SELECT id FROM purchases
           WHERE IFNULL(notes,'') LIKE 'DEMO%' OR material_name LIKE 'Demo %'
         )
         OR IFNULL(notes,'') LIKE 'DEMO%'
         OR IFNULL(notes,'') LIKE 'PRE-STOCK — DEMO%'
         OR material_name LIKE 'Demo %'`
    );
    del(
      "purchases",
      `DELETE FROM purchases WHERE IFNULL(notes,'') LIKE 'DEMO%' OR material_name LIKE 'Demo %'`
    );
    del(
      "vendor_advances",
      `DELETE FROM vendor_advances WHERE supplier_id IN (
         SELECT id FROM suppliers WHERE name LIKE 'Demo %' OR IFNULL(notes,'') LIKE 'DEMO%'
       )`
    );
    del(
      "suppliers",
      `DELETE FROM suppliers WHERE name LIKE 'Demo %' OR IFNULL(notes,'') LIKE 'DEMO%'`
    );

    // Expenses / labour / partners / buyers / plastic types
    del("other_expenses", `DELETE FROM other_expenses WHERE IFNULL(description,'') LIKE 'DEMO%'`);
    del(
      "labour_rows",
      `DELETE FROM processing_manual_labour WHERE
         IFNULL(notes,'') LIKE 'DEMO%'
         OR worker_id IN (SELECT id FROM manual_labour_workers WHERE name LIKE 'Demo %')`
    );
    del("workers", `DELETE FROM manual_labour_workers WHERE name LIKE 'Demo %'`);
    del("partner_advances", `DELETE FROM partner_advances WHERE IFNULL(notes,'') LIKE 'DEMO%'`);
    del("buyers", `DELETE FROM buyers WHERE name LIKE 'Demo %' OR IFNULL(notes,'') LIKE 'DEMO%'`);
    del(
      "plastic_types",
      `DELETE FROM plastic_material_types WHERE name LIKE 'Demo %' OR IFNULL(notes,'') LIKE 'Sample plastic%'`
    );
    del("marker", `DELETE FROM site_content WHERE key = 'demo_business_seeded'`);

    db.exec("COMMIT");
    const total = Object.values(removed).reduce((n, v) => n + v, 0);
    return {
      purged: total > 0,
      detail: total > 0 ? `removed-${total}-demo-rows` : "nothing-changed",
      removed,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    return {
      purged: false,
      detail: error instanceof Error ? error.message : "purge-failed",
      removed,
    };
  }
}
