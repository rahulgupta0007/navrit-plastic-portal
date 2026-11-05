/* eslint-disable @typescript-eslint/no-explicit-any */
import { NAVI_SYSTEM_PROMPT, NAVI_TOOLS, runNaviTool } from "@/lib/navi/tools";
import { getCashAndPartners, getCompanyOverview, getProfitSnapshot, searchPortal } from "@/lib/navi/portal-data";

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; name?: string; tool_call_id?: string; tool_calls?: any[] };

function config() {
  const apiKey = process.env.NAVI_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || "";
  const base = (process.env.NAVI_API_BASE || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.NAVI_MODEL || "gpt-4o-mini";
  return { apiKey, base, model };
}

export function naviStatus() {
  const { apiKey, base, model } = config();
  return {
    name: "Navi",
    ready: Boolean(apiKey),
    model: apiKey ? model : "local-portal-brain",
    base: apiKey ? base : null,
    web: true,
    note: apiKey
      ? "Navi is online with LLM + portal tools + optional web research."
      : "No NAVI_API_KEY / OPENAI_API_KEY yet — Navi still answers from portal data with a local brain. Add a key on Railway for full chat intelligence.",
  };
}

async function chatCompletions(messages: ChatMessage[], withTools: boolean) {
  const { apiKey, base, model } = config();
  const body: any = { model, messages, temperature: 0.4 };
  if (withTools) {
    body.tools = NAVI_TOOLS;
    body.tool_choice = "auto";
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `LLM error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function localBrain(userText: string) {
  const q = userText.toLowerCase();
  const overview = getCompanyOverview();
  const cash = getCashAndPartners();

  if (/profit|margin|loss|kamai|munafa/.test(q)) {
    const mode = /plastic/.test(q) ? "PLASTIC" as const : "PET" as const;
    const snap = getProfitSnapshot(mode);
    return [
      `🌱 Navi here! Rough **${mode} profit sketch** from portal ledgers:`,
      ``,
      `- Revenue: ₹${snap.revenue.toLocaleString("en-IN")}`,
      `- Purchases: ₹${snap.purchaseCost.toLocaleString("en-IN")}`,
      `- Mode expenses: ₹${snap.modeExpenses.toLocaleString("en-IN")}`,
      `- Shared expense share (sketch): ₹${snap.sharedExpensesHalfForSketch.toLocaleString("en-IN")}`,
      `- Labour charges on sales: ₹${snap.labourChargesDeductedOnSales.toLocaleString("en-IN")}`,
      `- **Rough profit sketch: ₹${snap.roughProfitSketch.toLocaleString("en-IN")}**`,
      ``,
      snap.disclaimer,
      ``,
      `_Tip: set NAVI_API_KEY for fuller narrative reports._`,
    ].join("\n");
  }

  if (/cash|book|account|partner|rahul|devesh|nitin|wallet/.test(q)) {
    return [
      `🌱 Company cash book (approx): **₹${cash.companyBookApprox.toLocaleString("en-IN")}**`,
      ``,
      `- Sales received: ₹${cash.parts.salesReceived.toLocaleString("en-IN")}`,
      `- Buyer advances: ₹${cash.parts.buyerAdvances.toLocaleString("en-IN")}`,
      `- Vendor payments: ₹${cash.parts.vendorPayments.toLocaleString("en-IN")}`,
      `- Other expenses: ₹${cash.parts.otherExpenses.toLocaleString("en-IN")}`,
      `- Labour cash: ₹${cash.parts.labourCash.toLocaleString("en-IN")}`,
      `- Partner settlements: ₹${cash.parts.partnerSettled.toLocaleString("en-IN")}`,
      ``,
      `Partners: ${cash.partners.map((p) => `${p.person} (settled ₹${p.settled})`).join(" · ")}`,
      ``,
      cash.note,
    ].join("\n");
  }

  if (/sale|sell|buyer|truck/.test(q)) {
    return [
      `🌱 Sales snapshot:`,
      `- PET sales: ₹${overview.sales.PET.toLocaleString("en-IN")} (${overview.soldKg.PET} kg)`,
      `- Plastic sales: ₹${overview.sales.PLASTIC.toLocaleString("en-IN")} (${overview.soldKg.PLASTIC} kg)`,
      `- Total: ₹${overview.sales.total.toLocaleString("en-IN")}`,
      `- Buyer credit pending: ₹${overview.buyerCreditPending.toLocaleString("en-IN")}`,
      ``,
      `Ask me a name to search, e.g. “find buyer Afsar”.`,
    ].join("\n");
  }

  if (/purchase|vendor|dues|kabir|unpaid/.test(q)) {
    return [
      `🌱 Purchases snapshot:`,
      `- PET purchases: ₹${overview.purchases.PET.toLocaleString("en-IN")}`,
      `- Plastic purchases: ₹${overview.purchases.PLASTIC.toLocaleString("en-IN")}`,
      `- Vendor dues outstanding: ₹${overview.vendorDuesOutstanding.toLocaleString("en-IN")}`,
    ].join("\n");
  }

  if (/stock|inventory|kg|natural|red/.test(q)) {
    const lines = (overview.stock as any[]).slice(0, 12).map((s) => `- ${s.mode} · ${s.material}: ${s.kg} kg`);
    return [`🌱 Current stock:`, ...(lines.length ? lines : ["- No stock rows yet"])].join("\n");
  }

  if (/find|search|kaun|where/.test(q)) {
    const term = userText.replace(/find|search|buyer|vendor|worker|for|kaun|hai/gi, " ").trim() || userText;
    const hit = searchPortal(term);
    return [
      `🌱 Portal search for “${term}”:`,
      `- Sales hits: ${(hit as any).sales?.length || 0}`,
      `- Purchase hits: ${(hit as any).purchases?.length || 0}`,
      `- Buyers: ${((hit as any).buyers || []).map((b: any) => b.name).join(", ") || "—"}`,
      `- Vendors: ${((hit as any).vendors || []).map((v: any) => v.name).join(", ") || "—"}`,
      `- Workers: ${((hit as any).workers || []).map((w: any) => w.name).join(", ") || "—"}`,
    ].join("\n");
  }

  return [
    `🌱 Hi, I'm **Navi** — your Navrit buddy!`,
    ``,
    `I can read this portal and summarise:`,
    `- profit / cash / partners`,
    `- sales & purchases`,
    `- stock, dues, labour, buyers/vendors`,
    ``,
    `Quick glance right now:`,
    `- Sales total ₹${overview.sales.total.toLocaleString("en-IN")}`,
    `- Purchases total ₹${overview.purchases.total.toLocaleString("en-IN")}`,
    `- Approx company book ₹${cash.companyBookApprox.toLocaleString("en-IN")}`,
    ``,
    `Try: “PET profit this month”, “vendor dues”, “cash with partners”, “find Kabir”.`,
    naviStatus().ready ? "" : `\n_Add NAVI_API_KEY (OpenAI-compatible) for smarter full conversations + web research._`,
  ].filter(Boolean).join("\n");
}

export async function askNavi(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const { apiKey } = config();

  if (!apiKey) {
    return { reply: localBrain(lastUser), mode: "local" as const, toolsUsed: [] as string[] };
  }

  const toolsUsed: string[] = [];
  const convo: ChatMessage[] = [
    { role: "system", content: NAVI_SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // Tool loop (max 4 rounds)
  for (let i = 0; i < 4; i++) {
    const json = await chatCompletions(convo, true);
    const choice = json.choices?.[0]?.message;
    if (!choice) throw new Error("Empty model response");

    const toolCalls = choice.tool_calls || [];
    if (!toolCalls.length) {
      return {
        reply: String(choice.content || "").trim() || "I couldn't form an answer — try asking another way.",
        mode: "llm" as const,
        toolsUsed,
      };
    }

    convo.push({
      role: "assistant",
      content: choice.content || "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function?.name || "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      toolsUsed.push(name);
      const result = await runNaviTool(name, args);
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  const final = await chatCompletions(convo, false);
  const text = final.choices?.[0]?.message?.content || localBrain(lastUser);
  return { reply: String(text).trim(), mode: "llm" as const, toolsUsed };
}
