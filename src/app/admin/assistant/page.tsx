"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Loader2, Send, Sparkles } from "lucide-react";
import { NaviLogo } from "@/components/navi-logo";

type Msg = { role: "user" | "assistant"; content: string; meta?: string };

const SUGGESTIONS = [
  "Company cash & partner overview",
  "PET profit sketch this month",
  "Vendor dues outstanding",
  "Top buyers and advance balances",
  "Labour cash paid recently",
  "What is PET flake market rate? (web)",
];

export default function NaviAssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm **Navi** 🌱 — your cute Navrit buddy!\n\nI can read this portal (sales, purchases, cash, labour, profit sketches, buyers/vendors) and, when the network allows, peek at the internet for market context.\n\nAsk me anything about your business data.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ready?: boolean; model?: string; note?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/admin/assistant", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/admin/login";
          return;
        }
        const j = await r.json();
        setStatus(j.assistant || null);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const history = nextMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      const r = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Navi could not reply");
      const tools = (j.toolsUsed || []).length ? `Used: ${(j.toolsUsed as string[]).join(", ")}` : j.mode === "local" ? "Local portal brain" : undefined;
      setMessages((m) => [...m, { role: "assistant", content: j.reply, meta: tools }]);
      if (j.assistant) setStatus(j.assistant);
    } catch (error) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Oops — ${error instanceof Error ? error.message : "something went wrong"}. Try again in a moment.`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <AdminShell
      title="Navi"
      subtitle="Your cute Navrit assistant — portal reports, summaries & optional web research"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="ad-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[var(--ad-border)] bg-[color-mix(in_srgb,#7C3AED_12%,transparent)] px-4 py-3">
            <NaviLogo size={48} className="shadow-sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                Navi <Sparkles size={14} className="text-[#7C3AED]" />
              </p>
              <p className="ad-muted truncate text-xs">
                {status?.ready
                  ? `Online · ${status.model}`
                  : status?.note || "Reading portal data…"}
              </p>
            </div>
          </div>

          <div className="flex max-h-[min(62vh,640px)] min-h-[360px] flex-col gap-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ml-auto bg-[var(--ad-accent)] text-white"
                    : "mr-auto border border-[var(--ad-border)] bg-[var(--ad-input)]"
                }`}
              >
                {m.content.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
                  part.startsWith("**") && part.endsWith("**") ? (
                    <strong key={j}>{part.slice(2, -2)}</strong>
                  ) : (
                    <span key={j}>{part}</span>
                  )
                )}
                {m.meta && <p className="mt-2 text-[10px] opacity-70">{m.meta}</p>}
              </div>
            ))}
            {busy && (
              <div className="mr-auto flex items-center gap-2 rounded-2xl border border-[var(--ad-border)] bg-[var(--ad-input)] px-3 py-2 text-xs ad-muted">
                <Loader2 size={14} className="animate-spin" /> Navi is reading the portal…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[var(--ad-border)] px-4 py-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="ad-btn ad-btn-ghost !px-2.5 !py-1 text-[11px]"
                  disabled={busy}
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <form onSubmit={onSubmit} className="flex gap-2">
              <input
                className="ad-input flex-1"
                placeholder="Ask Navi about profit, dues, stock, labour…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
              />
              <button className="ad-btn ad-btn-primary" type="submit" disabled={busy || !input.trim()}>
                <Send size={16} />
              </button>
            </form>
            <p className="ad-muted mt-2 text-[11px]">
              Data source: this Navrit portal (read-only). Internet research is optional and for context only.
            </p>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
