"use client";

import { Fragment, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Empty, ErrorBox, Loading, Section, Stat, inr, kgText, useBizData } from "@/components/business/common";

type Lot = { id: number; lot_date: string; kg_in: number; kg_left: number; cost_per_kg: number };
type Mat = { id: number; name: string; grp: string; kg: number; value: number; avgCost: number; lots: Lot[] };
type StockRes = { materials: Mat[]; totalKg: number; totalValue: number };

const FILTERS = [
  { id: "ALL", label: "All" },
  { id: "PET", label: "PET" },
  { id: "PLASTIC", label: "Plastic" },
  { id: "OTHER", label: "Other" },
];

export default function StockPage() {
  const { data, error } = useBizData<StockRes>("/api/admin/business/stock");
  const [filter, setFilter] = useState("ALL");
  const [open, setOpen] = useState<number | null>(null);

  const rows = (data?.materials || []).filter((m) => filter === "ALL" || m.grp === filter);
  const kg = rows.reduce((a, m) => a + m.kg, 0);
  const value = rows.reduce((a, m) => a + m.value, 0);

  return (
    <AdminShell title="Stock" subtitle="What is in the yard now, valued at the real landed cost (purchase price plus its share of transport and loading).">
      {error ? <ErrorBox message={error} /> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} className={"ad-btn " + (filter === f.id ? "ad-btn-primary" : "ad-btn-ghost")} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:max-w-lg">
            <Stat label="Weight in stock" value={kgText(kg)} />
            <Stat label="Stock value" value={inr(value)} />
          </div>
          <Section title="Materials" subtitle="Tap a row to see the purchase lots. Sales use the oldest lot first.">
            {rows.length === 0 ? (
              <Empty>No stock yet. Record a purchase to add material.</Empty>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table compact">
                  <thead>
                    <tr><th>Material</th><th>Group</th><th className="text-right">Weight</th><th className="text-right">Avg cost/kg</th><th className="text-right">Value</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <Fragment key={m.id}>
                        <tr className="cursor-pointer" onClick={() => setOpen(open === m.id ? null : m.id)}>
                          <td className="font-medium">{m.name}</td>
                          <td>{m.grp === "PLASTIC" ? "Plastic" : m.grp === "PET" ? "PET" : "Other"}</td>
                          <td className={"text-right tabular-nums " + (m.kg <= 0 ? "text-[var(--ad-muted)]" : "")}>{kgText(m.kg)}</td>
                          <td className="text-right tabular-nums">{inr(m.avgCost, 2)}</td>
                          <td className="text-right tabular-nums">{inr(m.value)}</td>
                        </tr>
                        {open === m.id ? (
                          <tr>
                            <td colSpan={5} className="bg-[var(--ad-input)]">
                              {m.lots.length === 0 ? (
                                <p className="text-xs text-[var(--ad-muted)]">Nothing left in stock.</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <tbody>
                                    {m.lots.map((l) => (
                                      <tr key={l.id}>
                                        <td className="py-1">Bought {l.lot_date}</td>
                                        <td className="py-1 text-right tabular-nums">{kgText(l.kg_left)} left of {kgText(l.kg_in)}</td>
                                        <td className="py-1 text-right tabular-nums">{inr(l.cost_per_kg, 2)}/kg</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      ) : null}
    </AdminShell>
  );
}
