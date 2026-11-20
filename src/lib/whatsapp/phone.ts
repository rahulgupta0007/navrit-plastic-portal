/** Normalize Indian / E.164-ish phone strings for WhatsApp Cloud API (`to` without +). */
export function normalizeIndiaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) digits = `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function formatPhoneDisplay(raw: string | null | undefined): string {
  const n = normalizeIndiaPhone(raw);
  if (!n) return String(raw || "").trim() || "—";
  if (n.startsWith("91") && n.length === 12) return `+91 ${n.slice(2, 7)} ${n.slice(7)}`;
  return `+${n}`;
}
