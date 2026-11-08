import { ZodError } from "zod";

const FIELD_LABELS: Record<string, string> = {
  materialName: "Material",
  materialId: "Material",
  supplierId: "Vendor",
  quantityKg: "Quantity (kg)",
  ratePerKg: "Rate / kg",
  paidAmount: "Paid to vendor",
  paidBy: "Payment done by",
  receivedBy: "Received by",
  person: "Partner",
  amount: "Amount",
  purchaseDate: "Purchase date",
  paymentDate: "Payment date",
  settlementDate: "Settlement date",
  saleDate: "Sale date",
  customerName: "Customer name",
  expenseType: "Expense type",
  description: "Description",
  mode: "Business mode",
  fundingSource: "Paid from",
  borrowingId: "Borrowing account",
  lenderId: "Lender",
  purchaseType: "Purchase type",
  workerIds: "Workers",
  notes: "Notes",
};

function labelFor(path: (string | number)[]) {
  const key = String(path[0] ?? "");
  return FIELD_LABELS[key] || key || "Field";
}

/** Turn Zod issues into short, staff-friendly messages (never bare "Required"). */
export function friendlyZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Please check the form and try again";
  const field = labelFor(issue.path);
  const code = issue.code;

  if (code === "invalid_type") {
    const received = (issue as { received?: unknown }).received;
    if (received === "undefined" || received === undefined) {
      return `Please select or enter ${field}`;
    }
    if (received === "nan" || received === null) {
      return `${field} must be a valid number`;
    }
    return `${field} is invalid`;
  }
  if (code === "too_small") {
    const msg = issue.message || "";
    if (msg && !/^required$/i.test(msg.trim()) && !/string must contain/i.test(msg) && !/number must be/i.test(msg) && !/too small/i.test(msg)) {
      return msg;
    }
    const minimum = (issue as { minimum?: number }).minimum;
    const type = (issue as { type?: string }).type;
    if (type === "string") return `Please select or enter ${field}`;
    if (type === "number" && minimum === 0) return `${field} cannot be negative`;
    if (type === "number") return `${field} must be greater than ${minimum ?? 0}`;
    return `${field} is too small`;
  }
  if (code === "too_big") return `${field} is too large`;
  if (code === "invalid_enum_value" || code === "invalid_literal") {
    return `Please choose a valid ${field}`;
  }
  if (code === "invalid_string") {
    if ((issue as { validation?: string }).validation === "regex") {
      return `${field} must be a valid date (YYYY-MM-DD)`;
    }
    return `${field} format is invalid`;
  }
  // Prefer custom messages when authors set them; rewrite bare "Required".
  const msg = issue.message || "";
  if (!msg || /^required$/i.test(msg.trim())) {
    return `Please select or enter ${field}`;
  }
  if (/expected string/i.test(msg) || /expected number/i.test(msg)) {
    return `Please select or enter ${field}`;
  }
  return msg;
}
