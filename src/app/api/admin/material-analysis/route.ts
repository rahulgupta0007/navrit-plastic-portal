/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sqlite } from "@/db";

export const dynamic = "force-dynamic";

function n(v: unknown) { return Number(v || 0); }
function round(v: number, d=2) { const p=10**d; return Math.round(v*p)/p; }

export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "PLASTIC" ? "PLASTIC" : "PET";
  const from = url.searchParams.get("from") || "2000-01-01";
  const to = url.searchParams.get("to") || "2999-12-31";

  const purchases = sqlite.prepare(`
    SELECT id, material_name, material_variant, quantity_kg, rate_per_kg, total_amount, purchase_date
    FROM purchases WHERE mode=? AND purchase_date BETWEEN ? AND ? ORDER BY purchase_date DESC, id DESC
  `).all(mode,from,to) as any[];

  const sales = sqlite.prepare(`
    SELECT id, customer_name, quantity_kg, total_amount, gross_amount, labour_charges, loading_charges, sale_date
    FROM sales WHERE mode=? AND sale_date BETWEEN ? AND ? ORDER BY sale_date DESC, id DESC
  `).all(mode,from,to) as any[];

  const saleItems = sqlite.prepare(`
    SELECT si.*, s.sale_date FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.mode=? AND s.sale_date BETWEEN ? AND ? ORDER BY s.sale_date DESC, si.id DESC
  `).all(mode,from,to) as any[];

  const batches = sqlite.prepare(`
    SELECT * FROM processing_batches
    WHERE mode=? AND batch_date BETWEEN ? AND ? ORDER BY batch_date DESC, id DESC
  `).all(mode,from,to) as any[];

  const batchItems = sqlite.prepare(`
    SELECT pbi.*, pb.batch_date FROM processing_batch_items pbi
    JOIN processing_batches pb ON pb.id=pbi.batch_id
    WHERE pb.mode=? AND pb.batch_date BETWEEN ? AND ?
    ORDER BY pb.batch_date DESC, pbi.id
  `).all(mode,from,to) as any[];

  const batchOutputs = sqlite.prepare(`
    SELECT pbo.*, pb.batch_date FROM processing_batch_outputs pbo
    JOIN processing_batches pb ON pb.id=pbo.batch_id
    WHERE pb.mode=? AND pb.batch_date BETWEEN ? AND ?
    ORDER BY pb.batch_date DESC, pbo.id
  `).all(mode,from,to) as any[];

  const processingExpenses = sqlite.prepare(`
    SELECT * FROM processing_expenses WHERE mode=? AND expense_date BETWEEN ? AND ?
    ORDER BY expense_date DESC, id DESC
  `).all(mode,from,to) as any[];

  const otherExpenses = sqlite.prepare(`
    SELECT * FROM other_expenses
    WHERE mode=?
      AND (
        (expense_type='Electricity' AND billing_month BETWEEN substr(?,1,7) AND substr(?,1,7))
        OR
        (expense_type!='Electricity' AND expense_date BETWEEN ? AND ?)
      )
    ORDER BY COALESCE(NULLIF(billing_month,''), substr(expense_date,1,7)) DESC, id DESC
  `).all(mode,from,to,from,to) as any[];

  const inventory = sqlite.prepare(`
    SELECT material_name, ROUND(SUM(quantity_kg),3) quantity_kg, ROUND(SUM(amount),2) value
    FROM inventory_transactions
    WHERE mode=? GROUP BY material_name HAVING ABS(SUM(quantity_kg)) > 0.0001
    ORDER BY material_name
  `).all(mode) as any[];

  const purchasedKg = purchases.reduce((s,x)=>s+n(x.quantity_kg),0);
  const purchaseCost = purchases.reduce((s,x)=>s+n(x.total_amount),0);
  const processedInputKg = batches.reduce((s,x)=>s+n(x.total_input_kg),0);
  const finishedOutputKg = batches.reduce((s,x)=>s+n(x.total_output_kg),0);
  const wasteKg = batches.reduce((s,x)=>s+n(x.waste_kg),0);
  const soldKg = sales.reduce((s,x)=>s+n(x.quantity_kg),0);
  const revenue = sales.reduce((s,x)=>s+n(x.total_amount),0);
  const saleDirectCost = sales.reduce((s,x)=>s+n(x.labour_charges)+n(x.loading_charges),0);
  const processingCost = batches.reduce((s,x)=>s+n(x.labour_cost)+n(x.processing_cost),0);
  const processingOtherExpenses = otherExpenses.filter(x=>x.expense_type==="Electricity" || x.expense_type==="Thread");
  const adminMaintenanceExpenses = otherExpenses.filter(x=>x.expense_type==="GST / Admin" || x.expense_type==="Infrastructure / Maintenance" || x.expense_type==="Other");
  const processingExpenseCost = processingExpenses.reduce((s,x)=>s+n(x.amount),0) + processingOtherExpenses.reduce((s,x)=>s+n(x.amount),0);
  const otherExpenseCost = adminMaintenanceExpenses.reduce((s,x)=>s+n(x.amount),0);
  const finishedCostPerKg = finishedOutputKg > 0 ? (purchaseCost + processingCost + processingExpenseCost) / finishedOutputKg : 0;
  const estimatedCogs = soldKg * finishedCostPerKg;
  const estimatedNetProfit = revenue - estimatedCogs - otherExpenseCost;
  const stockKg = inventory.reduce((s,x)=>s+n(x.quantity_kg),0);
  const reconciliation = {
    openingPlusPurchases: purchasedKg,
    processedInputKg,
    soldKg,
    closingStockKg: stockKg,
    wasteKg,
    finishedOutputKg,
    processingBalanced: batches.every(x => Math.abs(n(x.total_input_kg)-n(x.total_output_kg)-n(x.waste_kg)) < 0.01),
  };

  const months = new Map<string, any>();
  const addMonth=(date:string, key:string, value:number)=>{
    const m=(date||"").slice(0,7); if(!m)return;
    const row=months.get(m)||{month:m,purchasedKg:0,processedKg:0,finishedKg:0,wasteKg:0,soldKg:0,revenue:0,expenses:0,processingExpenses:0,adminMaintenanceExpenses:0};
    row[key]+=value; months.set(m,row);
  };
  purchases.forEach(x=>addMonth(x.purchase_date,"purchasedKg",n(x.quantity_kg)));
  batches.forEach(x=>{addMonth(x.batch_date,"processedKg",n(x.total_input_kg));addMonth(x.batch_date,"finishedKg",n(x.total_output_kg));addMonth(x.batch_date,"wasteKg",n(x.waste_kg));});
  sales.forEach(x=>{addMonth(x.sale_date,"soldKg",n(x.quantity_kg));addMonth(x.sale_date,"revenue",n(x.total_amount));});
  processingExpenses.forEach(x=>addMonth(x.expense_date,"processingExpenses",n(x.amount)));
  otherExpenses.forEach(x=>{
    const month=x.expense_type==="Electricity" && x.billing_month ? x.billing_month : (x.expense_date||"").slice(0,7);
    const key=(x.expense_type==="Electricity" || x.expense_type==="Thread") ? "processingExpenses" : "adminMaintenanceExpenses";
    const row=months.get(month)||{month,purchasedKg:0,processedKg:0,finishedKg:0,wasteKg:0,soldKg:0,revenue:0,expenses:0,processingExpenses:0,adminMaintenanceExpenses:0};
    row[key]+=n(x.amount); row.expenses=(row.processingExpenses||0)+(row.adminMaintenanceExpenses||0); months.set(month,row);
  });
  const monthly=[...months.values()].sort((a,b)=>a.month.localeCompare(b.month));

  return NextResponse.json({
    mode, period:{from,to},
    summary:{
      purchasedKg:round(purchasedKg,3), purchaseCost:round(purchaseCost),
      processedInputKg:round(processedInputKg,3), finishedOutputKg:round(finishedOutputKg,3),
      wasteKg:round(wasteKg,3), wastePct:processedInputKg?round(wasteKg/processedInputKg*100):0,
      soldKg:round(soldKg,3), stockKg:round(stockKg,3), revenue:round(revenue),
      saleDirectCost:round(saleDirectCost), processingCost:round(processingCost+processingExpenseCost),
      otherExpenses:round(otherExpenseCost), processingOtherExpenses:round(processingOtherExpenses.reduce((s,x)=>s+n(x.amount),0)), adminMaintenanceExpenses:round(otherExpenseCost), estimatedCogs:round(estimatedCogs),
      estimatedNetProfit:round(estimatedNetProfit),
      finishedCostPerKg:round(finishedCostPerKg),
    },
    reconciliation, inventory, purchases, sales, saleItems, batches, batchItems, batchOutputs, monthly
  });
}
