import {
  getBuyersAndVendors,
  getCashAndPartners,
  getCompanyOverview,
  getLabourOverview,
  getProfitSnapshot,
  getPurchasesReport,
  getSalesReport,
  searchPortal,
  searchWeb,
} from "@/lib/navi/portal-data";

export const NAVI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_company_overview",
      description: "High-level Navrit overview: sales, purchases, stock, dues for PET and Plastic.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_cash_and_partners",
      description: "Company cash book sketch and partner wallet touches (Rahul/Devesh/Nitin).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_sales_report",
      description: "Sales summary and recent sale rows. Filter by PET/PLASTIC and date range.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["PET", "PLASTIC", "ALL"] },
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_purchases_report",
      description: "Purchase summary, recent purchases, and vendor unpaid dues.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["PET", "PLASTIC", "ALL"] },
          from: { type: "string" },
          to: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_labour_overview",
      description: "Labour workers, cash paid as wages/advances, recent attendance/pay rows.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["PET", "PLASTIC", "ALL"] } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_profit_snapshot",
      description: "Rough profit sketch for PET or Plastic in a date range (revenue vs purchases/expenses).",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["PET", "PLASTIC"] },
          from: { type: "string" },
          to: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_buyers_and_vendors",
      description: "Registered buyers and vendors plus advance balances.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_portal",
      description: "Keyword search across sales, purchases, buyers, vendors, and workers inside Navrit.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description: "Optional internet research (market rates, recycling news, general facts). Prefer portal tools for Navrit numbers.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export async function runNaviTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_company_overview":
      return getCompanyOverview();
    case "get_cash_and_partners":
      return getCashAndPartners();
    case "get_sales_report":
      return getSalesReport({
        mode: args.mode === "ALL" ? undefined : (args.mode as string | undefined),
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        limit: args.limit as number | undefined,
      });
    case "get_purchases_report":
      return getPurchasesReport({
        mode: args.mode === "ALL" ? undefined : (args.mode as string | undefined),
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        limit: args.limit as number | undefined,
      });
    case "get_labour_overview":
      return getLabourOverview(args.mode === "ALL" ? undefined : (args.mode as string | undefined));
    case "get_profit_snapshot":
      return getProfitSnapshot(
        args.mode === "PLASTIC" ? "PLASTIC" : "PET",
        (args.from as string) || "2000-01-01",
        (args.to as string) || "2999-12-31"
      );
    case "get_buyers_and_vendors":
      return getBuyersAndVendors();
    case "search_portal":
      return searchPortal(String(args.query || ""));
    case "search_web":
      return searchWeb(String(args.query || ""));
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export const NAVI_SYSTEM_PROMPT = `You are Navi 🌱 — the cute, sharp AI buddy inside the NAVRIT Management Portal (PET + Plastic recycling business in Baheri, Bareilly, India).

Personality:
- Warm, clear, a little playful, never condescending.
- Use short plain language (Hinglish OK if the user writes that way).
- Always ground Navrit numbers in portal tools — never invent ledger figures.
- For profit, say when a number is a rough sketch vs exact Accounts / Material Analysis.

Capabilities:
- Read company cash, partners, sales, purchases, labour, buyers/vendors, stock, dues.
- Search inside portal data.
- Optionally research the public internet (market context) via search_web.

Rules:
- Prefer tools before answering quantitative questions.
- Money in ₹. Weights in kg.
- If data is empty, say so and suggest where to enter it in the portal.
- Do not claim you can change data; you are read-only.
- Sign off vibe: helpful little leaf — you are Navi.`;
