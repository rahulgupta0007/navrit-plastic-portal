import { sqlite } from "@/db";
import { nowIso } from "@/lib/rates";
import {
  emailConfigDiagnostics,
  isEmailConfigured,
  notifyRecipients,
  sendMailWithPdf,
} from "@/lib/email/gmail";
import { buildPurchaseSlipPdf, type PurchaseSlipData } from "@/lib/whatsapp/purchase-pdf";
import { formatPhoneDisplay } from "@/lib/whatsapp/phone";

export type NotifyKind = "purchase" | "purchase_update" | "vendor_payment";

export type NotifyEmailResult = {
  configured: boolean;
  skipped: boolean;
  skippedReason?: string;
  ok?: boolean;
  to?: string;
  error?: string;
  filename?: string;
};

type PaymentOverlay = {
  amount: number;
  paymentDate: string;
  paymentMode: string;
  paidBy: string;
  notes: string;
};

function businessEnv() {
  return {
    businessName: process.env.NEXT_PUBLIC_BUSINESS_NAME || "NAVRIT",
    businessAddress: process.env.NEXT_PUBLIC_ADDRESS || "",
    businessPhone: process.env.NEXT_PUBLIC_PHONE || process.env.NEXT_PUBLIC_WHATSAPP || "",
  };
}

function vendorBalances(mode: string, supplierId: number) {
  const purchaseRow = sqlite
    .prepare(
      `SELECT
        COALESCE(SUM(total_amount),0) as totalPurchase,
        COALESCE(SUM(paid_amount),0) as totalPaid,
        COALESCE(SUM(credit_amount),0) as outstanding
       FROM purchases WHERE mode=? AND supplier_id=?`
    )
    .get(mode, supplierId) as { totalPurchase: number; totalPaid: number; outstanding: number };
  const advanceRow = sqlite
    .prepare(
      `SELECT COALESCE(SUM(amount-used_amount),0) as advance
       FROM vendor_advances WHERE mode=? AND supplier_id=?`
    )
    .get(mode, supplierId) as { advance: number };
  return {
    vendorTotalPurchase: Number(purchaseRow?.totalPurchase || 0),
    vendorTotalPaid: Number(purchaseRow?.totalPaid || 0),
    vendorOutstanding: Number(purchaseRow?.outstanding || 0),
    vendorAdvance: Number(advanceRow?.advance || 0),
  };
}

