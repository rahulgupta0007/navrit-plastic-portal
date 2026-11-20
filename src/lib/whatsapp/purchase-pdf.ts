import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type PurchaseSlipData = {
  docTitle: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  mode: "PET" | "PLASTIC";
  purchaseId: number;
  purchaseDate: string;
  vendorName: string;
  vendorPhone: string;
  vendorLocation: string;
  materialName: string;
  materialVariant: string;
  quantityKg: number;
  ratePerKg: number;
  totalAmount: number;
  transportCharges?: number;
  loadingCharges?: number;
  landedTotal?: number;
  effectiveRate?: number;
  paidAmount: number;
  creditAmount: number;
  paidBy: string;
  notes: string;
  /** Vendor running balances for this mode */
  vendorOutstanding: number;
  vendorAdvance: number;
  vendorTotalPurchase: number;
  vendorTotalPaid: number;
  /** Optional payment event overlay */
  payment?: {
    amount: number;
    paymentDate: string;
    paymentMode: string;
    paidBy: string;
    notes: string;
  };
  generatedAt: string;
};

function money(n: number) {
  return `INR ${Number(n || 0).toFixed(2)}`;
}

function kg(n: number) {
  return `${Number(n || 0).toFixed(3)} kg`;
}

export async function buildPurchaseSlipPdf(data: PurchaseSlipData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.05, 0.35, 0.22);
  const muted = rgb(0.35, 0.4, 0.38);
  const black = rgb(0.1, 0.12, 0.11);
  let y = 800;

  const draw = (text: string, opts?: { size?: number; font?: typeof font; color?: typeof black; x?: number }) => {
    page.drawText(text, {
      x: opts?.x ?? 40,
      y,
      size: opts?.size ?? 11,
      font: opts?.font ?? font,
      color: opts?.color ?? black,
    });
  };

  draw(data.businessName || "NAVRIT", { size: 18, font: bold, color: green });
  y -= 18;
  draw(data.businessAddress || "", { size: 9, color: muted });
  y -= 12;
  draw(`Phone: ${data.businessPhone || "—"}`, { size: 9, color: muted });
  y -= 22;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1.2, color: green });
  y -= 28;

  draw(data.docTitle, { size: 14, font: bold });
  y -= 16;
  draw(`${data.mode} · Purchase #${data.purchaseId} · ${data.purchaseDate}`, { size: 10, color: muted });
  y -= 24;

  const leftRows: Array<[string, string]> = [
    ["Vendor", data.vendorName || "—"],
    ["Contact", data.vendorPhone || "—"],
    ["Location", data.vendorLocation || "—"],
    ["Material", data.materialName || "—"],
    ["Type / variant", data.materialVariant || "—"],
    ["Quantity", kg(data.quantityKg)],
    ["Rate / kg", money(data.ratePerKg)],
  ];
  for (const [label, value] of leftRows) {
    draw(label, { size: 9, color: muted, font: bold });
    draw(String(value).slice(0, 70), { x: 160, size: 10 });
    y -= 16;
  }

  y -= 8;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.6, color: muted });
  y -= 20;

  draw("This purchase", { size: 12, font: bold, color: green });
  y -= 18;
  const transport = Number(data.transportCharges || 0);
  const loading = Number(data.loadingCharges || 0);
  const landed =
    data.landedTotal != null
      ? Number(data.landedTotal)
      : Number(data.totalAmount) + transport + loading;
  const effective =
    data.effectiveRate != null
      ? Number(data.effectiveRate)
      : data.quantityKg > 0
        ? landed / Number(data.quantityKg)
        : Number(data.ratePerKg);
  const moneyRows: Array<[string, string]> = [
    ["Vendor material total", money(data.totalAmount)],
    ["Transport (driver)", money(transport)],
    ["Loading (outside labour)", money(loading)],
    ["Landed total", money(landed)],
    ["Final rate / kg", money(effective)],
    ["Paid to vendor (material)", money(data.paidAmount)],
    ["Remaining to vendor", money(data.creditAmount)],
    ["Payment done by", data.paidBy || "—"],
  ];
  for (const [label, value] of moneyRows) {
    draw(label, { size: 9, color: muted, font: bold });
    draw(value, { x: 240, size: 11, font: bold });
    y -= 16;
  }

  if (data.payment) {
    y -= 8;
    draw("This payment", { size: 12, font: bold, color: green });
    y -= 18;
    for (const [label, value] of [
      ["Amount paid now", money(data.payment.amount)],
      ["Payment date", data.payment.paymentDate],
      ["Mode", data.payment.paymentMode || "Cash"],
      ["Paid by", data.payment.paidBy || "—"],
      ["Notes", data.payment.notes || "—"],
    ] as Array<[string, string]>) {
      draw(label, { size: 9, color: muted, font: bold });
      draw(String(value).slice(0, 70), { x: 220, size: 10 });
      y -= 16;
    }
  }

  y -= 8;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.6, color: muted });
  y -= 20;

  draw(`Vendor running balance (${data.mode})`, { size: 12, font: bold, color: green });
  y -= 18;
  for (const [label, value] of [
    ["Total purchases", money(data.vendorTotalPurchase)],
    ["Total paid", money(data.vendorTotalPaid)],
    ["Outstanding credit (remaining)", money(data.vendorOutstanding)],
    ["Advance balance", money(data.vendorAdvance)],
  ] as Array<[string, string]>) {
    draw(label, { size: 9, color: muted, font: bold });
    draw(value, { x: 260, size: 11, font: bold });
    y -= 16;
  }

  if (data.notes?.trim()) {
    y -= 10;
    draw("Notes", { size: 9, color: muted, font: bold });
    y -= 14;
    const note = data.notes.trim().slice(0, 220);
    draw(note, { size: 10 });
    y -= 16;
  }

  y = Math.min(y, 80);
  draw(`Generated ${data.generatedAt}`, { size: 8, color: muted });
  y -= 12;
  draw("GST not included. Auto-emailed from NAVRIT portal — forward manually if needed.", { size: 8, color: muted });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
