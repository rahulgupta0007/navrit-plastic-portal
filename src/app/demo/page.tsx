"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function DemoEntryPage() {
  const router = useRouter();
  const started = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const enterDemo = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/demo", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("The demo is temporarily unavailable.");
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Unable to open demo.");
    }
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void enterDemo();
  }, [enterDemo]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#071e19] px-5 text-center text-white">
      <div className="w-full max-w-md rounded-3xl border border-[#c8f27a]/20 bg-[#12352c] p-8 shadow-2xl">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[#c8f27a] text-3xl font-black text-[#05241d]">
          N.
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Explore Navrit</h1>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {loading
            ? "Opening your view-only demo dashboard…"
            : "The demo couldn't open automatically. You can retry or use the regular login."}
        </p>
        {loading && (
          <div className="mx-auto mt-7 h-8 w-8 animate-spin rounded-full border-2 border-[#c8f27a]/20 border-t-[#c8f27a]" aria-label="Opening demo" />
        )}
        {error && (
          <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
            {error}
          </p>
        )}
        {!loading && (
          <div className="mt-6 flex flex-col gap-3">
            <button type="button" onClick={() => void enterDemo()} className="rounded-xl bg-[#c8f27a] px-4 py-3 font-semibold text-[#05241d]">
              Try opening demo again
            </button>
            <Link href="/admin/login" className="rounded-xl border border-white/20 px-4 py-3 text-sm text-white/80">
              Go to login
            </Link>
          </div>
        )}
        <p className="mt-6 text-xs text-white/50">View-only access · No changes allowed</p>
      </div>
    </main>
  );
}
