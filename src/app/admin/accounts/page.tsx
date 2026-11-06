"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { useBusinessMode } from "@/components/business-mode-provider";
import { ACCOUNT_PERSONS, isAccountPerson, type AccountPerson } from "@/lib/account-persons";
import { AdminSelect } from "@/components/admin-select";
import { PersonSelect } from "@/components/person-select";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, X } from "lucide-react";

type TxRow = {
  date: string;
  type: string;
  description: string;
  person: string;
  amount: number;
  direction: "in" | "out";
  funding?: string;
};

type DetailPopup = {
  title: string;
  subtitle?: string;
  rows: TxRow[];
  moreHref: string;
  moreLabel: string;
};

type Person = AccountPerson;
type Row = Record<string, unknown>;
type PersonTotals = {
  received: number;
  buyerAdvanceReceived?: number;
  partnerLent?: number;
  partnerLentHeld?: number;
  purchasesPaid: number;
  expensesPaid: number;
  processingPaid: number;
  saleProcessingPaid: number;
  labourPaid?: number;
  contractorPaid?: number;
  companyPaid?: number;
  ownPocketPaid?: number;
  settled?: number;
  cashWithPartner?: number;
  companyOwesPartner?: number;
  paid: number;
  balance: number;
};
type Reconciliation = {
  companyBook: number;
  cashWithPartners: number;
  dueToPartners: number;
  externalLoanOutstanding: number;
};
type CashflowBreakdown = {
  salesReceived: number;
  buyerAdvances?: number;
  partnerAdvances?: number;
  vendorPayments: number;
  borrowed: number;
  loanRepaid: number;
  processingExpenses: number;
  saleProcessing: number;
  otherExpenses: number;
  manualLabour: number;
  contractorCash: number;
  partnerSettled: number;
  book: number;
};
type Lender = { id: number; name: string; phone?: string; notes?: string; lender_kind?: string };
type Borrowing = {
  id: number;
  mode: string;
  lenderName: string;
  lenderKind?: string;
  amount: number;
  interest_rate_percent?: number;
  interest_amount?: number;
  outstanding_amount: number;
  borrowing_date: string;
  due_date?: string;
  purpose?: string;
  status?: string;
};
type Supplier = { id: number; name: string };
type BusinessSplit = {
  salesReceived: number;
  vendorPayments: number;
  expenses: number;
  labourCash: number;
  contractorCash: number;
  borrowed: number;
  loanRepaid: number;
  partnerSettled: number;
  sharedExpensesAllocated?: number;
  contribution: number;
};
type AccountsData = {
  personAccountTotals?: Record<string, PersonTotals | Record<string, PersonTotals>>;
  personAccountTotalsFlat?: Record<string, PersonTotals>;
  cashBalance?: Record<string, number>;
  reconciliation?: Record<string, Reconciliation>;
  cashflowBreakdown?: Record<string, CashflowBreakdown>;
  businessSplit?: Record<string, BusinessSplit>;
  externalLoanOutstanding?: Record<string, number>;
  partnerSettlements?: Row[];
  partnerAdvances?: Row[];
  buyerAdvances?: Row[];
  buyerAdvanceBalance?: number;
  partnerLentTotal?: number;
  salePayments?: Row[];
  purchases?: Row[];
  vendorPayments?: Row[];
  otherExpenses?: Row[];
  processingExpenses?: Row[];
  saleProcessingCosts?: Row[];
  manualLabour?: Row[];
  processingContractorLedger?: Row[];
  lenders?: Lender[];
  borrowings?: Borrowing[];
  suppliers?: Supplier[];
};

const people: Person[] = [...ACCOUNT_PERSONS];

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sumBy(rows: Row[] | undefined, field: string, person: Person, amountField = "amount") {
  return (rows || [])
    .filter((row) => String(row[field] || "") === person)
    .reduce((total, row) => total + Number(row[amountField] ?? row.amount ?? 0), 0);
}

function personTotalsFromData(data: AccountsData | null, person: Person): PersonTotals | undefined {
  const flat = data?.personAccountTotalsFlat?.[person];
  if (flat) return flat;
  const nested = data?.personAccountTotals;
  if (!nested) return undefined;
  const direct = nested[person];
  if (direct && typeof (direct as PersonTotals).balance === "number") return direct as PersonTotals;
  const company = nested.COMPANY as Record<string, PersonTotals> | undefined;
  if (company?.[person]) return company[person];
  const pet = nested.PET as Record<string, PersonTotals> | undefined;
  if (pet?.[person]) return pet[person];
  return undefined;
}

