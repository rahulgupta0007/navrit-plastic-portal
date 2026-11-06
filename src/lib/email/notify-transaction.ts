import { nowIso } from "@/lib/rates";
import {
  emailConfigDiagnostics,
  isEmailConfigured,
  notifyRecipients,
  sendMailWithPdf,
} from "@/lib/email/gmail";
import {
  buildTransactionSlipPdf,
  type TransactionSlipField,
} from "@/lib/email/transaction-pdf";
import type { NotifyEmailResult } from "@/lib/email/notify-purchase";
import { sqlite } from "@/db";

function businessEnv() {
  return {
    businessName: process.env.NEXT_PUBLIC_BUSINESS_NAME || "NAVRIT",
    businessAddress: process.env.NEXT_PUBLIC_ADDRESS || "",
    businessPhone: process.env.NEXT_PUBLIC_PHONE || process.env.NEXT_PUBLIC_WHATSAPP || "",
  };
}

function logEmail(opts: {
  eventType: string;
  purchaseId: number;
  toEmail: string;
  status: string;
  error?: string;
}) {
  try {
    sqlite
      .prepare(
        `INSERT INTO email_send_log (event_type, purchase_id, to_email, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(opts.eventType, opts.purchaseId, opts.toEmail, opts.status, opts.error || "", nowIso());
  } catch {
    /* table may not exist yet */
  }
}

export type TransactionNotifyInput = {
  /** Stable key for logs / subject, e.g. expense, sale, labour */
  eventType: string;
  docTitle: string;
  subject: string;
  fields: TransactionSlipField[];
  amount?: number;
  amountLabel?: string;
  notes?: string;
  /** Optional link id for email_send_log (0 if N/A) */
  refId?: number;
  sendEmail?: boolean;
};

/**
 * Email a generic transaction slip PDF to Rahul + Devesh + Nitin.
 * Soft-fail — never throws.
 */
export async function notifyTransactionEmail(
  opts: TransactionNotifyInput
): Promise<NotifyEmailResult> {
  if (opts.sendEmail === false) {
    return { configured: isEmailConfigured(), skipped: true, skippedReason: "Email notify turned off" };
  }
  if (!isEmailConfigured()) {
    const d = emailConfigDiagnostics();
    return {
      configured: false,
      skipped: true,
      skippedReason: d.missing.length
        ? `Email not configured — missing ${d.missing.join(", ")} on Railway`
        : "Email not configured",
    };
  }

  const recipients = notifyRecipients();
  const to = recipients.join(", ");
  const biz = businessEnv();
  const filename = `NAVRIT-${opts.eventType}-${opts.refId || Date.now()}.pdf`;

  let pdf: Buffer;
  try {
    pdf = await buildTransactionSlipPdf({
      docTitle: opts.docTitle,
      ...biz,
      fields: opts.fields,
      amount: opts.amount,
      amountLabel: opts.amountLabel,
      notes: opts.notes,
      generatedAt: nowIso(),
    });
  } catch (e) {
    return {
      configured: true,
      skipped: false,
      ok: false,
      error: e instanceof Error ? e.message : "PDF failed",
    };
  }

  const text = [
    opts.docTitle,
    ...opts.fields.map((f) => `${f.label}: ${f.value}`),
    opts.amount != null ? `${opts.amountLabel || "Amount"}: ₹${Number(opts.amount).toFixed(2)}` : "",
    opts.notes ? `Notes: ${opts.notes}` : "",
    `Sent to: ${to}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<pre style="font-family:ui-monospace,monospace;font-size:13px;line-height:1.45">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;

  const sent = await sendMailWithPdf({
    to: recipients,
    subject: opts.subject,
    text,
    html,
    filename,
    pdf,
  });

  const refId = opts.refId || 0;
  if (!sent.ok) {
    logEmail({
      eventType: opts.eventType,
      purchaseId: refId,
      toEmail: to,
      status: "failed",
      error: sent.error,
    });
    return { configured: true, skipped: false, ok: false, to, error: sent.error, filename };
  }

  logEmail({
    eventType: opts.eventType,
    purchaseId: refId,
    toEmail: to,
    status: "sent",
  });
  return { configured: true, skipped: false, ok: true, to, filename };
}

/** Money-moving inventory actions that should email office (excludes master-data CRUD). */
export const TRANSACTION_EMAIL_ACTIONS = new Set([
  "addOtherExpense",
  "addProcessingExpense",
  "addSale",
  "updateSale",
  "receiveSalePayment",
  "addBorrowing",
  "repayBorrowing",
  "settlePartner",
  "addPartnerAdvance",
  "addVendorAdvance",
  "addBuyerAdvance",
  "applyBuyerAdvance",
  "addManualLabour",
  "updateManualLabour",
  "addContractorAdvance",
  "settleContractor",
  "addPreStock",
  "adjustInventory",
  "addProcessingBatch",
  "completeProcessingBatch",
  "deletePurchase",
  "deleteManualLabour",
  "deleteBuyerAdvance",
  "deletePartnerAdvance",
]);

function money(n: unknown) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function str(v: unknown, fallback = "—") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

/**
 * Build a transaction email payload from the inventory API action + request body + JSON result.
 */
export function buildTxNotifyFromAction(
  action: string,
  body: Record<string, unknown>,
  result: Record<string, unknown>
): TransactionNotifyInput | null {
  const mode = str(body.mode, "");
  const titleMap: Record<string, string> = {
    addOtherExpense: "Business expense added",
    addProcessingExpense: "Processing expense added",
    addSale: "Sale recorded",
    updateSale: "Sale updated",
    receiveSalePayment: "Sale payment received",
    addBorrowing: "Borrowing / loan added",
    repayBorrowing: "Loan repayment",
    settlePartner: "Partner settlement",
    addPartnerAdvance: "Partner advance",
    addVendorAdvance: "Vendor advance",
    addBuyerAdvance: "Buyer advance",
    applyBuyerAdvance: "Buyer advance applied",
    addManualLabour: "Labour entry",
    updateManualLabour: "Labour entry updated",
    addContractorAdvance: "Contractor advance",
    settleContractor: "Contractor settlement",
    addPreStock: "Pre-stock / opening stock",
    adjustInventory: "Inventory adjustment",
    addProcessingBatch: "Processing batch created",
    completeProcessingBatch: "Processing batch completed",
    deletePurchase: "Purchase deleted",
    deleteManualLabour: "Labour entry deleted",
    deleteBuyerAdvance: "Buyer advance deleted",
    deletePartnerAdvance: "Partner advance deleted",
  };
  const docTitle = titleMap[action] || `Transaction: ${action}`;
  const fields: TransactionSlipField[] = [];
  if (mode) fields.push({ label: "Mode / scope", value: mode });

  let amount: number | undefined;
  let amountLabel = "Amount";
  let notes = str(body.notes || body.description, "");
  let refId = Number(result.id || result.saleId || result.batchId || body.saleId || body.purchaseId || body.labourId || 0) || undefined;

  switch (action) {
    case "addOtherExpense":
    case "addProcessingExpense":
      fields.push({ label: "Category", value: str(body.expenseType) });
      fields.push({ label: "Payment date", value: str(body.expenseDate) });
      if (body.billingMonth) fields.push({ label: "Billing month", value: str(body.billingMonth) });
      if (body.billingStartDate || body.billingEndDate) {
        fields.push({
          label: "Billing period",
          value: `${str(body.billingStartDate, "")} → ${str(body.billingEndDate, "")}`.trim(),
        });
      }
      fields.push({ label: "Payment done by", value: str(body.paidBy) });
      fields.push({ label: "Paid from", value: str(body.fundingSource) === "OWN_POCKET" ? "Own pocket" : "Company cash" });
      if (body.description) fields.push({ label: "Description", value: str(body.description) });
      amount = Number(body.amount);
      notes = str(body.description, "");
      refId = Number(result.id || 0) || undefined;
      break;
    case "addSale":
    case "updateSale":
      fields.push({ label: "Customer", value: str(body.customerName || result.customerName) });
      fields.push({ label: "Sale date", value: str(body.saleDate) });
      fields.push({ label: "Sale ID", value: str(result.id || body.saleId) });
      if (result.total != null) amount = Number(result.total);
      else if (result.total_amount != null) amount = Number(result.total_amount);
      amountLabel = "Sale total";
      break;
    case "receiveSalePayment":
      fields.push({ label: "Sale ID", value: str(body.saleId) });
      fields.push({ label: "Payment date", value: str(body.paymentDate) });
      fields.push({ label: "Mode", value: str(body.paymentMode) });
      fields.push({ label: "Received by", value: str(body.receivedBy) });
      amount = Number(body.amount);
      amountLabel = "Payment received";
      break;
    case "addBorrowing":
      fields.push({ label: "Lender ID", value: str(body.lenderId) });
      fields.push({ label: "Date", value: str(body.borrowingDate) });
      fields.push({ label: "Purpose", value: str(body.purpose) });
      amount = Number(body.amount);
      break;
    case "repayBorrowing":
      fields.push({ label: "Borrowing ID", value: str(body.borrowingId) });
      fields.push({ label: "Repayment date", value: str(body.repaymentDate) });
      fields.push({ label: "Paid by", value: str(body.paidBy) });
      amount = Number(body.amount);
      break;
    case "settlePartner":
    case "addPartnerAdvance":
      fields.push({ label: "Partner", value: str(body.partnerName || body.person || body.paidBy) });
      fields.push({ label: "Date", value: str(body.settlementDate || body.advanceDate || body.paymentDate) });
      amount = Number(body.amount);
      break;
    case "addVendorAdvance":
      fields.push({ label: "Supplier ID", value: str(body.supplierId) });
      fields.push({ label: "Advance date", value: str(body.advanceDate) });
      amount = Number(body.amount);
      break;
    case "addBuyerAdvance":
    case "applyBuyerAdvance":
      fields.push({ label: "Buyer", value: str(body.buyerName) });
      fields.push({ label: "Date", value: str(body.advanceDate || body.paymentDate) });
      amount = Number(body.amount);
      break;
    case "addManualLabour":
    case "updateManualLabour":
      fields.push({ label: "Task", value: str(body.taskType) });
      fields.push({ label: "Payment kind", value: str(body.paymentKind || result.paymentKind) });
      fields.push({ label: "Date", value: str(body.paymentDate) });
      fields.push({ label: "Paid by", value: str(body.paidBy) });
      if (result.totalAmount != null) amount = Number(result.totalAmount);
      else if (body.amount != null) amount = Number(body.amount);
      else if (body.amountPerWorker != null) amount = Number(body.amountPerWorker);
      break;
    case "addContractorAdvance":
    case "settleContractor":
      fields.push({ label: "Date", value: str(body.paymentDate || body.entryDate) });
      fields.push({ label: "Paid by", value: str(body.paidBy) });
      amount = Number(body.amount);
      break;
    case "addPreStock":
      fields.push({ label: "Material", value: `${str(body.materialName)} ${str(body.materialVariant, "")}`.trim() });
      fields.push({ label: "Qty (kg)", value: str(body.quantityKg) });
      fields.push({ label: "Rate / kg", value: money(body.ratePerKg) });
      fields.push({ label: "Stock date", value: str(body.stockDate) });
      amount = Number(result.amount ?? Number(body.quantityKg || 0) * Number(body.ratePerKg || 0));
      amountLabel = "Stock value";
      break;
    case "adjustInventory":
      fields.push({ label: "Material", value: str(body.materialName) });
      fields.push({ label: "Qty change (kg)", value: str(body.quantityKg) });
      fields.push({ label: "Date", value: str(body.transactionDate) });
      amount = Number(body.amount || 0);
      amountLabel = "Adjustment amount";
      break;
    case "addProcessingBatch":
    case "completeProcessingBatch":
      fields.push({ label: "Batch ID", value: str(result.batchId || body.batchId) });
      if (result.inputKg != null) fields.push({ label: "Input kg", value: str(result.inputKg) });
      if (result.outputKg != null) fields.push({ label: "Output kg", value: str(result.outputKg) });
      if (result.contractorEarn != null) {
        amount = Number(result.contractorEarn);
        amountLabel = "Contractor earn";
      }
      break;
    case "deletePurchase":
      fields.push({ label: "Purchase ID", value: str(body.purchaseId) });
      break;
    case "deleteManualLabour":
      fields.push({ label: "Labour ID", value: str(body.labourId) });
      break;
    case "deleteBuyerAdvance":
      fields.push({ label: "Advance ID", value: str(body.advanceId || body.id) });
      break;
    case "deletePartnerAdvance":
      fields.push({ label: "Advance ID", value: str(body.advanceId || body.id) });
      break;
    default:
      fields.push({ label: "Action", value: action });
      if (body.amount != null) amount = Number(body.amount);
  }

  if (amount != null && Number.isFinite(amount)) {
    fields.push({ label: amountLabel, value: money(amount) });
  }

  return {
    eventType: action,
    docTitle,
    subject: `NAVRIT · ${docTitle}${amount != null && Number.isFinite(amount) ? ` · ${money(amount)}` : ""}`,
    fields,
    amount: amount != null && Number.isFinite(amount) ? amount : undefined,
    amountLabel,
    notes: notes && notes !== "—" ? notes : undefined,
    refId,
    sendEmail: body.sendEmail !== false,
  };
}
