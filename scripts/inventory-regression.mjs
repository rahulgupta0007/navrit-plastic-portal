import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE sales (id INTEGER PRIMARY KEY);
  CREATE TABLE purchases (
    id INTEGER PRIMARY KEY,
    paid_amount REAL NOT NULL,
    material_id INTEGER,
    material_name TEXT NOT NULL,
    supplier_id INTEGER,
    paid_by TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE vendor_payments (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER NOT NULL,
    purchase_id INTEGER,
    payment_type TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_date TEXT NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'Cash',
    paid_by TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    material_id INTEGER,
    material_name TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    quantity_kg REAL NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    purchase_id INTEGER,
    sale_id INTEGER,
    transaction_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );
`);

function availableStock(mode, materialName, date, excludeSaleId) {
  const row = excludeSaleId === undefined
    ? db.prepare("SELECT COALESCE(SUM(quantity_kg),0) kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=?").get(mode,date,materialName)
    : db.prepare("SELECT COALESCE(SUM(quantity_kg),0) kg FROM inventory_transactions WHERE mode=? AND transaction_date<=? AND material_name=? AND COALESCE(sale_id,0)<>?").get(mode,date,materialName,excludeSaleId);
  return Number(row.kg || 0);
}

// A1: sale #1 must never delete sale #10/#11 inventory rows.
db.exec("INSERT INTO inventory_transactions(mode,material_name,transaction_type,quantity_kg,amount,sale_id,transaction_date,notes) VALUES ('PET','Natural Bottles - Green','ADJUSTMENT',-100,-300,1,'2026-10-01','SALE #1')");
db.exec("INSERT INTO inventory_transactions(mode,material_name,transaction_type,quantity_kg,amount,sale_id,transaction_date,notes) VALUES ('PET','Natural Bottles - Green','ADJUSTMENT',-200,-600,10,'2026-10-01','SALE #10')");
db.prepare("DELETE FROM inventory_transactions WHERE sale_id=? AND transaction_type='ADJUSTMENT'").run(1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE sale_id=1").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE sale_id=10").get().n, 1);

// A4: stock is exact by material and duplicate lines aggregate before checking.
db.exec("INSERT INTO inventory_transactions(mode,material_name,transaction_type,quantity_kg,amount,transaction_date) VALUES ('PET','Natural Bottles - White','PURCHASE',50,1000,'2026-10-01')");
db.exec("INSERT INTO inventory_transactions(mode,material_name,transaction_type,quantity_kg,amount,transaction_date) VALUES ('PET','Natural Bottles - Green','PURCHASE',400,6000,'2026-10-01')");
assert.equal(availableStock("PET","Natural Bottles - Red","2026-10-01"), 0);
assert.equal(availableStock("PET","Natural Bottles - White","2026-10-01"), 50);
assert.equal(availableStock("PET","Natural Bottles - Green","2026-10-01"), 200);

// A3: omitted payer/payment mode must preserve the latest payment.
db.exec("INSERT INTO sales(id) VALUES(1)");
db.exec("INSERT INTO vendor_payments(id,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,paid_by) VALUES(1,1,1,'PURCHASE',100,'2026-10-01','Cash','Rahul')");
db.exec("CREATE TABLE sale_payments(id INTEGER PRIMARY KEY,sale_id INTEGER,received_by TEXT,payment_mode TEXT)");
db.exec("INSERT INTO sale_payments(id,sale_id,received_by,payment_mode) VALUES(1,1,'Devesh','UPI')");
db.prepare("UPDATE sale_payments SET received_by=COALESCE(?,received_by),payment_mode=COALESCE(?,payment_mode) WHERE id=(SELECT id FROM sale_payments WHERE sale_id=? ORDER BY id DESC LIMIT 1)").run(null,null,1);
const preservedPayment = db.prepare("SELECT received_by,payment_mode FROM sale_payments WHERE id=1").get();
assert.equal(preservedPayment.received_by,"Devesh");
assert.equal(preservedPayment.payment_mode,"UPI");

// A6: purchase edits preserve payment date/payer while allowing supplier to move.
db.exec("INSERT INTO purchases(id,paid_amount,material_id,material_name,supplier_id,paid_by) VALUES(1,100,7,'Natural Bottles',1,'Rahul')");
db.exec("INSERT INTO vendor_payments(id,supplier_id,purchase_id,payment_type,amount,payment_date,payment_mode,paid_by) VALUES(2,1,1,'PURCHASE',100,'2026-10-01','Cash','Rahul')");
db.prepare("UPDATE vendor_payments SET supplier_id=? WHERE purchase_id=?").run(2,1);
const preservedVendorPayment = db.prepare("SELECT supplier_id,payment_date,paid_by FROM vendor_payments WHERE id=2").get();
assert.equal(preservedVendorPayment.supplier_id,2);
assert.equal(preservedVendorPayment.payment_date,"2026-10-01");
assert.equal(preservedVendorPayment.paid_by,"Rahul");

// A7: atomic validation principle — a write made before a later failure must roll back.
db.exec("CREATE TABLE vendor_advances(id INTEGER PRIMARY KEY, amount REAL, used_amount REAL)");
db.exec("INSERT INTO vendor_advances(id,amount,used_amount) VALUES(1,500,0)");
db.exec("BEGIN IMMEDIATE");
try {
  db.prepare("UPDATE vendor_advances SET used_amount=100 WHERE id=1").run();
  throw new Error("simulated validation failure");
} catch {
  db.exec("ROLLBACK");
}
assert.equal(db.prepare("SELECT used_amount FROM vendor_advances WHERE id=1").get().used_amount, 0);

db.close();
console.log("inventory regression tests: PASS");
