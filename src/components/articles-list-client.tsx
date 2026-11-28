"use client";

import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import type { Article } from "@/lib/articles";
import { ArrowRight, Clock, Bookmark } from "lucide-react";

export function ArticlesListClient({ articles }: { articles: Article[] }) {
  const { locale, dict } = useLocale();
  const brand = dict.brand;

  return (
    <div>
      <section className="hero-premium border-b border-[var(--nv-border)]">
        <div className="hero-mesh" />
        <div className="container-premium py-14 sm:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#16a34a]">{brand}</p>
          <h1 className="mt-3 font-display text-4xl text-[var(--nv-text)] sm:text-5xl">
            {locale === "hi" ? "लेख और अंतर्दृष्टि" : "Articles & Insights"}
          </h1>
          <p className="mt-3 max-w-xl text-base text-[var(--nv-muted)]">
            {locale === "hi"
              ? "रीसाइक्लिंग, निष्पक्ष रेट और चक्रीय अर्थव्यवस्था पर प्रकाशित लेख।"
              : "Published writing on recycling, fair rates, and the circular economy."}
          </p>
        </div>
      </section>

      <div className="container-premium py-12">
        {articles.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--nv-border)] py-16 text-center">
            <p className="text-[var(--nv-muted)]">
              {locale === "hi" ? "अभी कोई प्रकाशित लेख नहीं।" : "No published articles yet."}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {articles.map((a, i) => {
              const excerpt = locale === "hi" ? a.excerpt_hi : a.excerpt_en;
              const mins = Math.max(2, Math.ceil((excerpt?.length || 120) / 90));
              return (
                <article
                  key={a.id}
                  className="article-card animate-card"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <Link href={`/articles/${a.slug}`} className="media block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.image_url || "/articles/rates.svg"}
                      alt=""
                      loading="lazy"
                    />
                    <div className="absolute right-3 top-3 z-10 flex gap-2">
                      <span className="rounded-full bg-white/90 p-2 text-[#14532d] shadow-sm">
                        <Bookmark size={14} />
                      </span>
                    </div>
                    <span className="absolute bottom-3 left-3 z-10 rounded-full bg-gradient-to-r from-[#16a34a] to-[#84cc16] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                      Insights
                    </span>
                  </Link>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center gap-2 text-xs text-[var(--nv-muted)]">
                      <Clock size={12} />
                      {mins} {locale === "hi" ? "मिनट" : "min"}
                      <span>·</span>
                      {a.published_at
                        ? new Date(a.published_at + "T12:00:00").toLocaleDateString(
                            locale === "hi" ? "hi-IN" : "en-IN",
                            { day: "2-digit", month: "long", year: "numeric" }
                          )
                        : ""}
                    </div>
                    <h2 className="mt-2 font-display text-xl leading-snug text-[var(--nv-text)]">
                      <Link href={`/articles/${a.slug}`} className="hover:text-[#16a34a]">
                        {locale === "hi" ? a.title_hi : a.title_en}
                      </Link>
                    </h2>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-[var(--nv-muted)]">
                      {excerpt}
                    </p>
                    <Link href={`/articles/${a.slug}`} className="btn-ghost mt-4">
                      {locale === "hi" ? "पूरा पढ़ें" : "Read article"}
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
