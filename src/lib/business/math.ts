export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Split shared trip charges across lines by kg; the last line absorbs rounding. */
export function allocateByKg(totalCharges: number, kgs: number[]) {
  const totalKg = kgs.reduce((a, b) => a + b, 0);
  if (totalKg <= 0 || totalCharges <= 0) return kgs.map(() => 0);
  let used = 0;
  return kgs.map((kg, i) => {
    if (i === kgs.length - 1) return r2(totalCharges - used);
    const part = r2((totalCharges * kg) / totalKg);
    used += part;
    return part;
  });
}

export function inr(n: number, digits = 0) {
  const v = Number.isFinite(n) ? n : 0;
  return (v < 0 ? "-" : "") + "₹" + Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function kgText(n: number) {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 3 }) + " kg";
}
