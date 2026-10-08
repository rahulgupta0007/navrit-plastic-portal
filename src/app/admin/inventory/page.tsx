/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin-shell";

import { useBusinessMode, type BusinessMode } from "@/components/business-mode-provider";

type Mode = BusinessMode;
type Material = { id:number; name_en:string; name_hi:string; category_en:string };
type Supplier = { id:number; name:string; phone:string; notes:string };
type Lender = { id:number; name:string; phone:string; notes:string };
type Purchase = {
  id:number; mode:Mode; material_name:string; purchase_type:string; quantity_kg:number;
  rate_per_kg:number; total_amount:number; paid_amount:number; credit_amount:number;
  transport_charges:number; weight_charges:number; labour_charges:number; effective_cost:number;
  supplierName?:string; lenderName?:string; purchase_date:string; paid_by?:string;
};
type Borrowing = { id:number; mode:Mode; lenderName:string; amount:number; outstanding_amount:number; borrowing_date:string; purpose:string };

export default function InventoryPage() {
  const { mode } = useBusinessMode();
  const [data,setData] = useState<any>(null);
  const [tab,setTab] = useState("purchases");
  const [expense,setExpense] = useState({expenseType:"Electricity",description:"",amount:"",expenseDate:new Date().toISOString().slice(0,10),billingMonth:new Date().toISOString().slice(0,7),billingStartDate:"",billingEndDate:"",paidBy:""});
  const [sale,setSale] = useState({customerName:"",phone:"",location:"",receivedAmount:"",receivedBy:"",paymentMode:"Cash",loadingCharges:"",saleDate:new Date().toISOString().slice(0,10),notes:""});
  const [editingSale,setEditingSale] = useState<number|null>(null);
  const [saleItems,setSaleItems] = useState([{materialCategory:"Natural Bottles",materialVariant:"Green",quantityKg:"",ratePerKg:""}]);

  const [message,setMessage] = useState("");
  const emptyPurchase = { materialId:"", materialName:"", supplierId:"", purchaseType:"NORMAL", quantityKg:"", ratePerKg:"", paidAmount:"", paidBy:"", borrowingId:"", lenderId:"", purchaseDate:new Date().toISOString().slice(0,10), notes:"",  };
  const [purchase,setPurchase] = useState(emptyPurchase);
  const [editingPurchase,setEditingPurchase] = useState<number|null>(null);
  const [borrowing,setBorrowing] = useState({lenderId:"",amount:"",purpose:"",notes:""});
  const [adjust,setAdjust] = useState({materialId:"",materialName:"",quantityKg:"",amount:"",notes:""});

  async function load() {
    const r=await fetch("/api/admin/inventory");
    if(r.status===401){window.location.href="/admin/login";return;}
    setData(await r.json());
  }
  useEffect(()=>{load()},[]);

  const materials = useMemo(()=> (data?.materials||[]).filter((m:Material)=>m.id),[data]);
  const filteredInventory=(data?.inventory||[]).filter((x:any)=>x.mode===mode);
  const filteredPurchases=(data?.purchases||[]).filter((x:Purchase)=>x.mode===mode);
  const filteredBorrowings=(data?.borrowings||[]).filter((x:Borrowing)=>x.mode===mode);
  const openBorrowings=filteredBorrowings.filter((x:Borrowing)=>x.outstanding_amount>0);
  const currentKg=filteredInventory.reduce((n:any,x:any)=>n+Number(x.quantityKg||0),0);
  const saleGrossAmount=saleItems.reduce((n:number,x:any)=>n+(Number(x.quantityKg)||0)*(Number(x.ratePerKg)||0),0);
  const saleTotalWeight=saleItems.reduce((n:number,x:any)=>n+(Number(x.quantityKg)||0),0);
  const saleLabourCharges=saleTotalWeight*2;
  const saleLoadingCharges=Number(sale.loadingCharges||0);
  const saleFinalAmount=Math.max(0,saleGrossAmount-saleLabourCharges-saleLoadingCharges);

  async function post(action:string, body:any) {
    const r=await fetch("/api/admin/inventory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...body})});
    const j=await r.json();
    if(!r.ok){setMessage(j.error||"Operation failed");return false;}
    setMessage("Saved successfully");
    await load();
    return true;
  }

  function resetSaleForm() {
    setEditingSale(null);
    setSale({customerName:"",phone:"",location:"",receivedAmount:"",receivedBy:"",paymentMode:"Cash",loadingCharges:"",saleDate:new Date().toISOString().slice(0,10),notes:""});
    setSaleItems([{materialCategory:"Natural Bottles",materialVariant:"Green",quantityKg:"",ratePerKg:""}]);
  }

  async function addSale() {
    const ok=await post("addSale",{mode,customerName:sale.customerName,phone:sale.phone,location:sale.location,items:saleItems.map(x=>({...x,quantityKg:Number(x.quantityKg),ratePerKg:Number(x.ratePerKg)})),receivedAmount:sale.receivedAmount===""?undefined:Number(sale.receivedAmount),receivedBy:sale.receivedBy||undefined,paymentMode:sale.paymentMode,loadingCharges:Number(sale.loadingCharges||0),saleDate:sale.saleDate,notes:sale.notes});
    if(ok) resetSaleForm();
  }

  async function editSale() {
    if(editingSale===null) return;
    const ok=await post("updateSale",{saleId:editingSale,mode,customerName:sale.customerName,phone:sale.phone,location:sale.location,items:saleItems.map(x=>({...x,quantityKg:Number(x.quantityKg),ratePerKg:Number(x.ratePerKg)})),loadingCharges:Number(sale.loadingCharges||0),receivedBy:sale.receivedBy||undefined,paymentMode:sale.paymentMode,saleDate:sale.saleDate,notes:sale.notes});
    if(ok) resetSaleForm();
  }

  function startEditSale(s:any) {
    const items=(data.saleItems||[]).filter((x:any)=>x.sale_id===s.id);
    const payments=(data.salePayments||[]).filter((x:any)=>x.sale_id===s.id);
    const latestPayment=payments[0];
    setEditingSale(s.id);
    setSale({
      customerName:s.customer_name||"",
      phone:s.phone||"",
      location:s.location||"",
      receivedAmount:String(s.received_amount??""),
      receivedBy:latestPayment?.received_by||"",
      paymentMode:latestPayment?.payment_mode||"Cash",
      loadingCharges:String(s.loading_charges??""),
      saleDate:s.sale_date,
      notes:s.notes||""
    });
    setSaleItems(items.length ? items.map((x:any)=>({materialCategory:x.material_category,materialVariant:x.material_variant,quantityKg:String(x.quantity_kg),ratePerKg:String(x.rate_per_kg)})) : [{materialCategory:s.material_category,materialVariant:s.material_variant==="MIXED"?"Green":s.material_variant,quantityKg:String(s.quantity_kg),ratePerKg:String(s.rate_per_kg||0)}]);
    window.scrollTo({top:0,behavior:"smooth"});
  }
  async function addExpense() {
    const amount=Number(expense.amount||0);
    if(amount<=0) { setMessage("Enter a valid expense amount"); return; }
    const ok=await post("addOtherExpense",{mode,expenseType:expense.expenseType,description:expense.description,amount,expenseDate:expense.expenseDate,...(expense.expenseType==="Electricity"?{billingMonth:expense.billingMonth,billingStartDate:expense.billingStartDate,billingEndDate:expense.billingEndDate}:{}),paidBy:expense.paidBy||undefined});
    if(ok) setExpense({expenseType:"Electricity",description:"",amount:"",expenseDate:new Date().toISOString().slice(0,10),billingMonth:new Date().toISOString().slice(0,7),billingStartDate:"",billingEndDate:"",paidBy:""});
  }

  async function receiveSalePayment(s:any) {
    const v=prompt("Payment amount",String(s.credit_amount));
    if(v) await post("receiveSalePayment",{mode,saleId:s.id,amount:Number(v),receivedBy:prompt("Received by (Rahul / Devesh / Nitin)")||undefined,paymentMode:prompt("Payment mode","Cash")||"Cash",paymentDate:new Date().toISOString().slice(0,10)});
  }

  async function addPurchase() {
    const m=materials.find((x:Material)=>String(x.id)===purchase.materialId);
    const ok=await post("addPurchase",{
      mode, materialId:m?.id, materialName:purchase.materialName||m?.name_en,
      supplierId:purchase.supplierId?Number(purchase.supplierId):undefined,
      purchaseType:purchase.purchaseType, quantityKg:Number(purchase.quantityKg),
      ratePerKg:Number(purchase.ratePerKg), paidAmount:purchase.paidAmount===""?undefined:Number(purchase.paidAmount), paidBy:purchase.paidBy||undefined,
      borrowingId:purchase.borrowingId?Number(purchase.borrowingId):undefined,
      lenderId:purchase.lenderId?Number(purchase.lenderId):undefined, purchaseDate:purchase.purchaseDate, notes:purchase.notes
    });
    if(ok)setPurchase({...emptyPurchase});
  }

  async function editPurchase() {
    if (editingPurchase===null) return;
    const m=materials.find((x:Material)=>String(x.id)===purchase.materialId);
    const ok=await post("updatePurchase",{
      purchaseId:editingPurchase, mode, materialId:m?.id, materialName:purchase.materialName||m?.name_en,
      supplierId:purchase.supplierId?Number(purchase.supplierId):undefined, purchaseType:purchase.purchaseType,
      quantityKg:Number(purchase.quantityKg), ratePerKg:Number(purchase.ratePerKg), paidBy:purchase.paidBy||undefined, purchaseDate:purchase.purchaseDate, notes:purchase.notes
    });
    if(ok){setEditingPurchase(null);setPurchase({...emptyPurchase});}
  }

  function startEditPurchase(p:Purchase) {
    setEditingPurchase(p.id);
    setPurchase({materialId:"",materialName:p.material_name,supplierId:p.supplierName ? String((data?.suppliers||[]).find((s:Supplier)=>s.name===p.supplierName)?.id||"") : "",purchaseType:p.purchase_type,quantityKg:String(p.quantity_kg),ratePerKg:String(p.rate_per_kg),paidAmount:String(p.paid_amount),paidBy:p.paid_by||"",borrowingId:"",lenderId:"",purchaseDate:p.purchase_date,notes:""});
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function addBorrowing() {
    if(await post("addBorrowing",{...borrowing,mode,lenderId:Number(borrowing.lenderId),amount:Number(borrowing.amount)}))
      setBorrowing({lenderId:"",amount:"",purpose:"",notes:""});
  }

  async function adjustInventory() {
    if(await post("adjustInventory",{...adjust,mode,materialId:adjust.materialId?Number(adjust.materialId):undefined,quantityKg:Number(adjust.quantityKg),amount:Number(adjust.amount||0)}))
      setAdjust({materialId:"",materialName:"",quantityKg:"",amount:"",notes:""});
  }

  if(!data) return <AdminShell title="Inventory & Finance"><div className="ad-card p-6">Loading…</div></AdminShell>;

  return <AdminShell title={mode + " Inventory & Finance"} subtitle={"Internal " + mode + " inventory, purchases, supplier credit and borrowed funds"}>
    <div>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ml-2 text-xs text-[var(--ad-muted)]">Current stock: <b>{currentKg.toFixed(2)} kg</b></span>
        {message && <span className="text-xs text-[var(--ad-accent)]">{message}</span>}
      </div>
    </div>

    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div className="ad-card p-4"><p className="ad-muted text-xs">Current {mode} stock</p><p className="mt-1 text-2xl font-bold">{currentKg.toFixed(2)} kg</p></div>
      <div className="ad-card p-4"><p className="ad-muted text-xs">Outstanding borrowed</p><p className="mt-1 text-2xl font-bold">₹{openBorrowings.reduce((n:any,x:any)=>n+Number(x.outstanding_amount),0).toFixed(2)}</p></div>
      <div className="ad-card p-4"><p className="ad-muted text-xs">Supplier credit</p><p className="mt-1 text-2xl font-bold">₹{filteredPurchases.reduce((n:any,x:any)=>n+Number(x.credit_amount),0).toFixed(2)}</p></div>
    </div>

    <div className="mb-4 flex flex-wrap gap-2">
      {[["purchases","Purchases"],["sales","Sales"],["inventory","Inventory"],["expenses","Expenses"],["borrowings","Borrowings"]].map(([value,label])=><button key={value} onClick={()=>setTab(value)} className={tab===value?"ad-btn ad-btn-primary":"ad-btn ad-btn-ghost"}>{label}</button>)}
    </div>

    {tab==="purchases" && <div className="space-y-5">
      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">{editingPurchase ? `Edit ${mode} purchase #${editingPurchase}` : `Add ${mode} purchase`}</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <select className="ad-input" value={purchase.supplierId} onChange={e=>setPurchase({...purchase,supplierId:e.target.value})}>
            <option value="">Select vendor</option>{(data.suppliers||[]).map((s:Supplier)=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="ad-input" value={purchase.materialName} onChange={e=>setPurchase({...purchase,materialName:e.target.value})}>
            <option value="">Material</option>
            <option value="Natural Bottles">Natural Bottles</option>
            <option value="Red Bottles">Red Bottles</option>
          </select>
          <input className="ad-input" type="date" value={purchase.purchaseDate} onChange={e=>setPurchase({...purchase,purchaseDate:e.target.value})}/>
          <input className="ad-input" type="number" placeholder="Quantity (kg)" value={purchase.quantityKg} onChange={e=>setPurchase({...purchase,quantityKg:e.target.value})}/>
          <input className="ad-input" type="number" placeholder="Rate / kg" value={purchase.ratePerKg} onChange={e=>setPurchase({...purchase,ratePerKg:e.target.value})}/>
          <span className="ad-input flex items-center text-sm">Total: ₹{((Number(purchase.quantityKg)||0)*(Number(purchase.ratePerKg)||0)).toFixed(2)}</span><input className="ad-input" type="number" min="0" placeholder="Paid to vendor" value={purchase.paidAmount} onChange={e=>setPurchase({...purchase,paidAmount:e.target.value})}/><select className="ad-input" value={purchase.paidBy} onChange={e=>setPurchase({...purchase,paidBy:e.target.value})}><option value="">Payment done by</option><option>Rahul</option><option>Devesh</option><option>Nitin</option></select>
          {purchase.purchaseType==="BORROWED_FUND" && <select className="ad-input" value={purchase.borrowingId} onChange={e=>setPurchase({...purchase,borrowingId:e.target.value})}><option value="">Select borrowing</option>{openBorrowings.map((b:Borrowing)=><option key={b.id} value={b.id}>#{b.id} {b.lenderName} — ₹{b.outstanding_amount}</option>)}</select>}
          <input className="ad-input md:col-span-2" placeholder="Notes" value={purchase.notes} onChange={e=>setPurchase({...purchase,notes:e.target.value})}/>
          
          
          
          
          <button className="ad-btn ad-btn-primary" onClick={editingPurchase ? editPurchase : addPurchase}>{editingPurchase ? "Update purchase" : "Save purchase"}</button>{editingPurchase&&<button className="ad-btn ad-btn-ghost" onClick={()=>{setEditingPurchase(null);setPurchase({...emptyPurchase})}}>Cancel</button>}
        </div>
      </div>

      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Date</th><th>Vendor</th><th>Material</th><th>Qty</th><th>Rate</th><th>Vendor Total</th><th>Paid</th><th>Unpaid</th><th>Payment done by</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {filteredPurchases.map((p:Purchase)=><tr key={p.id}><td>{p.purchase_date}</td><td>{p.supplierName||"—"}</td><td>{p.material_name}</td><td>{p.quantity_kg} kg</td><td>₹{p.rate_per_kg}</td><td>₹{p.total_amount}</td><td>₹{p.paid_amount}</td><td>₹{p.credit_amount}</td><td>{Number(p.paid_amount)>0?p.paid_by||"—":"—"}</td><td>{Number(p.paid_amount)>0?"PAID":"UNPAID"}</td><td><button className="text-xs font-semibold text-[var(--ad-accent)] mr-3" onClick={()=>startEditPurchase(p)}>Edit</button>{p.credit_amount>0&&<button className="text-xs font-semibold text-[var(--ad-accent)]" onClick={async()=>{const v=prompt("Payment amount",String(p.credit_amount));if(!v)return;const paidBy=prompt("Payment done by (Rahul / Devesh / Nitin)")||"";if(paidBy&&!["Rahul","Devesh","Nitin"].includes(paidBy)){setMessage("Invalid payer");return;}await post("paySupplierCredit",{purchaseId:p.id,amount:Number(v),paidBy:paidBy||undefined})}}>Pay credit</button>}</td></tr>)}
      </tbody></table></div>
    </div>}

    {tab==="sales" && <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="ad-card p-4"><p className="ad-muted text-xs">Company Balance</p><p className="mt-1 text-2xl font-bold">₹{Number(data.cashBalance?.[mode]||0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Total Sales</p><p className="mt-1 text-2xl font-bold">₹{(data.sales||[]).filter((s:any)=>s.mode===mode).reduce((n:number,s:any)=>n+Number(s.total_amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Received</p><p className="mt-1 text-2xl font-bold">₹{(data.sales||[]).filter((s:any)=>s.mode===mode).reduce((n:number,s:any)=>n+Number(s.received_amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Pending</p><p className="mt-1 text-2xl font-bold">₹{(data.sales||[]).filter((s:any)=>s.mode===mode).reduce((n:number,s:any)=>n+Number(s.credit_amount||0),0).toFixed(2)}</p></div>
      </div>
      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">{editingSale ? `Edit Sale #${editingSale}` : "Add Sale — One Go / Full Truck"}</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <input className="ad-input" placeholder="Customer / Buyer name" value={sale.customerName} onChange={e=>setSale({...sale,customerName:e.target.value})}/>
          <input className="ad-input" placeholder="Contact number" value={sale.phone} onChange={e=>setSale({...sale,phone:e.target.value})}/>
          <input className="ad-input" placeholder="Location" value={sale.location} onChange={e=>setSale({...sale,location:e.target.value})}/>
          <input className="ad-input" type="date" value={sale.saleDate} onChange={e=>setSale({...sale,saleDate:e.target.value})}/>
        </div>
        <div className="mt-3 space-y-2">
          {saleItems.map((item:any,i:number)=><div key={i} className="grid gap-2 md:grid-cols-6">
            <select className="ad-input" value={item.materialCategory} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,materialCategory:e.target.value,materialVariant:e.target.value==="Red Bottles"?"Red":"Green"}:x))}>
              <option>Natural Bottles</option><option>Red Bottles</option>
            </select>
            <select className="ad-input" value={item.materialVariant} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,materialVariant:e.target.value}:x))}>
              {item.materialCategory==="Red Bottles" ? <option value="Red">Red</option> : <><option value="Green">Green</option><option value="White">White</option><option value="White Milk">White Milk</option></>}
            </select>
            <input className="ad-input" type="number" placeholder="Quantity (kg)" value={item.quantityKg} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,quantityKg:e.target.value}:x))}/>
            <input className="ad-input" type="number" placeholder="Rate / kg" value={item.ratePerKg} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,ratePerKg:e.target.value}:x))}/>
            <span className="ad-input flex items-center text-sm">₹{((Number(item.quantityKg)||0)*(Number(item.ratePerKg)||0)).toFixed(2)}</span>
            {saleItems.length>1?<button className="ad-btn ad-btn-ghost" onClick={()=>setSaleItems(saleItems.filter((_:any,j:number)=>j!==i))}>Remove</button>:<span/>}
          </div>)}
          <button className="ad-btn ad-btn-ghost" onClick={()=>setSaleItems([...saleItems,{materialCategory:"Natural Bottles",materialVariant:"Green",quantityKg:"",ratePerKg:""}])}>+ Add Material</button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <span className="ad-input flex items-center font-semibold">Gross Sale: ₹{saleGrossAmount.toFixed(2)}</span>
          <span className="ad-input flex items-center">Labour Charges (₹2/kg): -₹{saleLabourCharges.toFixed(2)}</span>
          <input className="ad-input" type="number" min="0" placeholder="Loading Charges" value={sale.loadingCharges||""} onChange={e=>setSale({...sale,loadingCharges:e.target.value})}/>
          <span className="ad-input flex items-center font-semibold">Final Amount: ₹{saleFinalAmount.toFixed(2)}</span>
          <input className="ad-input" type="number" min="0" max={saleFinalAmount} disabled={editingSale!==null} placeholder={editingSale?"Received payment (history)":"Total received payment"} value={sale.receivedAmount} onChange={e=>setSale({...sale,receivedAmount:e.target.value})}/>
          <select className="ad-input" value={sale.receivedBy} onChange={e=>setSale({...sale,receivedBy:e.target.value})}><option value="">Received by</option><option>Rahul</option><option>Devesh</option><option>Nitin</option></select>
          <select className="ad-input" value={sale.paymentMode} onChange={e=>setSale({...sale,paymentMode:e.target.value})}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
          <input className="ad-input md:col-span-2" placeholder="Notes" value={sale.notes} onChange={e=>setSale({...sale,notes:e.target.value})}/>
          <button className="ad-btn ad-btn-primary" onClick={editingSale ? editSale : addSale}>{editingSale ? "Update Sale" : "Save Full Truck Sale"}</button>{editingSale&&<button className="ad-btn ad-btn-ghost" onClick={resetSaleForm}>Cancel</button>}
        </div>
        <p className="mt-2 text-xs ad-muted">Processing labour is automatically ₹2/kg for every sale. Loading charges are sale-specific and paid after the sale. GST is intentionally not included for now.</p>
      </div>
      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Date</th><th>Buyer</th><th>Contact</th><th>Materials</th><th>Total</th><th>Received</th><th>Pending</th><th>Action</th></tr></thead><tbody>
        {(data.sales||[]).filter((s:any)=>s.mode===mode).map((s:any)=><tr key={s.id}><td>{s.sale_date}</td><td>{s.customer_name}</td><td>{s.phone||"—"}</td><td>{(data.saleItems||[]).filter((x:any)=>x.sale_id===s.id).map((x:any)=>x.material_variant+" "+x.quantity_kg+"kg @ ₹"+x.rate_per_kg).join(" | ")||s.material_variant}</td><td>₹{s.total_amount}</td><td>₹{s.received_amount}</td><td>₹{s.credit_amount}</td><td>{s.credit_amount>0?<button className="text-xs font-semibold text-[var(--ad-accent)] mr-3" onClick={()=>receiveSalePayment(s)}>Receive</button>:<span className="mr-3">PAID</span>}<button className="text-xs font-semibold text-[var(--ad-accent)]" onClick={()=>startEditSale(s)}>Edit</button></td></tr>)}
      </tbody></table></div>
    </div>}
    {tab==="inventory" && <div className="space-y-5">
      <div className="ad-card p-4"><h2 className="mb-3 font-semibold">Inventory adjustment</h2><div className="grid gap-2 md:grid-cols-5">
        <select className="ad-input" value={adjust.materialId} onChange={e=>setAdjust({...adjust,materialId:e.target.value,materialName:""})}><option value="">Material</option>{materials.map((m:Material)=><option key={m.id} value={m.id}>{m.name_en}</option>)}</select>
        <input className="ad-input" placeholder="Material name" value={adjust.materialName} onChange={e=>setAdjust({...adjust,materialName:e.target.value})}/>
        <input className="ad-input" type="number" placeholder="+/- kg" value={adjust.quantityKg} onChange={e=>setAdjust({...adjust,quantityKg:e.target.value})}/>
        <input className="ad-input" type="number" placeholder="Value" value={adjust.amount} onChange={e=>setAdjust({...adjust,amount:e.target.value})}/>
        <button className="ad-btn ad-btn-primary" onClick={adjustInventory}>Save adjustment</button>
      </div><input className="ad-input mt-2 w-full" placeholder="Reason / notes (required)" value={adjust.notes} onChange={e=>setAdjust({...adjust,notes:e.target.value})}/></div>
      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Material</th><th>Mode</th><th>Quantity</th><th>Value</th></tr></thead><tbody>{filteredInventory.map((x:any)=><tr key={x.mode+"-"+x.materialId}><td>{x.materialName}</td><td>{x.mode}</td><td>{Number(x.quantityKg).toFixed(2)} kg</td><td>₹{Number(x.value).toFixed(2)}</td></tr>)}</tbody></table></div>
    </div>}

    {tab==="expenses" && <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ad-card p-4"><p className="ad-muted text-xs">Total Expenses</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>x.mode===mode).reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Monthly Processing Expense</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>x.mode===mode&&(x.expense_type==="Electricity"||x.expense_type==="Thread")).reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Other Admin & Maintenance</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>x.mode===mode&&(x.expense_type==="GST / Admin"||x.expense_type==="Infrastructure / Maintenance"||x.expense_type==="Other")).reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Current Month</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>x.mode===mode&&((x.expense_type==="Electricity"&&x.billing_month===new Date().toISOString().slice(0,7))||(!x.billing_month&&String(x.expense_date||"").startsWith(new Date().toISOString().slice(0,7))))).reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
      </div>
      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">Add Business Expense</h2>
        <p className="mb-3 text-xs ad-muted">Use this for costs outside a specific sale or purchase. Sale labour/loading stay on the Sale screen.</p>
        <div className="grid gap-2 md:grid-cols-6">
          <select className="ad-input" value={expense.expenseType} onChange={e=>setExpense({...expense,expenseType:e.target.value})}>
            <option>Electricity</option><option>Thread</option><option>GST / Admin</option><option>Infrastructure / Maintenance</option><option>Other</option>
          </select>
          <input className="ad-input" type="number" min="0" placeholder="Amount" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})}/>
          <input className="ad-input" type="date" value={expense.expenseDate} onChange={e=>setExpense({...expense,expenseDate:e.target.value})}/>
          {expense.expenseType==="Electricity" && <><input className="ad-input" type="month" value={expense.billingMonth} onChange={e=>setExpense({...expense,billingMonth:e.target.value})}/><input className="ad-input" type="date" value={expense.billingStartDate} onChange={e=>setExpense({...expense,billingStartDate:e.target.value})} placeholder="Billing start"/><input className="ad-input" type="date" value={expense.billingEndDate} onChange={e=>setExpense({...expense,billingEndDate:e.target.value})} placeholder="Billing end"/></>}
          <select className="ad-input" value={expense.paidBy} onChange={e=>setExpense({...expense,paidBy:e.target.value})}>
            <option value="">Paid by</option><option>Rahul</option><option>Devesh</option><option>Nitin</option>
          </select>
          <input className="ad-input" placeholder="Description / notes" value={expense.description} onChange={e=>setExpense({...expense,description:e.target.value})}/>
        </div>
        <button className="ad-btn ad-btn-primary mt-3" onClick={addExpense}>Save Expense</button>
      </div>
      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Payment Date</th><th>Category</th><th>Billing Period</th><th>Description</th><th>Amount</th><th>Paid by</th></tr></thead><tbody>
        {(data.otherExpenses||[]).filter((x:any)=>x.mode===mode).map((x:any)=><tr key={x.id}><td>{x.expense_date}</td><td>{x.expense_type}</td><td>{x.expense_type==="Electricity" ? (x.billing_start_date&&x.billing_end_date ? `${x.billing_start_date} → ${x.billing_end_date}` : x.billing_month||"—") : "Expense date month"}</td><td>{x.description||"—"}</td><td>₹{Number(x.amount).toFixed(2)}</td><td>{x.paid_by||"—"}</td></tr>)}
      </tbody></table></div>
    </div>}

    {tab==="borrowings" && <div className="space-y-5">
      <div className="ad-card p-4"><h2 className="mb-3 font-semibold">Borrow funds for {mode}</h2><div className="grid gap-2 md:grid-cols-4">
        <select className="ad-input" value={borrowing.lenderId} onChange={e=>setBorrowing({...borrowing,lenderId:e.target.value})}><option value="">Lender</option>{(data.lenders||[]).map((l:Lender)=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <input className="ad-input" type="number" placeholder="Amount" value={borrowing.amount} onChange={e=>setBorrowing({...borrowing,amount:e.target.value})}/>
        <input className="ad-input" placeholder="Purpose" value={borrowing.purpose} onChange={e=>setBorrowing({...borrowing,purpose:e.target.value})}/>
        <button className="ad-btn ad-btn-primary" onClick={addBorrowing}>Add borrowing</button>
      </div></div>
      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Date</th><th>Lender</th><th>Amount</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>{filteredBorrowings.map((b:Borrowing)=><tr key={b.id}><td>{b.borrowing_date}</td><td>{b.lenderName}</td><td>₹{b.amount}</td><td>₹{b.outstanding_amount}</td><td>{b.outstanding_amount>0&&<button className="text-xs font-semibold text-[var(--ad-accent)]" onClick={async()=>{const v=prompt("Repayment amount",String(b.outstanding_amount));if(v)await post("repayBorrowing",{borrowingId:b.id,amount:Number(v)})}}>Repay</button>}</td></tr>)}</tbody></table></div>
    </div>}

    </div>
  </AdminShell>
}
