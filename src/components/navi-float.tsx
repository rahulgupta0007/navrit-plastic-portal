"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { NaviLogo } from "@/components/navi-logo";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Always-on Navi bubble in the corner of every admin page.
 */
export function NaviFloat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: "Hi! I'm Navi 🌱 — ask me about cash, profit, dues, stock, labour…",
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Hide the floating panel on the full Navi page (sidebar already goes there).
  const hideOnFullPage = pathname?.startsWith("/admin/assistant");

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, open]);

  if (hideOnFullPage) return null;

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Navi could not reply");
      setMessages((m) => [...m, { role: "assistant", content: j.reply || "…" }]);
    } catch (error) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Something went wrong",
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
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-3">
      {open && (
        <div className="pointer-events-auto flex h-[min(70vh,520px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-[var(--ad-border)] bg-[var(--ad-card)] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-[var(--ad-border)] bg-[color-mix(in_srgb,#7C3AED_14%,transparent)] px-3 py-2.5">
            <NaviLogo size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-sm font-semibold">
                Navi <Sparkles size={12} className="text-[#7C3AED]" />
              </p>
              <p className="ad-muted text-[10px]">Your Navrit buddy</p>
            </div>
            <button type="button" className="ad-btn ad-btn-ghost !px-2 !py-1" onClick={() => setOpen(false)} aria-label="Close Navi">
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 text-sm">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-[var(--ad-accent)] text-[#052e16]"
                    : "mr-auto border border-[var(--ad-border)] bg-[var(--ad-input)]"
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="ad-muted mr-auto flex items-center gap-1.5 text-xs">
                <Loader2 size={12} className="animate-spin" /> reading portal…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={onSubmit} className="flex gap-2 border-t border-[var(--ad-border)] p-2.5">
            <input
              className="ad-input flex-1 text-sm"
              placeholder="Ask Navi…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="ad-btn ad-btn-primary !px-3" disabled={busy || !input.trim()}>
              <Send size={14} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--ad-border)] bg-[var(--ad-card)] py-2 pl-2 pr-4 font-semibold shadow-lg transition hover:scale-[1.03]"
        aria-label="Open Navi assistant"
      >
        <NaviLogo size={40} />
        <span>Ask Navi</span>
      </button>
    </div>
  );
}
