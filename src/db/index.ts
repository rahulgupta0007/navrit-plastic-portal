import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

// Production data MUST live on Railway's persistent Volume.
// The path can be overridden explicitly, but never falls back to the app's
// ephemeral filesystem in production.
const configuredDataDir = process.env.NAVRIT_DATA_DIR?.trim();
const dataDir =
  configuredDataDir ||
  (process.env.NODE_ENV === "production"
    ? "/app/data"
    : path.join(process.cwd(), "data"));

const dbPath =
  process.env.NAVRIT_DB_PATH?.trim() ||
  path.join(dataDir, "plastic-rates.db");

const globalForDb = globalThis as unknown as { __plasticDb?: DatabaseSync };

/**
 * Next.js spawns many workers during `next build` that all import API/page modules.
 * Opening the same SQLite file from those workers causes ERR_SQLITE_ERROR "database is locked".
 * Use in-memory DB for the entire build (set by npm script + fallbacks).
 */
function shouldUseMemoryDb() {
  return (
    process.env.NAVRIT_SQLITE_MEMORY === "1" ||
    process.env.npm_lifecycle_event === "build" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  );
}

function createDb() {
  const memory = shouldUseMemoryDb();

  if (!memory) {
    if (process.env.NODE_ENV === "production" && !fs.existsSync(dataDir)) {
      throw new Error(
        `Persistent data directory is unavailable: ${dataDir}. Refusing to create a new production database on ephemeral storage.`
      );
    }
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  const sqlite = new DatabaseSync(memory ? ":memory:" : dbPath);
  sqlite.exec("PRAGMA busy_timeout = 10000;");
  if (!memory) {
    try {
      sqlite.exec("PRAGMA journal_mode = WAL;");
    } catch {
      // Ignore if another process holds the lock briefly
    }
    sqlite.exec("PRAGMA synchronous = FULL;");
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      name_en TEXT NOT NULL,
      name_hi TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '₹/kg',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      rate_date TEXT NOT NULL,
      rate REAL NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rate_material_date_idx
      ON rate_snapshots(material_id, rate_date);
    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value_en TEXT NOT NULL DEFAULT '',
      value_hi TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      location TEXT NOT NULL DEFAULT '',
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendor_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      payment_type TEXT NOT NULL CHECK(payment_type IN ('ADVANCE','PURCHASE','CREDIT_SETTLEMENT','OTHER')),
      amount REAL NOT NULL CHECK(amount > 0),
      payment_date TEXT NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'Cash',
      notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vendor_payments_supplier_idx
      ON vendor_payments(supplier_id, mode, payment_date);

    CREATE TABLE IF NOT EXISTS vendor_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      amount REAL NOT NULL CHECK(amount > 0),
      used_amount REAL NOT NULL DEFAULT 0 CHECK(used_amount >= 0),
      advance_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS other_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      expense_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL CHECK(amount >= 0),
      expense_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS borrowings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      lender_id INTEGER NOT NULL REFERENCES lenders(id),
      amount REAL NOT NULL CHECK(amount > 0),
      outstanding_amount REAL NOT NULL CHECK(outstanding_amount >= 0),
      borrowing_date TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIAL','PAID')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS borrowing_repayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      borrowing_id INTEGER NOT NULL REFERENCES borrowings(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK(amount > 0),
      repayment_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      material_id INTEGER REFERENCES materials(id),
      material_name TEXT NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id),
      purchase_type TEXT NOT NULL CHECK(purchase_type IN ('NORMAL','SUPPLIER_CREDIT','BORROWED_FUND')),
      quantity_kg REAL NOT NULL CHECK(quantity_kg > 0),
      rate_per_kg REAL NOT NULL CHECK(rate_per_kg >= 0),
      total_amount REAL NOT NULL CHECK(total_amount >= 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
      credit_amount REAL NOT NULL DEFAULT 0 CHECK(credit_amount >= 0),
      lender_id INTEGER REFERENCES lenders(id),
      borrowing_id INTEGER REFERENCES borrowings(id),
      purchase_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS purchases_mode_date_idx ON purchases(mode, purchase_date);
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      material_category TEXT NOT NULL CHECK(material_category IN ('Natural Bottles','Red Bottles')),
      material_variant TEXT NOT NULL DEFAULT '',
      quantity_kg REAL NOT NULL CHECK(quantity_kg > 0),
      rate_per_kg REAL NOT NULL CHECK(rate_per_kg >= 0),
      total_amount REAL NOT NULL CHECK(total_amount >= 0),
      gross_amount REAL NOT NULL DEFAULT 0,
      labour_charges REAL NOT NULL DEFAULT 0,
      loading_charges REAL NOT NULL DEFAULT 0,
      received_amount REAL NOT NULL DEFAULT 0 CHECK(received_amount >= 0),
      credit_amount REAL NOT NULL DEFAULT 0 CHECK(credit_amount >= 0),
      sale_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sales_mode_date_idx ON sales(mode, sale_date);
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      material_category TEXT NOT NULL,
      material_variant TEXT NOT NULL DEFAULT '',
      quantity_kg REAL NOT NULL CHECK(quantity_kg > 0),
      rate_per_kg REAL NOT NULL CHECK(rate_per_kg >= 0),
      amount REAL NOT NULL CHECK(amount >= 0)
    );
    CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(sale_id);

    CREATE TABLE IF NOT EXISTS company_balances (
      mode TEXT PRIMARY KEY CHECK(mode IN ('PET','PLASTIC')),
      opening_balance REAL NOT NULL DEFAULT 0 CHECK(opening_balance >= 0),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processing_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      batch_date TEXT NOT NULL,
      total_input_kg REAL NOT NULL CHECK(total_input_kg > 0),
      labour_rate REAL NOT NULL DEFAULT 2 CHECK(labour_rate >= 0),
      labour_cost REAL NOT NULL DEFAULT 0 CHECK(labour_cost >= 0),
      status TEXT NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','SOLD','CANCELLED')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processing_batch_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER REFERENCES processing_batches(id) ON DELETE CASCADE,
      material_variant TEXT NOT NULL CHECK(material_variant IN ('Green','White','White Milk','Red')),
      quantity_kg REAL NOT NULL CHECK(quantity_kg > 0),
      bale_count INTEGER NOT NULL DEFAULT 0 CHECK(bale_count >= 0)
    );
    CREATE TABLE IF NOT EXISTS manual_labour_workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processing_manual_labour (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      batch_id INTEGER NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
      worker_id INTEGER NOT NULL REFERENCES manual_labour_workers(id),
      amount REAL NOT NULL CHECK(amount > 0),
      payment_date TEXT NOT NULL,
      paid_by TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'Manual Labour'
    );
    CREATE INDEX IF NOT EXISTS processing_manual_labour_batch_idx
      ON processing_manual_labour(batch_id, payment_date);
    CREATE TABLE IF NOT EXISTS processing_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      expense_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL CHECK(amount > 0),
      expense_date TEXT NOT NULL,
      paid_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sale_processing_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      labour_kg REAL NOT NULL CHECK(labour_kg > 0),
      labour_rate REAL NOT NULL DEFAULT 2 CHECK(labour_rate >= 0),
      labour_cost REAL NOT NULL CHECK(labour_cost >= 0),
      loading_cost REAL NOT NULL DEFAULT 0 CHECK(loading_cost >= 0),
      paid_by TEXT NOT NULL DEFAULT '',
      payment_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processing_batch_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
      material_variant TEXT NOT NULL CHECK(material_variant IN ('Green','White','White Milk','Red')),
      quantity_kg REAL NOT NULL CHECK(quantity_kg > 0),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS processing_batch_outputs_batch_idx
      ON processing_batch_outputs(batch_id);

    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_date TEXT NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'Cash',
      received_by TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sale_payments_sale_idx ON sale_payments(sale_id, payment_date);
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')),
      material_id INTEGER REFERENCES materials(id),
      material_name TEXT NOT NULL,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('PURCHASE','ADJUSTMENT')),
      quantity_kg REAL NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      purchase_id INTEGER REFERENCES purchases(id),
      sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
      transaction_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inventory_mode_material_idx
      ON inventory_transactions(mode, material_id, transaction_date);
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title_en TEXT NOT NULL,
      title_hi TEXT NOT NULL,
      excerpt_en TEXT NOT NULL DEFAULT '',
      excerpt_hi TEXT NOT NULL DEFAULT '',
      body_en TEXT NOT NULL DEFAULT '',
      body_hi TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Labour attendance does not require a processing batch. Existing databases may still have batch_id as NOT NULL.
  try {
    sqlite.exec("ALTER TABLE processing_manual_labour ADD COLUMN task_type TEXT NOT NULL DEFAULT 'Manual Labour'");
  } catch { /* task_type already exists */ }
  try {
    const info = sqlite.prepare("PRAGMA table_info(processing_manual_labour)").all() as Array<{ name: string; notnull: number }>;
    const batchColumn = info.find((column) => column.name === "batch_id");
    if (batchColumn?.notnull) {
      sqlite.exec("PRAGMA foreign_keys=OFF");
      sqlite.exec("BEGIN");
      sqlite.exec("CREATE TABLE processing_manual_labour_new (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL CHECK(mode IN ('PET','PLASTIC')), batch_id INTEGER REFERENCES processing_batches(id) ON DELETE CASCADE, worker_id INTEGER NOT NULL REFERENCES manual_labour_workers(id), amount REAL NOT NULL CHECK(amount > 0), payment_date TEXT NOT NULL, paid_by TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, task_type TEXT NOT NULL DEFAULT 'Manual Labour')");
      sqlite.exec("INSERT INTO processing_manual_labour_new (id,mode,batch_id,worker_id,amount,payment_date,paid_by,notes,created_at,task_type) SELECT id,mode,batch_id,worker_id,amount,payment_date,paid_by,notes,created_at,COALESCE(task_type,'Manual Labour') FROM processing_manual_labour");
      sqlite.exec("DROP TABLE processing_manual_labour");
      sqlite.exec("ALTER TABLE processing_manual_labour_new RENAME TO processing_manual_labour");
      sqlite.exec("CREATE INDEX IF NOT EXISTS processing_manual_labour_batch_idx ON processing_manual_labour(batch_id, payment_date)");
      sqlite.exec("COMMIT");
      sqlite.exec("PRAGMA foreign_keys=ON");
    }
  } catch (error) {
    try { sqlite.exec("ROLLBACK"); } catch {}
    try { sqlite.exec("PRAGMA foreign_keys=ON"); } catch {}
    throw error;
  }
  for (const migration of [
    "ALTER TABLE processing_batches ADD COLUMN total_output_kg REAL NOT NULL DEFAULT 0",
    "ALTER TABLE processing_batches ADD COLUMN waste_kg REAL NOT NULL DEFAULT 0",
    "ALTER TABLE processing_batches ADD COLUMN processing_cost REAL NOT NULL DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN gross_amount REAL NOT NULL DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN labour_charges REAL NOT NULL DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN loading_charges REAL NOT NULL DEFAULT 0",
    "ALTER TABLE purchases ADD COLUMN paid_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE purchases ADD COLUMN material_variant TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE purchases ADD COLUMN transport_charges REAL NOT NULL DEFAULT 0",
    "ALTER TABLE purchases ADD COLUMN weight_charges REAL NOT NULL DEFAULT 0",
    "ALTER TABLE purchases ADD COLUMN labour_charges REAL NOT NULL DEFAULT 0",
    "ALTER TABLE vendor_payments ADD COLUMN paid_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE inventory_transactions ADD COLUMN sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE",
    "ALTER TABLE other_expenses ADD COLUMN expense_frequency TEXT NOT NULL DEFAULT 'ONE_TIME'",
    "ALTER TABLE other_expenses ADD COLUMN paid_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE other_expenses ADD COLUMN billing_month TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE other_expenses ADD COLUMN billing_start_date TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE other_expenses ADD COLUMN billing_end_date TEXT NOT NULL DEFAULT ''",  ]) {
    try { sqlite.exec(migration); } catch { /* column already exists */ }
  }
  // Create the sale index only after the sale_id migration has run. Existing
  // production databases may have an older inventory_transactions table.
  try {
    sqlite.exec("CREATE INDEX IF NOT EXISTS inventory_sale_idx ON inventory_transactions(sale_id)");
  } catch { /* legacy schema will be handled by the migration above */ }
  // Backfill sale links for historical sale inventory rows created before sale_id existed.
  try {
    sqlite.exec(`UPDATE inventory_transactions
      SET sale_id = CAST(substr(notes, 7) AS INTEGER)
      WHERE sale_id IS NULL AND transaction_type = 'ADJUSTMENT' AND notes LIKE 'SALE #%'`);
  } catch { /* legacy rows may not exist */ }
  seedSiteContent(sqlite);
  return sqlite;
}

