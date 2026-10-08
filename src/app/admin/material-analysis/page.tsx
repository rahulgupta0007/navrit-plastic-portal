/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { AdminShell, adminToast } from "@/components/admin-shell";
import { useBusinessMode } from "@/components/business-mode-provider";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

type Variant = "Green" | "White" | "White Milk" | "Red";
type Row = { materialVariant: Variant; quantityKg: string; baleCount?: string };

const today = () => new Date().toISOString().slice(0,10);
const monthStart = () => { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); };
const money=(v:number)=>`₹${Number(v||0).toLocaleString("en-IN",{maximumFractionDigits:2})}`;
const kg=(v:number)=>`${Number(v||0).toLocaleString("en-IN",{maximumFractionDigits:3})} kg`;

export default function MaterialAnalysisPage() {
  const { mode } = useBusinessMode();
  const [from,setFrom]=useState(monthStart());
  const [to,setTo]=useState(today());
  const [data,setData]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [batchDate,setBatchDate]=useState(today());
  const [batchItems,setBatchItems]=useState<Row[]>([{materialVariant:"Green",quantityKg:"",baleCount:""}]);
  const [selectedBatch,setSelectedBatch]=useState<number|null>(null);
  const [outputItems,setOutputItems]=useState<Row[]>([{materialVariant:"Green",quantityKg:""}]);
  const [processingCost,setProcessingCost]=useState("");

  async function load() {
    setBusy(true);
    try {
      const r=await fetch(`/api/admin/material-analysis?mode=${mode}&from=${from}&to=${to}`,{cache:"no-store"});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||"Analysis failed");
      setData(j);
    } catch(e) { adminToast(e instanceof Error?e.message:"Analysis failed"); }
    finally { setBusy(false); }
  }
  // The filters are the intended trigger for reloading analysis data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{load();},[mode,from,to]);

  async function post(action:string,payload:any) {
    const r=await fetch("/api/admin/inventory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...payload})});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||"Operation failed");
    return j;
  }

  async function createBatch() {
    const items=batchItems.map(x=>({...x,quantityKg:Number(x.quantityKg),baleCount:Number(x.baleCount||0)})).filter(x=>x.quantityKg>0);
    if(!items.length){adminToast("Enter processing input kg");return;}
    try { await post("addProcessingBatch",{mode,batchDate,items}); adminToast("Processing batch created"); setBatchItems([{materialVariant:"Green",quantityKg:"",baleCount:""}]); await load(); }
    catch(e){adminToast(e instanceof Error?e.message:"Could not create batch");}
  }

  async function completeBatch() {
    if(!selectedBatch){adminToast("Select a processing batch");return;}
    const outputs=outputItems.map(x=>({...x,quantityKg:Number(x.quantityKg)})).filter(x=>x.quantityKg>0);
    if(!outputs.length){adminToast("Enter finished output kg");return;}
    try {
      const result=await post("completeProcessingBatch",{mode,batchId:selectedBatch,outputs,processingCost:Number(processingCost||0)});
      adminToast(`Completed: ${kg(result.outputKg)} finished, ${kg(result.wasteKg)} waste`);
      setSelectedBatch(null); setOutputItems([{materialVariant:"Green",quantityKg:""}]); setProcessingCost(""); await load();
    } catch(e){adminToast(e instanceof Error?e.message:"Could not complete batch");}
  }

  const readyBatches=(data?.batches||[]).filter((b:any)=>Number(b.total_output_kg||0)===0&&Number(b.waste_kg||0)===0);
  const s=data?.summary;
  const flow=[
    ["Purchased",kg(s?.purchasedKg),"₹"+Number(s?.purchaseCost||0).toLocaleString("en-IN")],
    ["Processed",kg(s?.processedInputKg),"Input to processing"],
    ["Finished",kg(s?.finishedOutputKg),s?.finishedOutputKg?money(s.finishedCostPerKg)+"/kg cost":"Awaiting output"],
    ["Waste / Loss",kg(s?.wasteKg),`${Number(s?.wastePct||0).toFixed(1)}%`],
    ["Sold",kg(s?.soldKg),money(s?.revenue)],
    ["Stock",kg(s?.stockKg),"Current physical ledger"],
  ];

  return <AdminShell title={`${mode} Material & Profit Analysis`} subtitle="Purchase → Processing → Waste → Finished Material → Sale → Profit">
    <div className="space-y-5">
      <div className="ad-card p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--ad-muted)]">From<input className="ad-input mt-1" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
          <label className="text-xs font-semibold text-[var(--ad-muted)]">To<input className="ad-input mt-1" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
          <button className="ad-btn ad-btn-primary" onClick={load} disabled={busy}><RefreshCw size={14}/> Refresh</button>
        </div>
      </div>

      {s && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ad-card p-4"><p className="ad-muted text-xs">Purchased</p><p className="mt-1 text-2xl font-bold">{kg(s.purchasedKg)}</p><p className="text-xs ad-muted">{money(s.purchaseCost)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Finished Output</p><p className="mt-1 text-2xl font-bold">{kg(s.finishedOutputKg)}</p><p className="text-xs ad-muted">Cost {money(s.finishedCostPerKg)}/kg</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Waste / Loss</p><p className="mt-1 text-2xl font-bold">{kg(s.wasteKg)}</p><p className="text-xs ad-muted">{Number(s.wastePct).toFixed(1)}% of processed input</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Estimated Net Profit</p><p className={`mt-1 text-2xl font-bold ${s.estimatedNetProfit>=0?"text-[var(--ad-success)]":"text-[var(--ad-danger)]"}`}>{money(s.estimatedNetProfit)}</p><p className="text-xs ad-muted">Revenue {money(s.revenue)} · COGS {money(s.estimatedCogs)}</p></div>
      </div>}

      {s && <div className="ad-card p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Material Flow</h2>{data.reconciliation.processingBalanced?<span className="inline-flex items-center gap-1 text-xs text-[var(--ad-success)]"><CheckCircle2 size={14}/> Processing reconciled</span>:<span className="inline-flex items-center gap-1 text-xs text-[var(--ad-danger)]"><AlertTriangle size={14}/> Check processing results</span>}</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {flow.map(([label,value,sub],i)=><div key={label} className="rounded-xl border border-[var(--ad-border)] bg-[var(--ad-input)] p-3"><p className="text-[11px] uppercase tracking-wide text-[var(--ad-muted)]">{label}</p><p className="mt-1 text-lg font-bold">{value}</p><p className="mt-1 text-[11px] text-[var(--ad-muted)]">{sub}</p>{i<flow.length-1&&<span className="hidden"/>}</div>)}
        </div>
        <p className="mt-3 text-xs ad-muted">Profit is marked estimated because the current system does not yet have a full FIFO/average-cost ledger for every historical sale. New completed processing batches are fully reconciled input = finished output + waste.</p>
      </div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="ad-card p-4">
          <h2 className="font-semibold">Record Processing Batch</h2>
          <p className="mt-1 text-xs ad-muted">Enter the material that went into one processing run.</p>
          <div className="mt-3 space-y-2">
            {batchItems.map((x,i)=><div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <select className="ad-input" value={x.materialVariant} onChange={e=>setBatchItems(a=>a.map((r,j)=>j===i?{...r,materialVariant:e.target.value as Variant}:r))}>
                {(mode==="PET"?["Green","White","White Milk"]:["Green","White","White Milk","Red"]).map(v=><option key={v}>{v}</option>)}
              </select>
              <input className="ad-input" type="number" placeholder="Input kg" value={x.quantityKg} onChange={e=>setBatchItems(a=>a.map((r,j)=>j===i?{...r,quantityKg:e.target.value}:r))}/>
              <button className="ad-btn ad-btn-ghost" disabled={batchItems.length===1} onClick={()=>setBatchItems(a=>a.filter((_,j)=>j!==i))}>×</button>
            </div>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="ad-btn ad-btn-ghost" onClick={()=>setBatchItems(a=>[...a,{materialVariant:mode==="PET"?"Green":"Red",quantityKg:"",baleCount:""}])}>+ Material</button>
            <input className="ad-input" type="date" value={batchDate} onChange={e=>setBatchDate(e.target.value)}/>
            <button className="ad-btn ad-btn-primary" onClick={createBatch}>Create Batch</button>
          </div>
        </div>

        <div className="ad-card p-4">
          <h2 className="font-semibold">Complete Processing Batch</h2>
          <p className="mt-1 text-xs ad-muted">Enter finished output. Waste is automatically calculated as input minus output.</p>
          <select className="ad-input mt-3 w-full" value={selectedBatch||""} onChange={e=>setSelectedBatch(Number(e.target.value)||null)}>
            <option value="">Select ready batch</option>
            {readyBatches.map((b:any)=><option key={b.id} value={b.id}>#{b.id} · {b.batch_date} · {kg(b.total_input_kg)} input</option>)}
          </select>
          {selectedBatch && <div className="mt-3 space-y-2">
            {outputItems.map((x,i)=><div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <select className="ad-input" value={x.materialVariant} onChange={e=>setOutputItems(a=>a.map((r,j)=>j===i?{...r,materialVariant:e.target.value as Variant}:r))}>
                {(mode==="PET"?["Green","White","White Milk"]:["Green","White","White Milk","Red"]).map(v=><option key={v}>{v}</option>)}
              </select>
              <input className="ad-input" type="number" placeholder="Finished kg" value={x.quantityKg} onChange={e=>setOutputItems(a=>a.map((r,j)=>j===i?{...r,quantityKg:e.target.value}:r))}/>
              <button className="ad-btn ad-btn-ghost" disabled={outputItems.length===1} onClick={()=>setOutputItems(a=>a.filter((_,j)=>j!==i))}>×</button>
            </div>)}
            <div className="flex flex-wrap gap-2">
              <button className="ad-btn ad-btn-ghost" onClick={()=>setOutputItems(a=>[...a,{materialVariant:"Green",quantityKg:""}])}>+ Output</button>
              <input className="ad-input" type="number" min="0" placeholder="Extra processing cost" value={processingCost} onChange={e=>setProcessingCost(e.target.value)}/>
              <button className="ad-btn ad-btn-primary" onClick={completeBatch}>Complete & Reconcile</button>
            </div>
          </div>}
        </div>
      </div>

      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">Processing Batches</h2>
        <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Date</th><th>Input</th><th>Finished</th><th>Waste</th><th>Waste %</th><th>Processing Cost</th><th>Status</th></tr></thead><tbody>
          {(data?.batches||[]).map((b:any)=>{const input=Number(b.total_input_kg),w=Number(b.waste_kg),out=Number(b.total_output_kg);return <tr key={b.id}><td>#{b.id} · {b.batch_date}</td><td>{kg(input)}</td><td>{kg(out)}</td><td>{kg(w)}</td><td>{input?(w/input*100).toFixed(1):"0.0"}%</td><td>{money(Number(b.labour_cost)+Number(b.processing_cost))}</td><td>{out||w?"Reconciled":"Needs output"}</td></tr>})}
        </tbody></table></div>
      </div>

      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">Monthly Snapshot</h2>
        <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Month</th><th>Purchased</th><th>Processed</th><th>Finished</th><th>Waste</th><th>Sold</th><th>Revenue</th><th>Processing Expense</th><th>Admin & Maintenance</th><th>Total Expense</th></tr></thead><tbody>
          {(data?.monthly||[]).map((m:any)=><tr key={m.month}><td>{m.month}</td><td>{kg(m.purchasedKg)}</td><td>{kg(m.processedKg)}</td><td>{kg(m.finishedKg)}</td><td>{kg(m.wasteKg)}</td><td>{kg(m.soldKg)}</td><td>{money(m.revenue)}</td><td>{money(m.processingExpenses||0)}</td><td>{money(m.adminMaintenanceExpenses||0)}</td><td>{money(m.expenses)}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  </AdminShell>;
}
