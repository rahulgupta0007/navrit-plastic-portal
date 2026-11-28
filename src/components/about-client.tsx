"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import type { SiteContent } from "@/lib/content";
import { Leaf, Target, Eye, Sparkles, MapPin } from "lucide-react";

export function AboutClient({
  content,
  address,
}: {
  content: SiteContent;
  address: string;
}) {
  const { locale, dict } = useLocale();
  const brand = dict.brand;
  const tagline = process.env.NEXT_PUBLIC_BUSINESS_TAGLINE || dict.tagline;
  const lang = locale === "hi" ? "hi" : "en";

  const rows = [
    { icon: Target, title: dict.mission, body: content.mission[lang], color: "from-green-500/15 to-emerald-400/10" },
    { icon: Eye, title: dict.vision, body: content.vision[lang], color: "from-lime-500/15 to-green-400/10" },
    { icon: Sparkles, title: dict.whyUs, body: content.why_us[lang], color: "from-teal-500/15 to-lime-400/10" },
  ];

  const timeline = [
    { y: "01", t: locale === "hi" ? "संग्रह नेटवर्क" : "Collection network", d: locale === "hi" ? "स्थानीय वेंडर साझेदारी" : "Local vendor partnerships" },
    { y: "02", t: locale === "hi" ? "ग्रेडिंग" : "Grading", d: locale === "hi" ? "सामग्री गुणवत्ता जाँच" : "Material quality checks" },
    { y: "03", t: locale === "hi" ? "पारदर्शी रेट" : "Transparent rates", d: locale === "hi" ? "दैनिक प्रकाशित मूल्य" : "Daily published pricing" },
    { y: "04", t: locale === "hi" ? "चक्रीय मूल्य" : "Circular value", d: locale === "hi" ? "कचरे से संसाधन" : "Waste becomes resource" },
  ];

  return (
    <div>
      <section className="hero-premium border-b border-[var(--nv-border)]">
        <div className="hero-mesh" />
        <div className="container-premium py-16 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#166534] backdrop-blur dark:bg-white/5 dark:text-emerald-300">
            <Leaf size={14} />
            {brand}
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-4xl text-[var(--nv-text)] sm:text-6xl">
            {dict.aboutTitle}
          </h1>
          <p className="mt-4 max-w-xl font-display text-xl text-[#16a34a] sm:text-2xl">{tagline}</p>
          <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
            <Counter label={locale === "hi" ? "दैनिक रेट" : "Daily rates"} value={365} suffix="+" />
            <Counter label={locale === "hi" ? "सामग्री" : "Materials"} value={20} suffix="+" />
            <Counter label={locale === "hi" ? "भाषाएँ" : "Languages"} value={2} />
          </div>
        </div>
      </section>

      <section className="container-premium py-14 sm:py-16">
        <div className="grid gap-5 lg:grid-cols-3">
          {rows.map((row, i) => (
            <article
              key={row.title}
              className={`card-premium animate-card overflow-hidden p-6 bg-gradient-to-br ${row.color}`}
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              <span className="stat-icon">
                <row.icon size={18} />
              </span>
              <h2 className="mt-5 font-display text-2xl text-[var(--nv-text)]">{row.title}</h2>
              <div className="mt-2 h-1 w-12 rounded-full bg-gradient-to-r from-[#16a34a] to-[#84cc16]" />
              <p className="mt-4 text-sm leading-7 text-[var(--nv-muted)] sm:text-base sm:leading-8">
                {row.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--nv-border)] bg-white/40 py-14 dark:bg-white/[0.02] sm:py-16">
        <div className="container-premium">
          <h2 className="font-display text-3xl text-[var(--nv-text)]">
            {locale === "hi" ? "हमारी यात्रा" : "Our journey"}
          </h2>
          <p className="mt-2 max-w-xl text-[var(--nv-muted)]">
            {locale === "hi"
              ? "संग्रह से लेकर पारदर्शी मूल्य तक — चक्रीय अर्थव्यवस्था का मार्ग।"
              : "From collection to transparent pricing — a path toward circular economy."}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {timeline.map((t, i) => (
              <div key={t.y} className="card-premium relative p-5" style={{ animationDelay: `${i * 0.06}s` }}>
                <p className="font-display text-4xl text-green-500/25">{t.y}</p>
                <h3 className="mt-2 font-display text-lg text-[var(--nv-text)]">{t.t}</h3>
                <p className="mt-1 text-sm text-[var(--nv-muted)]">{t.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {address && (
        <section className="container-premium py-14">
          <div className="card-premium flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex items-start gap-3">
              <span className="stat-icon">
                <MapPin size={18} />
              </span>
              <div>
                <h2 className="font-display text-xl text-[var(--nv-text)]">{dict.location}</h2>
                <p className="mt-1 text-[var(--nv-muted)]">{address}</p>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const dur = 1200;
          const tick = (t: number) => {
            const p = Math.min(1, (t - start) / dur);
            setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="rounded-2xl border border-[var(--nv-border)] bg-white/80 p-4 backdrop-blur dark:bg-white/5">
      <p className="font-display text-2xl text-[var(--nv-text)] sm:text-3xl">
        {n}
        {suffix}
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--nv-muted)]">
        {label}
      </p>
    </div>
  );
}
