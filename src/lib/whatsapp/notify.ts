import { sqlite } from "@/db";
import { nowIso } from "@/lib/rates";
import {
  isWhatsAppConfigured,
  officeGroupId,
  officeNotifyPhones,
  sendDocumentMessage,
  sendDocumentTemplate,
  uploadDocument,
  type WhatsAppSendResult,
} from "@/lib/whatsapp/cloud-api";
import { formatPhoneDisplay, normalizeIndiaPhone } from "@/lib/whatsapp/phone";
import { buildPurchaseSlipPdf, type PurchaseSlipData } from "@/lib/whatsapp/purchase-pdf";

export type NotifyKind = "purchase" | "purchase_update" | "vendor_payment";

export type NotifyWhatsAppResult = {
  configured: boolean;
  skipped: boolean;
  skippedReason?: string;
  vendor?: WhatsAppSendResult;
  office: WhatsAppSendResult[];
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
): { slip: PurchaseSlipData; supplierId: number; vendorPhoneRaw: string } | null {
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

  return {
    supplierId: row.supplier_id,
    vendorPhoneRaw: String(row.supplierPhone || ""),
    slip: {
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
      quantityKg: Number(row.quantity_kg),
      ratePerKg: Number(row.rate_per_kg),
      totalAmount: Number(row.total_amount),
      paidAmount: Number(row.paid_amount),
      creditAmount: Number(row.credit_amount),
      paidBy: row.paid_by || "",
      notes: row.notes || "",
      ...balances,
      payment,
      generatedAt: nowIso(),
    },
  };
}

