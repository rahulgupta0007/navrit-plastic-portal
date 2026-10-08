/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { useBusinessMode, type BusinessMode } from "@/components/business-mode-provider";
import VendorManagement from "../inventory/vendor-management";

export default function VendorsPage() {
  const { mode } = useBusinessMode();
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const r = await fetch("/api/admin/inventory");
    if (r.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    setData(await r.json());
  }

  useEffect(() => { load(); }, []);

  async function post(action: string, body: any) {
    const r = await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMessage(j.error || "Operation failed");
      return false;
    }
    setMessage("Saved successfully");
    await load();
    return true;
  }

  if (!data) {
    return <AdminShell title="Vendors & Management"><div className="ad-card p-6">Loading…</div></AdminShell>;
  }

  return (
    <AdminShell
      title={mode === "PET" ? "PET Vendors & Management" : "Plastic Vendors & Management"}
      subtitle="Manage vendors, material supplied, payments, advances and outstanding balances"
    >
      {message && <div className="mb-4 text-xs text-[var(--ad-accent)]">{message}</div>}
      <VendorManagement data={data} mode={mode as BusinessMode} post={post} />
    </AdminShell>
  );
}