const DEFAULT_CONTENT: Array<{ key: string; en: string; hi: string }> = [
  {
    key: "mission",
    en: "We transform overlooked waste into valuable resources. By collecting and refining raw discarded materials, we deliver high-quality, sustainable products while contributing to a cleaner environment.",
    hi: "हम नज़रअंदाज़ कचरे को मूल्यवान संसाधनों में बदलते हैं। कच्चे त्यागे गए पदार्थों को एकत्र और परिष्कृत कर, हम उच्च गुणवत्ता वाले, टिकाऊ उत्पाद देते हैं और स्वच्छ पर्यावरण में योगदान करते हैं।",
  },
  {
    key: "vision",
    en: "We envision a world where no material is wasted. Every discarded item finds its purpose, creating a circular economy that uplifts communities and protects our planet.",
    hi: "हम एक ऐसी दुनिया की कल्पना करते हैं जहाँ कोई भी सामग्री बर्बाद न हो। हर त्यागा गया सामान अपना उद्देश्य पाए, एक चक्रीय अर्थव्यवस्था बनाकर जो समुदायों को ऊपर उठाए और हमारे ग्रह की रक्षा करे।",
  },
  {
    key: "why_us",
    en: "We combine ground-level collection with advanced refinement to deliver superior recycled materials. With every partnership, you support sustainability, innovation, and a cleaner future for all.",
    hi: "हम ज़मीनी स्तर पर संग्रह को उन्नत परिष्करण के साथ जोड़कर श्रेष्ठ रीसाइकल्ड सामग्री देते हैं। हर साझेदारी के साथ आप स्थिरता, नवाचार और सबके लिए स्वच्छ भविष्य का समर्थन करते हैं।",
  },
];

function seedSiteContent(db: DatabaseSync) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO site_content (key, value_en, value_hi, updated_at) VALUES (?, ?, ?, ?)`
  );
  for (const row of DEFAULT_CONTENT) {
    insert.run(row.key, row.en, row.hi, now);
  }
}

function getDb() {
  if (!globalForDb.__plasticDb) {
    globalForDb.__plasticDb = createDb();
  }
  return globalForDb.__plasticDb;
}

export function closeDb() {
  const db = globalForDb.__plasticDb;
  if (!db) return;
  db.close();
  delete globalForDb.__plasticDb;
}

export const sqlite = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const db = getDb();
    const value = Reflect.get(db, prop, db);
    return typeof value === "function" ? value.bind(db) : value;
  },
});

export type Category = {
  id: number;
  name_en: string;
  name_hi: string;
  icon: string | null;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
};

export type Material = {
  id: number;
  category_id: number;
  name_en: string;
  name_hi: string;
  unit: string;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
};
