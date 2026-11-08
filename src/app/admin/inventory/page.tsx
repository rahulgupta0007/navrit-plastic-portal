/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, CalendarClock, Wallet, Trash2, Mail } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AdminSelect } from "@/components/admin-select";
import { FundingSelect } from "@/components/funding-select";
import { PersonSelect } from "@/components/person-select";
import { isAccountPerson } from "@/lib/account-persons";
import type { FundingSource } from "@/lib/funding";
import { useBusinessMode, type BusinessMode } from "@/components/business-mode-provider";

type Mode = BusinessMode;
type Material = { id:number; name_en:string; name_hi:string; category_en:string };
type Supplier = { id:number; name:string; phone:string; notes:string };
type Purchase = {
  id:number; mode:Mode; material_name:string; purchase_type:string; quantity_kg:number;
  rate_per_kg:number; total_amount:number; paid_amount:number; credit_amount:number;
  transport_charges:number; weight_charges:number; labour_charges:number; effective_cost:number;
  landed_total?:number;
  supplierName?:string; lenderName?:string; purchase_date:string; payment_date?:string;
  paid_by?:string; payment_done_by?:string;
};
type Borrowing = {
  id:number; mode:Mode; lenderName:string; amount:number; outstanding_amount:number;
  borrowing_date:string; purpose:string;
};
type PreStock = {
  id:number; mode:Mode; materialName:string; quantityKg:number; amount:number; stockDate:string; notes?:string;
};

const BUILTIN_EXPENSE_TYPES = [
  "Electricity",
  "Thread",
  "GST / Admin",
  "Infrastructure / Maintenance",
  "Other",
] as const;

function expenseTypeLabel(type: string) {
  return type === "Infrastructure / Maintenance" ? "Infra / Maint." : type;
}

