import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type TransactionSlipField = { label: string; value: string };

export type TransactionSlipData = {
  docTitle: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  fields: TransactionSlipField[];
  amountLabel?: string;
  amount?: number;
  notes?: string;
  generatedAt: string;
};

function money(n: number) {
  return `INR ${Number(n || 0).toFixed(2)}`;
}

export async function buildTransactionSlipPdf(data: TransactionSlipData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.05, 0.35, 0.22);
  const muted = rgb(0.35, 0.4, 0.38);
  const black = rgb(0.1, 0.12, 0.11);
  let y = 800;

  const draw = (text: string, opts?: { size?: number; font?: typeof font; color?: typeof black; x?: number }) => {
    const safe = String(text || "").slice(0, 110);
    page.drawText(safe, {
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
  y -= 24;

  for (const field of data.fields) {
    draw(`${field.label}:`, { size: 10, color: muted });
    y -= 14;
    draw(field.value || "—", { size: 11, font: bold });
    y -= 18;
    if (y < 80) break;
  }

  if (data.amount != null) {
    y -= 6;
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.8, color: green });
    y -= 22;
    draw(data.amountLabel || "Amount", { size: 10, color: muted });
    y -= 16;
    draw(money(data.amount), { size: 16, font: bold, color: green });
    y -= 22;
  }

  if (data.notes) {
    draw("Notes:", { size: 10, color: muted });
    y -= 14;
    draw(data.notes, { size: 10 });
    y -= 18;
  }

  y = Math.min(y, 60);
  draw(`Generated: ${data.generatedAt}`, { size: 8, color: muted, x: 40 });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