export default function AccountsPage() {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<AccountsData | null>(null);
  const [tab, setTab] = useState<"overview" | "borrowings">("overview");
  const [loading, setLoading] = useState(true);
  const [settle, setSettle] = useState({
    person: "" as string,
    amount: "",
    settlementDate: new Date().toISOString().slice(0, 10),
    paidBy: "" as string,
    notes: "",
  });
  const [settleBusy, setSettleBusy] = useState(false);
  const [detailPopup, setDetailPopup] = useState<DetailPopup | null>(null);
  const [lend, setLend] = useState({
    person: "" as string,
    heldBy: "" as string,
    amount: "",
    advanceDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [lendBusy, setLendBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [borrowing, setBorrowing] = useState({
    lenderId: "",
    amount: "",
    interestRatePercent: "",
    dueDate: "",
    borrowingDate: new Date().toISOString().slice(0, 10),
    purpose: "",
    notes: "",
  });
  const [lenderForm, setLenderForm] = useState({ name: "", phone: "", notes: "", lenderKind: "EXTERNAL" });
  const [repayForm, setRepayForm] = useState<{ borrowingId: number; amount: string; paidBy: string; repaymentDate: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load accounts");
      setData(json);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postAction(action: string, body: Record<string, unknown>) {
    const res = await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Operation failed");
    await load();
    return json;
  }

  async function settlePartner() {
    const amount = Number(settle.amount);
    if (!settle.person || !isAccountPerson(settle.person)) {
      setMessage("Please select which partner the company is paying back");
      return;
    }
    if (!(amount > 0)) {
      setMessage("Please enter a settlement amount greater than 0");
      return;
    }
    if (!settle.paidBy || !isAccountPerson(settle.paidBy)) {
      setMessage("Please select Payment done by — who handed over the company cash");
      return;
    }
    setSettleBusy(true);
    setMessage("");
    try {
      await postAction("settlePartner", {
        mode,
        person: settle.person,
        amount,
        settlementDate: settle.settlementDate,
        paidBy: settle.paidBy,
        notes: settle.notes,
      });
      setSettle({ person: "", amount: "", settlementDate: new Date().toISOString().slice(0, 10), paidBy: "", notes: "" });
      setMessage("Partner settlement saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settlement failed");
    } finally {
      setSettleBusy(false);
    }
  }

  async function lendToCompany() {
    const amount = Number(lend.amount);
    if (!lend.person || !isAccountPerson(lend.person)) {
      setMessage("Please select which partner is giving the money to the company");
      return;
    }
    if (!(amount > 0)) {
      setMessage("Please enter an amount greater than 0");
      return;
    }
    setLendBusy(true);
    setMessage("");
    try {
      await postAction("addPartnerAdvance", {
        mode,
        person: lend.person,
        heldBy: lend.heldBy || lend.person,
        amount,
        advanceDate: lend.advanceDate,
        notes: lend.notes,
      });
      setLend({ person: "", heldBy: "", amount: "", advanceDate: new Date().toISOString().slice(0, 10), notes: "" });
      setMessage("Partner money added to the company book. Use Settle partner when the company pays it back.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save partner advance");
    } finally {
      setLendBusy(false);
    }
  }

  async function addLender() {
    if (!lenderForm.name.trim()) {
      setMessage("Lender name is required");
      return;
    }
    try {
      await postAction("addLender", {
        name: lenderForm.name.trim(),
        phone: lenderForm.phone,
        notes: lenderForm.notes,
        lenderKind: lenderForm.lenderKind,
      });
      setLenderForm({ name: "", phone: "", notes: "", lenderKind: "EXTERNAL" });
      setMessage("Lender saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save lender");
    }
  }

  async function addBorrowing() {
    if (!borrowing.lenderId || !(Number(borrowing.amount) > 0)) {
      setMessage("Select a lender and enter principal amount");
      return;
    }
    try {
      await postAction("addBorrowing", {
        mode,
        lenderId: Number(borrowing.lenderId),
        amount: Number(borrowing.amount),
        interestRatePercent: Number(borrowing.interestRatePercent || 0),
        borrowingDate: borrowing.borrowingDate,
        dueDate: borrowing.dueDate || "",
        purpose: borrowing.purpose,
        notes: borrowing.notes,
      });
      setBorrowing({
        lenderId: "",
        amount: "",
        interestRatePercent: "",
        dueDate: "",
        borrowingDate: new Date().toISOString().slice(0, 10),
        purpose: "",
        notes: "",
      });
      setMessage("Borrowing saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save borrowing");
    }
  }

  async function submitRepayment() {
    if (!repayForm) return;
    const amount = Number(repayForm.amount);
    if (!(amount > 0)) {
      setMessage("Enter a valid repayment amount");
      return;
    }
    if (repayForm.paidBy && !isAccountPerson(repayForm.paidBy)) {
      setMessage("Invalid payment person");
      return;
    }
    try {
      await postAction("repayBorrowing", {
        borrowingId: repayForm.borrowingId,
        amount,
        repaymentDate: repayForm.repaymentDate,
        paidBy: repayForm.paidBy || undefined,
      });
      setRepayForm(null);
      setMessage("Repayment saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save repayment");
    }
  }

  const companyBalance = Number(
    data?.cashBalance?.COMPANY ?? data?.cashBalance?.PET ?? data?.cashBalance?.PLASTIC ?? 0
  );
  const recon = data?.reconciliation?.COMPANY || data?.reconciliation?.[mode];
  const breakdown = data?.cashflowBreakdown?.COMPANY || data?.cashflowBreakdown?.[mode];
  const businessSplit = data?.businessSplit;
  const externalLoans = Number(
    (data?.externalLoanOutstanding?.PET || 0) + (data?.externalLoanOutstanding?.PLASTIC || 0)
    || recon?.externalLoanOutstanding || 0
  );
  // Borrowings list still mode-filterable for ops focus; totals include both.
  const filteredBorrowings = (data?.borrowings || []).filter((b) => b.mode === mode);
  const openBorrowings = filteredBorrowings.filter((b) => Number(b.outstanding_amount) > 0);
  const outstandingByVendor = useMemo(() => {
    const map = new Map<number, { supplierId: number; name: string; outstanding: number; modes: Set<string> }>();
    for (const row of data?.purchases || []) {
      const credit = Number(row.credit_amount || 0);
      if (credit <= 0.005) continue;
      const supplierId = Number(row.supplier_id || 0);
      if (!supplierId) continue;
      const name = String(row.supplierName || (data?.suppliers || []).find((s) => s.id === supplierId)?.name || `Vendor #${supplierId}`);
      const prev = map.get(supplierId);
      const modes = prev?.modes || new Set<string>();
      modes.add(String(row.mode || ""));
      map.set(supplierId, { supplierId, name, outstanding: (prev?.outstanding || 0) + credit, modes });
    }
    return [...map.values()]
      .map((v) => ({ ...v, modeLabel: [...v.modes].filter(Boolean).join(" · ") }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [data]);
  const vendorOutstandingTotal = outstandingByVendor.reduce((n, v) => n + v.outstanding, 0);

  const accounts = useMemo(() => {
    return people.map((person) => {
      const serverTotals = personTotalsFromData(data, person);
      if (serverTotals) {
        return {
          person,
          received: Number(serverTotals.received || 0),
          buyerAdvanceReceived: Number(serverTotals.buyerAdvanceReceived || 0),
          partnerLent: Number(serverTotals.partnerLent || 0),
          partnerLentHeld: Number(serverTotals.partnerLentHeld || 0),
          paid: Number(serverTotals.paid || 0),
          balance: Number(serverTotals.balance || 0),
          purchasesPaid: Number(serverTotals.purchasesPaid || 0),
          expensesPaid:
            Number(serverTotals.expensesPaid || 0) +
            Number(serverTotals.processingPaid || 0) +
            Number(serverTotals.saleProcessingPaid || 0) +
            Number(serverTotals.labourPaid || 0) +
            Number(serverTotals.contractorPaid || 0),
          companyPaid: Number(serverTotals.companyPaid || 0),
          ownPocketPaid: Number(serverTotals.ownPocketPaid || 0),
          settled: Number(serverTotals.settled || 0),
          cashWithPartner: Number(serverTotals.cashWithPartner ?? serverTotals.balance ?? 0),
          companyOwesPartner: Number(serverTotals.companyOwesPartner || 0),
        };
      }

      const received = sumBy(data?.salePayments, "received_by", person);
      const purchasesPaid = (data?.vendorPayments || [])
        .filter((row) =>
          String(row.paid_by || "") === person &&
          String(row.payment_type || "") !== "ADVANCE" &&
          String(row.payment_mode || "") !== "Advance"
        )
        .reduce((total, row) => total + Number(row.amount ?? 0), 0);
      const expensesPaid = sumBy(data?.otherExpenses, "paid_by", person);
      const processingPaid = sumBy(data?.processingExpenses, "paid_by", person);
      const saleProcessingPaid = (data?.saleProcessingCosts || [])
        .filter((row) => String(row.paid_by || "") === person)
        .reduce((total, row) => total + Number(row.labour_cost || 0) + Number(row.loading_cost || 0), 0);
      const labourPaid = (data?.manualLabour || [])
        .filter((row) =>
          String(row.paid_by || "") === person &&
          ["WAGE", "ADVANCE", ""].includes(String(row.payment_kind || "WAGE"))
        )
        .reduce((total, row) => total + Number(row.amount ?? 0), 0);
      const contractorPaid = (data?.processingContractorLedger || [])
        .filter((row) =>
          String(row.paid_by || "") === person &&
          ["ADVANCE", "SETTLEMENT"].includes(String(row.entry_type || ""))
        )
        .reduce((total, row) => total + Number(row.amount ?? 0), 0);
      const paid = purchasesPaid + expensesPaid + processingPaid + saleProcessingPaid + labourPaid + contractorPaid;
      const cashWithPartner = received - paid;
      return {
        person,
        received,
        buyerAdvanceReceived: 0,
        partnerLent: 0,
        partnerLentHeld: 0,
        paid,
        balance: cashWithPartner,
        purchasesPaid,
        expensesPaid: expensesPaid + processingPaid + saleProcessingPaid + labourPaid + contractorPaid,
        companyPaid: paid,
        ownPocketPaid: 0,
        settled: 0,
        cashWithPartner,
        companyOwesPartner: 0,
      };
    });
  }, [data]);

  const allTransactions = useMemo(() => {
    const rows: TxRow[] = [];

    (data?.salePayments || [])
      .filter((x) => x.received_by)
      .forEach((x) => rows.push({
        date: String(x.payment_date ?? ""),
        type: "Sale receipt",
        description: `${x.mode || ""} · ${x.customerName ? `Sale from ${x.customerName}` : `Sale #${x.sale_id}`}`.trim(),
        person: String(x.received_by ?? ""),
        amount: Number(x.amount || 0),
        direction: "in",
      }));

    (data?.buyerAdvances || []).forEach((x) => rows.push({
      date: String(x.advance_date ?? ""),
      type: "Buyer advance",
      description: `${x.mode || ""} · Advance from ${x.buyer_name}${x.notes ? ` — ${x.notes}` : ""}`.trim(),
      person: String(x.received_by ?? ""),
      amount: Number(x.amount || 0),
      direction: "in",
    }));

    (data?.partnerAdvances || []).forEach((x) => {
      const lender = String(x.person ?? "");
      const holder = String(x.held_by || lender);
      rows.push({
        date: String(x.advance_date ?? ""),
        type: "Partner lent to company",
        description: `${lender} gave money to company${holder !== lender ? ` (held by ${holder})` : ""}${x.notes ? ` — ${x.notes}` : ""}`,
        person: holder,
        amount: Number(x.amount || 0),
        direction: "in",
      });
    });

    (data?.vendorPayments || [])
      .filter((x) => x.paid_by && String(x.payment_type || "") !== "ADVANCE" && String(x.payment_mode || "") !== "Advance" && Number(x.amount) > 0)
      .forEach((x) => {
        const later = String(x.payment_type || "") === "CREDIT_SETTLEMENT";
        const base = x.purchase_id
          ? `${later ? "Paid after cash in" : "Paid at purchase"} — #${x.purchase_id} ${x.materialName || x.supplierName || ""}`.trim()
          : String(x.supplierName || "Vendor payment");
        rows.push({
          date: String(x.payment_date ?? ""),
          type: later ? "Vendor payment (later)" : "Purchase payment",
          description: `${x.mode || ""} · ${base}`.trim(),
          person: String(x.paid_by ?? ""),
          amount: Number(x.amount || 0),
          direction: "out",
          funding: String(x.funding_source || "COMPANY") === "OWN_POCKET" ? "Own pocket" : "Company cash",
        });
      });

    [...(data?.otherExpenses || []), ...(data?.processingExpenses || []), ...(data?.saleProcessingCosts || [])]
      .filter((x) => x.paid_by && Number(x.amount ?? x.labour_cost ?? x.loading_cost) > 0)
      .forEach((x) => {
        const amount = x.amount != null
          ? Number(x.amount)
          : Number(x.labour_cost ?? 0) + Number(x.loading_cost ?? 0);
        rows.push({
          date: String(x.expense_date ?? x.payment_date ?? ""),
          type: "Expense",
          description: `${x.mode || ""} · ${String(x.description ?? x.expense_type ?? "Business expense")}`.trim(),
          person: String(x.paid_by ?? ""),
          amount,
          direction: "out",
          funding: String(x.funding_source || "COMPANY") === "OWN_POCKET" ? "Own pocket" : "Company cash",
        });
      });

    (data?.manualLabour || [])
      .filter((x) =>
        x.paid_by &&
        Number(x.amount) > 0 &&
        String(x.payment_kind || "WAGE") !== "ATTENDANCE"
      )
      .forEach((x) => rows.push({
        date: String(x.payment_date ?? ""),
        type: String(x.payment_kind || "") === "ADVANCE" ? "Labour advance" : "Labour wage",
        description: `${x.mode || ""} · ${x.workerName || "Worker"} — ${x.task_type || "Labour"}`.trim(),
        person: String(x.paid_by ?? ""),
        amount: Number(x.amount || 0),
        direction: "out",
        funding: String(x.funding_source || "COMPANY") === "OWN_POCKET" ? "Own pocket" : "Company cash",
      }));

    (data?.processingContractorLedger || [])
      .filter((x) =>
        x.paid_by &&
        Number(x.amount) > 0 &&
        ["ADVANCE", "SETTLEMENT"].includes(String(x.entry_type || ""))
      )
      .forEach((x) => {
        const isAdvance = String(x.entry_type) === "ADVANCE";
        rows.push({
          date: String(x.entry_date ?? ""),
          type: isAdvance ? "Contractor advance" : "Contractor settlement",
          description: `${x.mode || ""} · ${x.contractorName || "Contractor"} — ${isAdvance ? "advance" : "settlement"}`.trim(),
          person: String(x.paid_by ?? ""),
          amount: Number(x.amount || 0),
          direction: "out",
          funding: String(x.funding_source || "COMPANY") === "OWN_POCKET" ? "Own pocket" : "Company cash",
        });
      });

    (data?.partnerSettlements || [])
      .forEach((x) => {
        const paidBy = String(x.paid_by || "");
        const partner = String(x.person ?? "");
        // One list row only — company book is hit once. Who handed cash stays in the description
        // (and in each partner's wallet math), so it does not look like ₹amount × 2 left the company.
        const note = x.notes ? String(x.notes) : "";
        const who = paidBy && paidBy !== partner
          ? `Company repaid ${partner}; cash handed by ${paidBy}`
          : paidBy
            ? `Company repaid ${partner} (by ${paidBy})`
            : `Company repaid ${partner}`;
        rows.push({
          date: String(x.settlement_date ?? ""),
          type: "Partner settlement",
          description: note || who,
          person: partner,
          amount: Number(x.amount || 0),
          direction: "out",
          funding: "Company cash",
        });
      });

    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  const transactions = useMemo(() => allTransactions.slice(0, 100), [allTransactions]);

  function openDetail(title: string, rows: TxRow[], moreHref: string, moreLabel: string, subtitle?: string) {
    setDetailPopup({ title, subtitle, rows: rows.slice(0, 12), moreHref, moreLabel });
  }

  return (
    <AdminShell
      title="Accounts & Finance"
      subtitle="One company cash book for PET + Plastic. Partners are shared. Business split shows analysis by mode."
      actions={
        <button className="ad-btn ad-btn-ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      }
    >
      {message && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            /saved|success/i.test(message)
              ? "border-[var(--ad-success)] text-[var(--ad-success)]"
              : "border-[var(--ad-danger)] text-[var(--ad-danger)]"
          }`}
          role="alert"
        >
          {message}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button className={tab === "overview" ? "ad-btn ad-btn-primary" : "ad-btn ad-btn-ghost"} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button className={tab === "borrowings" ? "ad-btn ad-btn-primary" : "ad-btn ad-btn-ghost"} onClick={() => setTab("borrowings")}>
          Borrowings
        </button>
      </div>

      {tab === "overview" && <>
      <div className="mb-5 ad-card p-4">
        <button
          type="button"
          className="w-full text-left"
          onClick={() => openDetail(
            "Company book — recent activity",
            allTransactions,
            "#account-transactions",
            "See full transaction list below",
            "Sales in, vendor/expense/settlement out. Click through for the full list."
          )}
        >
          <p className="ad-muted text-xs">Company Account (shared PET + Plastic) · tap for recent activity</p>
          <p className={`mt-1 text-3xl font-bold ${companyBalance < 0 ? "text-[var(--ad-danger)]" : ""}`}>{money(companyBalance)}</p>
          <p className="ad-muted mt-2 text-xs leading-relaxed">
            One cash book for the firm. PET sale or Plastic purchase both move this balance.
            Sales + Buyer advances − Vendor payments − Expenses − Labour − Contractor cash + Loans + Partner money given − Repayments − Partner settlements.
            Attendance-only labour does not hit this book. Unpaid purchases stay as vendor dues until paid.
          </p>
        </button>
        {vendorOutstandingTotal > 0.005 && (
          <button
            type="button"
            className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ad-warning)] bg-[color-mix(in_srgb,var(--ad-warning)_12%,transparent)] px-3 py-2 text-left text-sm"
            onClick={() => {
              window.location.assign("/admin/vendors");
            }}
          >
            <span>
              <span className="font-semibold">Vendor dues outstanding</span>
              <span className="ad-muted ml-2 text-xs">Material received, not paid yet — pay it from Vendors & Buyers</span>
            </span>
            <span className="text-lg font-bold text-[var(--ad-warning)]">{money(vendorOutstandingTotal)}</span>
          </button>
        )}
        {breakdown && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
            <button
              type="button"
              className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
              onClick={() => openDetail("Sales received", allTransactions.filter((t) => t.direction === "in"), "/admin/inventory", "Open Inventory → Sales", "Money collected from customers")}
            >
              <p className="ad-muted">Sales received</p>
              <p className="mt-1 font-semibold text-[var(--ad-success)]">+{money(breakdown.salesReceived)}</p>
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
              onClick={() => openDetail("Vendor payments", allTransactions.filter((t) => t.type.includes("Vendor") || t.type.includes("Purchase")), "/admin/inventory", "Open Inventory → Purchases", "Cash paid to vendors (payment date)")}
            >
              <p className="ad-muted">Vendor payments</p>
              <p className="mt-1 font-semibold text-[var(--ad-danger)]">−{money(breakdown.vendorPayments)}</p>
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
              onClick={() => openDetail(
                "Expenses + labour + contractor cash",
                allTransactions.filter((t) =>
                  t.type === "Expense" ||
                  t.type === "Labour wage" ||
                  t.type === "Labour advance" ||
                  t.type === "Contractor advance" ||
                  t.type === "Contractor settlement"
                ),
                "/admin/processing",
                "Open Labour Management",
                "Company-funded expenses, wages, advances, and contractor cash"
              )}
            >
              <p className="ad-muted">Expenses + labour + contractor</p>
              <p className="mt-1 font-semibold text-[var(--ad-danger)]">
                −{money(
                  breakdown.otherExpenses +
                  breakdown.processingExpenses +
                  breakdown.saleProcessing +
                  breakdown.manualLabour +
                  Number(breakdown.contractorCash || 0)
                )}
              </p>
            </button>
            {Number(breakdown.buyerAdvances || 0) > 0 && (
              <button
                type="button"
                className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                onClick={() => openDetail(
                  "Buyer advances",
                  allTransactions.filter((t) => t.type === "Buyer advance"),
                  "/admin/vendors",
                  "Open Vendors & Buyers",
                  "Advance money received from buyers"
                )}
              >
                <p className="ad-muted">Buyer advances received</p>
                <p className="mt-1 font-semibold text-[var(--ad-success)]">+{money(Number(breakdown.buyerAdvances))}</p>
              </button>
            )}
            {Number(breakdown.partnerAdvances || 0) > 0 && (
              <button
                type="button"
                className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                onClick={() => openDetail(
                  "Partner money given to company",
                  allTransactions.filter((t) => t.type === "Partner lent to company"),
                  "#partner-lend",
                  "Open lend form"
                )}
              >
                <p className="ad-muted">Partner money given (temp)</p>
                <p className="mt-1 font-semibold text-[var(--ad-success)]">+{money(Number(breakdown.partnerAdvances))}</p>
              </button>
            )}
            {(breakdown.borrowed > 0 || breakdown.loanRepaid > 0) && (
              <div className="rounded-lg border border-[var(--ad-border)] p-2">
                <p className="ad-muted">Loans net</p>
                <p className="mt-1 font-semibold">{money(breakdown.borrowed - breakdown.loanRepaid)}</p>
              </div>
            )}
            {breakdown.partnerSettled > 0 && (
              <button
                type="button"
                className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                onClick={() => openDetail(
                  "Partner settlements",
                  allTransactions.filter((t) => t.type === "Partner settlement"),
                  "#account-transactions",
                  "See transactions below"
                )}
              >
                <p className="ad-muted">Partner settlements</p>
                <p className="mt-1 font-semibold text-[var(--ad-danger)]">−{money(breakdown.partnerSettled)}</p>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mb-5 ad-card p-4">
        <h2 className="font-semibold">Reconciliation</h2>
        <p className="ad-muted mt-1 text-xs">Positive partner balance = holds company cash. Negative = company needs to pay that partner. Vendor dues are separate from the cash book.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <button
            type="button"
            className="rounded-lg border border-[var(--ad-border)] p-3 text-left"
            onClick={() => openDetail("Company book", allTransactions, "#account-transactions", "See full list below")}
          >
            <p className="ad-muted text-xs">Company book (cash)</p>
            <p className={`mt-1 text-lg font-bold ${(recon?.companyBook ?? companyBalance) < 0 ? "text-[var(--ad-danger)]" : ""}`}>
              {money(recon?.companyBook ?? companyBalance)}
            </p>
          </button>
          <button
            type="button"
            className={`rounded-lg border p-3 text-left ${vendorOutstandingTotal > 0.005 ? "border-[var(--ad-warning)]" : "border-[var(--ad-border)]"}`}
            onClick={() => {
              window.location.assign("/admin/vendors");
            }}
          >
            <p className="ad-muted text-xs">Vendor dues outstanding</p>
            <p className={`mt-1 text-lg font-bold ${vendorOutstandingTotal > 0.005 ? "text-[var(--ad-warning)]" : ""}`}>
              {money(vendorOutstandingTotal)}
            </p>
            {outstandingByVendor.length > 0 && (
              <p className="ad-muted mt-1 text-[10px] leading-snug">
                {outstandingByVendor.slice(0, 3).map((v) => `${v.name} ${money(v.outstanding)}`).join(" · ")}
                {outstandingByVendor.length > 3 ? " · …" : ""}
              </p>
            )}
          </button>
          <div className="rounded-lg border border-[var(--ad-border)] p-3">
            <p className="ad-muted text-xs">Cash with partners</p>
            <p className="mt-1 text-lg font-bold">{money(recon?.cashWithPartners ?? accounts.reduce((n, a) => n + Math.max(0, a.balance), 0))}</p>
          </div>
          <div className="rounded-lg border border-[var(--ad-border)] p-3">
            <p className="ad-muted text-xs">Company needs to pay partners</p>
            <p className="mt-1 text-lg font-bold">{money(recon?.dueToPartners ?? accounts.reduce((n, a) => n + Math.max(0, -a.balance), 0))}</p>
          </div>
          <div className="rounded-lg border border-[var(--ad-border)] p-3">
            <p className="ad-muted text-xs">Owed to partners (own pocket + lent)</p>
            <p className="mt-1 text-lg font-bold">{money(accounts.reduce((n, a) => n + Math.max(0, a.companyOwesPartner), 0))}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--ad-border)] p-3 text-left"
            onClick={() => window.location.assign("/admin/vendors")}
          >
            <p className="ad-muted text-xs">Buyer advance held (to adjust in sales)</p>
            <p className="mt-1 text-lg font-bold">{money(Number(data?.buyerAdvanceBalance || 0))}</p>
          </button>
          <div className="rounded-lg border border-[var(--ad-border)] p-3">
            <p className="ad-muted text-xs">External loans outstanding</p>
            <p className="mt-1 text-lg font-bold">{money(externalLoans)}</p>
          </div>
        </div>
      </div>

      <div className="mb-5 ad-card p-4">
        <h2 className="font-semibold">Business split (analysis)</h2>
        <p className="ad-muted mt-1 text-xs">
          Same company cash, separate PET vs Plastic contribution. Sell PET and buy Plastic both hit one book; this strip shows where money came from / went.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(["PET", "PLASTIC"] as const).map((biz) => {
            const split = businessSplit?.[biz];
            return (
              <div key={biz} className="rounded-xl border border-[var(--ad-border)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ad-muted)]">{biz}</p>
                <p className={`mt-1 text-2xl font-bold ${(split?.contribution || 0) < 0 ? "text-[var(--ad-danger)]" : ""}`}>
                  {money(split?.contribution || 0)}
                </p>
                <p className="ad-muted mt-1 text-xs">Mode contribution to company book</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-[var(--ad-input)] p-2">
                    <p className="ad-muted">Sales in</p>
                    <p className="mt-1 font-semibold text-[var(--ad-success)]">+{money(split?.salesReceived || 0)}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--ad-input)] p-2">
                    <p className="ad-muted">Vendor paid</p>
                    <p className="mt-1 font-semibold text-[var(--ad-danger)]">−{money(split?.vendorPayments || 0)}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--ad-input)] p-2">
                    <p className="ad-muted">Expenses{Number(split?.sharedExpensesAllocated||0)>0?" (incl. shared)":""}</p>
                    <p className="mt-1 font-semibold">−{money(split?.expenses || 0)}</p>
                    {Number(split?.sharedExpensesAllocated||0)>0.005 && (
                      <p className="ad-muted mt-1 text-[10px]">Shared bill share {money(split?.sharedExpensesAllocated||0)}</p>
                    )}
                  </div>
                  <div className="rounded-lg bg-[var(--ad-input)] p-2">
                    <p className="ad-muted">Labour cash</p>
                    <p className="mt-1 font-semibold">−{money(split?.labourCash || 0)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {accounts.map((account) => {
          const bal = account.balance;
          const primaryLabel = bal > 0.005
            ? `${account.person} has company cash`
            : bal < -0.005
              ? `Company needs to pay ${account.person}`
              : `Settled with ${account.person}`;
          const overspent = account.cashWithPartner < -0.005;
          return (
            <div key={account.person} className="ad-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{account.person}</p>
                  <p className="ad-muted text-xs">{primaryLabel}</p>
                  {overspent && bal < -0.005 && (
                    <p className="mt-1 text-[10px] text-[var(--ad-muted)]">{account.person} overspent company cash vs receipts</p>
                  )}
                </div>
                <p className={`text-xl font-bold ${bal < 0 ? "text-[var(--ad-danger)]" : bal > 0 ? "text-[var(--ad-success)]" : ""}`}>
                  {money(bal)}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                  onClick={() => openDetail(
                    `${account.person} — received`,
                    allTransactions.filter((t) => t.person === account.person && t.direction === "in"),
                    "/admin/inventory",
                    "Open Inventory → Sales"
                  )}
                >
                  <p className="ad-muted">Received</p>
                  <p className="mt-1 font-semibold">{money(account.received)}</p>
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                  onClick={() => openDetail(
                    `${account.person} — paid (company cash)`,
                    allTransactions.filter((t) => t.person === account.person && t.direction === "out"),
                    "/admin/inventory",
                    "Open Inventory → Purchases"
                  )}
                >
                  <p className="ad-muted">Paid (company cash)</p>
                  <p className="mt-1 font-semibold">{money(account.companyPaid)}</p>
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                  onClick={() => openDetail(
                    `${account.person} — own-pocket`,
                    allTransactions.filter((t) => t.person === account.person && t.funding === "Own pocket"),
                    "#account-transactions",
                    "See transactions below"
                  )}
                >
                  <p className="ad-muted">Own-pocket advances</p>
                  <p className="mt-1 font-semibold">{money(account.ownPocketPaid)}</p>
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--ad-border)] p-2 text-left hover:border-[var(--ad-accent)]"
                  onClick={() => openDetail(
                    `${account.person} — settlements`,
                    allTransactions.filter((t) =>
                      t.type.toLowerCase().includes("settlement") &&
                      (t.person === account.person || t.description.includes(account.person))
                    ),
                    "#account-transactions",
                    "See transactions below"
                  )}
                >
                  <p className="ad-muted">Settled</p>
                  <p className="mt-1 font-semibold">{money(account.settled)}</p>
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs">
                <p>Holds company cash: <span className="font-semibold">{money(Math.max(0, bal))}</span></p>
                <p>Company needs to pay: <span className="font-semibold">{money(Math.max(0, -bal))}</span></p>
                {account.partnerLent > 0.005 && (
                  <p>Lent to company (temp): <span className="font-semibold">{money(account.partnerLent)}</span></p>
                )}
                {account.buyerAdvanceReceived > 0.005 && (
                  <p>Buyer advances received: <span className="font-semibold">{money(account.buyerAdvanceReceived)}</span></p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div id="partner-lend" className="mb-5 ad-card p-4 scroll-mt-4">
        <h2 className="mb-1 font-semibold">Partner gives money to company (temporary)</h2>
        <p className="ad-muted mb-3 text-xs">
          A partner lends cash to the company for now. It adds to the company book and the partner shows as &quot;company needs to pay&quot;.
          When the company returns it, use <b>Settle partner</b> below. Example: Rahul gives ₹50,000 and Devesh keeps it — Partner = Rahul, Money held by = Devesh.
        </p>
        <div className="grid gap-2 md:grid-cols-6">
          <PersonSelect label="Partner" value={lend.person} onChange={(v) => setLend({ ...lend, person: v })} required />
          <input className="ad-input" type="number" min="0" placeholder="Amount" value={lend.amount} onChange={(e) => setLend({ ...lend, amount: e.target.value })} />
          <input className="ad-input" type="date" value={lend.advanceDate} onChange={(e) => setLend({ ...lend, advanceDate: e.target.value })} />
          <PersonSelect label="Money held by" value={lend.heldBy} onChange={(v) => setLend({ ...lend, heldBy: v })} />
          <input className="ad-input" placeholder="Notes (e.g. for salary week)" value={lend.notes} onChange={(e) => setLend({ ...lend, notes: e.target.value })} />
          <button className="ad-btn ad-btn-primary" onClick={() => void lendToCompany()} disabled={lendBusy}>
            {lendBusy ? "Saving…" : "Give to company"}
          </button>
        </div>
        <p className="ad-muted mt-2 text-[11px]">Money held by: leave empty if the lending partner keeps the cash himself.</p>
      </div>

      <div className="mb-5 ad-card p-4">
        <h2 className="mb-1 font-semibold">Settle partner (company pays back)</h2>
        <p className="ad-muted mb-3 text-xs">
          When company returns money to a partner (own-pocket advance or overspend reimbursement).
          Example: Devesh holds sale cash and settles Rahul — select Partner = Rahul, Payment done by = Devesh.
        </p>
        <div className="grid gap-2 md:grid-cols-6">
          <PersonSelect label="Partner" value={settle.person} onChange={(v) => setSettle({ ...settle, person: v })} required />
          <input className="ad-input" type="number" min="0" placeholder="Amount" value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} />
          <input className="ad-input" type="date" value={settle.settlementDate} onChange={(e) => setSettle({ ...settle, settlementDate: e.target.value })} />
          <PersonSelect value={settle.paidBy} onChange={(v) => setSettle({ ...settle, paidBy: v })} required />
          <input className="ad-input" placeholder="Notes" value={settle.notes} onChange={(e) => setSettle({ ...settle, notes: e.target.value })} />
          <button className="ad-btn ad-btn-primary" onClick={() => void settlePartner()} disabled={settleBusy}>
            {settleBusy ? "Saving…" : "Record settlement"}
          </button>
        </div>
      </div>

      <div className="ad-card p-4" id="account-transactions">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Account Transactions</h2>
            <p className="ad-muted text-xs">Receipts, company-funded and own-pocket payments, and partner settlements.</p>
          </div>
          <span className="ad-muted text-xs">{transactions.length} recent entries</span>
        </div>

        {loading ? (
          <p className="ad-muted py-8 text-center text-sm">Loading account transactions…</p>
        ) : transactions.length === 0 ? (
          <p className="ad-muted py-8 text-center text-sm">No person-attributed transactions found for {mode}.</p>
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Person</th>
                  <th>Paid from</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, index) => (
                  <tr key={index}>
                    <td>{tx.date || "—"}</td>
                    <td>{tx.type}</td>
                    <td>{tx.description}</td>
                    <td>{tx.person}</td>
                    <td>{tx.funding || (tx.direction === "in" ? "—" : "Company cash")}</td>
                    <td className="font-semibold">
                      <span className="inline-flex items-center gap-1">
                        {tx.direction === "in" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                        {tx.direction === "in" ? "+" : "−"}{money(tx.amount)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>}

      {detailPopup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" role="dialog" aria-modal="true">
          <div className="ad-card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--ad-border)] px-4 py-3">
              <div>
                <h3 className="font-semibold">{detailPopup.title}</h3>
                {detailPopup.subtitle && <p className="ad-muted mt-1 text-xs">{detailPopup.subtitle}</p>}
              </div>
              <button type="button" className="ad-btn ad-btn-ghost px-2" onClick={() => setDetailPopup(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3">
              {detailPopup.rows.length === 0 ? (
                <p className="ad-muted py-8 text-center text-sm">No recent transactions for this box.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {detailPopup.rows.map((tx, i) => (
                    <div key={i} className="rounded-lg border border-[var(--ad-border)] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{tx.type}</p>
                          <p className="ad-muted text-xs">{tx.description}</p>
                          <p className="ad-muted mt-1 text-xs">{tx.date || "—"} · {tx.person}{tx.funding ? ` · ${tx.funding}` : ""}</p>
                        </div>
                        <p className={`shrink-0 font-semibold ${tx.direction === "in" ? "text-[var(--ad-success)]" : "text-[var(--ad-danger)]"}`}>
                          {tx.direction === "in" ? "+" : "−"}{money(tx.amount)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ad-border)] px-4 py-3">
              {detailPopup.moreHref.startsWith("#") ? (
                <button
                  type="button"
                  className="ad-btn ad-btn-primary"
                  onClick={() => {
                    setDetailPopup(null);
                    document.querySelector(detailPopup.moreHref)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {detailPopup.moreLabel}
                </button>
              ) : (
                <Link href={detailPopup.moreHref} className="ad-btn ad-btn-primary" onClick={() => setDetailPopup(null)}>
                  {detailPopup.moreLabel}
                </Link>
              )}
              <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setDetailPopup(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {tab === "borrowings" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="ad-card p-4">
              <p className="ad-muted text-xs">External loans outstanding</p>
              <p className="mt-1 text-2xl font-bold">{money(externalLoans)}</p>
            </div>
            <div className="ad-card p-4">
              <p className="ad-muted text-xs">All open borrowings</p>
              <p className="mt-1 text-2xl font-bold">{money(openBorrowings.reduce((n, x) => n + Number(x.outstanding_amount), 0))}</p>
            </div>
            <div className="ad-card p-4">
              <p className="ad-muted text-xs">Interest booked (open)</p>
              <p className="mt-1 text-2xl font-bold">{money(openBorrowings.reduce((n, x) => n + Number(x.interest_amount || 0), 0))}</p>
            </div>
          </div>

          <div className="ad-card p-4">
            <h2 className="mb-3 font-semibold">Add lender</h2>
            <div className="grid gap-2 md:grid-cols-5">
              <input className="ad-input" placeholder="Lender name" value={lenderForm.name} onChange={(e) => setLenderForm({ ...lenderForm, name: e.target.value })} />
              <input className="ad-input" placeholder="Phone" value={lenderForm.phone} onChange={(e) => setLenderForm({ ...lenderForm, phone: e.target.value })} />
              <select className="ad-input" value={lenderForm.lenderKind} onChange={(e) => setLenderForm({ ...lenderForm, lenderKind: e.target.value })}>
                <option value="EXTERNAL">External lender</option>
                <option value="PARTNER">Partner advance</option>
              </select>
              <input className="ad-input" placeholder="Notes" value={lenderForm.notes} onChange={(e) => setLenderForm({ ...lenderForm, notes: e.target.value })} />
              <button className="ad-btn ad-btn-primary" onClick={() => void addLender()}>Save lender</button>
            </div>
          </div>

          <div className="ad-card p-4">
            <h2 className="mb-3 font-semibold">Borrow funds for {mode}</h2>
            <p className="mb-3 text-xs ad-muted">Interest is a flat % of principal stored at entry (principal + interest = starting outstanding).</p>
            <div className="grid gap-2 md:grid-cols-4">
              <select className="ad-input" value={borrowing.lenderId} onChange={(e) => setBorrowing({ ...borrowing, lenderId: e.target.value })}>
                <option value="">Lender</option>
                {(data?.lenders || []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}{l.lender_kind === "PARTNER" ? " (Partner)" : ""}</option>
                ))}
              </select>
              <input className="ad-input" type="number" min="0" placeholder="Principal amount" value={borrowing.amount} onChange={(e) => setBorrowing({ ...borrowing, amount: e.target.value })} />
              <input className="ad-input" type="number" min="0" step="0.01" placeholder="Interest % (flat)" value={borrowing.interestRatePercent} onChange={(e) => setBorrowing({ ...borrowing, interestRatePercent: e.target.value })} />
              <input className="ad-input" type="date" value={borrowing.borrowingDate} onChange={(e) => setBorrowing({ ...borrowing, borrowingDate: e.target.value })} />
              <input className="ad-input" type="date" value={borrowing.dueDate} onChange={(e) => setBorrowing({ ...borrowing, dueDate: e.target.value })} title="Due date" />
              <input className="ad-input" placeholder="Purpose" value={borrowing.purpose} onChange={(e) => setBorrowing({ ...borrowing, purpose: e.target.value })} />
              <input className="ad-input" placeholder="Notes" value={borrowing.notes} onChange={(e) => setBorrowing({ ...borrowing, notes: e.target.value })} />
              <button className="ad-btn ad-btn-primary" onClick={() => void addBorrowing()}>Add borrowing</button>
            </div>
            {Number(borrowing.amount) > 0 && (
              <p className="mt-2 text-xs ad-muted">
                Interest ₹{(Number(borrowing.amount) * (Number(borrowing.interestRatePercent || 0) / 100)).toFixed(2)} · Outstanding will start at ₹{(Number(borrowing.amount) + Number(borrowing.amount) * (Number(borrowing.interestRatePercent || 0) / 100)).toFixed(2)}
              </p>
            )}
          </div>

          {repayForm && (
            <div className="ad-card border border-[var(--ad-accent)] p-4">
              <h3 className="mb-3 text-sm font-semibold">Repay borrowing #{repayForm.borrowingId}</h3>
              <div className="grid gap-2 md:grid-cols-4">
                <input className="ad-input" type="number" min="0" placeholder="Repayment amount" value={repayForm.amount} onChange={(e) => setRepayForm({ ...repayForm, amount: e.target.value })} />
                <PersonSelect value={repayForm.paidBy} onChange={(v) => setRepayForm({ ...repayForm, paidBy: v })} />
                <button className="ad-btn ad-btn-primary" onClick={() => void submitRepayment()}>Save repayment</button>
                <button className="ad-btn ad-btn-ghost" onClick={() => setRepayForm(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Lender</th>
                  <th>Kind</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Outstanding</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredBorrowings.map((b) => (
                  <tr key={b.id}>
                    <td>{b.borrowing_date}</td>
                    <td>{b.lenderName}</td>
                    <td>{b.lenderKind === "PARTNER" ? "Partner" : "External"}</td>
                    <td>{money(Number(b.amount))}</td>
                    <td>{money(Number(b.interest_amount || 0))}{Number(b.interest_rate_percent || 0) > 0 ? ` (${b.interest_rate_percent}%)` : ""}</td>
                    <td>{money(Number(b.outstanding_amount))}</td>
                    <td>{b.due_date || "—"}</td>
                    <td>{b.status || "—"}</td>
                    <td>
                      {Number(b.outstanding_amount) > 0 && (
                        <button
                          className="text-xs font-semibold text-[var(--ad-accent)]"
                          onClick={() => setRepayForm({ borrowingId: b.id, amount: String(b.outstanding_amount ?? ""), paidBy: "", repaymentDate: new Date().toISOString().slice(0, 10) })}
                        >
                          Repay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredBorrowings.length === 0 && (
                  <tr><td colSpan={9} className="ad-muted py-6 text-center text-sm">No borrowings for {mode} yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
