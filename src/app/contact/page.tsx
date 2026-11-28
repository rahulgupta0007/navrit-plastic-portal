"use client";

import { useState } from "react";
import {
  Mail,
  MapPin,
  Phone,
  Clock,
  MessageCircle,
  Navigation,
  ChevronDown,
  User,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";

export default function ContactPage() {
  const { locale, dict } = useLocale();
  const owner = process.env.NEXT_PUBLIC_OWNER_NAME || "";
  const phone = process.env.NEXT_PUBLIC_PHONE || "";
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP || "";
  const email = process.env.NEXT_PUBLIC_EMAIL || "";
  const address = process.env.NEXT_PUBLIC_ADDRESS || "";
  const hours = process.env.NEXT_PUBLIC_BUSINESS_HOURS || "";
  const mapUrl = process.env.NEXT_PUBLIC_MAPS_EMBED_URL || "";
  const brand = dict.brand;
  const mapsLink = process.env.NEXT_PUBLIC_MAPS_LINK || "";

  const faqs = [
    {
      q: locale === "hi" ? "रेट कितनी बार अपडेट होते हैं?" : "How often are rates updated?",
      a:
        locale === "hi"
          ? "खरीद रेट प्रतिदिन प्रकाशित होते हैं और बाज़ार के अनुसार बदल सकते हैं।"
          : "Purchase rates are published daily and may change with market conditions.",
    },
    {
      q: locale === "hi" ? "कौन सी सामग्री स्वीकार की जाती है?" : "What materials do you accept?",
      a:
        locale === "hi"
          ? "PET, PP, HDPE और अन्य सूचीबद्ध प्लास्टिक श्रेणियाँ — रेट बोर्ड देखें।"
          : "PET, PP, HDPE and other listed plastic categories — see today’s rate board.",
    },
    {
      q: locale === "hi" ? "क्या व्हाट्सऐप पर रेट मिल सकते हैं?" : "Can I get rates on WhatsApp?",
      a:
        locale === "hi"
          ? "हाँ, नीचे दिए नंबर पर संदेश भेजें — हम जल्दी जवाब देते हैं।"
          : "Yes — message the WhatsApp number below and we’ll respond quickly.",
    },
  ];

  return (
    <div>
      <section className="hero-premium border-b border-[var(--nv-border)]">
        <div className="hero-mesh" />
        <div className="container-premium py-14 sm:py-16">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#16a34a]">{brand}</p>
          <h1 className="mt-3 font-display text-4xl text-[var(--nv-text)] sm:text-5xl">
            {dict.contactTitle}
          </h1>
          <p className="mt-3 max-w-lg text-[var(--nv-muted)]">{dict.tagline}</p>
        </div>
      </section>

      <div className="container-premium py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="contact-glass animate-rise p-6 sm:p-8">
            <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#16a34a]/10 to-[#84cc16]/15 p-4">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#16a34a] to-[#84cc16] text-white">
                <User size={22} />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--nv-muted)]">
                  {dict.owner}
                </p>
                <p className="font-display text-2xl text-[var(--nv-text)]">{owner}</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <ContactRow
                icon={Phone}
                label={dict.phone}
                value={phone}
                href={phone ? `tel:${phone.replace(/\s/g, "")}` : undefined}
              />
              <ContactRow
                icon={MessageCircle}
                label={dict.whatsapp}
                value={phone || whatsapp}
                href={whatsapp ? `https://wa.me/${whatsapp}` : undefined}
              />
              <ContactRow
                icon={Mail}
                label={dict.email}
                value={email}
                href={email ? `mailto:${email}` : undefined}
              />
              <ContactRow icon={Clock} label={dict.businessHours} value={hours} />
              <ContactRow icon={MapPin} label={dict.location} value={address} />
            </div>

            {(mapsLink || mapUrl) && (
              <a
                href={mapsLink || "https://maps.google.com"}
                target="_blank"
                rel="noreferrer"
                className="btn-primary mt-6 w-full"
              >
                <Navigation size={16} />
                {locale === "hi" ? "दिशा निर्देश" : "Get Directions"}
              </a>
            )}
          </div>

          <div className="animate-rise-delay overflow-hidden rounded-[1.75rem] border border-[var(--nv-border)] bg-[var(--nv-card)] shadow-[var(--nv-shadow-lg)]">
            {mapUrl ? (
              <iframe
                title="map"
                src={mapUrl}
                className="h-full min-h-[480px] w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div className="flex min-h-[480px] flex-col items-center justify-center gap-3 p-8 text-center">
                <MapPin className="text-[#16a34a]" size={36} />
                <p className="font-display text-xl">{address || "Delhi, India"}</p>
                <p className="text-sm text-[var(--nv-muted)]">
                  {locale === "hi" ? "मानचित्र जल्द उपलब्ध होगा" : "Map embed coming soon"}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl text-[var(--nv-text)] sm:text-3xl">
              {locale === "hi" ? "अक्सर पूछे जाने वाले प्रश्न" : "Frequently asked questions"}
            </h2>
            <div className="mt-6 space-y-3">
              {faqs.map((f) => (
                <FaqItem key={f.q} q={f.q} a={f.a} />
              ))}
            </div>
          </div>

          <div className="card-premium p-6 sm:p-8">
            <h2 className="font-display text-2xl text-[var(--nv-text)]">
              {locale === "hi" ? "संदेश भेजें" : "Send a message"}
            </h2>
            <p className="mt-2 text-sm text-[var(--nv-muted)]">
              {locale === "hi"
                ? "हम जल्द संपर्क करेंगे — या सीधे व्हाट्सऐप करें।"
                : "We’ll get back soon — or reach us directly on WhatsApp."}
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (whatsapp) {
                  window.open(`https://wa.me/${whatsapp}`, "_blank");
                }
              }}
            >
              <label className="block text-sm font-medium text-[var(--nv-text)]">
                {locale === "hi" ? "नाम" : "Name"}
                <input
                  required
                  className="mt-1.5 w-full rounded-2xl border border-[var(--nv-border)] bg-[var(--nv-bg)] px-4 py-3 outline-none ring-[#16a34a]/25 focus:ring-2"
                />
              </label>
              <label className="block text-sm font-medium text-[var(--nv-text)]">
                {dict.phone}
                <input
                  className="mt-1.5 w-full rounded-2xl border border-[var(--nv-border)] bg-[var(--nv-bg)] px-4 py-3 outline-none ring-[#16a34a]/25 focus:ring-2"
                />
              </label>
              <label className="block text-sm font-medium text-[var(--nv-text)]">
                {locale === "hi" ? "संदेश" : "Message"}
                <textarea
                  rows={4}
                  className="mt-1.5 w-full rounded-2xl border border-[var(--nv-border)] bg-[var(--nv-bg)] px-4 py-3 outline-none ring-[#16a34a]/25 focus:ring-2"
                />
              </label>
              <button type="submit" className="btn-primary">
                <MessageCircle size={16} />
                {locale === "hi" ? "व्हाट्सऐप पर भेजें" : "Continue on WhatsApp"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500/15 to-lime-400/20 text-[#16a34a]">
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--nv-muted)]">
          {label}
        </span>
        <span className="mt-0.5 block truncate font-medium text-[var(--nv-text)]">{value}</span>
      </span>
    </>
  );

  if (href) {
    return (
      <a href={href} className="contact-row" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        {inner}
      </a>
    );
  }
  return <div className="contact-row">{inner}</div>;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item" data-open={open}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-semibold text-[var(--nv-text)]">{q}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[var(--nv-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className="faq-body">
        <div>
          <p className="px-4 pb-4 text-sm leading-relaxed text-[var(--nv-muted)]">{a}</p>
        </div>
      </div>
    </div>
  );
}
