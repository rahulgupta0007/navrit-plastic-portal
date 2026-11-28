"use client";

import { useMemo, useState } from "react";
import { Download, Share2, Search, X, Recycle } from "lucide-react";
import { useLocale } from "./locale-provider";
import type { TodayRateRow } from "@/lib/rates";
import { downloadRatesPdf } from "@/lib/export-client";

type Props = {
  rows: TodayRateRow[];
  date: string;
  lastUpdated: string | null;
};

const badgeColors = [
  "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
  "bg-lime-500/15 text-lime-800 dark:text-lime-300",
  "bg-teal-500/12 text-teal-800 dark:text-teal-300",
  "bg-green-500/12 text-green-800 dark:text-green-300",
  "bg-cyan-500/12 text-cyan-800 dark:text-cyan-300",
];

export function RateTable({ rows, date, lastUpdated }: Props) {
  const { locale, dict } = useLocale();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<"high" | "low" | "name">("high");
  const [shareMsg, setShareMsg] = useState("");
  const [selected, setSelected] = useState<TodayRateRow | null>(null);

  const categories = useMemo(() => {
    const map = new Map<number, { id: number; en: string; hi: string }>();
    rows.forEach((r) => map.set(r.categoryId, { id: r.categoryId, en: r.categoryEn, hi: r.categoryHi }));
    return [...map.values()];
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (category !== "all" && String(r.categoryId) !== category) return false;
      if (!query) return true;
      return (
        r.nameEn.toLowerCase().includes(query) ||
        r.nameHi.includes(query) ||
        r.categoryEn.toLowerCase().includes(query) ||
        r.categoryHi.includes(query)
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "high") return b.rate - a.rate;
      if (sort === "low") return a.rate - b.rate;
      const an = locale === "hi" ? a.nameHi : a.nameEn;
      const bn = locale === "hi" ? b.nameHi : b.nameEn;
      return an.localeCompare(bn, locale === "hi" ? "hi" : "en");
    });
    return list;
  }, [rows, q, category, sort, locale]);

  async function onShare() {
    const text =
      `${dict.todaysRates} (${date})\n` +
      filtered
        .map((r) => `${locale === "hi" ? r.nameHi : r.nameEn}: ₹${r.rate}/kg`)
        .join("\n");
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: dict.todaysRates, text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setShareMsg(dict.copied);
        setTimeout(() => setShareMsg(""), 2000);
      }
    } catch {
      /* user cancelled */
    }
  }

  function onPdf() {
    downloadRatesPdf({
      title: dict.todaysRates,
      date,
      business: dict.brand,
      locale,
      rows: filtered,
      labels: {
        name: dict.plasticName,
        category: dict.category,
        rate: dict.rate,
      },
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--nv-border)] bg-[var(--nv-card)] px-6 py-16 text-center">
        <Recycle className="mx-auto text-[#16a34a]" size={36} />
        <p className="mt-4 font-display text-xl text-[var(--nv-text)]">{dict.noRates}</p>
        <p className="mt-2 text-sm text-[var(--nv-muted)]">
          {locale === "hi" ? "कृपया बाद में जाँचें।" : "Please check back later today."}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="glass-panel sticky top-[4.25rem] z-20 flex flex-col gap-3 rounded-3xl p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--nv-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={dict.searchPlaceholder}
            className="w-full rounded-2xl border border-[var(--nv-border)] bg-[var(--nv-card)] py-3 pl-10 pr-3 text-sm outline-none ring-[#16a34a]/30 transition focus:ring-2"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
          <Chip active={category === "all"} onClick={() => setCategory("all")}>
            {dict.allCategories}
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c.id}
              active={category === String(c.id)}
              onClick={() => setCategory(String(c.id))}
            >
              {locale === "hi" ? c.hi : c.en}
            </Chip>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-2xl border border-[var(--nv-border)] bg-[var(--nv-card)] px-3 py-3 text-sm"
        >
          <option value="high">{dict.sortHighLow}</option>
          <option value="low">{dict.sortLowHigh}</option>
          <option value="name">{dict.sortName}</option>
        </select>

        <div className="flex gap-2">
          <button type="button" onClick={onPdf} className="btn-secondary !py-2.5 !text-sm">
            <Download size={15} /> {dict.downloadPdf}
          </button>
          <button type="button" onClick={onShare} className="btn-secondary !py-2.5 !text-sm">
            <Share2 size={15} /> {dict.shareRates}
          </button>
        </div>
      </div>

      {shareMsg && <p className="text-sm font-medium text-[#16a34a]">{shareMsg}</p>}
      {lastUpdated && (
        <p className="flex items-center gap-2 text-xs text-[var(--nv-muted)]">
          <span className="live-dot inline-block size-1.5 rounded-full bg-[#84cc16]" />
          {dict.ratesUpdated} ·{" "}
          {new Date(lastUpdated).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN")}
        </p>
      )}

      {/* Mobile cards */}
      <div className="grid gap-3 sm:hidden">
        {filtered.map((r, i) => (
          <button
            type="button"
            key={r.materialId}
            onClick={() => setSelected(r)}
            className="animate-card card-premium w-full p-4 text-left"
            style={{ animationDelay: `${i * 0.03}s` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg text-[var(--nv-text)]">
                  {locale === "hi" ? r.nameHi : r.nameEn}
                </h3>
                <span
                  className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    badgeColors[r.categoryId % badgeColors.length]
                  }`}
                >
                  {locale === "hi" ? r.categoryHi : r.categoryEn}
                </span>
              </div>
              <p className="price-pill text-lg">₹{r.rate.toFixed(2)}</p>
            </div>
            <p className="mt-3 text-[11px] text-[var(--nv-muted)]">
              {new Date(r.updatedAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="rate-table-wrap hidden sm:block">
        <table className="rate-table w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr>
              <th className="px-5 py-4">{dict.plasticName}</th>
              <th className="px-5 py-4">{dict.category}</th>
              <th className="px-5 py-4">{dict.rate}</th>
              <th className="px-5 py-4">{dict.lastUpdated}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.materialId} onClick={() => setSelected(r)}>
                <td className="px-5 py-4 font-semibold text-[var(--nv-text)]">
                  <span className="inline-flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/15 to-lime-400/20 text-xs font-bold text-[#166534]">
                      {(locale === "hi" ? r.nameHi : r.nameEn).slice(0, 2).toUpperCase()}
                    </span>
                    {locale === "hi" ? r.nameHi : r.nameEn}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`category-badge ${badgeColors[r.categoryId % badgeColors.length]}`}
                  >
                    {locale === "hi" ? r.categoryHi : r.categoryEn}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="price-pill text-base">₹{r.rate.toFixed(2)}</span>
                  <span className="ml-1 text-xs text-[var(--nv-muted)]">/{r.unit || "kg"}</span>
                </td>
                <td className="px-5 py-4 text-[var(--nv-muted)]">
                  {new Date(r.updatedAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <MaterialDrawer row={selected} onClose={() => setSelected(null)} locale={locale} dict={dict} />
      )}
    </section>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "shrink-0 rounded-full bg-gradient-to-r from-[#16a34a] to-[#84cc16] px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-green-500/20"
          : "shrink-0 rounded-full border border-[var(--nv-border)] bg-[var(--nv-card)] px-3.5 py-2 text-xs font-semibold text-[var(--nv-muted)] transition hover:border-green-500/30 hover:text-[var(--nv-text)]"
      }
    >
      {children}
    </button>
  );
}

function MaterialDrawer({
  row,
  onClose,
  locale,
  dict,
}: {
  row: TodayRateRow;
  onClose: () => void;
  locale: "en" | "hi";
  dict: { category: string; lastUpdated: string; kg: string };
}) {
  return (
    <>
      <button type="button" className="drawer-backdrop" aria-label="Close" onClick={onClose} />
      <aside className="drawer-panel p-6" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="category-badge">
              {locale === "hi" ? row.categoryHi : row.categoryEn}
            </span>
            <h2 className="mt-3 font-display text-3xl text-[var(--nv-text)]">
              {locale === "hi" ? row.nameHi : row.nameEn}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--nv-border)] p-2 text-[var(--nv-muted)] hover:text-[var(--nv-text)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-8 rounded-3xl bg-gradient-to-br from-[#16a34a] to-[#84cc16] p-6 text-white shadow-lg shadow-green-500/25">
          <p className="text-sm font-medium opacity-90">
            {locale === "hi" ? "वर्तमान रेट" : "Current rate"}
          </p>
          <p className="mt-2 font-display text-5xl">₹{row.rate.toFixed(2)}</p>
          <p className="mt-1 text-sm opacity-90">/{row.unit || "kg"}</p>
        </div>

        <dl className="mt-6 space-y-4 text-sm">
          <div className="flex justify-between border-b border-[var(--nv-border)] pb-3">
            <dt className="text-[var(--nv-muted)]">{dict.category}</dt>
            <dd className="font-semibold">{locale === "hi" ? row.categoryHi : row.categoryEn}</dd>
          </div>
          <div className="flex justify-between border-b border-[var(--nv-border)] pb-3">
            <dt className="text-[var(--nv-muted)]">{dict.lastUpdated}</dt>
            <dd className="font-semibold">
              {new Date(row.updatedAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN")}
            </dd>
          </div>
        </dl>

        <p className="mt-8 text-sm leading-relaxed text-[var(--nv-muted)]">
          {locale === "hi"
            ? "यह आज का प्रकाशित खरीद रेट है। रेट बाज़ार और आपूर्ति के अनुसार बदल सकते हैं।"
            : "This is today’s published purchase rate. Prices may change with market supply."}
        </p>
      </aside>
    </>
  );
}
