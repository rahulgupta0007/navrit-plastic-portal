import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { DatabaseSync } from "node:sqlite";
import { format, subDays } from "date-fns";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../..");
const dataDir = path.join(root, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new DatabaseSync(path.join(dataDir, "plastic-rates.db"));
sqlite.exec("PRAGMA journal_mode = WAL;");
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
`);

const now = () => new Date().toISOString();

const CATEGORY_SEED = [
  { nameEn: "PET", nameHi: "पीईटी", icon: "bottle", sortOrder: 1 },
  { nameEn: "PP", nameHi: "पीपी", icon: "box", sortOrder: 2 },
  { nameEn: "HDPE", nameHi: "एचडीपीई", icon: "drum", sortOrder: 3 },
  { nameEn: "Mixed Plastic", nameHi: "मिश्रित प्लास्टिक", icon: "layers", sortOrder: 4 },
  { nameEn: "Colored Plastic", nameHi: "रंगीन प्लास्टिक", icon: "palette", sortOrder: 5 },
  { nameEn: "White Plastic", nameHi: "सफेद प्लास्टिक", icon: "circle", sortOrder: 6 },
  { nameEn: "Black Plastic", nameHi: "काला प्लास्टिक", icon: "moon", sortOrder: 7 },
  { nameEn: "Flexible Plastic", nameHi: "लचीला प्लास्टिक", icon: "waves", sortOrder: 8 },
];

const MATERIAL_SEED = [
  { cat: "PET", nameEn: "PET Bottle", nameHi: "पीईटी बोतल", baseRate: 30, sortOrder: 1 },
  { cat: "PET", nameEn: "PET Flakes", nameHi: "पीईटी फ्लेक्स", baseRate: 42, sortOrder: 2 },
  { cat: "PP", nameEn: "PP Dibba", nameHi: "पीपी डिब्बा", baseRate: 24, sortOrder: 1 },
  { cat: "PP", nameEn: "PP Granules", nameHi: "पीपी ग्रेन्यूल्स", baseRate: 55, sortOrder: 2 },
  { cat: "HDPE", nameEn: "HDPE Drum", nameHi: "एचडीपीई ड्रम", baseRate: 28, sortOrder: 1 },
  { cat: "HDPE", nameEn: "HDPE Bottle", nameHi: "एचडीपीई बोतल", baseRate: 26, sortOrder: 2 },
  { cat: "Mixed Plastic", nameEn: "Mixed Scrap", nameHi: "मिश्रित स्क्रैप", baseRate: 12, sortOrder: 1 },
  { cat: "Colored Plastic", nameEn: "Colored Mixed", nameHi: "रंगीन मिश्रित", baseRate: 15, sortOrder: 1 },
  { cat: "White Plastic", nameEn: "White Natural", nameHi: "सफेद नेचुरल", baseRate: 35, sortOrder: 1 },
  { cat: "Black Plastic", nameEn: "Black Scrap", nameHi: "काला स्क्रैप", baseRate: 10, sortOrder: 1 },
  { cat: "Flexible Plastic", nameEn: "LD Film", nameHi: "एलडी फिल्म", baseRate: 18, sortOrder: 1 },
  { cat: "Flexible Plastic", nameEn: "Carry Bag", nameHi: "कैरी बैग", baseRate: 8, sortOrder: 2 },
];

async function seed() {
  try {
    sqlite.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  } catch {
    /* exists */
  }

  const adminCount = sqlite.prepare("SELECT count(*) as c FROM admins").get().c;
  if (adminCount === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    const passwordHash = await bcrypt.hash(password, 10);
    sqlite
      .prepare("INSERT INTO admins (username, password_hash, created_at, role) VALUES (?, ?, ?, 'admin')")
      .run(username, passwordHash, now());
    console.log(`Admin created: ${username}`);
  }

  const viewerUser = (process.env.READONLY_USERNAME || "viewer").trim();
  const viewerPass = process.env.READONLY_PASSWORD;
  if (viewerPass && viewerPass.trim()) {
    const passwordHash = await bcrypt.hash(viewerPass, 10);
    const existing = sqlite.prepare("SELECT id FROM admins WHERE lower(username)=lower(?)").get(viewerUser);
    if (existing) {
      sqlite.prepare("UPDATE admins SET password_hash=?, role='readonly' WHERE id=?").run(passwordHash, existing.id);
    } else {
      sqlite
        .prepare("INSERT INTO admins (username, password_hash, created_at, role) VALUES (?, ?, ?, 'readonly')")
        .run(viewerUser, passwordHash, now());
    }
    console.log(`View-only user ready: ${viewerUser}`);
  }

  const catCount = sqlite.prepare("SELECT count(*) as c FROM categories").get().c;
  if (catCount > 0) {
    console.log("Already seeded.");
    return;
  }

  const catIds = new Map();
  const insertCat = sqlite.prepare(
    "INSERT INTO categories (name_en, name_hi, icon, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)"
  );
  for (const c of CATEGORY_SEED) {
    const r = insertCat.run(c.nameEn, c.nameHi, c.icon, c.sortOrder, now(), now());
    catIds.set(c.nameEn, Number(r.lastInsertRowid));
  }

  const insertMat = sqlite.prepare(
    "INSERT INTO materials (category_id, name_en, name_hi, unit, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, '₹/kg', ?, 1, ?, ?)"
  );
  const materialRows = [];
  for (const m of MATERIAL_SEED) {
    const categoryId = catIds.get(m.cat);
    const r = insertMat.run(categoryId, m.nameEn, m.nameHi, m.sortOrder, now(), now());
    materialRows.push({ id: Number(r.lastInsertRowid), baseRate: m.baseRate });
  }

  const insertRate = sqlite.prepare(
    "INSERT INTO rate_snapshots (material_id, rate_date, rate, published, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
  );
  for (let d = 29; d >= 0; d--) {
    const date = format(subDays(new Date(), d), "yyyy-MM-dd");
    for (const m of materialRows) {
      const wobble = Math.sin(d / 3 + m.id) * 1.5 + ((d * m.id) % 7) / 10 - 0.3;
      const rate = Math.round((m.baseRate + wobble) * 100) / 100;
      insertRate.run(m.id, date, rate, now(), now());
    }
  }

  console.log(
    `Seeded ${CATEGORY_SEED.length} categories, ${materialRows.length} materials, 30 days of rates.`
  );
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
