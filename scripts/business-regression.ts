import assert from "node:assert/strict";

process.env.NAVRIT_SQLITE_MEMORY = "1";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";

async function main() {
  const { sqlite } = await import("../src/db");
  const e = await import("../src/lib/business/engine");

  e.addInvestment({ date: "2026-11-20", investor: "Rahul", amount: 100000, kind: "equity" });
  e.addInvestment({ date: "2026-11-20", investor: "Bank", amount: 20000, kind: "loan" });

  // One trip, three materials, 1000 transport + 500 loading shared by kg.
  const pid = e.createPurchase({
    date: "2026-11-21",
    partyName: "FIAZAL",
    transport: 1000,
    loading: 500,
    paidNow: 10000,
    lines: [
      { materialName: "Safed PPDD", group: "PLASTIC", kg: 200, rate: 45 },
      { materialName: "Rangin PPDD", group: "PLASTIC", kg: 100, rate: 25 },
      { materialName: "PET Bottle", group: "PET", kg: 200, rate: 20 },
    ],
  });
  const purchase = e.listPurchases()[0];
  assert.equal(purchase.id, pid);
  assert.equal(purchase.total, 9000 + 2500 + 4000 + 1500);
  const allocSum = purchase.lines.reduce((a: number, l: { alloc_charges: unknown }) => a + Number(l.alloc_charges), 0);
  assert.equal(Math.round(allocSum * 100) / 100, 1500);
  // 1500 * 200/500 = 600 on Safed -> landed (9000+600)/200 = 48
  assert.equal(Math.round(Number(purchase.lines[0].landed_per_kg) * 100) / 100, 48);

  // Pay the rest of the trip in one action.
  const supplier = e.listParties().find((p) => p.name === "FIAZAL")!;
  assert.equal(supplier.payable, purchase.total - 10000);
  e.payPurchases({ partyId: supplier.id, amount: supplier.payable, date: "2026-11-22" });
  assert.equal(e.listPurchases()[0].due, 0);

  // Sell part of Safed PPDD with 12% GST.
  const sid = e.createSale({
    date: "2026-11-23",
    partyName: "Customer A",
    gstPercent: 12,
    sideCosts: 100,
    receivedNow: 2000,
    lines: [{ materialName: "Safed PPDD", kg: 50, rate: 60 }],
  });
  const sale = e.listSales()[0];
  assert.equal(sale.id, sid);
  assert.equal(sale.gross, 3000);
  assert.equal(sale.gst_amount, 360);
  assert.equal(sale.total, 3360);
  // cost 50 * 48 = 2400 -> profit 3000 - 2400 - 100 side = 500
  assert.equal(sale.profit, 500);
  assert.equal(sale.received, 2000);
  assert.equal(sale.due, 1360);

  let stock = e.getStock().materials.find((m) => m.name === "Safed PPDD")!;
  assert.equal(stock.kg, 150);

  assert.throws(() => e.createSale({ partyName: "X", lines: [{ materialName: "Safed PPDD", kg: 999, rate: 1 }] }), /in stock/);
  assert.throws(() => e.createPurchase({ partyName: "X", lines: [{ materialName: "A", kg: 1, rate: 1 }], paidNow: 99 }), /more than/);

  let s = e.getSummary();
  assert.ok(s.check.balanced, `books must balance, diff ${s.check.difference}`);
  assert.equal(s.profit.allTime.salesProfit, 500);

  e.addExpense({ date: "2026-11-24", category: "Labour", amount: 200 });
  e.addExpense({ date: "2026-11-24", category: "GST payment", amount: 100 });
  s = e.getSummary();
  assert.equal(s.profit.allTime.profit, 300);
  assert.equal(s.gst.payable, 260);
  assert.ok(s.check.balanced, `books balance after expenses, diff ${s.check.difference}`);

  // Edit sale: restores stock and re-runs FIFO.
  e.updateSale(sid, {
    date: "2026-11-23", partyName: "Customer A", gstPercent: 5, sideCosts: 0,
    lines: [{ materialName: "Safed PPDD", kg: 40, rate: 70 }],
  });
  stock = e.getStock().materials.find((m) => m.name === "Safed PPDD")!;
  assert.equal(stock.kg, 160);
  assert.equal(e.listSales()[0].profit, 2800 - 1920);

  // Purchase with sold stock cannot be deleted; deleting the sale frees it.
  assert.throws(() => e.deletePurchase(pid), /already sold/);
  e.deleteSale(sid);
  stock = e.getStock().materials.find((m) => m.name === "Safed PPDD")!;
  assert.equal(stock.kg, 200);
  e.deletePurchase(pid);
  assert.equal(e.getStock().totalKg, 0);
  assert.ok(e.getSummary().check.balanced);

  const leaked = sqlite
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name LIKE 'nv\\_%' ESCAPE '\\'")
    .get() as { c: number };
  assert.equal(leaked.c, 0, "NAVRIT 2.0 tables must not exist in the old database");
  console.log("business regression: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