function loadPurchaseSlip(
  purchaseId: number,
  kind: NotifyKind,
  payment?: PaymentOverlay
): PurchaseSlipData | null {
  const row = sqlite
    .prepare(
      `SELECT p.*, s.name as supplierName, s.phone as supplierPhone, s.location as supplierLocation
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id=?`
    )
    .get(purchaseId) as
    | {
        id: number;
        mode: "PET" | "PLASTIC";
        supplier_id: number | null;
        material_name: string;
        material_variant: string;
        quantity_kg: number;
        rate_per_kg: number;
        total_amount: number;
        transport_charges?: number;
        labour_charges?: number;
        paid_amount: number;
        credit_amount: number;
        paid_by: string;
        purchase_date: string;
        notes: string;
        supplierName: string | null;
        supplierPhone: string | null;
        supplierLocation: string | null;
      }
    | undefined;
  if (!row || !row.supplier_id) return null;

  const balances = vendorBalances(row.mode, row.supplier_id);
  const biz = businessEnv();
  const docTitle =
    kind === "vendor_payment"
      ? "Vendor payment receipt"
      : kind === "purchase_update"
        ? "Purchase update slip"
        : "Purchase slip";
  const transportCharges = Number(row.transport_charges || 0);
  const loadingCharges = Number(row.labour_charges || 0);
  const totalAmount = Number(row.total_amount);
  const quantityKg = Number(row.quantity_kg);
  const landedTotal = Math.round((totalAmount + transportCharges + loadingCharges) * 100) / 100;
  const effectiveRate = quantityKg > 0 ? Math.round((landedTotal / quantityKg) * 100) / 100 : Number(row.rate_per_kg);

  return {
    docTitle,
    ...biz,
    mode: row.mode,
    purchaseId: row.id,
    purchaseDate: row.purchase_date,
    vendorName: row.supplierName || "—",
    vendorPhone: formatPhoneDisplay(row.supplierPhone),
    vendorLocation: row.supplierLocation || "",
    materialName: row.material_name,
    materialVariant: row.material_variant || "",
    quantityKg,
    ratePerKg: Number(row.rate_per_kg),
    totalAmount,
    transportCharges,
    loadingCharges,
    landedTotal,
    effectiveRate,
    paidAmount: Number(row.paid_amount),
    creditAmount: Number(row.credit_amount),
    paidBy: row.paid_by || "",
    notes: row.notes || "",
    ...balances,
    payment,
    generatedAt: nowIso(),
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

/**
 * Email full purchase/payment PDF to Rahul + Devesh + Nitin (and any extra NOTIFY_EMAILS).
 * Soft-fail — never throws.
 */
export async function notifyPurchaseEmail(opts: {
  purchaseId: number;
  kind: NotifyKind;
  sendEmail?: boolean;
  payment?: PaymentOverlay;
}): Promise<NotifyEmailResult> {
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
  const slip = loadPurchaseSlip(opts.purchaseId, opts.kind, opts.payment);
  if (!slip) {
    return { configured: true, skipped: true, skippedReason: "Purchase or vendor missing" };
  }

  const filename = `NAVRIT-${opts.kind === "vendor_payment" ? "payment" : "purchase"}-${opts.purchaseId}.pdf`;
  let pdf: Buffer;
  try {
    pdf = await buildPurchaseSlipPdf(slip);
  } catch (e) {
    return {
      configured: true,
      skipped: false,
      ok: false,
      error: e instanceof Error ? e.message : "PDF failed",
    };
  }

  const subject =
    opts.kind === "vendor_payment"
      ? `NAVRIT payment · #${slip.purchaseId} · ${slip.vendorName}`
      : opts.kind === "purchase_update"
        ? `NAVRIT purchase update · #${slip.purchaseId} · ${slip.vendorName}`
        : `NAVRIT purchase · #${slip.purchaseId} · ${slip.vendorName}`;

  const text = [
    slip.docTitle,
    `${slip.mode} · Purchase #${slip.purchaseId} · ${slip.purchaseDate}`,
    `Vendor: ${slip.vendorName}`,
    `Material: ${slip.materialName} ${slip.materialVariant || ""}`.trim(),
    `Qty: ${Number(slip.quantityKg).toFixed(2)} kg @ ₹${Number(slip.ratePerKg).toFixed(2)}`,
    `Vendor material: ₹${Number(slip.totalAmount).toFixed(2)}`,
    `Transport (driver): ₹${Number(slip.transportCharges || 0).toFixed(2)}`,
    `Loading (outside labour): ₹${Number(slip.loadingCharges || 0).toFixed(2)}`,
    `Landed total: ₹${Number(slip.landedTotal || slip.totalAmount).toFixed(2)}`,
    `Final rate / kg: ₹${Number(slip.effectiveRate || slip.ratePerKg).toFixed(2)}`,
    `Paid to vendor: ₹${Number(slip.paidAmount).toFixed(2)}`,
    `Remaining to vendor: ₹${Number(slip.creditAmount).toFixed(2)}`,
    `Vendor outstanding: ₹${Number(slip.vendorOutstanding).toFixed(2)}`,
    `Vendor advance: ₹${Number(slip.vendorAdvance).toFixed(2)}`,
    `Sent to: ${to}`,
    "",
    "PDF attached. Forward to WhatsApp group / vendor manually if needed.",
  ].join("\n");

  const html = `<pre style="font-family:ui-monospace,monospace;font-size:13px;line-height:1.45">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;

  const sent = await sendMailWithPdf({ to: recipients, subject, text, html, filename, pdf });
  if (!sent.ok) {
    logEmail({
      eventType: opts.kind,
      purchaseId: opts.purchaseId,
      toEmail: to,
      status: "failed",
      error: sent.error,
    });
    return { configured: true, skipped: false, ok: false, to, error: sent.error, filename };
  }

  logEmail({
    eventType: opts.kind,
    purchaseId: opts.purchaseId,
    toEmail: to,
    status: "sent",
  });
  return { configured: true, skipped: false, ok: true, to, filename };
}

export function formatEmailStatus(email: NotifyEmailResult | undefined | null): string {
  if (!email) return "";
  if (!email.configured) return "Email not configured yet (saved offline)";
  if (email.skipped && email.skippedReason === "Email notify turned off") return "Email skipped";
  if (email.skipped) return email.skippedReason ? `Email: ${email.skippedReason}` : "Email skipped";
  if (email.ok) return `Email sent to ${email.to || "inbox"}`;
  return `Email failed: ${email.error || "error"}`;
}
