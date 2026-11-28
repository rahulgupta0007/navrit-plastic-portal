"use client";

import { ArrowDown, Download, Share2, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { useLocale } from "./locale-provider";
import { RecyclingArt } from "./recycling-art";
import { downloadRatesPdf } from "@/lib/export-client";
import type { TodayRateRow } from "@/lib/rates";

type Props = {
  date: string;
  ratesAsOf?: string;
  rows: TodayRateRow[];
  stats: {
    totalCategories: number;
    lastUpdated: string | null;
    highest: number | null;
    lowest: number | null;
  };
};

export function HomeHero({ date, ratesAsOf, rows, stats }: Props) {
  const { locale, dict } = useLocale();
  const brand = dict.brand;

  // Parse as calendar date (noon local) so IST "today" doesn't shift by timezone
  const formatted = new Date(date + "T12:00:00").toLocaleDateString(
    locale === "hi" ? "hi-IN" : "en-IN",
    { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata" }
  );
  const staleRates = ratesAsOf && ratesAsOf !== date;

  function onPdf() {
    downloadRatesPdf({
      title: dict.todaysRates,
      date: ratesAsOf || date,
      business: brand,
      locale,
      rows,
      labels: {
        name: dict.plasticName,
        category: dict.category,
        rate: dict.rate,
      },
    });
  }

  async function onShare() {
    const text =
      `${dict.todaysRates} (${date})\n` +
      rows
        .slice(0, 8)
        .map((r) => `${locale === "hi" ? r.nameHi : r.nameEn}: ₹${r.rate}/kg`)
        .join("\n");
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: dict.todaysRates, text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <section className="hero-premium">
      <div className="hero-mesh" />
      <div className="container-premium grid items-center gap-12 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
        <div className="animate-rise">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#166534] shadow-sm backdrop-blur dark:bg-white/5 dark:text-emerald-300">
            <span className="live-dot size-1.5 rounded-full bg-[#16a34a]" />
            {formatted}
          </div>
          {staleRates ? (
            <p className="mt-2 text-xs text-[var(--nv-muted)]">
              {locale === "hi"
                ? `दरें अंतिम अपडेट: ${ratesAsOf}`
                : `Rates as of ${ratesAsOf} (today’s board not published yet)`}
            </p>
          ) : null}

          <h1 className="mt-6 max-w-xl font-display text-4xl leading-[1.05] text-[var(--nv-text)] sm:text-5xl lg:text-6xl">
            {locale === "hi" ? (
              dict.todaysRates
            ) : (
              <>
                Today&apos;s Plastic{" "}
                <span className="bg-gradient-to-r from-[#16a34a] via-[#10b981] to-[#84cc16] bg-clip-text text-transparent">
                  Purchase Rates
                </span>
              </>
            )}
          </h1>

          <p className="mt-5 max-w-lg text-base leading-relaxed text-[var(--nv-muted)] sm:text-lg">
            {locale === "hi"
              ? "प्लास्टिक रीसाइक्लिंग व्यवसायों के लिए पारदर्शी दैनिक मूल्य।"
              : "Transparent daily pricing for plastic recycling businesses."}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#rates" className="btn-primary">
              <ArrowDown size={16} />
              {locale === "hi" ? "रेट देखें" : "View Rates"}
            </a>
            <button type="button" onClick={onPdf} className="btn-secondary">
              <Download size={16} />
              {dict.downloadPdf}
            </button>
            <button type="button" onClick={onShare} className="btn-secondary">
              <Share2 size={16} />
              {dict.shareRates}
            </button>
          </div>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            <MiniStat
              icon={<TrendingUp size={14} />}
              label={dict.highestRate}
              value={stats.highest != null ? `₹${stats.highest.toFixed(0)}` : "—"}
              className="float-card"
            />
            <MiniStat
              icon={<TrendingDown size={14} />}
              label={dict.lowestRate}
              value={stats.lowest != null ? `₹${stats.lowest.toFixed(0)}` : "—"}
              className="float-card-delay"
            />
            <MiniStat
              icon={<Clock size={14} />}
              label={dict.lastUpdatedTime}
              value={
                stats.lastUpdated
                  ? new Date(stats.lastUpdated).toLocaleTimeString(
                      locale === "hi" ? "hi-IN" : "en-IN",
                      { hour: "2-digit", minute: "2-digit" }
                    )
                  : "—"
              }
              className="float-card-late"
            />
          </div>
        </div>

        <div className="relative animate-rise-delay hidden sm:block">
          <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-green-400/20 via-emerald-300/10 to-lime-300/20 blur-2xl" />
          <div className="relative overflow-hidden rounded-[1.75rem] border border-[var(--nv-border)] bg-[var(--nv-card)] p-6 shadow-[var(--nv-shadow-lg)]">
            <RecyclingArt />
            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--nv-muted)]">
                  {brand}
                </p>
                <p className="mt-1 font-display text-lg text-[var(--nv-text)]">
                  {locale === "hi" ? "कचरे से मूल्य" : "Waste → Value"}
                </p>
              </div>
              <div className="rounded-2xl bg-gradient-to-br from-[#16a34a] to-[#84cc16] px-3 py-2 text-center text-white">
                <p className="text-[10px] font-medium uppercase opacity-90">
                  {dict.totalCategories}
                </p>
                <p className="font-display text-xl">{stats.totalCategories}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--nv-border)] bg-white/80 p-3 shadow-sm backdrop-blur dark:bg-white/5 ${className || ""}`}
    >
      <div className="flex items-center gap-1.5 text-[#16a34a]">{icon}</div>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--nv-muted)]">
        {label}
      </p>
      <p className="mt-0.5 font-display text-lg text-[var(--nv-text)] sm:text-xl">{value}</p>
    </div>
  );
}
