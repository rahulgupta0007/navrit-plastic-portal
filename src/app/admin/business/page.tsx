"use client";

import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { ErrorBox, Loading, ProfitText, Section, Stat, Empty, inr, kgText, useBizData, useCanWrite } from "@/components/business/common";
import { ArrowRight, Receipt, ShoppingCart } from "lucide-react";

type Sale = { id: number; sale_date: string; party_name: string; total_kg: number; gross: number; profit: number; margin: number };
type Summary = {
  date: string;
  capital: { equity: number; loans: number; drawings: number; net: number };
  cash: number;
  stock: { totalKg: number; totalValue: number };
  receivables: number;
  payables: number;
  profit: { today: { profit: number; gross: number }; month: { profit: number; gross: number }; allTime: { profit: number } };
  check: { balanced: boolean; difference: number };
  recentSales: Sale[];
  counts: { purchases: number; sales: number };
};

export default function BusinessHomePage() {
  const { data, error } = useBizData<Summary>("/api/admin/business/summary");
  const canWrite = useCanWrite();

  return (
    <AdminShell
      title="NAVRIT 2.0"
      subtitle="One business, one cash book. Real profit on every sale."
      actions={
        canWrite ? (
          <>
            <Link href="/admin/business/buy" className="ad-btn ad-btn-ghost">
              <ShoppingCart size={14} /> New purchase
            </Link>
            <Link href="/admin/business/sell" className="ad-btn ad-btn-primary">
              <Receipt size={14} /> New sale
            </Link>
          </>
        ) : null
      }
    >
      {error ? <ErrorBox message={error} /> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <div className="space-y-5">
          {data.counts.purchases === 0 && data.counts.sales === 0 && data.capital.equity === 0 ? (
            <Section title="Start your new book" subtitle="NAVRIT 2.0 starts at zero. Your old PET and Plastic books stay separate under Previous Books.">
              <ol className="space-y-2 text-sm">
                <li>
                  <Link href="/admin/business/investment" className="text-[var(--ad-accent)] underline">1. Add the new investment</Link> (capital that came into the business).
                </li>
                <li>
                  <Link href="/admin/business/buy" className="text-[var(--ad-accent)] underline">2. Record a purchase</Link> with all materials from one trip in a single entry.
                </li>
                <li>
                  <Link href="/admin/business/sell" className="text-[var(--ad-accent)] underline">3. Record a sale</Link> and see the real profit before you save.
                </li>
              </ol>
            </Section>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Profit today" value={<ProfitText value={data.profit.today.profit} className="text-xl sm:text-2xl" />} hint={`Sales ${inr(data.profit.today.gross)}`} />
            <Stat label="Profit this month" value={<ProfitText value={data.profit.month.profit} className="text-xl sm:text-2xl" />} hint={`Sales ${inr(data.profit.month.gross)}`} />
            <Stat label="Cash in hand" value={inr(data.cash)} tone={data.cash < 0 ? "bad" : "neutral"} hint="From the single cash book" />
            <Stat label="Stock value" value={inr(data.stock.totalValue)} hint={kgText(data.stock.totalKg) + " at landed cost"} />
            <Stat label="Capital invested" value={inr(data.capital.net)} hint={data.capital.loans > 0 ? `plus ${inr(data.capital.loans)} loans` : "Owner money in, net of drawings"} />
            <Stat label="Customers owe you" value={inr(data.receivables)} />
            <Stat label="You owe suppliers" value={inr(data.payables)} />
            <Stat label="Real profit so far" value={<ProfitText value={data.profit.allTime.profit} className="text-xl sm:text-2xl" />} hint="After costs and expenses" />
          </div>

          <Section
            title="Latest sales"
            subtitle="Profit uses the real landed cost of the stock that was sold (oldest stock first)."
            actions={
              <Link href="/admin/business/sell" className="inline-flex items-center gap-1 text-xs text-[var(--ad-accent)]">
                All sales <ArrowRight size={12} />
              </Link>
            }
          >
            {data.recentSales.length === 0 ? (
              <Empty>No sales yet. Your first sale will show up here with its profit.</Empty>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table compact">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Customer</th>
                      <th className="text-right">Weight</th>
                      <th className="text-right">Sale</th>
                      <th className="text-right">Profit</th>
                      <th className="text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSales.map((s) => (
                      <tr key={s.id}>
                        <td>{s.sale_date}</td>
                        <td>{s.party_name}</td>
                        <td className="text-right tabular-nums">{kgText(s.total_kg)}</td>
                        <td className="text-right tabular-nums">{inr(s.gross)}</td>
                        <td className="text-right"><ProfitText value={s.profit} /></td>
                        <td className="text-right tabular-nums">{s.margin}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {!data.check.balanced ? (
            <ErrorBox message={`Books are out of balance by ${inr(data.check.difference, 2)}. Open Accounts for details.`} />
          ) : null}

          <p className="text-xs text-[var(--ad-muted)]">
            NAVRIT 2.0 keeps its own separate database. Your old PET and Plastic records are not mixed in; open them any time from{" "}
            <Link href="/admin" className="text-[var(--ad-accent)] underline">Previous Books</Link>.
          </p>
        </div>
      ) : null}
    </AdminShell>
  );
}
