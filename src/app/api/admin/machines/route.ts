import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireWriteSession } from "@/lib/auth";
import { sqlite } from "@/db";
import { nowIso, todayStr } from "@/lib/rates";
import { optionalAccountPersonSchema } from "@/lib/account-persons";
import { optionalFundingSourceSchema } from "@/lib/funding";

export const dynamic = "force-dynamic";

const modeSchema = z.enum(["PET", "PLASTIC", "SHARED"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function insertLinkedExpense(opts: {
  mode: string;
  expenseType: string;
  description: string;
  amount: number;
  expenseDate: string;
  paidBy: string;
  fundingSource: string;
}) {
  const r = sqlite
    .prepare(
      `INSERT INTO other_expenses
       (mode,purchase_id,expense_type,description,amount,expense_date,expense_frequency,paid_by,created_at,billing_month,billing_start_date,billing_end_date,funding_source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      opts.mode,
      null,
      opts.expenseType,
      opts.description,
      opts.amount,
      opts.expenseDate,
      "ONE_TIME",
      opts.paidBy,
      nowIso(),
      "",
      "",
      "",
      opts.fundingSource
    );
  return Number(r.lastInsertRowid);
}

function updateLinkedExpense(
  expenseId: number | null | undefined,
  opts: {
    mode: string;
    expenseType: string;
    description: string;
    amount: number;
    expenseDate: string;
    paidBy: string;
    fundingSource: string;
  }
) {
  if (expenseId) {
    const exists = sqlite.prepare("SELECT id FROM other_expenses WHERE id=?").get(expenseId);
    if (exists) {
      sqlite
        .prepare(
          `UPDATE other_expenses
           SET mode=?, expense_type=?, description=?, amount=?, expense_date=?, paid_by=?, funding_source=?
           WHERE id=?`
        )
        .run(
          opts.mode,
          opts.expenseType,
          opts.description,
          opts.amount,
          opts.expenseDate,
          opts.paidBy,
          opts.fundingSource,
          expenseId
        );
      return expenseId;
    }
  }
  return insertLinkedExpense(opts);
}

function deleteLinkedExpense(expenseId: number | null | undefined) {
  if (!expenseId) return;
  sqlite.prepare("DELETE FROM other_expenses WHERE id=?").run(expenseId);
}

function moneyRound(n: number) {
  return Math.round(n * 100) / 100;
}

function machineDesc(name: string, vendorName: string, kind: string) {
  const base = vendorName ? `Machine: ${name} (vendor ${vendorName})` : `Machine: ${name}`;
  return `${base} · ${kind}`;
}

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const machines = sqlite
    .prepare(
      `SELECT m.*,
        (SELECT title FROM machine_setups s WHERE s.machine_id=m.id ORDER BY s.setup_date DESC, s.id DESC LIMIT 1) as latest_setup
       FROM machines m
       ORDER BY m.purchase_date DESC, m.id DESC
       LIMIT 500`
    )
    .all();
  const setups = sqlite
    .prepare(
      `SELECT s.*, m.name as machine_name
       FROM machine_setups s
       LEFT JOIN machines m ON m.id = s.machine_id
       ORDER BY s.setup_date DESC, s.id DESC
       LIMIT 500`
    )
    .all();
  const machinePayments = sqlite
    .prepare(
      `SELECT * FROM machine_payments ORDER BY payment_date DESC, id DESC LIMIT 1000`
    )
    .all();

  const machineOrderTotal = Number(
    (sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM machines").get() as { n: number })?.n || 0
  );
  const machinePaidTotal = Number(
    (sqlite.prepare("SELECT COALESCE(SUM(paid_amount),0) as n FROM machines").get() as { n: number })?.n || 0
  );
  const machineDueTotal = Number(
    (sqlite.prepare("SELECT COALESCE(SUM(credit_amount),0) as n FROM machines").get() as { n: number })?.n || 0
  );
  const setupTotal = Number(
    (sqlite.prepare("SELECT COALESCE(SUM(amount),0) as n FROM machine_setups").get() as { n: number })?.n || 0
  );

  return json({
    machines,
    setups,
    machinePayments,
    totals: {
      machines: moneyRound(machineOrderTotal),
      machinesPaid: moneyRound(machinePaidTotal),
      machinesDue: moneyRound(machineDueTotal),
      setups: moneyRound(setupTotal),
      all: moneyRound(machinePaidTotal + setupTotal),
      machineCount: machines.length,
      setupCount: setups.length,
    },
  });
}

export async function POST(req: NextRequest) {
  const write = await requireWriteSession();
  if (write.error) return write.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);

  try {
    const action = String((body as { action?: string }).action || "");

    if (action === "addMachine") {
      const s = z
        .object({
          mode: modeSchema,
          name: z.string().trim().min(1, "Machine name is required").max(120),
          vendorName: z.string().trim().optional().default(""),
          purchaseDate: dateSchema.optional().default(todayStr()),
          amount: z.number().positive("Order amount must be greater than 0"),
          paidAmount: z.number().nonnegative("Paid now cannot be negative").optional().default(0),
          paidBy: optionalAccountPersonSchema,
          fundingSource: optionalFundingSourceSchema,
          notes: z.string().trim().optional().default(""),
        })
        .parse(body);

      const orderAmount = moneyRound(s.amount);
      let paidNow = moneyRound(s.paidAmount ?? 0);
      if (paidNow > orderAmount) paidNow = orderAmount;
      const credit = moneyRound(orderAmount - paidNow);

      if (paidNow > 0.005 && !s.paidBy) {
        return json({ error: "Please select Payment done by when paying advance / partial / full" }, 400);
      }
      if (s.fundingSource === "OWN_POCKET" && paidNow > 0.005 && !s.paidBy) {
        return json({ error: "Payment done by is required for own-pocket payments" }, 400);
      }

      const payKind =
        paidNow <= 0.005 ? "Order only" : paidNow + 0.005 >= orderAmount ? "Full payment" : "Advance / partial";

      let expenseId: number | null = null;
      if (paidNow > 0.005) {
        expenseId = insertLinkedExpense({
          mode: s.mode,
          expenseType: "Machine purchase",
          description: machineDesc(s.name, s.vendorName, payKind),
          amount: paidNow,
          expenseDate: s.purchaseDate,
          paidBy: s.paidBy ?? "",
          fundingSource: s.fundingSource,
        });
      }

      const r = sqlite
        .prepare(
          `INSERT INTO machines
           (mode, name, vendor_name, purchase_date, amount, paid_amount, credit_amount, paid_by, funding_source, notes, other_expense_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          s.mode,
          s.name,
          s.vendorName,
          s.purchaseDate,
          orderAmount,
          paidNow,
          credit,
          s.paidBy ?? "",
          s.fundingSource,
          s.notes,
          expenseId,
          nowIso(),
          nowIso()
        );
      const machineId = Number(r.lastInsertRowid);

      if (paidNow > 0.005 && expenseId) {
        sqlite
          .prepare(
            `INSERT INTO machine_payments
             (machine_id, amount, payment_date, paid_by, funding_source, notes, other_expense_id, created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          )
          .run(machineId, paidNow, s.purchaseDate, s.paidBy ?? "", s.fundingSource, payKind, expenseId, nowIso());
      }

      return json({ ok: true, id: machineId, paid: paidNow, credit, paymentKind: payKind });
    }

    if (action === "updateMachine") {
      const s = z
        .object({
          machineId: z.number().int().positive(),
          mode: modeSchema,
          name: z.string().trim().min(1).max(120),
          vendorName: z.string().trim().optional().default(""),
          purchaseDate: dateSchema,
          amount: z.number().positive(),
          notes: z.string().trim().optional().default(""),
        })
        .parse(body);
      const existing = sqlite
        .prepare("SELECT id, paid_amount, credit_amount FROM machines WHERE id=?")
        .get(s.machineId) as { id: number; paid_amount: number; credit_amount: number } | undefined;
      if (!existing) return json({ error: "Machine not found" }, 404);

      const orderAmount = moneyRound(s.amount);
      const paid = moneyRound(Number(existing.paid_amount) || 0);
      if (orderAmount + 0.005 < paid) {
        return json({ error: `Order amount cannot be less than already paid (${paid})` }, 400);
      }
      const credit = moneyRound(orderAmount - paid);

      sqlite
        .prepare(
          `UPDATE machines
           SET mode=?, name=?, vendor_name=?, purchase_date=?, amount=?, credit_amount=?, notes=?, updated_at=?
           WHERE id=?`
        )
        .run(s.mode, s.name, s.vendorName, s.purchaseDate, orderAmount, credit, s.notes, nowIso(), s.machineId);
      return json({ ok: true });
    }

    if (action === "payMachineBalance") {
      const s = z
        .object({
          machineId: z.number().int().positive(),
          amount: z.number().positive("Payment amount must be greater than 0"),
          paymentDate: dateSchema.optional().default(todayStr()),
          paidBy: optionalAccountPersonSchema,
          fundingSource: optionalFundingSourceSchema,
          notes: z.string().trim().optional().default(""),
        })
        .parse(body);

      const existing = sqlite
        .prepare("SELECT * FROM machines WHERE id=?")
        .get(s.machineId) as
        | {
            id: number;
            mode: string;
            name: string;
            vendor_name: string;
            amount: number;
            paid_amount: number;
            credit_amount: number;
          }
        | undefined;
      if (!existing) return json({ error: "Machine not found" }, 404);

      const due = moneyRound(Number(existing.credit_amount) || 0);
      if (due <= 0.005) return json({ error: "This machine order is already fully paid" }, 400);

      let pay = moneyRound(s.amount);
      if (pay > due) pay = due;
      if (!s.paidBy) {
        return json({ error: "Please select Payment done by for this payment" }, 400);
      }
      if (s.fundingSource === "OWN_POCKET" && !s.paidBy) {
        return json({ error: "Payment done by is required for own-pocket payments" }, 400);
      }

      const payKind = pay + 0.005 >= due ? "Balance settlement" : "Partial payment";
      const expenseId = insertLinkedExpense({
        mode: existing.mode,
        expenseType: "Machine purchase",
        description: machineDesc(existing.name, existing.vendor_name || "", payKind),
        amount: pay,
        expenseDate: s.paymentDate,
        paidBy: s.paidBy ?? "",
        fundingSource: s.fundingSource,
      });

      sqlite
        .prepare(
          `INSERT INTO machine_payments
           (machine_id, amount, payment_date, paid_by, funding_source, notes, other_expense_id, created_at)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        .run(
          s.machineId,
          pay,
          s.paymentDate,
          s.paidBy ?? "",
          s.fundingSource,
          s.notes || payKind,
          expenseId,
          nowIso()
        );

      const newPaid = moneyRound(Number(existing.paid_amount) + pay);
      const newCredit = moneyRound(Number(existing.amount) - newPaid);
      sqlite
        .prepare(
          `UPDATE machines
           SET paid_amount=?, credit_amount=?, paid_by=?, funding_source=?, other_expense_id=COALESCE(other_expense_id, ?), updated_at=?
           WHERE id=?`
        )
        .run(newPaid, newCredit, s.paidBy ?? "", s.fundingSource, expenseId, nowIso(), s.machineId);

      return json({ ok: true, paid: newPaid, credit: newCredit });
    }

    if (action === "deleteMachine") {
      const s = z.object({ machineId: z.number().int().positive() }).parse(body);
      const existing = sqlite
        .prepare("SELECT id, other_expense_id FROM machines WHERE id=?")
        .get(s.machineId) as { id: number; other_expense_id: number | null } | undefined;
      if (!existing) return json({ error: "Machine not found" }, 404);

      const pays = sqlite
        .prepare("SELECT other_expense_id FROM machine_payments WHERE machine_id=?")
        .all(s.machineId) as Array<{ other_expense_id: number | null }>;
      sqlite.prepare("UPDATE machine_setups SET machine_id=NULL WHERE machine_id=?").run(s.machineId);
      sqlite.prepare("DELETE FROM machine_payments WHERE machine_id=?").run(s.machineId);
      sqlite.prepare("DELETE FROM machines WHERE id=?").run(s.machineId);

      const expenseIds = new Set<number>();
      if (existing.other_expense_id) expenseIds.add(existing.other_expense_id);
      for (const p of pays) {
        if (p.other_expense_id) expenseIds.add(p.other_expense_id);
      }
      for (const id of expenseIds) deleteLinkedExpense(id);

      return json({ ok: true });
    }

    if (action === "addSetup") {
      const s = z
        .object({
          mode: modeSchema,
          machineId: z.number().int().positive().optional(),
          title: z.string().trim().min(1, "Setup title is required").max(160),
          setupDate: dateSchema.optional().default(todayStr()),
          amount: z.number().positive("Amount must be greater than 0"),
          paidBy: optionalAccountPersonSchema,
          fundingSource: optionalFundingSourceSchema,
          notes: z.string().trim().optional().default(""),
        })
        .parse(body);
      if (s.fundingSource === "OWN_POCKET" && !s.paidBy) {
        return json({ error: "Payment done by is required for own-pocket payments" }, 400);
      }
      if (s.machineId) {
        const m = sqlite.prepare("SELECT id FROM machines WHERE id=?").get(s.machineId);
        if (!m) return json({ error: "Linked machine not found" }, 400);
      }
      const desc = s.machineId
        ? `Setup: ${s.title} (machine #${s.machineId})`
        : `Setup: ${s.title}`;
      const expenseId = insertLinkedExpense({
        mode: s.mode,
        expenseType: "Machine setup",
        description: desc,
        amount: s.amount,
        expenseDate: s.setupDate,
        paidBy: s.paidBy ?? "",
        fundingSource: s.fundingSource,
      });
      const r = sqlite
        .prepare(
          `INSERT INTO machine_setups
           (mode, machine_id, title, setup_date, amount, paid_by, funding_source, notes, other_expense_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          s.mode,
          s.machineId ?? null,
          s.title,
          s.setupDate,
          s.amount,
          s.paidBy ?? "",
          s.fundingSource,
          s.notes,
          expenseId,
          nowIso(),
          nowIso()
        );
      return json({ ok: true, id: Number(r.lastInsertRowid) });
    }

    if (action === "updateSetup") {
      const s = z
        .object({
          setupId: z.number().int().positive(),
          mode: modeSchema,
          machineId: z.number().int().positive().optional().nullable(),
          title: z.string().trim().min(1).max(160),
          setupDate: dateSchema,
          amount: z.number().positive(),
          paidBy: optionalAccountPersonSchema,
          fundingSource: optionalFundingSourceSchema,
          notes: z.string().trim().optional().default(""),
        })
        .parse(body);
      const existing = sqlite
        .prepare("SELECT id, other_expense_id FROM machine_setups WHERE id=?")
        .get(s.setupId) as { id: number; other_expense_id: number | null } | undefined;
      if (!existing) return json({ error: "Setup not found" }, 404);
      if (s.fundingSource === "OWN_POCKET" && !s.paidBy) {
        return json({ error: "Payment done by is required for own-pocket payments" }, 400);
      }
      const machineId = s.machineId || null;
      if (machineId) {
        const m = sqlite.prepare("SELECT id FROM machines WHERE id=?").get(machineId);
        if (!m) return json({ error: "Linked machine not found" }, 400);
      }
      const desc = machineId ? `Setup: ${s.title} (machine #${machineId})` : `Setup: ${s.title}`;
      const expenseId = updateLinkedExpense(existing.other_expense_id, {
        mode: s.mode,
        expenseType: "Machine setup",
        description: desc,
        amount: s.amount,
        expenseDate: s.setupDate,
        paidBy: s.paidBy ?? "",
        fundingSource: s.fundingSource,
      });
      sqlite
        .prepare(
          `UPDATE machine_setups
           SET mode=?, machine_id=?, title=?, setup_date=?, amount=?, paid_by=?, funding_source=?, notes=?, other_expense_id=?, updated_at=?
           WHERE id=?`
        )
        .run(
          s.mode,
          machineId,
          s.title,
          s.setupDate,
          s.amount,
          s.paidBy ?? "",
          s.fundingSource,
          s.notes,
          expenseId,
          nowIso(),
          s.setupId
        );
      return json({ ok: true });
    }

    if (action === "deleteSetup") {
      const s = z.object({ setupId: z.number().int().positive() }).parse(body);
      const existing = sqlite
        .prepare("SELECT id, other_expense_id FROM machine_setups WHERE id=?")
        .get(s.setupId) as { id: number; other_expense_id: number | null } | undefined;
      if (!existing) return json({ error: "Setup not found" }, 404);
      sqlite.prepare("DELETE FROM machine_setups WHERE id=?").run(s.setupId);
      deleteLinkedExpense(existing.other_expense_id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: error.errors[0]?.message || "Invalid input" }, 400);
    }
    console.error("[machines]", error);
    return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
}
