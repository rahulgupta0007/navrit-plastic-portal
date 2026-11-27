import type { DatabaseSync } from "node:sqlite";

/**
 * NAVRIT 2.0 schema, applied only to the separate navrit2.db file (see business-db.ts).
 * The PET / Plastic database is never opened from here.
 */

export function ensureBusinessSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nv_parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'both' CHECK(kind IN ('supplier','customer','both')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      grp TEXT NOT NULL DEFAULT 'PLASTIC' CHECK(grp IN ('PET','PLASTIC','OTHER')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inv_date TEXT NOT NULL,
      investor TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      kind TEXT NOT NULL DEFAULT 'equity' CHECK(kind IN ('equity','loan','drawing')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_date TEXT NOT NULL,
      party_id INTEGER NOT NULL REFERENCES nv_parties(id),
      transport REAL NOT NULL DEFAULT 0,
      loading REAL NOT NULL DEFAULT 0,
      other_charges REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_purchase_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES nv_purchases(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES nv_materials(id),
      kg REAL NOT NULL CHECK(kg > 0),
      rate REAL NOT NULL CHECK(rate >= 0),
      line_cost REAL NOT NULL,
      alloc_charges REAL NOT NULL DEFAULT 0,
      landed_per_kg REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_stock_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_line_id INTEGER NOT NULL UNIQUE REFERENCES nv_purchase_lines(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES nv_materials(id),
      lot_date TEXT NOT NULL,
      kg_in REAL NOT NULL,
      kg_left REAL NOT NULL,
      cost_per_kg REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT NOT NULL,
      party_id INTEGER NOT NULL REFERENCES nv_parties(id),
      gst_percent REAL NOT NULL DEFAULT 0,
      gst_amount REAL NOT NULL DEFAULT 0,
      side_costs REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_sale_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES nv_sales(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES nv_materials(id),
      kg REAL NOT NULL CHECK(kg > 0),
      rate REAL NOT NULL CHECK(rate >= 0),
      amount REAL NOT NULL,
      cogs REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS nv_lot_consumption (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_line_id INTEGER NOT NULL REFERENCES nv_sale_lines(id) ON DELETE CASCADE,
      lot_id INTEGER NOT NULL REFERENCES nv_stock_lots(id),
      kg REAL NOT NULL,
      cost REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exp_date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nv_cash_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      amount REAL NOT NULL CHECK(amount > 0),
      ref_type TEXT NOT NULL DEFAULT '',
      ref_id INTEGER,
      party_id INTEGER,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS nv_purchase_lines_purchase_idx ON nv_purchase_lines(purchase_id);
    CREATE INDEX IF NOT EXISTS nv_stock_lots_material_idx ON nv_stock_lots(material_id, lot_date, id);
    CREATE INDEX IF NOT EXISTS nv_sale_lines_sale_idx ON nv_sale_lines(sale_id);
    CREATE INDEX IF NOT EXISTS nv_lot_consumption_line_idx ON nv_lot_consumption(sale_line_id);
    CREATE INDEX IF NOT EXISTS nv_lot_consumption_lot_idx ON nv_lot_consumption(lot_id);
    CREATE INDEX IF NOT EXISTS nv_cash_ref_idx ON nv_cash_ledger(ref_type, ref_id);
    CREATE INDEX IF NOT EXISTS nv_cash_date_idx ON nv_cash_ledger(entry_date, id);
  `);
}