export default function InventoryPage() {
  const { mode } = useBusinessMode();
  const [data,setData] = useState<any>(null);
  const [tab,setTab] = useState("purchases");
  const [expense,setExpense] = useState({expenseType:"Electricity",scope:"SHARED" as "MODE"|"SHARED",description:"",amount:"",expenseDate:new Date().toISOString().slice(0,10),billingMonth:new Date().toISOString().slice(0,7),billingStartDate:"",billingEndDate:"",paidBy:"",fundingSource:"COMPANY" as FundingSource});
  const [customExpenseTypes,setCustomExpenseTypes] = useState<string[]>([]);
  const [showNewExpenseType,setShowNewExpenseType] = useState(false);
  const [newExpenseTypeName,setNewExpenseTypeName] = useState("");
  const [sale,setSale] = useState({customerName:"",phone:"",location:"",receivedAmount:"",receivedBy:"",paymentMode:"Cash",loadingCharges:"",labourMode:"CONTRACT" as "CONTRACT"|"DAILY_WAGE",saleDate:new Date().toISOString().slice(0,10),notes:""});
  const [useAdvance,setUseAdvance] = useState(true);
  const [editingSale,setEditingSale] = useState<number|null>(null);
  const [saleItems,setSaleItems] = useState([{materialCategory:"Natural Bottles",materialVariant:"Green",quantityKg:"",ratePerKg:""}]);

  const [message,setMessage] = useState("");
  const emptyPurchase = { materialId:"", materialName:"", materialVariant:"Mixed", supplierId:"", purchaseType:"NORMAL", quantityKg:"", ratePerKg:"", paidAmount:"", paidBy:"", fundingSource:"COMPANY" as FundingSource, borrowingId:"", lenderId:"", purchaseDate:new Date().toISOString().slice(0,10), paymentDate:new Date().toISOString().slice(0,10), notes:"", transportCharges:"", loadingCharges:"" };
  const [purchase,setPurchase] = useState(emptyPurchase);
  const [editingPurchase,setEditingPurchase] = useState<number|null>(null);
  const [paymentEdit,setPaymentEdit] = useState<{purchaseId:number; paymentDate:string; paidBy:string} | null>(null);
  const [preStock,setPreStock] = useState({materialName:"Natural Bottles",materialVariant:"Mixed",quantityKg:"",ratePerKg:"",stockDate:"2026-09-30",notes:""});
  const [showPreStock,setShowPreStock] = useState(false);
  const [showPlasticTypes,setShowPlasticTypes] = useState(false);
  const [adjust,setAdjust] = useState({materialId:"",materialName:"",quantityKg:"",amount:"",notes:""});
  const [creditPay,setCreditPay] = useState<{purchaseId:number; amount:string; paidBy:string; fundingSource:FundingSource; paymentDate:string} | null>(null);
  const [salePay,setSalePay] = useState<{saleId:number; amount:string; receivedBy:string; paymentMode:string} | null>(null);
  const [plasticTypeName,setPlasticTypeName] = useState("");
  const [plasticTypeNotes,setPlasticTypeNotes] = useState("");
  const [sendEmail,setSendEmail] = useState(true);

  async function load() {
    const r=await fetch("/api/admin/inventory");
    if(r.status===401){window.location.href="/admin/login";return;}
    setData(await r.json());
  }
  useEffect(()=>{load()},[]);
  useEffect(() => {
    if (mode !== "PLASTIC") setShowPlasticTypes(false);
  }, [mode]);
  useEffect(() => {
    if (mode === "PLASTIC") {
      const first = (data?.plasticMaterialTypes || []).find((t: any) => t.active)?.name || "";
      setPurchase((p) => ({ ...p, materialName: first, materialVariant: "" }));
      setSaleItems((items) => items.map((it) => ({
        ...it,
        materialCategory: it.materialCategory && !(it.materialCategory === "Natural Bottles" || it.materialCategory === "Red Bottles")
          ? it.materialCategory
          : first,
        materialVariant: "",
      })));
      setPreStock((ps) => {
        const isPlasticType = (data?.plasticMaterialTypes || []).some(
          (t: any) => t.active && t.name === ps.materialName
        );
        return {
          ...ps,
          materialName: isPlasticType ? ps.materialName : first,
          materialVariant: "",
        };
      });
    } else {
      // Switching back to PET must reset sale lines — otherwise a Plastic type stays in
      // state while the dropdown visually shows "Natural Bottles" and save fails.
      setPurchase((p) => ({
        ...p,
        materialName: p.materialName === "Natural Bottles" || p.materialName === "Red Bottles" ? p.materialName : "Natural Bottles",
        materialVariant: p.materialName === "Red Bottles" ? "Red" : (p.materialVariant || "Mixed"),
      }));
      setSaleItems((items) => items.map((it) => {
        const ok = it.materialCategory === "Natural Bottles" || it.materialCategory === "Red Bottles";
        if (ok) {
          const variant = it.materialCategory === "Red Bottles"
            ? (["Red Bottle", "Red Bottle Cap", "Red"].includes(String(it.materialVariant)) ? it.materialVariant : "Red Bottle")
            : (["Green", "White", "White Milk"].includes(String(it.materialVariant)) ? it.materialVariant : "Green");
          return { ...it, materialVariant: variant };
        }
        return { ...it, materialCategory: "Natural Bottles", materialVariant: "Green" };
      }));
      setPreStock((ps) => {
        const materialName = ps.materialName === "Natural Bottles" || ps.materialName === "Red Bottles"
          ? ps.materialName
          : "Natural Bottles";
        return {
          ...ps,
          materialName,
          materialVariant: materialName === "Red Bottles" ? "Red" : "Mixed",
        };
      });
    }
  }, [mode, data?.plasticMaterialTypes]);

  const materials = useMemo(()=> (data?.materials||[]).filter((m:Material)=>m.id),[data]);
  const plasticTypes = useMemo(() => (data?.plasticMaterialTypes || []).filter((t: any) => t.active), [data]);
  const allPlasticTypes = useMemo(() => data?.plasticMaterialTypes || [], [data]);
  const filteredInventory=(data?.inventory||[]).filter((x:any)=>x.mode===mode);
  const filteredPurchases=(data?.purchases||[]).filter((x:Purchase)=>x.mode===mode);
  const filteredBorrowings=(data?.borrowings||[]).filter((x:Borrowing)=>x.mode===mode);
  const openBorrowings=filteredBorrowings.filter((x:Borrowing)=>x.outstanding_amount>0);
  const currentKg=filteredInventory.reduce((n:any,x:any)=>n+Number(x.quantityKg||0),0);
  const saleGrossAmount=saleItems.reduce((n:number,x:any)=>n+(Number(x.quantityKg)||0)*(Number(x.ratePerKg)||0),0);
  const saleTotalWeight=saleItems.reduce((n:number,x:any)=>n+(Number(x.quantityKg)||0),0);
  const saleLabourCharges=mode==="PET"&&sale.labourMode==="CONTRACT"?saleTotalWeight*2:0;
  const saleLoadingCharges=Number(sale.loadingCharges||0);
  const saleFinalAmount=Math.max(0,saleGrossAmount-saleLabourCharges-saleLoadingCharges);
  const modeBuyers=useMemo(()=>{
    const registered=((data?.buyers||[]) as any[]).filter((b:any)=>b.mode===mode&&b.name);
    if (registered.length) return registered;
    // Fallback until buyers table is populated from history.
    return ((data?.buyerSummary||[]) as any[]).filter((b:any)=>b.mode===mode&&b.name);
  }, [data?.buyers, data?.buyerSummary, mode]);
  const selectedBuyer=((data?.buyerSummary||[]) as any[]).find((b:any)=>b.mode===mode&&String(b.name||"").trim().toLowerCase()===sale.customerName.trim().toLowerCase());
  const buyerAdvanceAvail=Number(selectedBuyer?.advanceBalance||0);
  const advanceWillApply=useAdvance?Math.min(Number(buyerAdvanceAvail),saleFinalAmount):0;
  const cashAfterAdvance=Math.max(0,saleFinalAmount-advanceWillApply);
  function pickBuyer(name: string) {
    const key=name.trim().toLowerCase();
    const buyer = modeBuyers.find((b:any)=>String(b.name||"").trim().toLowerCase()===key)
      || ((data?.buyerSummary||[]) as any[]).find((b:any)=>b.mode===mode&&String(b.name||"").trim().toLowerCase()===key);
    setSale({
      ...sale,
      customerName: buyer?.name || name,
      phone: buyer?.phone || "",
      location: buyer?.location || "",
    });
  }

  function emailMessage(email:any): string {
    if (!email) return "";
    if (!email.configured) return email.skippedReason || "Email not configured yet (saved offline)";
    if (email.skipped && email.skippedReason === "Email notify turned off") return "Email skipped";
    if (email.skipped) return email.skippedReason ? `Email: ${email.skippedReason}` : "Email skipped";
    if (email.ok) return `Email sent to ${email.to || "your Gmail"}`;
    return `Email failed: ${email.error || "error"}`;
  }

  async function post(action:string, body:any) {
    let r: Response;
    try {
      r = await fetch("/api/admin/inventory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...body})});
    } catch {
      setMessage("Network error — could not reach server. Check internet / Railway status.");
      return false;
    }
    const raw = await r.text();
    let j: any = {};
    try { j = raw ? JSON.parse(raw) : {}; } catch { j = {}; }
    if(!r.ok){
      const mailNote = emailMessage(j.email);
      const detail = mailNote || j.error || (r.status === 502 || r.status === 504
        ? "Server timed out (often Gmail SMTP blocked on Railway). Purchase may still be saved — refresh list. Use Send test email / RESEND_API_KEY."
        : r.status === 401
          ? "Session expired — please login again"
          : raw && !raw.trim().startsWith("{")
            ? `Save failed (HTTP ${r.status}). Server returned a non-JSON error.`
            : `Could not save (HTTP ${r.status}) — please check the form and try again`);
      setMessage(detail);
      return false;
    }
    const mailNote = emailMessage(j.email);
    setMessage(mailNote ? `Saved successfully · ${mailNote}` : "Saved successfully");
    await load();
    return true;
  }

  async function sendTestEmail() {
    setMessage("Sending test email…");
    const r = await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "testEmail" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const missing = Array.isArray(j.diagnostics?.missing) ? j.diagnostics.missing.join(", ") : "";
      setMessage(j.error || j.email?.error || (missing ? `Missing Railway vars: ${missing}` : "Test email failed"));
      return;
    }
    setMessage(`Test email sent to ${j.email?.to || data?.notifyEmail || "inbox"}${j.transport ? ` via ${j.transport}` : ""} — check inbox/Spam`);
  }

  async function savePlasticType() {
    if (!plasticTypeName.trim()) { setMessage("Enter a plastic material type name"); return; }
    const ok = await post("upsertPlasticMaterialType", { name: plasticTypeName.trim(), notes: plasticTypeNotes });
    if (ok) {
      setPlasticTypeName("");
      setPlasticTypeNotes("");
      setShowPlasticTypes(false);
    }
  }

  function defaultSaleItem() {
    if (mode === "PLASTIC") {
      const first = plasticTypes[0]?.name || "";
      return { materialCategory: first, materialVariant: "", quantityKg: "", ratePerKg: "" };
    }
    return { materialCategory: "Natural Bottles", materialVariant: "Green", quantityKg: "", ratePerKg: "" };
  }

  function validatePurchaseForm() {
    if (!purchase.supplierId) return "Please select a Vendor";
    if (!purchase.materialName) return mode==="PLASTIC" ? "Please select a Plastic material type" : "Please select Material (Natural or Red)";
    const qty = Number(purchase.quantityKg);
    if (!(qty > 0)) return "Please enter Quantity (kg) greater than 0";
    const rate = Number(purchase.ratePerKg);
    if (purchase.ratePerKg === "" || Number.isNaN(rate) || rate < 0) return "Please enter Rate / kg";
    const paid = purchase.paidAmount === "" ? 0 : Number(purchase.paidAmount);
    if (purchase.paidAmount !== "" && (Number.isNaN(paid) || paid < 0)) return "Paid to vendor must be a valid amount (0 or more)";
    const transport = purchase.transportCharges === "" ? 0 : Number(purchase.transportCharges);
    const loading = purchase.loadingCharges === "" ? 0 : Number(purchase.loadingCharges);
    if (purchase.transportCharges !== "" && (Number.isNaN(transport) || transport < 0)) return "Transport must be 0 or more";
    if (purchase.loadingCharges !== "" && (Number.isNaN(loading) || loading < 0)) return "Loading charges must be 0 or more";
    if (paid > 0 && !purchase.paidBy) return "Please select Payment done by when paying the vendor";
    if ((transport > 0 || loading > 0) && !purchase.paidBy) return "Please select Payment done by when paying transport / loading";
    if (!purchase.purchaseDate) return "Please select Purchase date";
    return "";
  }

  const materialTotal = (Number(purchase.quantityKg) || 0) * (Number(purchase.ratePerKg) || 0);
  const transportAmt = Number(purchase.transportCharges) || 0;
  const loadingAmt = Number(purchase.loadingCharges) || 0;
  const landedTotal = materialTotal + transportAmt + loadingAmt;
  const finalRate = (Number(purchase.quantityKg) || 0) > 0 ? landedTotal / Number(purchase.quantityKg) : 0;

  function resetSaleForm() {
    setEditingSale(null);
    setSale({customerName:"",phone:"",location:"",receivedAmount:"",receivedBy:"",paymentMode:"Cash",loadingCharges:"",labourMode:"CONTRACT",saleDate:new Date().toISOString().slice(0,10),notes:""});
    setSaleItems([defaultSaleItem()]);
  }

  function saleItemsPayload() {
    return saleItems.map((x) => {
      let materialCategory = String(x.materialCategory || "").trim();
      let materialVariant = String(x.materialVariant || "").trim();
      if (mode === "PET") {
        if (materialCategory !== "Natural Bottles" && materialCategory !== "Red Bottles") {
          materialCategory = "Natural Bottles";
        }
        if (materialCategory === "Red Bottles") {
          if (materialVariant === "Red") materialVariant = "Red Bottle";
          if (materialVariant !== "Red Bottle" && materialVariant !== "Red Bottle Cap") materialVariant = "Red Bottle";
        } else if (!["Green", "White", "White Milk"].includes(materialVariant)) {
          materialVariant = "Green";
        }
      }
      return {
        materialCategory,
        materialVariant,
        quantityKg: Number(x.quantityKg),
        ratePerKg: Number(x.ratePerKg),
      };
    });
  }

  async function addSale() {
    if (!sale.customerName.trim()) { setMessage("Select a buyer from the list (add in Vendors & Buyers first)"); return; }
    // If PET↔Plastic left a wrong category in state while the select looked correct, normalize before save.
    const items = saleItemsPayload();
    if (mode === "PET") {
      setSaleItems((prev) => prev.map((it, idx) => ({
        ...it,
        materialCategory: items[idx]?.materialCategory ?? "Natural Bottles",
        materialVariant: items[idx]?.materialVariant ?? "Green",
      })));
    }
    const ok=await post("addSale",{mode,customerName:sale.customerName,phone:sale.phone,location:sale.location,items,receivedAmount:sale.receivedAmount===""?undefined:Number(sale.receivedAmount),receivedBy:sale.receivedBy||undefined,paymentMode:sale.paymentMode,loadingCharges:Number(sale.loadingCharges||0),labourMode:sale.labourMode,saleDate:sale.saleDate,useAdvance,notes:sale.notes});
    if(ok) resetSaleForm();
  }

  async function editSale() {
    if(editingSale===null) return;
    const ok=await post("updateSale",{saleId:editingSale,mode,customerName:sale.customerName,phone:sale.phone,location:sale.location,items:saleItemsPayload(),loadingCharges:Number(sale.loadingCharges||0),labourMode:sale.labourMode,receivedBy:sale.receivedBy||undefined,paymentMode:sale.paymentMode,saleDate:sale.saleDate,notes:sale.notes});
    if(ok) resetSaleForm();
  }

  function startEditSale(s:any) {
    const items=(data.saleItems||[]).filter((x:any)=>x.sale_id===s.id);
    const payments=(data.salePayments||[]).filter((x:any)=>x.sale_id===s.id);
    const latestPayment=payments.find((x:any)=>x.payment_mode!=="Advance")||payments[0];
    setEditingSale(s.id);
    setSale({
      customerName:s.customer_name||"",
      phone:s.phone||"",
      location:s.location||"",
      receivedAmount:String(s.received_amount??""),
      receivedBy:latestPayment?.received_by||"",
      paymentMode:latestPayment?.payment_mode||"Cash",
      loadingCharges:String(s.loading_charges??""),
      labourMode:(s.labour_mode==="DAILY_WAGE" || (Number(s.labour_charges||0)<=0 && mode==="PET")) ? "DAILY_WAGE" : "CONTRACT",
      saleDate:s.sale_date,
      notes:s.notes||""
    });
    setSaleItems(items.length ? items.map((x:any)=>({materialCategory:x.material_category,materialVariant:x.material_variant,quantityKg:String(x.quantity_kg),ratePerKg:String(x.rate_per_kg)})) : [{materialCategory:s.material_category,materialVariant:s.material_variant==="MIXED"?"Green":s.material_variant,quantityKg:String(s.quantity_kg),ratePerKg:String(s.rate_per_kg||0)}]);
    window.scrollTo({top:0,behavior:"smooth"});
  }
  const expenseTypeOptions = useMemo(() => {
    const fromHistory = (data?.otherExpenses || [])
      .map((x: any) => String(x.expense_type || "").trim())
      .filter(Boolean);
    const all = [...BUILTIN_EXPENSE_TYPES, ...customExpenseTypes, ...fromHistory];
    const seen = new Set<string>();
    return all.filter((type) => {
      const key = type.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data?.otherExpenses, customExpenseTypes]);

  function selectExpenseType(type: string) {
    setExpense((prev) => ({
      ...prev,
      expenseType: type,
      scope: type === "Electricity" ? prev.scope : "MODE",
    }));
  }

  function addNewExpenseType() {
    const name = newExpenseTypeName.trim().replace(/\s+/g, " ");
    if (!name) { setMessage("Enter a new expense type name"); return; }
    if (name.length > 80) { setMessage("Expense type name is too long (max 80)"); return; }
    const existing = expenseTypeOptions.find((t) => t.toLowerCase() === name.toLowerCase());
    if (existing) {
      selectExpenseType(existing);
    } else {
      setCustomExpenseTypes((prev) => [...prev, name]);
      selectExpenseType(name);
    }
    setNewExpenseTypeName("");
    setShowNewExpenseType(false);
    setMessage(`Expense type ready: ${existing || name}`);
  }

  async function addExpense() {
    const amount=Number(expense.amount||0);
    if(amount<=0) { setMessage("Enter a valid expense amount"); return; }
    if(!expense.expenseType.trim()) { setMessage("Select or add an expense type"); return; }
    const expenseMode = expense.scope === "SHARED" ? "SHARED" : mode;
    const ok=await post("addOtherExpense",{mode:expenseMode,expenseType:expense.expenseType,description:expense.description,amount,expenseDate:expense.expenseDate,...(expense.expenseType==="Electricity"?{billingMonth:expense.billingMonth,billingStartDate:expense.billingStartDate,billingEndDate:expense.billingEndDate}:{}),paidBy:expense.paidBy||undefined,fundingSource:expense.fundingSource});
    if(ok) setExpense({expenseType:expense.expenseType,scope:expense.scope,description:"",amount:"",expenseDate:new Date().toISOString().slice(0,10),billingMonth:new Date().toISOString().slice(0,7),billingStartDate:"",billingEndDate:"",paidBy:"",fundingSource:"COMPANY"});
  }

  function openSalePayment(s:any) {
    setSalePay({saleId:s.id, amount:String(s.credit_amount??""), receivedBy:"", paymentMode:"Cash"});
  }

  async function submitSalePayment() {
    if(!salePay) return;
    const amount=Number(salePay.amount);
    if(!(amount>0)) { setMessage("Enter a valid payment amount"); return; }
    if(salePay.receivedBy && !isAccountPerson(salePay.receivedBy)) {
      setMessage("Invalid payment person"); return;
    }
    const ok=await post("receiveSalePayment",{
      mode, saleId:salePay.saleId, amount,
      receivedBy:salePay.receivedBy||undefined,
      paymentMode:salePay.paymentMode||"Cash",
      paymentDate:new Date().toISOString().slice(0,10),
    });
    if(ok) setSalePay(null);
  }

  function openCreditPayment(p:Purchase) {
    setCreditPay({purchaseId:p.id, amount:String(p.credit_amount??""), paidBy:"", fundingSource:"COMPANY", paymentDate:new Date().toISOString().slice(0,10)});
  }

  async function submitCreditPayment() {
    if(!creditPay) return;
    const amount=Number(creditPay.amount);
    if(!(amount>0)) { setMessage("Enter a valid payment amount"); return; }
    if(!creditPay.paidBy || !isAccountPerson(creditPay.paidBy)) {
      setMessage("Payment done by is required for later vendor payments"); return;
    }
    const ok=await post("paySupplierCredit",{
      purchaseId:creditPay.purchaseId,
      amount,
      paidBy:creditPay.paidBy,
      fundingSource:creditPay.fundingSource,
      paymentDate:creditPay.paymentDate,
      sendEmail,
    });
    if(ok) setCreditPay(null);
  }

  async function resendPurchaseEmail(purchaseId: number) {
    await post("resendPurchaseEmail", { purchaseId, kind: "purchase" });
  }

  function purchaseCategoryAndVariant(materialName:string, materialVariant?:string) {
    if (materialName === "Red Bottles" || materialVariant === "Red") {
      return { materialName: "Red Bottles", materialVariant: "Red" };
    }
    if (materialName.startsWith("Natural Bottles") || materialName === "Natural Bottles") {
      return { materialName: "Natural Bottles", materialVariant: "Mixed" };
    }
    return { materialName, materialVariant: materialVariant || "Mixed" };
  }

  async function addPurchase() {
    const clientError = validatePurchaseForm();
    if (clientError) { setMessage(clientError); return; }
    const m=materials.find((x:Material)=>String(x.id)===purchase.materialId);
    const cashPaid=purchase.paidAmount===""?undefined:Number(purchase.paidAmount);
    const ok=await post("addPurchase",{
      mode, materialId:m?.id, materialName:purchase.materialName||m?.name_en,
      materialVariant:purchase.materialName==="Red Bottles"?"Red":"Mixed",
      supplierId:purchase.supplierId?Number(purchase.supplierId):undefined,
      purchaseType:purchase.purchaseType, quantityKg:Number(purchase.quantityKg),
      ratePerKg:Number(purchase.ratePerKg), paidAmount:cashPaid, paidBy:purchase.paidBy||undefined, fundingSource:purchase.fundingSource,
      borrowingId:purchase.borrowingId?Number(purchase.borrowingId):undefined,
      lenderId:purchase.lenderId?Number(purchase.lenderId):undefined,
      purchaseDate:purchase.purchaseDate,
      paymentDate: cashPaid && cashPaid>0 ? (purchase.paymentDate || purchase.purchaseDate) : undefined,
      notes:purchase.notes,
      transportCharges: purchase.transportCharges==="" ? 0 : Number(purchase.transportCharges),
      loadingCharges: purchase.loadingCharges==="" ? 0 : Number(purchase.loadingCharges),
      sendEmail,
    });
    if(ok)setPurchase({...emptyPurchase});
  }

  async function editPurchase() {
    if (editingPurchase===null) return;
    const clientError = validatePurchaseForm();
    if (clientError) { setMessage(clientError); return; }
    const m=materials.find((x:Material)=>String(x.id)===purchase.materialId);
    const cashPaid=purchase.paidAmount===""?undefined:Number(purchase.paidAmount);
    const ok=await post("updatePurchase",{
      purchaseId:editingPurchase, mode, materialId:m?.id, materialName:purchase.materialName||m?.name_en,
      materialVariant:purchase.materialName==="Red Bottles"?"Red":"Mixed",
      supplierId:purchase.supplierId?Number(purchase.supplierId):undefined, purchaseType:purchase.purchaseType,
      quantityKg:Number(purchase.quantityKg), ratePerKg:Number(purchase.ratePerKg),
      paidAmount:cashPaid,
      paidBy:purchase.paidBy||undefined,
      fundingSource:purchase.fundingSource,
      purchaseDate:purchase.purchaseDate,
      paymentDate:purchase.paymentDate||undefined,
      notes:purchase.notes,
      transportCharges: purchase.transportCharges==="" ? 0 : Number(purchase.transportCharges),
      loadingCharges: purchase.loadingCharges==="" ? 0 : Number(purchase.loadingCharges),
      sendEmail,
    });
    if(ok){setEditingPurchase(null);setPurchase({...emptyPurchase});}
  }

  function startEditPurchase(p:Purchase) {
    setEditingPurchase(p.id);
    const parsed = purchaseCategoryAndVariant(p.material_name, (p as Purchase & {material_variant?:string}).material_variant);
    const payDate = p.payment_date || p.purchase_date;
    setPurchase({
      materialId:"",
      materialName:parsed.materialName,
      materialVariant:parsed.materialVariant || "Mixed",
      supplierId:p.supplierName ? String((data?.suppliers||[]).find((s:Supplier)=>s.name===p.supplierName)?.id||"") : "",
      purchaseType:p.purchase_type,
      quantityKg:String(p.quantity_kg),
      ratePerKg:String(p.rate_per_kg),
      paidAmount:String(p.paid_amount),
      paidBy:p.payment_done_by||p.paid_by||"",
      fundingSource:"COMPANY",
      borrowingId:"",
      lenderId:"",
      purchaseDate:p.purchase_date,
      paymentDate:payDate,
      notes:"",
      transportCharges: String(p.transport_charges || ""),
      loadingCharges: String(p.labour_charges || ""),
    });
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function openPaymentEdit(p:Purchase) {
    setPaymentEdit({
      purchaseId:p.id,
      paymentDate:p.payment_date || p.purchase_date || new Date().toISOString().slice(0,10),
      paidBy:p.payment_done_by || p.paid_by || "",
    });
  }

  async function submitPaymentEdit() {
    if(!paymentEdit) return;
    if(!paymentEdit.paymentDate) { setMessage("Payment date is required"); return; }
    if(paymentEdit.paidBy && !isAccountPerson(paymentEdit.paidBy)) {
      setMessage("Invalid payment person"); return;
    }
    const ok=await post("updatePurchasePayment",{
      purchaseId:paymentEdit.purchaseId,
      mode,
      paymentDate:paymentEdit.paymentDate,
      paidBy:paymentEdit.paidBy||undefined,
    });
    if(ok) setPaymentEdit(null);
  }

  async function deletePurchase(p:Purchase) {
    const yes=window.confirm(`Delete purchase #${p.id} (${p.material_name}, ${p.quantity_kg} kg)? This removes stock and linked payments for this purchase.`);
    if(!yes) return;
    await post("deletePurchase",{purchaseId:p.id, mode});
  }

  async function addPreStock() {
    const quantityKg=Number(preStock.quantityKg);
    const ratePerKg=Number(preStock.ratePerKg);
    if(!(quantityKg>0)) { setMessage("Enter pre-stock weight (kg)"); return; }
    if(!(ratePerKg>=0) || preStock.ratePerKg==="") { setMessage("Enter pre-stock rate / kg"); return; }
    if(mode==="PLASTIC" && !preStock.materialName.trim()) {
      setMessage("Select a Plastic material type for pre stock (add under Add type first)");
      return;
    }
    const materialVariant = mode==="PLASTIC"
      ? ""
      : (preStock.materialName==="Red Bottles" ? "Red" : "Mixed");
    const ok=await post("addPreStock",{
      mode,
      materialName:preStock.materialName,
      materialVariant,
      quantityKg,
      ratePerKg,
      stockDate:preStock.stockDate||"2026-09-30",
      notes:preStock.notes,
    });
    if(ok) {
      const resetName = mode==="PLASTIC"
        ? (plasticTypes[0]?.name || "")
        : "Natural Bottles";
      setPreStock({
        materialName: resetName,
        materialVariant: mode==="PLASTIC" ? "" : "Mixed",
        quantityKg:"",
        ratePerKg:"",
        stockDate:"2026-09-30",
        notes:"",
      });
      setShowPreStock(false);
    }
  }

  async function adjustInventory() {
    if(await post("adjustInventory",{...adjust,mode,materialId:adjust.materialId?Number(adjust.materialId):undefined,quantityKg:Number(adjust.quantityKg),amount:Number(adjust.amount||0)}))
      setAdjust({materialId:"",materialName:"",quantityKg:"",amount:"",notes:""});
  }

  const filteredPreStock=(data?.preStock||[]).filter((x:PreStock)=>x.mode===mode);
  const preStockKg=filteredPreStock.reduce((n:number,x:PreStock)=>n+Number(x.quantityKg||0),0);

  if(!data) return <AdminShell title="Inventory & Finance"><div className="ad-card p-6">Loading…</div></AdminShell>;

  return <AdminShell title={mode + " Inventory & Finance"} subtitle={`${mode} stock and purchases only. Company cash is shared with the other business — see Accounts.`}
    actions={
      <>
        {mode==="PLASTIC" && (
          <button className="ad-btn ad-btn-primary" onClick={()=>{ setShowPlasticTypes((v)=>!v); setShowPreStock(false); }}>
            {showPlasticTypes ? "Close type" : "Add type"}
          </button>
        )}
        <button className="ad-btn ad-btn-primary" onClick={()=>{ setShowPreStock((v)=>!v); setShowPlasticTypes(false); }}>
          {showPreStock ? "Close pre stock" : "Add pre stock"}
        </button>
      </>
    }
  >
    <div>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ml-2 text-xs text-[var(--ad-muted)]">Current stock: <b>{currentKg.toFixed(2)} kg</b></span>
      </div>
    </div>
    {message && (
      <div
        className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
          message === "Saved successfully" || (message.startsWith("Saved successfully") && message.includes("Email sent")) || message.startsWith("Test email sent")
            ? "border-[var(--ad-success)] text-[var(--ad-success)]"
            : message.includes("Sending test")
              ? "border-[var(--ad-accent)] text-[var(--ad-fg)]"
              : "border-[var(--ad-danger)] bg-[color-mix(in_srgb,var(--ad-danger)_12%,transparent)] text-[var(--ad-danger)]"
        }`}
        role="alert"
      >
        {message}
      </div>
    )}
    {tab==="purchases" && (
      <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${data?.emailConfigured ? "border-[var(--ad-success)]/40" : "border-[var(--ad-danger)]/50 bg-[color-mix(in_srgb,var(--ad-danger)_8%,transparent)]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{data?.emailConfigured ? "Email notify ready" : "Email notify not ready"}</p>
            <p className="ad-muted text-xs mt-0.5">
              {data?.emailConfigured
                ? `Slips go to ${data.notifyEmail || "your inbox"} (${data.emailDiagnostics?.transport || "mail"})`
                : `Add Railway vars: ${(data?.emailDiagnostics?.missing || ["GMAIL_USER","GMAIL_APP_PASSWORD","NOTIFY_EMAIL"]).join(", ")} then redeploy`}
            </p>
          </div>
          <button type="button" className="ad-btn ad-btn-ghost" onClick={()=>void sendTestEmail()}>
            <Mail size={14} className="mr-1 inline" /> Send test email
          </button>
        </div>
      </div>
    )}

    {showPreStock && (
      <div className="mb-5 ad-card border border-[var(--ad-accent)] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Add pre stock (before audit)</h2>
            <p className="ad-muted text-xs">
              {mode==="PLASTIC"
                ? "Physical stock already present before 30 Sept — choose a Plastic type (same list as purchases). Weight + rate, no vendor/payment."
                : "Physical stock already present before 30 Sept — Natural (mixed) or Red only. Weight + rate, no vendor/payment."}
            </p>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          {mode==="PLASTIC" ? (
            <select
              className="ad-input"
              value={preStock.materialName}
              onChange={e=>setPreStock({...preStock,materialName:e.target.value,materialVariant:""})}
            >
              <option value="">Select plastic type</option>
              {plasticTypes.map((t:any)=>(
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          ) : (
            <select className="ad-input" value={preStock.materialName} onChange={e=>{
              const materialName=e.target.value;
              setPreStock({...preStock,materialName,materialVariant:materialName==="Red Bottles"?"Red":"Mixed"});
            }}>
              <option value="Natural Bottles">Natural (mixed)</option>
              <option value="Red Bottles">Red</option>
            </select>
          )}
          <input className="ad-input" type="number" min="0" placeholder="Weight (kg)" value={preStock.quantityKg} onChange={e=>setPreStock({...preStock,quantityKg:e.target.value})}/>
          <input className="ad-input" type="number" min="0" placeholder="Rate / kg" value={preStock.ratePerKg} onChange={e=>setPreStock({...preStock,ratePerKg:e.target.value})}/>
          <input className="ad-input" type="date" value={preStock.stockDate} onChange={e=>setPreStock({...preStock,stockDate:e.target.value})}/>
          <button className="ad-btn ad-btn-primary" onClick={addPreStock} disabled={mode==="PLASTIC"&&plasticTypes.length===0}>Save pre stock</button>
        </div>
        {mode==="PLASTIC" && plasticTypes.length===0 && (
          <p className="mt-2 text-xs text-[var(--ad-danger)]">No plastic types yet — click Add type first, then add pre stock.</p>
        )}
        <p className="mt-2 text-xs ad-muted">
          Value: ₹{((Number(preStock.quantityKg)||0)*(Number(preStock.ratePerKg)||0)).toFixed(2)}
          {filteredPreStock.length>0 ? ` · ${filteredPreStock.length} pre-stock rows · ${preStockKg.toFixed(2)} kg recorded` : ""}
        </p>
        {filteredPreStock.length>0 && (
          <div className="ad-table-wrap mt-3">
            <table className="ad-table">
              <thead><tr><th>Date</th><th>Material</th><th>Weight</th><th>Value</th><th>Notes</th></tr></thead>
              <tbody>
                {filteredPreStock.map((row:PreStock)=>(
                  <tr key={row.id}>
                    <td>{row.stockDate}</td>
                    <td>{row.materialName}</td>
                    <td>{Number(row.quantityKg).toFixed(2)} kg</td>
                    <td>₹{Number(row.amount).toFixed(2)}</td>
                    <td>{row.notes||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}

    {mode==="PLASTIC" && showPlasticTypes && (
      <div className="mb-5 ad-card border border-[var(--ad-accent)] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Add plastic material type</h2>
            <p className="ad-muted text-xs">Types like Rangin Plastic PP, Mix PP Dibba, Safed Plastic DB become stock names for buy/sell.</p>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <input className="ad-input" placeholder="Type name" value={plasticTypeName} onChange={e=>setPlasticTypeName(e.target.value)}/>
          <input className="ad-input md:col-span-2" placeholder="Notes (optional)" value={plasticTypeNotes} onChange={e=>setPlasticTypeNotes(e.target.value)}/>
          <button className="ad-btn ad-btn-primary" onClick={()=>void savePlasticType()}>Save type</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {allPlasticTypes.length ? allPlasticTypes.map((t:any)=>(
            <button
              key={t.id}
              type="button"
              className={"rounded-lg border px-2 py-1 "+(t.active?"border-[var(--ad-accent)]":"border-[var(--ad-border)] opacity-60")}
              onClick={()=>void post("setPlasticMaterialTypeStatus",{typeId:t.id,active:!t.active})}
              title={t.active?"Click to disable":"Click to enable"}
            >
              {t.name}{t.active?"":" · off"}
            </button>
          )) : <span className="ad-muted">No types yet — add the first one above.</span>}
        </div>
      </div>
    )}

    <div className="mb-5 grid gap-3 sm:grid-cols-3 ad-fade-in">
      <div className="ad-card p-4"><p className="ad-muted text-xs">Current {mode} stock</p><p className="mt-1 text-2xl font-bold">{currentKg.toFixed(2)} kg</p></div>
      <div className="ad-card p-4"><p className="ad-muted text-xs">Pre stock recorded</p><p className="mt-1 text-2xl font-bold">{preStockKg.toFixed(2)} kg</p></div>
      <div className="ad-card p-4"><p className="ad-muted text-xs">Supplier credit</p><p className="mt-1 text-2xl font-bold">₹{filteredPurchases.reduce((n:any,x:any)=>n+Number(x.credit_amount),0).toFixed(2)}</p></div>
    </div>

    <div className="mb-4 flex flex-wrap gap-2">
      {[["purchases","Purchases"],["sales","Sales"],["inventory","Inventory"],["expenses","Expenses"]].map(([value,label])=><button key={value} onClick={()=>setTab(value)} className={tab===value?"ad-btn ad-btn-primary":"ad-btn ad-btn-ghost"}>{label}</button>)}
    </div>

    {tab==="purchases" && <div className="space-y-5 ad-fade-in">
      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">{editingPurchase ? `Edit ${mode} purchase #${editingPurchase}` : `Add ${mode} purchase`}</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <AdminSelect
            label="Vendor"
            required
            placeholder="Select vendor"
            value={purchase.supplierId}
            onChange={(v)=>setPurchase({...purchase,supplierId:v})}
            options={[
              { value: "", label: "Select vendor" },
              ...(data.suppliers||[]).map((s:Supplier)=>({ value: String(s.id), label: s.name })),
            ]}
          />
          {mode==="PLASTIC" ? (
            <AdminSelect
              label="Plastic material type"
              required
              placeholder="Select type"
              value={purchase.materialName}
              onChange={(materialName)=>setPurchase({...purchase,materialName,materialVariant:""})}
              options={[
                { value: "", label: "Select type" },
                ...plasticTypes.map((t:any)=>({ value: t.name, label: t.name })),
              ]}
            />
          ) : (
            <AdminSelect
              label="Material"
              required
              placeholder="Select material"
              value={purchase.materialName}
              onChange={(materialName)=>{
                setPurchase({...purchase,materialName,materialVariant:materialName==="Red Bottles"?"Red":"Mixed"});
              }}
              options={[
                { value: "", label: "Select material" },
                { value: "Natural Bottles", label: "Natural (mixed)" },
                { value: "Red Bottles", label: "Red" },
              ]}
            />
          )}
          <label className="ad-field">
            <span className="ad-field-label">Purchase date *</span>
            <input className="ad-input" type="date" value={purchase.purchaseDate} onChange={e=>setPurchase({...purchase,purchaseDate:e.target.value})}/>
          </label>
          <label className="ad-field">
            <span className="ad-field-label">Quantity (kg) *</span>
            <input className="ad-input" type="number" min="0" step="any" placeholder="e.g. 100" value={purchase.quantityKg} onChange={e=>setPurchase({...purchase,quantityKg:e.target.value})}/>
          </label>
          <label className="ad-field">
            <span className="ad-field-label">Rate / kg *</span>
            <input className="ad-input" type="number" min="0" step="any" placeholder="e.g. 49" value={purchase.ratePerKg} onChange={e=>setPurchase({...purchase,ratePerKg:e.target.value})}/>
          </label>
          <div className="ad-field">
            <span className="ad-field-label">Vendor material total</span>
            <div className="ad-input flex items-center text-sm font-semibold">₹{materialTotal.toFixed(2)}</div>
          </div>
          <label className="ad-field">
            <span className="ad-field-label">Transport (driver)</span>
            <input className="ad-input" type="number" min="0" step="any" placeholder="0 if none" value={purchase.transportCharges} onChange={e=>setPurchase({...purchase,transportCharges:e.target.value})}/>
          </label>
          <label className="ad-field">
            <span className="ad-field-label">Loading (outside labour)</span>
            <input className="ad-input" type="number" min="0" step="any" placeholder="0 if none" value={purchase.loadingCharges} onChange={e=>setPurchase({...purchase,loadingCharges:e.target.value})}/>
          </label>
          <div className="ad-field">
            <span className="ad-field-label">Landed total</span>
            <div className="ad-input flex items-center text-sm font-semibold">₹{landedTotal.toFixed(2)}</div>
          </div>
          <div className="ad-field">
            <span className="ad-field-label">Final rate / kg</span>
            <div className="ad-input flex items-center text-sm font-semibold">₹{finalRate.toFixed(2)}</div>
          </div>
          <label className="ad-field">
            <span className="ad-field-label">Paid to vendor (material only)</span>
            <input className="ad-input" type="number" min="0" step="any" placeholder="0 if pay later" value={purchase.paidAmount} onChange={e=>setPurchase({...purchase,paidAmount:e.target.value})}/>
          </label>
          {(Number(purchase.paidAmount)>0 || editingPurchase!==null) && (
            <label className="ad-field">
              <span className="ad-field-label">Payment date</span>
              <input className="ad-input" type="date" value={purchase.paymentDate} onChange={e=>setPurchase({...purchase,paymentDate:e.target.value})}/>
            </label>
          )}
          <PersonSelect value={purchase.paidBy} onChange={(v)=>setPurchase({...purchase,paidBy:v})} />
          <FundingSelect value={purchase.fundingSource} onChange={(v)=>setPurchase({...purchase,fundingSource:v})} />
          {purchase.purchaseType==="BORROWED_FUND" && (
            <AdminSelect
              label="Borrowing"
              placeholder="Select borrowing"
              value={purchase.borrowingId}
              onChange={(v)=>setPurchase({...purchase,borrowingId:v})}
              options={[
                { value: "", label: "Select borrowing" },
                ...openBorrowings.map((b:Borrowing)=>({
                  value: String(b.id),
                  label: `#${b.id} ${b.lenderName} — ₹${Number(b.outstanding_amount).toFixed(2)} due`,
                })),
              ]}
            />
          )}
          <label className="ad-field md:col-span-2">
            <span className="ad-field-label">Notes</span>
            <input className="ad-input" placeholder="Optional notes" value={purchase.notes} onChange={e=>setPurchase({...purchase,notes:e.target.value})}/>
          </label>
          <label className="ad-field md:col-span-2 flex items-center gap-2 pt-6">
            <input type="checkbox" checked={sendEmail} onChange={e=>setSendEmail(e.target.checked)} />
            <span className="text-sm">
              Email PDF slip to my Gmail
              {data?.emailConfigured
                ? data?.notifyEmail ? ` (${data.notifyEmail})` : ""
                : ` — missing ${(data?.emailDiagnostics?.missing || ["GMAIL_USER","GMAIL_APP_PASSWORD"]).join(", ")}`}
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <button className="ad-btn ad-btn-primary" onClick={editingPurchase ? editPurchase : addPurchase}>{editingPurchase ? "Update purchase" : "Save purchase"}</button>
            {editingPurchase&&<button className="ad-btn ad-btn-ghost" onClick={()=>{setEditingPurchase(null);setPurchase({...emptyPurchase})}}>Cancel</button>}
          </div>
        </div>
        <p className="mt-3 text-xs ad-muted">Vendor gets <b>material cost only</b>. Transport (driver) and loading (outside labour) are separate expenses — not added to vendor bill. Final rate / kg = (material + transport + loading) ÷ kg. PDF emailed to your Gmail.</p>
      </div>

      {paymentEdit && <div className="ad-card p-4 border border-[var(--ad-accent)] ad-fade-in">
        <h3 className="mb-1 text-sm font-semibold">Update payment date — purchase #{paymentEdit.purchaseId}</h3>
        <p className="ad-muted mb-3 text-xs">Correct the date when vendor was actually paid. This fixes Accounts / partner cash calculation.</p>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="ad-field">
            <span className="ad-field-label">Payment date</span>
            <input className="ad-input" type="date" value={paymentEdit.paymentDate} onChange={e=>setPaymentEdit({...paymentEdit,paymentDate:e.target.value})}/>
          </label>
          <PersonSelect value={paymentEdit.paidBy} onChange={(v)=>setPaymentEdit({...paymentEdit,paidBy:v})} />
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <button className="ad-btn ad-btn-primary" onClick={()=>void submitPaymentEdit()}>Save payment date</button>
            <button className="ad-btn ad-btn-ghost" onClick={()=>setPaymentEdit(null)}>Cancel</button>
          </div>
        </div>
      </div>}

      {creditPay && <div className="ad-card p-4 border border-[var(--ad-accent)] ad-fade-in">
        <h3 className="mb-1 text-sm font-semibold">Pay vendor later — purchase #{creditPay.purchaseId}</h3>
        <p className="ad-muted mb-3 text-xs">Use when payment is made after cash comes into company. Payment done by is required for Accounts.</p>
        <div className="grid gap-3 md:grid-cols-6">
          <label className="ad-field">
            <span className="ad-field-label">Amount</span>
            <input className="ad-input" type="number" min="0" placeholder="Payment amount" value={creditPay.amount} onChange={e=>setCreditPay({...creditPay,amount:e.target.value})}/>
          </label>
          <label className="ad-field">
            <span className="ad-field-label">Payment date</span>
            <input className="ad-input" type="date" value={creditPay.paymentDate} onChange={e=>setCreditPay({...creditPay,paymentDate:e.target.value})}/>
          </label>
          <PersonSelect value={creditPay.paidBy} onChange={(v)=>setCreditPay({...creditPay,paidBy:v})} required />
          <FundingSelect value={creditPay.fundingSource} onChange={(v)=>setCreditPay({...creditPay,fundingSource:v})} />
          <div className="flex flex-wrap items-end gap-2 md:col-span-2">
            <button className="ad-btn ad-btn-primary" onClick={submitCreditPayment}>Save payment</button>
            <button className="ad-btn ad-btn-ghost" onClick={()=>setCreditPay(null)}>Cancel</button>
          </div>
        </div>
      </div>}

      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Purchase date</th><th>Payment date</th><th>Vendor</th><th>Material</th><th>Qty</th><th>Rate</th><th>Vendor</th><th>Transport</th><th>Loading</th><th>Final ₹/kg</th><th>Paid</th><th>Unpaid</th><th>By</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {filteredPurchases.map((p:Purchase)=>{
          const payDate=p.payment_date|| (Number(p.paid_amount)>0 ? p.purchase_date : "");
          const payer=p.payment_done_by||p.paid_by||"—";
          const paid=Number(p.paid_amount)>0;
          return <tr key={p.id}>
            <td>{p.purchase_date}</td>
            <td>{payDate||"—"}</td>
            <td>{p.supplierName||"—"}</td>
            <td>{p.material_name==="Natural Bottles"||String(p.material_name).startsWith("Natural Bottles")?"Natural (mixed)":p.material_name}</td>
            <td>{p.quantity_kg} kg</td>
            <td>₹{p.rate_per_kg}</td>
            <td>₹{Number(p.total_amount).toFixed(2)}</td>
            <td>₹{Number(p.transport_charges||0).toFixed(2)}</td>
            <td>₹{Number(p.labour_charges||0).toFixed(2)}</td>
            <td>₹{Number(p.effective_cost||p.rate_per_kg).toFixed(2)}</td>
            <td>₹{p.paid_amount}</td>
            <td>₹{p.credit_amount}</td>
            <td>{paid||Number(p.transport_charges||0)>0||Number(p.labour_charges||0)>0?payer:"—"}</td>
            <td><span className={paid?"ad-status-paid":"ad-status-unpaid"}>{paid?"PAID":"UNPAID"}</span></td>
            <td>
              <div className="ad-row-actions">
                <button type="button" className="ad-icon-btn ad-icon-btn-accent" onClick={()=>startEditPurchase(p)} title="Edit purchase">
                  <Pencil size={13} /> Edit
                </button>
                {paid && (
                  <button type="button" className="ad-icon-btn" onClick={()=>openPaymentEdit(p)} title="Update payment date">
                    <CalendarClock size={13} /> Pay date
                  </button>
                )}
                {p.credit_amount>0 && (
                  <button type="button" className="ad-icon-btn ad-icon-btn-accent" onClick={()=>openCreditPayment(p)} title="Pay remaining credit">
                    <Wallet size={13} /> Pay
                  </button>
                )}
                <button type="button" className="ad-icon-btn" onClick={()=>void resendPurchaseEmail(p.id)} title="Resend PDF to Gmail">
                  <Mail size={13} /> Mail
                </button>
                <button type="button" className="ad-icon-btn ad-icon-btn-danger" onClick={()=>void deletePurchase(p)} title="Delete purchase">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </td>
          </tr>;
        })}
      </tbody></table></div>
    </div>}

    {tab==="sales" && <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="ad-card p-4"><p className="ad-muted text-xs">Company cash (shared)</p><p className="mt-1 text-2xl font-bold">₹{Number(data.cashBalance?.COMPANY ?? data.cashBalance?.[mode] ?? 0).toFixed(2)}</p><p className="ad-muted mt-1 text-[10px]">PET + Plastic one book</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Total Sales</p><p className="mt-1 text-2xl font-bold">₹{(data.sales||[]).filter((s:any)=>s.mode===mode).reduce((n:number,s:any)=>n+Number(s.total_amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Received</p><p className="mt-1 text-2xl font-bold">₹{(data.sales||[]).filter((s:any)=>s.mode===mode).reduce((n:number,s:any)=>n+Number(s.received_amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Pending</p><p className="mt-1 text-2xl font-bold">₹{(data.sales||[]).filter((s:any)=>s.mode===mode).reduce((n:number,s:any)=>n+Number(s.credit_amount||0),0).toFixed(2)}</p></div>
      </div>
      <div className="ad-card p-4">
        <h2 className="mb-3 font-semibold">{editingSale ? `Edit Sale #${editingSale}` : "Add Sale — One Go / Full Truck"}</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <AdminSelect
            label="Buyer"
            required
            placeholder={modeBuyers.length ? "Select buyer" : "Add buyer in Vendors & Buyers first"}
            value={sale.customerName}
            onChange={(v) => pickBuyer(v)}
            options={[
              { value: "", label: modeBuyers.length ? "Select buyer" : "No buyers yet — add in Vendors & Buyers" },
              ...modeBuyers.map((b:any) => ({ value: b.name, label: b.name })),
            ]}
          />
          <input className="ad-input" placeholder="Contact number" value={sale.phone} onChange={e=>setSale({...sale,phone:e.target.value})}/>
          <input className="ad-input" placeholder="Location" value={sale.location} onChange={e=>setSale({...sale,location:e.target.value})}/>
          <input className="ad-input" type="date" value={sale.saleDate} onChange={e=>setSale({...sale,saleDate:e.target.value})}/>
        </div>
        <p className="mt-2 text-xs ad-muted">Buyer list comes from <a className="underline" href="/admin/vendors">Vendors &amp; Buyers → Buyers</a>. Add the buyer there first, then select here.</p>
        <div className="mt-3 space-y-2">
          {saleItems.map((item:any,i:number)=><div key={i} className="grid gap-2 md:grid-cols-6">
            {mode==="PLASTIC" ? (
              <select className="ad-input" value={item.materialCategory} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,materialCategory:e.target.value,materialVariant:""}:x))}>
                <option value="">Plastic type</option>
                {plasticTypes.map((t:any)=><option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            ) : (
              <>
                <select className="ad-input" value={item.materialCategory==="Natural Bottles"||item.materialCategory==="Red Bottles"?item.materialCategory:"Natural Bottles"} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,materialCategory:e.target.value,materialVariant:e.target.value==="Red Bottles"?"Red Bottle":"Green"}:x))}>
                  <option value="Natural Bottles">Natural Bottles</option>
                  <option value="Red Bottles">Red Bottles</option>
                </select>
                <select className="ad-input" value={item.materialVariant==="Red"?"Red Bottle":item.materialVariant} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,materialVariant:e.target.value}:x))}>
                  {item.materialCategory==="Red Bottles" ? <><option value="Red Bottle">Red Bottle</option><option value="Red Bottle Cap">Red Bottle Cap</option></> : <><option value="Green">Green</option><option value="White">White</option><option value="White Milk">White Milk</option></>}
                </select>
              </>
            )}
            <input className="ad-input" type="number" placeholder="Quantity (kg)" value={item.quantityKg} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,quantityKg:e.target.value}:x))}/>
            <input className="ad-input" type="number" placeholder="Rate / kg" value={item.ratePerKg} onChange={e=>setSaleItems(saleItems.map((x:any,j:number)=>j===i?{...x,ratePerKg:e.target.value}:x))}/>
            <span className="ad-input flex items-center text-sm">₹{((Number(item.quantityKg)||0)*(Number(item.ratePerKg)||0)).toFixed(2)}</span>
            {saleItems.length>1?<button className="ad-btn ad-btn-ghost" onClick={()=>setSaleItems(saleItems.filter((_:any,j:number)=>j!==i))}>Remove</button>:<span/>}
          </div>)}
          <button className="ad-btn ad-btn-ghost" onClick={()=>setSaleItems([...saleItems,defaultSaleItem()])}>+ Add Material</button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <span className="ad-input flex items-center font-semibold">Gross Sale: ₹{saleGrossAmount.toFixed(2)}</span>
          {mode==="PET" && (
            <select className="ad-input" value={sale.labourMode} onChange={e=>setSale({...sale,labourMode:e.target.value as "CONTRACT"|"DAILY_WAGE"})}>
              <option value="CONTRACT">Labour: Contract ₹2/kg</option>
              <option value="DAILY_WAGE">Labour: Daily wage (no ₹2/kg)</option>
            </select>
          )}
          {mode==="PET" && (
            <span className="ad-input flex items-center">
              {sale.labourMode==="CONTRACT"
                ? <>Contract labour (₹2/kg): -₹{saleLabourCharges.toFixed(2)}</>
                : <>Daily wage — pay via Labour Management (no sale deduction)</>}
            </span>
          )}
          <input className="ad-input" type="number" min="0" placeholder="Loading Charges" value={sale.loadingCharges||""} onChange={e=>setSale({...sale,loadingCharges:e.target.value})}/>
          <span className="ad-input flex items-center font-semibold">Final Amount: ₹{saleFinalAmount.toFixed(2)}</span>
          {buyerAdvanceAvail>0 && editingSale===null && <label className="ad-input flex items-center gap-2 text-sm md:col-span-4 border border-[var(--ad-accent)]">
            <input type="checkbox" checked={useAdvance} onChange={e=>setUseAdvance(e.target.checked)}/>
            <span><b>{sale.customerName.trim()}</b> has advance ₹{buyerAdvanceAvail.toFixed(2)} with us. {useAdvance?`₹${advanceWillApply.toFixed(2)} will be adjusted in this sale; cash/UPI to collect: ₹${cashAfterAdvance.toFixed(2)}.`:"Advance will not be used for this sale."}</span>
          </label>}
          <input className="ad-input" type="number" min="0" max={cashAfterAdvance} disabled={editingSale!==null} placeholder={editingSale?"Received payment (history)":(advanceWillApply>0?"Cash received now (blank = full "+cashAfterAdvance.toFixed(2)+")":"Total received payment")} value={sale.receivedAmount} onChange={e=>setSale({...sale,receivedAmount:e.target.value})}/>
          <PersonSelect value={sale.receivedBy} onChange={(v)=>setSale({...sale,receivedBy:v})} label="Received by" />
          <select className="ad-input" value={sale.paymentMode} onChange={e=>setSale({...sale,paymentMode:e.target.value})}><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select>
          <input className="ad-input md:col-span-2" placeholder="Notes" value={sale.notes} onChange={e=>setSale({...sale,notes:e.target.value})}/>
          <button className="ad-btn ad-btn-primary" onClick={editingSale ? editSale : addSale}>{editingSale ? "Update Sale" : "Save Full Truck Sale"}</button>{editingSale&&<button className="ad-btn ad-btn-ghost" onClick={resetSaleForm}>Cancel</button>}
        </div>
        <p className="mt-2 text-xs ad-muted">{mode==="PET"?"Choose Contract ₹2/kg (contractor earn) or Daily wage (mark/pay attendance in Labour Management — sale amount is not reduced).":"Plastic sales use material types with no ₹2/kg process labour deduction."} Loading charges are sale-specific. GST is intentionally not included for now.</p>
      </div>
      {salePay && <div className="ad-card p-4 border border-[var(--ad-accent)]">
        <h3 className="mb-3 text-sm font-semibold">Receive sale payment — sale #{salePay.saleId}</h3>
        <div className="grid gap-2 md:grid-cols-5">
          <input className="ad-input" type="number" min="0" placeholder="Payment amount" value={salePay.amount} onChange={e=>setSalePay({...salePay,amount:e.target.value})}/>
          <PersonSelect value={salePay.receivedBy} onChange={(v)=>setSalePay({...salePay,receivedBy:v})} label="Received by" />
          <select className="ad-input" value={salePay.paymentMode} onChange={e=>setSalePay({...salePay,paymentMode:e.target.value})}>
            <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option>
          </select>
          <button className="ad-btn ad-btn-primary" onClick={submitSalePayment}>Save payment</button>
          <button className="ad-btn ad-btn-ghost" onClick={()=>setSalePay(null)}>Cancel</button>
        </div>
      </div>}

      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Date</th><th>Buyer</th><th>Contact</th><th>Materials</th><th>Total</th><th>Received</th><th>Pending</th><th>Action</th></tr></thead><tbody>
        {(data.sales||[]).filter((s:any)=>s.mode===mode).map((s:any)=><tr key={s.id}><td>{s.sale_date}</td><td>{s.customer_name}</td><td>{s.phone||"—"}</td><td>{(data.saleItems||[]).filter((x:any)=>x.sale_id===s.id).map((x:any)=>x.material_variant+" "+x.quantity_kg+"kg @ ₹"+x.rate_per_kg).join(" | ")||s.material_variant}</td><td>₹{s.total_amount}</td><td>₹{s.received_amount}</td><td>₹{s.credit_amount}</td><td>{s.credit_amount>0?<button className="text-xs font-semibold text-[var(--ad-accent)] mr-3" onClick={()=>openSalePayment(s)}>Receive</button>:<span className="mr-3">PAID</span>}<button className="text-xs font-semibold text-[var(--ad-accent)]" onClick={()=>startEditSale(s)}>Edit</button></td></tr>)}
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
        <div className="ad-card p-4"><p className="ad-muted text-xs">This mode + shared</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>x.mode===mode||x.mode==="SHARED").reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Shared (PET + Plastic)</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>x.mode==="SHARED").reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p><p className="ad-muted mt-1 text-[10px]">Split later by activity kg in reports</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Electricity + Thread</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>(x.mode===mode||x.mode==="SHARED")&&(x.expense_type==="Electricity"||x.expense_type==="Thread")).reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
        <div className="ad-card p-4"><p className="ad-muted text-xs">Current Month</p><p className="mt-1 text-2xl font-bold">₹{(data.otherExpenses||[]).filter((x:any)=>(x.mode===mode||x.mode==="SHARED")&&((x.expense_type==="Electricity"&&x.billing_month===new Date().toISOString().slice(0,7))||(!x.billing_month&&String(x.expense_date||"").startsWith(new Date().toISOString().slice(0,7))))).reduce((n:number,x:any)=>n+Number(x.amount||0),0).toFixed(2)}</p></div>
      </div>
      <div className="ad-card p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-semibold">Add Business Expense</h2>
            <p className="mt-1 text-xs ad-muted">Electricity for both machines → choose <b>Shared (PET + Plastic)</b>. Company book records it once; Material Analysis allocates cost per kg by activity.</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5 sm:max-w-[60%]">
            {expenseTypeOptions.map((type) => (
              <button
                key={type}
                type="button"
                className={
                  "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition " +
                  (expense.expenseType === type
                    ? "border-[var(--ad-accent)] bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]"
                    : "border-[var(--ad-border)] text-[var(--ad-muted)] hover:border-[var(--ad-accent)]/50 hover:text-[var(--ad-text)]")
                }
                onClick={() => selectExpenseType(type)}
              >
                {expenseTypeLabel(type)}
              </button>
            ))}
            <button
              type="button"
              className={
                "rounded-lg border border-dashed px-2.5 py-1.5 text-[11px] font-semibold transition " +
                (showNewExpenseType
                  ? "border-[var(--ad-accent)] bg-[var(--ad-accent-dim)] text-[var(--ad-accent)]"
                  : "border-[var(--ad-border)] text-[var(--ad-muted)] hover:border-[var(--ad-accent)]/50 hover:text-[var(--ad-text)]")
              }
              onClick={() => setShowNewExpenseType((v) => !v)}
            >
              + Add type
            </button>
          </div>
        </div>
        {showNewExpenseType && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="ad-input sm:max-w-xs"
              placeholder="New expense type name"
              value={newExpenseTypeName}
              onChange={(e) => setNewExpenseTypeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewExpenseType(); } }}
              autoFocus
            />
            <div className="flex gap-2">
              <button type="button" className="ad-btn ad-btn-primary" onClick={addNewExpenseType}>Add</button>
              <button
                type="button"
                className="ad-btn"
                onClick={() => { setShowNewExpenseType(false); setNewExpenseTypeName(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-6">
          <select className="ad-input" value={expense.scope} onChange={e=>setExpense({...expense,scope:e.target.value as "MODE"|"SHARED"})}>
            <option value="SHARED">Shared (PET + Plastic)</option>
            <option value="MODE">{mode} only</option>
          </select>
          <input className="ad-input" type="number" min="0" placeholder="Amount" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})}/>
          <input className="ad-input" type="date" value={expense.expenseDate} onChange={e=>setExpense({...expense,expenseDate:e.target.value})}/>
          {expense.expenseType==="Electricity" && <><input className="ad-input" type="month" value={expense.billingMonth} onChange={e=>setExpense({...expense,billingMonth:e.target.value})}/><input className="ad-input" type="date" value={expense.billingStartDate} onChange={e=>setExpense({...expense,billingStartDate:e.target.value})} placeholder="Billing start"/><input className="ad-input" type="date" value={expense.billingEndDate} onChange={e=>setExpense({...expense,billingEndDate:e.target.value})} placeholder="Billing end"/></>}
          <PersonSelect value={expense.paidBy} onChange={(v)=>setExpense({...expense,paidBy:v})} />
          <FundingSelect value={expense.fundingSource} onChange={(v)=>setExpense({...expense,fundingSource:v})} />
          <input className="ad-input" placeholder="Description / notes" value={expense.description} onChange={e=>setExpense({...expense,description:e.target.value})}/>
        </div>
        <p className="mt-2 text-[11px] text-[var(--ad-muted)]">Selected type: <span className="font-semibold text-[var(--ad-text)]">{expense.expenseType}</span></p>
        <button className="ad-btn ad-btn-primary mt-3" onClick={addExpense}>Save Expense</button>
      </div>
      <div className="ad-table-wrap"><table className="ad-table"><thead><tr><th>Payment Date</th><th>Scope</th><th>Category</th><th>Billing Period</th><th>Description</th><th>Amount</th><th>Payment done by</th><th>Paid from</th></tr></thead><tbody>
        {(data.otherExpenses||[]).filter((x:any)=>x.mode===mode||x.mode==="SHARED").map((x:any)=><tr key={x.id}><td>{x.expense_date}</td><td>{x.mode==="SHARED"?"Shared":x.mode}</td><td>{x.expense_type}</td><td>{x.expense_type==="Electricity" ? (x.billing_start_date&&x.billing_end_date ? `${x.billing_start_date} → ${x.billing_end_date}` : x.billing_month||"—") : "Expense date month"}</td><td>{x.description||"—"}</td><td>₹{Number(x.amount).toFixed(2)}</td><td>{x.paid_by||"—"}</td><td>{x.funding_source==="OWN_POCKET"?"Own pocket":"Company cash"}</td></tr>)}
      </tbody></table></div>
    </div>}

    </div>
  </AdminShell>
}
