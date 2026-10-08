"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import clsx from "clsx";

export default function AdminLoginPage() {
  const { dict, locale, setLocale } = useLocale();
  const router = useRouter();
  const brand = process.env.NEXT_PUBLIC_BUSINESS_NAME || dict.brand;
  const tagline = process.env.NEXT_PUBLIC_BUSINESS_TAGLINE || dict.tagline;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError(dict.loginError);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-[#042821] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-[#c8f27a]/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 right-0 h-80 w-80 rounded-full bg-[#0b5c4d]/50 blur-3xl" />

        <div className="relative">
          <p className="brand-mark text-[#c8f27a]">
            <span className="brand-mark-dot" />
            <span className="font-display text-2xl tracking-tight text-white">{brand}</span>
          </p>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-5xl leading-[1.05] text-white xl:text-6xl">
            {tagline}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-white/55">{dict.loginSubtitle}</p>
        </div>

        <p className="relative text-xs text-white/30">© {new Date().getFullYear()} {brand}</p>
      </aside>

      {/* Form panel */}
      <div className="relative flex flex-col bg-[#f3f8f6]">
        <div className="flex items-center justify-between px-5 py-4 sm:px-10">
          <div className="ml-auto flex overflow-hidden rounded-full border border-[#042821]/12 bg-white text-xs font-bold">
            <button
              type="button"
              onClick={() => setLocale("en")}
              className={clsx("px-2.5 py-1.5", locale === "en" && "bg-[#042821] text-[#c8f27a]")}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLocale("hi")}
              className={clsx("px-2.5 py-1.5", locale === "hi" && "bg-[#042821] text-[#c8f27a]")}
            >
              हिं
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
          <form onSubmit={onSubmit} className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <p className="brand-mark">
                <span className="brand-mark-dot" />
                <span className="font-display text-2xl text-[#042821]">{brand}</span>
              </p>
              <p className="mt-2 text-sm text-[#042821]/55">{tagline}</p>
            </div>

            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#042821]/10 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#0b5c4d]">
              <Lock size={12} />
              {dict.secureArea}
            </div>
            <h2 className="font-display text-3xl text-[#042821] sm:text-4xl">{dict.login}</h2>
            <p className="mt-2 text-sm text-[#1a2e2a]">{dict.loginSubtitle}</p>

            <label className="mt-8 block text-sm font-medium text-[#042821]">
              {dict.username}
              <input
                className="mt-2 w-full rounded-2xl border border-[#042821]/12 bg-white px-4 py-3.5 text-[#042821] outline-none ring-[#0b5c4d]/25 transition focus:ring-2"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="admin"
                required
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-[#042821]">
              {dict.password}
              <div className="relative mt-2">
                <input
                  type={showPass ? "text" : "password"}
                  className="w-full rounded-2xl border border-[#042821]/12 bg-white px-4 py-3.5 pr-12 text-[#042821] outline-none ring-[#0b5c4d]/25 transition focus:ring-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  aria-label="Toggle password"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#042821]/60 hover:text-[#042821]"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-8 w-full rounded-2xl bg-[#042821] py-3.5 text-sm font-semibold text-[#c8f27a] transition hover:bg-[#0b5c4d] disabled:opacity-60"
            >
              {loading ? "…" : dict.signIn}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