function logSend(opts: {
  eventType: string;
  purchaseId?: number | null;
  paymentId?: number | null;
  toPhone: string;
  role: "vendor" | "office";
  status: string;
  error?: string;
}) {
  try {
    sqlite
      .prepare(
        `INSERT INTO whatsapp_send_log
         (event_type, purchase_id, payment_id, to_phone, role, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.eventType,
        opts.purchaseId ?? null,
        opts.paymentId ?? null,
        opts.toPhone,
        opts.role,
        opts.status,
        opts.error || "",
        nowIso()
      );
  } catch {
    /* table may not exist yet during build */
  }
}

function templateName(kind: NotifyKind) {
  if (kind === "vendor_payment") {
    return process.env.WHATSAPP_PAYMENT_TEMPLATE?.trim() || "vendor_payment_slip";
  }
  return process.env.WHATSAPP_PURCHASE_TEMPLATE?.trim() || "purchase_slip";
}

function bodyParams(slip: PurchaseSlipData): string[] {
  return [
    slip.vendorName,
    slip.materialName,
    Number(slip.quantityKg).toFixed(2),
    Number(slip.ratePerKg).toFixed(2),
    Number(slip.totalAmount).toFixed(2),
    Number(slip.paidAmount).toFixed(2),
    Number(slip.creditAmount).toFixed(2),
    Number(slip.vendorOutstanding).toFixed(2),
    slip.purchaseDate,
    String(slip.purchaseId),
  ];
}

function caption(slip: PurchaseSlipData) {
  return [
    `${slip.docTitle} #${slip.purchaseId}`,
    `${slip.vendorName} · ${slip.materialName}`,
    `${Number(slip.quantityKg).toFixed(2)} kg @ ₹${Number(slip.ratePerKg).toFixed(2)}`,
    `Total ₹${Number(slip.totalAmount).toFixed(2)} · Paid ₹${Number(slip.paidAmount).toFixed(2)} · Remaining ₹${Number(slip.creditAmount).toFixed(2)}`,
    `Vendor outstanding ₹${Number(slip.vendorOutstanding).toFixed(2)}`,
  ].join("\n");
}

async function deliverPdf(opts: {
  mediaId: string;
  filename: string;
  slip: PurchaseSlipData;
  kind: NotifyKind;
  to: string;
  role: "vendor" | "office";
  recipientType?: "individual" | "group";
  purchaseId: number;
}): Promise<WhatsAppSendResult> {
  const tpl = templateName(opts.kind);
  let result = await sendDocumentTemplate({
    to: opts.to,
    templateName: tpl,
    mediaId: opts.mediaId,
    filename: opts.filename,
    bodyParams: bodyParams(opts.slip),
    recipientType: opts.recipientType,
  });

  // If template not approved yet, try session document send (works only in open window).
  if (!result.ok && /template/i.test(result.error || "")) {
    result = await sendDocumentMessage({
      to: opts.to,
      mediaId: opts.mediaId,
      filename: opts.filename,
      caption: caption(opts.slip),
      recipientType: opts.recipientType,
    });
  }

  logSend({
    eventType: opts.kind,
    purchaseId: opts.purchaseId,
    toPhone: opts.to,
    role: opts.role,
    status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
    error: result.error,
  });
  return result;
}

/**
 * Build purchase/payment PDF and notify vendor (if phone) + office notify phones / optional API group.
 * Never throws — soft-fail for inventory API.
 */
export async function notifyPurchaseWhatsApp(opts: {
  purchaseId: number;
  kind: NotifyKind;
  sendWhatsApp?: boolean;
  payment?: PaymentOverlay;
}): Promise<NotifyWhatsAppResult> {
  if (opts.sendWhatsApp === false) {
    return { configured: isWhatsAppConfigured(), skipped: true, skippedReason: "Send WhatsApp turned off", office: [] };
  }
  if (!isWhatsAppConfigured()) {
    return { configured: false, skipped: true, skippedReason: "WhatsApp Cloud API not configured", office: [] };
  }

  const loaded = loadPurchaseSlip(opts.purchaseId, opts.kind, opts.payment);
  if (!loaded) {
    return { configured: true, skipped: true, skippedReason: "Purchase or vendor missing", office: [] };
  }

  const { slip, vendorPhoneRaw } = loaded;
  const filename = `NAVRIT-${opts.kind === "vendor_payment" ? "payment" : "purchase"}-${opts.purchaseId}.pdf`;

  let pdf: Buffer;
  try {
    pdf = await buildPurchaseSlipPdf(slip);
  } catch (e) {
    return {
      configured: true,
      skipped: false,
      skippedReason: e instanceof Error ? e.message : "PDF failed",
      office: [],
    };
  }

  const uploaded = await uploadDocument(pdf, filename);
  if (!uploaded.ok) {
    return {
      configured: true,
      skipped: false,
      skippedReason: uploaded.error,
      office: [],
      filename,
    };
  }

  const office: WhatsAppSendResult[] = [];
  let vendor: WhatsAppSendResult | undefined;

  const vendorPhone = normalizeIndiaPhone(vendorPhoneRaw);
  if (vendorPhone) {
    vendor = await deliverPdf({
      mediaId: uploaded.mediaId,
      filename,
      slip,
      kind: opts.kind,
      to: vendorPhone,
      role: "vendor",
      purchaseId: opts.purchaseId,
    });
  } else {
    vendor = { ok: false, skipped: true, error: "Vendor WhatsApp number missing" };
    logSend({
      eventType: opts.kind,
      purchaseId: opts.purchaseId,
      toPhone: "",
      role: "vendor",
      status: "skipped",
      error: "Vendor WhatsApp number missing",
    });
  }

  const groupId = officeGroupId();
  if (groupId) {
    office.push(
      await deliverPdf({
        mediaId: uploaded.mediaId,
        filename,
        slip,
        kind: opts.kind,
        to: groupId,
        role: "office",
        recipientType: "group",
        purchaseId: opts.purchaseId,
      })
    );
  } else {
    for (const phone of officeNotifyPhones()) {
      if (vendorPhone && phone === vendorPhone) continue;
      office.push(
        await deliverPdf({
          mediaId: uploaded.mediaId,
          filename,
          slip,
          kind: opts.kind,
          to: phone,
          role: "office",
          purchaseId: opts.purchaseId,
        })
      );
    }
  }

  const skipped = Boolean(vendor?.skipped) && office.length === 0;
  return {
    configured: true,
    skipped,
    skippedReason: vendor?.skipped ? vendor.error : undefined,
    vendor,
    office,
    filename,
  };
}

export function formatWhatsAppStatus(wa: NotifyWhatsAppResult | undefined | null): string {
  if (!wa) return "";
  if (!wa.configured) return "WhatsApp not configured (purchase saved)";
  if (wa.skipped && wa.skippedReason === "Send WhatsApp turned off") return "WhatsApp skipped (turned off)";
  if (wa.skippedReason === "WhatsApp Cloud API not configured") return "WhatsApp not configured (purchase saved)";

  const parts: string[] = [];
  if (wa.vendor?.ok) parts.push("vendor");
  else if (wa.vendor?.skipped) parts.push("vendor skipped (no number)");
  else if (wa.vendor && !wa.vendor.ok) parts.push(`vendor failed: ${wa.vendor.error || "error"}`);

  const officeOk = (wa.office || []).filter((x) => x.ok).length;
  const officeFail = (wa.office || []).filter((x) => !x.ok && !x.skipped).length;
  if (officeOk) parts.push(`office×${officeOk}`);
  if (officeFail) parts.push(`office failed×${officeFail}`);

  if (!parts.length) {
    return wa.skippedReason ? `WhatsApp: ${wa.skippedReason}` : "WhatsApp skipped";
  }
  return `WhatsApp: ${parts.join(" · ")}`;
}
