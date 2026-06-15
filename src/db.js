/* GOexpense data layer.
   Works in two modes, chosen automatically:
   - If a backend is configured (env keys present), data is saved to your
     private cloud account.
   - Otherwise it falls back to the browser's localStorage, so the app runs
     completely locally with zero setup and no login. */
import { supabase, supabaseConfigured } from "./supabase";

const num = (v) => (v == null ? 0 : Number(v));
const uid = () => crypto.randomUUID();

/* ════════════════════════════════════════════════════════════════
   LOCAL MODE — browser localStorage (the default for everyone)
   ════════════════════════════════════════════════════════════════ */
const LKEY = (k) => `goexpense:${k}`;
const lget = (k, fallback) => { try { const r = localStorage.getItem(LKEY(k)); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
const lset = (k, v) => { try { localStorage.setItem(LKEY(k), JSON.stringify(v)); } catch (e) { console.error("save failed", k, e); } };

async function localFetchAll() {
  return {
    expenses: lget("expenses", []),
    payments: lget("payments", []),
    debts: lget("debts", []),
    recurring: lget("recurring", []),
    budgets: lget("budgets", null),
  };
}

const localDb = {
  addExpense: async (e) => { const item = { id: uid(), amount: e.amount, category: e.category, note: e.note || "", date: e.date, recurringId: e.recurringId || undefined }; lset("expenses", [item, ...lget("expenses", [])]); return item; },
  addExpensesBatch: async (arr) => { const items = arr.map((e) => ({ id: uid(), amount: e.amount, category: e.category, note: e.note || "", date: e.date, recurringId: e.recurringId || undefined })); lset("expenses", [...items, ...lget("expenses", [])]); return items; },
  delExpense: async (id) => lset("expenses", lget("expenses", []).filter((e) => e.id !== id)),

  addPayment: async (p) => { const item = { id: uid(), name: p.name, amount: p.amount, dueDate: p.dueDate, recurring: p.recurring, status: p.status }; lset("payments", [...lget("payments", []), item]); return item; },
  updatePayment: async (id, patch) => lset("payments", lget("payments", []).map((p) => p.id === id ? { ...p, ...patch } : p)),
  delPayment: async (id) => lset("payments", lget("payments", []).filter((p) => p.id !== id)),

  addDebt: async (d) => { const item = { id: uid(), person: d.person, amount: d.amount, note: d.note || "", direction: d.direction }; lset("debts", [...lget("debts", []), item]); return item; },
  delDebt: async (id) => lset("debts", lget("debts", []).filter((d) => d.id !== id)),

  addRecurring: async (r) => { const item = { id: uid(), amount: r.amount, category: r.category, note: r.note || "", cadence: r.cadence, lastDate: r.lastDate }; lset("recurring", [...lget("recurring", []), item]); return item; },
  delRecurring: async (id) => lset("recurring", lget("recurring", []).filter((r) => r.id !== id)),
  updateRecurringLastDate: async (id, lastDate) => lset("recurring", lget("recurring", []).map((r) => r.id === id ? { ...r, lastDate } : r)),

  upsertBudget: async (b) => lset("budgets", { weekly: b.weekly, categories: b.categories }),

  seedSample: async (s) => {
    lset("expenses", s.expenses.map((e) => ({ id: uid(), amount: e.amount, category: e.category, note: e.note || "", date: e.date, recurringId: e.recurringId || undefined })));
    lset("payments", s.payments.map((p) => ({ id: uid(), name: p.name, amount: p.amount, dueDate: p.dueDate, recurring: p.recurring, status: p.status })));
    lset("debts", s.debts.map((d) => ({ id: uid(), person: d.person, amount: d.amount, note: d.note || "", direction: d.direction })));
    lset("recurring", s.recurring.map((r) => ({ id: uid(), amount: r.amount, category: r.category, note: r.note || "", cadence: r.cadence, lastDate: r.lastDate })));
  },
  clearAll: async () => { lset("expenses", []); lset("payments", []); lset("debts", []); lset("recurring", []); },
};

/* ════════════════════════════════════════════════════════════════
   CLOUD MODE — only active when a backend is configured
   ════════════════════════════════════════════════════════════════ */
const mapExpense = (r) => ({ id: r.id, amount: num(r.amount), category: r.category, note: r.note || "", date: r.spent_on, recurringId: r.recurring_id || undefined });
const mapPayment = (r) => ({ id: r.id, name: r.name, amount: num(r.amount), dueDate: r.due_date, recurring: r.recurring, status: r.status });
const mapDebt = (r) => ({ id: r.id, person: r.person, amount: num(r.amount), note: r.note || "", direction: r.direction });
const mapRecurring = (r) => ({ id: r.id, amount: num(r.amount), category: r.category, note: r.note || "", cadence: r.cadence, lastDate: r.last_date });

const expenseRow = (e) => ({ amount: e.amount, category: e.category, note: e.note || "", spent_on: e.date, recurring_id: e.recurringId || null });
const paymentRow = (p) => ({ name: p.name, amount: p.amount, due_date: p.dueDate, recurring: p.recurring, status: p.status });
const debtRow = (d) => ({ person: d.person, amount: d.amount, note: d.note || "", direction: d.direction });
const recurringRow = (r) => ({ amount: r.amount, category: r.category, note: r.note || "", cadence: r.cadence, last_date: r.lastDate });
const NIL = "00000000-0000-0000-0000-000000000000";

async function cloudFetchAll() {
  const [exp, pay, debt, rec, bud] = await Promise.all([
    supabase.from("expenses").select("*").order("spent_on", { ascending: false }),
    supabase.from("payments").select("*"),
    supabase.from("debts").select("*"),
    supabase.from("recurring_expenses").select("*"),
    supabase.from("budgets").select("*").maybeSingle(),
  ]);
  const err = exp.error || pay.error || debt.error || rec.error || bud.error;
  if (err) throw err;
  return {
    expenses: (exp.data || []).map(mapExpense),
    payments: (pay.data || []).map(mapPayment),
    debts: (debt.data || []).map(mapDebt),
    recurring: (rec.data || []).map(mapRecurring),
    budgets: bud.data ? { weekly: num(bud.data.weekly), categories: bud.data.categories } : null,
  };
}
async function insertOne(table, row, mapper) { const { data, error } = await supabase.from(table).insert(row).select().single(); if (error) throw error; return mapper(data); }
async function run(query) { const { error } = await query; if (error) throw error; }

const cloudDb = {
  addExpense: (e) => insertOne("expenses", expenseRow(e), mapExpense),
  addExpensesBatch: async (arr) => { if (!arr.length) return []; const { data, error } = await supabase.from("expenses").insert(arr.map(expenseRow)).select(); if (error) throw error; return (data || []).map(mapExpense); },
  delExpense: (id) => run(supabase.from("expenses").delete().eq("id", id)),
  addPayment: (p) => insertOne("payments", paymentRow(p), mapPayment),
  updatePayment: (id, patch) => { const row = {}; if ("dueDate" in patch) row.due_date = patch.dueDate; if ("status" in patch) row.status = patch.status; return run(supabase.from("payments").update(row).eq("id", id)); },
  delPayment: (id) => run(supabase.from("payments").delete().eq("id", id)),
  addDebt: (d) => insertOne("debts", debtRow(d), mapDebt),
  delDebt: (id) => run(supabase.from("debts").delete().eq("id", id)),
  addRecurring: (r) => insertOne("recurring_expenses", recurringRow(r), mapRecurring),
  delRecurring: (id) => run(supabase.from("recurring_expenses").delete().eq("id", id)),
  updateRecurringLastDate: (id, lastDate) => run(supabase.from("recurring_expenses").update({ last_date: lastDate }).eq("id", id)),
  upsertBudget: (b, userId) => run(supabase.from("budgets").upsert({ user_id: userId, weekly: b.weekly, categories: b.categories, updated_at: new Date().toISOString() }, { onConflict: "user_id" })),
  seedSample: (s) => Promise.all([
    supabase.from("expenses").insert(s.expenses.map(expenseRow)),
    supabase.from("payments").insert(s.payments.map(paymentRow)),
    supabase.from("debts").insert(s.debts.map(debtRow)),
    supabase.from("recurring_expenses").insert(s.recurring.map(recurringRow)),
  ]).then((rs) => { const e = rs.find((r) => r.error); if (e) throw e.error; }),
  clearAll: () => Promise.all([
    supabase.from("expenses").delete().neq("id", NIL),
    supabase.from("payments").delete().neq("id", NIL),
    supabase.from("debts").delete().neq("id", NIL),
    supabase.from("recurring_expenses").delete().neq("id", NIL),
  ]).then((rs) => { const e = rs.find((r) => r.error); if (e) throw e.error; }),
};

/* ── pick the implementation once, at load ── */
export const fetchAll = supabaseConfigured ? cloudFetchAll : localFetchAll;
export const db = supabaseConfigured ? cloudDb : localDb;
