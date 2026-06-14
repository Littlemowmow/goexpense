/* GOexpense data layer — Supabase CRUD scoped to the logged-in user.
   RLS + a `user_id default auth.uid()` column mean the client never sends
   user_id on inserts; the database fills and enforces it. We map between the
   DB's snake_case columns and the app's camelCase shapes here so the UI code
   stays unchanged. */
import { supabase } from "./supabase";

const num = (v) => (v == null ? 0 : Number(v));

/* row → app */
const mapExpense = (r) => ({ id: r.id, amount: num(r.amount), category: r.category, note: r.note || "", date: r.spent_on, recurringId: r.recurring_id || undefined });
const mapPayment = (r) => ({ id: r.id, name: r.name, amount: num(r.amount), dueDate: r.due_date, recurring: r.recurring, status: r.status });
const mapDebt = (r) => ({ id: r.id, person: r.person, amount: num(r.amount), note: r.note || "", direction: r.direction });
const mapRecurring = (r) => ({ id: r.id, amount: num(r.amount), category: r.category, note: r.note || "", cadence: r.cadence, lastDate: r.last_date });

/* app → row */
const expenseRow = (e) => ({ amount: e.amount, category: e.category, note: e.note || "", spent_on: e.date, recurring_id: e.recurringId || null });
const paymentRow = (p) => ({ name: p.name, amount: p.amount, due_date: p.dueDate, recurring: p.recurring, status: p.status });
const debtRow = (d) => ({ person: d.person, amount: d.amount, note: d.note || "", direction: d.direction });
const recurringRow = (r) => ({ amount: r.amount, category: r.category, note: r.note || "", cadence: r.cadence, last_date: r.lastDate });

const NIL = "00000000-0000-0000-0000-000000000000";

export async function fetchAll() {
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

async function insertOne(table, row, mapper) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return mapper(data);
}
async function run(query) { const { error } = await query; if (error) throw error; }

export const db = {
  addExpense: (e) => insertOne("expenses", expenseRow(e), mapExpense),
  addExpensesBatch: async (arr) => {
    if (!arr.length) return [];
    const { data, error } = await supabase.from("expenses").insert(arr.map(expenseRow)).select();
    if (error) throw error;
    return (data || []).map(mapExpense);
  },
  delExpense: (id) => run(supabase.from("expenses").delete().eq("id", id)),

  addPayment: (p) => insertOne("payments", paymentRow(p), mapPayment),
  updatePayment: (id, patch) => run(supabase.from("payments").update(patch).eq("id", id)),
  delPayment: (id) => run(supabase.from("payments").delete().eq("id", id)),

  addDebt: (d) => insertOne("debts", debtRow(d), mapDebt),
  delDebt: (id) => run(supabase.from("debts").delete().eq("id", id)),

  addRecurring: (r) => insertOne("recurring_expenses", recurringRow(r), mapRecurring),
  delRecurring: (id) => run(supabase.from("recurring_expenses").delete().eq("id", id)),
  updateRecurringLastDate: (id, lastDate) => run(supabase.from("recurring_expenses").update({ last_date: lastDate }).eq("id", id)),

  upsertBudget: (b, userId) => run(supabase.from("budgets").upsert(
    { user_id: userId, weekly: b.weekly, categories: b.categories, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  )),

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
