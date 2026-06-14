import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell,
  PieChart, Pie, Tooltip,
} from "recharts";
import {
  Wallet, CalendarClock, Users, Plus, Trash2, Check, Settings,
  ChevronLeft, ChevronRight, AlertTriangle, ArrowDownRight, ArrowUpRight, X,
} from "lucide-react";

/* ---------- theme: coastal mist (calm, light) ---------- */
const T = {
  bg: "#EEF3F4", panel: "#FBFDFD", panel2: "#FFFFFF", line: "#DEE7E8",
  ink: "#38454A", sub: "#7A8990", faint: "#A9B6BA",
  // muted accents (kept under the original key names so logic is untouched)
  blue: "#7FA6A3",   // soft teal — primary
  green: "#9DB89A",  // sage — positive
  amber: "#CBA36A",  // muted gold — due soon
  rose: "#C28B7E",   // dusty clay — alerts / negative
  violet: "#A99BC0", // dusty lavender — IOUs
  track: "#E4ECED",  // progress bar groove
  barIdle: "#CBDADC",// inactive bar fill
};
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Palladio, Georgia, 'Times New Roman', serif";
const CAT_COLORS = ["#7FA6A3", "#93B0C4", "#9DB89A", "#C9A27E", "#A99BC0", "#84B0AE", "#D2BFA0", "#A8BD9E"];

const DEFAULTS = {
  expenses: [],
  budgets: {
    weekly: 260,
    categories: [
      { name: "Food", limit: 70 },
      { name: "Groceries", limit: 55 },
      { name: "Transport", limit: 30 },
      { name: "Subscriptions", limit: 25 },
      { name: "Fun", limit: 45 },
      { name: "Other", limit: 35 },
    ],
  },
  payments: [],
  debts: [],
};

/* ---------- date helpers (local, no TZ drift) ---------- */
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
const weekStart = (d) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameWeek = (iso, start) => { const d = parse(iso); return d >= start && d < addDays(start, 7); };
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today0 = () => { const x = new Date(); x.setHours(0, 0, 0, 0); return x; };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------- storage (localStorage-backed; mirrors the {value} shape) ---------- */
const STORE_PREFIX = "life-dashboard:";
const storage = {
  async get(key) {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw == null ? null : { value: raw };
  },
  async set(key, value) {
    localStorage.setItem(STORE_PREFIX + key, value);
  },
};

const KEYS = ["expenses", "budgets", "payments", "debts"];
async function loadAll() {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of KEYS) {
    try { const r = await storage.get(k); if (r && r.value) out[k] = JSON.parse(r.value); } catch (e) { /* missing key */ }
  }
  return out;
}
async function save(key, value) {
  try { await storage.set(key, JSON.stringify(value)); } catch (e) { console.error("save failed", key, e); }
}

/* ---------- small ui ---------- */
const Card = ({ children, style, className = "" }) => (
  <div className={className} style={{ background: T.panel, borderRadius: 22, border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(56,69,74,.03), 0 18px 40px -24px rgba(56,69,74,.18)", ...style }}>{children}</div>
);
const Field = ({ children }) => <div className="flex flex-col gap-1">{children}</div>;
const inputStyle = { background: "#FFFFFF", border: `1px solid ${T.line}`, color: T.ink, borderRadius: 12, padding: "10px 12px", fontSize: 14, outline: "none", width: "100%" };
const btn = (bg, fg = "#FFFFFF") => ({ background: bg, color: fg, border: "none", borderRadius: 12, padding: "10px 16px", fontSize: 14, fontWeight: 600, letterSpacing: .2, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 1px 2px rgba(56,69,74,.10)" });
const ghost = { background: "transparent", color: T.sub, border: `1px solid ${T.line}`, borderRadius: 12, padding: "9px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 };

function Progress({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max && max > 0;
  return (
    <div style={{ height: 8, background: T.track, borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: over ? T.rose : color, borderRadius: 99, transition: "width .5s ease" }} />
    </div>
  );
}

/* ---------- main ---------- */
export default function LifeDashboard() {
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState(DEFAULTS.budgets);
  const [payments, setPayments] = useState([]);
  const [debts, setDebts] = useState([]);
  const [weekRef, setWeekRef] = useState(() => weekStart(new Date()));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { loadAll().then((d) => { setExpenses(d.expenses); setBudgets(d.budgets); setPayments(d.payments); setDebts(d.debts); setLoading(false); }); }, []);

  const mutate = useCallback((key, setter, next) => { setter(next); save(key, next); }, []);

  /* derived: current week */
  const wkStart = weekRef;
  const wkExpenses = useMemo(() => expenses.filter((e) => sameWeek(e.date, wkStart)), [expenses, wkStart]);
  const spent = useMemo(() => wkExpenses.reduce((s, e) => s + e.amount, 0), [wkExpenses]);
  const remaining = budgets.weekly - spent;
  const isThisWeek = +wkStart === +weekStart(new Date());

  const byDay = useMemo(() => DOW.map((label, i) => {
    const dayIso = fmt(addDays(wkStart, i));
    const total = wkExpenses.filter((e) => e.date === dayIso).reduce((s, e) => s + e.amount, 0);
    return { label, total };
  }), [wkExpenses, wkStart]);

  const byCat = useMemo(() => {
    const map = {};
    wkExpenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return budgets.categories.map((c, i) => ({ name: c.name, limit: c.limit, value: map[c.name] || 0, color: CAT_COLORS[i % CAT_COLORS.length] }))
      .concat(Object.keys(map).filter((k) => !budgets.categories.some((c) => c.name === k)).map((k, i) => ({ name: k, limit: 0, value: map[k], color: CAT_COLORS[(budgets.categories.length + i) % CAT_COLORS.length] })));
  }, [wkExpenses, budgets]);

  /* pace: where you "should" be by today */
  const dayIdx = isThisWeek ? Math.min(6, (new Date().getDay() + 6) % 7) : 6;
  const pace = budgets.weekly * ((dayIdx + 1) / 7);
  const paceDelta = spent - pace;

  /* payments */
  const sortedPayments = useMemo(() => [...payments].sort((a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === "unpaid" ? -1 : 1)), [payments]);
  const dueSoon = useMemo(() => payments.filter((p) => p.status === "unpaid" && parse(p.dueDate) <= addDays(today0(), 7)), [payments]);
  const overdue = useMemo(() => payments.filter((p) => p.status === "unpaid" && parse(p.dueDate) < today0()), [payments]);
  const unpaidTotal = useMemo(() => payments.filter((p) => p.status === "unpaid").reduce((s, p) => s + p.amount, 0), [payments]);

  /* debts */
  const iOwe = useMemo(() => debts.filter((d) => d.direction === "owe").reduce((s, d) => s + d.amount, 0), [debts]);
  const owedToMe = useMemo(() => debts.filter((d) => d.direction === "owed").reduce((s, d) => s + d.amount, 0), [debts]);

  /* a quiet, time-of-day greeting */
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "good morning" : hour < 18 ? "good afternoon" : "good evening";

  if (loading) return <div style={{ background: T.bg, color: T.sub, minHeight: 480, display: "grid", placeItems: "center", fontFamily: SERIF, fontStyle: "italic", fontSize: 16 }}>settling in…</div>;

  return (
    <div style={{ background: T.bg, color: T.ink, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", padding: "28px clamp(16px,4vw,40px)" }}>
      <style>{`*{box-sizing:border-box} input::placeholder{color:${T.faint}} .num{font-feature-settings:"tnum";font-variant-numeric:tabular-nums} .serif{font-family:${SERIF}}`}</style>

      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 26, maxWidth: 1180, marginInline: "auto", width: "100%" }}>
        <div>
          <div className="serif" style={{ fontSize: 15, color: T.sub, fontStyle: "italic" }}>{greeting}</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 500, margin: "1px 0 0", letterSpacing: -0.4, color: T.ink }}>your week</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="serif" style={{ color: T.sub, fontSize: 14, fontStyle: "italic" }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
          <button style={ghost} onClick={() => setShowSettings(true)}><Settings size={15} /> budget</button>
        </div>
      </div>

      <div style={{ maxWidth: 1180, marginInline: "auto" }}>
      {/* top stat strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", marginBottom: 16 }}>
        <Stat icon={<Wallet size={16} />} label="spent this week" value={money(spent)} sub={`of ${money(budgets.weekly)} budget`} tint={T.blue} />
        <Stat icon={<Wallet size={16} />} label="remaining" value={money(remaining)} sub={remaining < 0 ? "over budget" : "left to spend"} tint={remaining < 0 ? T.rose : T.green} />
        <Stat icon={<CalendarClock size={16} />} label="unpaid bills" value={money(unpaidTotal)} sub={`${dueSoon.length} due within 7 days`} tint={overdue.length ? T.rose : T.amber} />
        <Stat icon={<Users size={16} />} label="you owe" value={money(iOwe)} sub={owedToMe > 0 ? `${money(owedToMe)} owed to you` : "no one owes you"} tint={iOwe > 0 ? T.rose : T.green} />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))" }}>

        {/* ---- weekly budget + analytics ---- */}
        <Card className="p-5" style={{ gridColumn: "1 / -1" }}>
          <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 16 }}>
            <div className="flex items-center gap-2">
              <button style={ghost} onClick={() => setWeekRef(addDays(wkStart, -7))}><ChevronLeft size={15} /></button>
              <div className="serif" style={{ fontWeight: 500, fontSize: 19 }}>{isThisWeek ? "this week" : `week of ${wkStart.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`}</div>
              <button style={ghost} onClick={() => setWeekRef(addDays(wkStart, 7))} disabled={isThisWeek}><ChevronRight size={15} /></button>
            </div>
            <div className="num" style={{ fontSize: 13, color: Math.abs(paceDelta) < 1 ? T.sub : paceDelta > 0 ? T.amber : T.green }}>
              {paceDelta > 0 ? `${money(paceDelta)} ahead of pace` : `${money(-paceDelta)} under pace`}
            </div>
          </div>

          {/* big burn bar */}
          <div className="flex items-baseline gap-2" style={{ marginBottom: 8 }}>
            <span className="num" style={{ fontSize: 32, fontWeight: 600, color: T.ink }}>{money(spent)}</span>
            <span style={{ color: T.sub, fontSize: 14 }}>/ {money(budgets.weekly)}</span>
          </div>
          <Progress value={spent} max={budgets.weekly} color={T.blue} />

          <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 22 }}>
            {/* by day */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 10, fontWeight: 500 }}>by day</div>
              <div style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byDay} margin={{ top: 4, right: 0, bottom: 0, left: -22 }}>
                    <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: T.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "rgba(56,69,74,.05)" }} contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, color: T.ink, fontSize: 13, boxShadow: "0 8px 24px -12px rgba(56,69,74,.3)" }} formatter={(v) => [money(v), "spent"]} />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                      {byDay.map((d, i) => <Cell key={i} fill={d.label === DOW[dayIdx] && isThisWeek ? T.blue : T.barIdle} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* by category donut */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 10, fontWeight: 500 }}>by category</div>
              <div style={{ height: 150 }}>
                {spent > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byCat.filter((c) => c.value > 0)} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62} paddingAngle={3} stroke="none">
                        {byCat.filter((c) => c.value > 0).map((c, i) => <Cell key={i} fill={c.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, color: T.ink, fontSize: 13, boxShadow: "0 8px 24px -12px rgba(56,69,74,.3)" }} formatter={(v, n) => [money(v), n]} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="serif" style={{ height: "100%", display: "grid", placeItems: "center", color: T.faint, fontSize: 14, fontStyle: "italic" }}>nothing logged yet</div>}
              </div>
            </div>
          </div>

          {/* per-category progress */}
          <div className="grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginTop: 20 }}>
            {byCat.map((c, i) => (
              <div key={i}>
                <div className="flex items-center justify-between" style={{ marginBottom: 6, fontSize: 13 }}>
                  <span className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: 9, background: c.color }} />{c.name}</span>
                  <span className="num" style={{ color: c.limit && c.value > c.limit ? T.rose : T.sub }}>{money(c.value)}{c.limit ? ` / ${money(c.limit)}` : ""}</span>
                </div>
                <Progress value={c.value} max={c.limit || c.value || 1} color={c.color} />
              </div>
            ))}
          </div>
        </Card>

        {/* ---- expenses ---- */}
        <Card className="p-5">
          <SectionTitle icon={<Wallet size={16} />} title="expenses" />
          <ExpenseAdder categories={budgets.categories} onAdd={(e) => mutate("expenses", setExpenses, [e, ...expenses])} />
          <div style={{ marginTop: 14, maxHeight: 300, overflowY: "auto" }}>
            {wkExpenses.length === 0 && <Empty text="nothing logged this week yet" />}
            {wkExpenses.map((e) => (
              <Row key={e.id} onDelete={() => mutate("expenses", setExpenses, expenses.filter((x) => x.id !== e.id))}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 14 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 9, background: CAT_COLORS[budgets.categories.findIndex((c) => c.name === e.category) % CAT_COLORS.length] || T.sub, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.note || e.category}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>{e.category} · {parse(e.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
                </div>
                <span className="num" style={{ fontWeight: 600 }}>{money(e.amount)}</span>
              </Row>
            ))}
          </div>
        </Card>

        {/* ---- payments due ---- */}
        <Card className="p-5">
          <SectionTitle icon={<CalendarClock size={16} />} title="payments due" />
          <PaymentAdder onAdd={(p) => mutate("payments", setPayments, [...payments, p])} />
          <div style={{ marginTop: 14, maxHeight: 300, overflowY: "auto" }}>
            {payments.length === 0 && <Empty text="add rent, subscriptions, or one-off bills" />}
            {sortedPayments.map((p) => {
              const od = p.status === "unpaid" && parse(p.dueDate) < today0();
              const soon = p.status === "unpaid" && !od && parse(p.dueDate) <= addDays(today0(), 7);
              return (
                <Row key={p.id} onDelete={() => mutate("payments", setPayments, payments.filter((x) => x.id !== p.id))}>
                  <div style={{ minWidth: 0, opacity: p.status === "paid" ? 0.45 : 1 }}>
                    <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}>
                      {od && <AlertTriangle size={13} color={T.rose} />}
                      <span style={{ textDecoration: p.status === "paid" ? "line-through" : "none" }}>{p.name}</span>
                    </div>
                    <div style={{ fontSize: 12, color: od ? T.rose : soon ? T.amber : T.sub, marginTop: 3 }}>
                      {p.status === "paid" ? "paid" : od ? "overdue · " : soon ? "due soon · " : "due "}
                      {p.status !== "paid" && parse(p.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {p.recurring !== "once" ? ` · ${p.recurring}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num" style={{ fontWeight: 600, opacity: p.status === "paid" ? 0.45 : 1 }}>{money(p.amount)}</span>
                    <button title={p.status === "paid" ? "mark unpaid" : "mark paid"} style={{ ...ghost, padding: 7, color: p.status === "paid" ? T.green : T.sub }}
                      onClick={() => mutate("payments", setPayments, payments.map((x) => x.id === p.id ? { ...x, status: x.status === "paid" ? "unpaid" : "paid" } : x))}><Check size={14} /></button>
                  </div>
                </Row>
              );
            })}
          </div>
        </Card>

        {/* ---- who I owe ---- */}
        <Card className="p-5">
          <SectionTitle icon={<Users size={16} />} title="debts & ious" />
          <div className="flex gap-2" style={{ marginBottom: 4 }}>
            <Mini label="you owe" value={money(iOwe)} tint={T.rose} />
            <Mini label="owed to you" value={money(owedToMe)} tint={T.green} />
            <Mini label="net" value={money(owedToMe - iOwe)} tint={owedToMe - iOwe >= 0 ? T.green : T.rose} />
          </div>
          <DebtAdder onAdd={(d) => mutate("debts", setDebts, [...debts, d])} />
          <div style={{ marginTop: 14, maxHeight: 280, overflowY: "auto" }}>
            {debts.length === 0 && <Empty text="track who you owe and who owes you" />}
            {debts.map((d) => (
              <Row key={d.id} onDelete={() => mutate("debts", setDebts, debts.filter((x) => x.id !== d.id))}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}>
                    {d.direction === "owe" ? <ArrowUpRight size={14} color={T.rose} /> : <ArrowDownRight size={14} color={T.green} />}
                    {d.person}
                  </div>
                  {d.note && <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>{d.note}</div>}
                </div>
                <span className="num" style={{ fontWeight: 600, color: d.direction === "owe" ? T.rose : T.green }}>{d.direction === "owe" ? "-" : "+"}{money(d.amount).replace("$", "$")}</span>
              </Row>
            ))}
          </div>
        </Card>
      </div>
      </div>

      {showSettings && <BudgetSettings budgets={budgets} onSave={(b) => { mutate("budgets", setBudgets, b); setShowSettings(false); }} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/* ---------- subcomponents ---------- */
function Stat({ icon, label, value, sub, tint }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2" style={{ color: tint, fontSize: 12.5, fontWeight: 500 }}>{icon}{label}</div>
      <div className="num" style={{ fontSize: 25, fontWeight: 600, margin: "8px 0 3px", color: T.ink }}>{value}</div>
      <div style={{ fontSize: 12, color: T.sub }}>{sub}</div>
    </Card>
  );
}
function SectionTitle({ icon, title }) {
  return <div className="flex items-center gap-2 serif" style={{ fontWeight: 500, fontSize: 18, marginBottom: 14 }}><span style={{ color: T.blue }}>{icon}</span>{title}</div>;
}
function Empty({ text }) { return <div className="serif" style={{ color: T.faint, fontSize: 14, fontStyle: "italic", padding: "16px 2px", textAlign: "center" }}>{text}</div>; }
function Mini({ label, value, tint }) {
  return <div style={{ flex: 1, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 12, padding: "9px 11px" }}>
    <div style={{ fontSize: 11, color: T.sub }}>{label}</div>
    <div className="num" style={{ fontSize: 15, fontWeight: 600, color: tint }}>{value}</div>
  </div>;
}
function Row({ children, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-3 group" style={{ padding: "11px 2px", borderBottom: `1px solid ${T.line}` }}>
      <div className="flex items-center justify-between gap-3" style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <button onClick={onDelete} title="remove" style={{ background: "transparent", border: "none", color: T.faint, cursor: "pointer", padding: 4 }}><Trash2 size={14} /></button>
    </div>
  );
}

function ExpenseAdder({ categories, onAdd }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]?.name || "Other");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(fmt(new Date()));
  const add = () => {
    const a = parseFloat(amount);
    if (!a || a <= 0) return;
    onAdd({ id: crypto.randomUUID(), amount: a, category, note: note.trim(), date });
    setAmount(""); setNote("");
  };
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <input style={inputStyle} type="number" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
        {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      <input style={inputStyle} placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <button style={{ ...btn(T.blue), gridColumn: "1 / -1", justifyContent: "center" }} onClick={add}><Plus size={15} /> log expense</button>
    </div>
  );
}

function PaymentAdder({ onAdd }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(fmt(new Date()));
  const [recurring, setRecurring] = useState("monthly");
  const add = () => {
    const a = parseFloat(amount);
    if (!name.trim() || !a || a <= 0) return;
    onAdd({ id: crypto.randomUUID(), name: name.trim(), amount: a, dueDate, recurring, status: "unpaid" });
    setName(""); setAmount("");
  };
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <input style={{ ...inputStyle, gridColumn: "1 / -1" }} placeholder="e.g. rent, spotify" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={inputStyle} type="number" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input style={inputStyle} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <select style={{ ...inputStyle, gridColumn: "1 / -1" }} value={recurring} onChange={(e) => setRecurring(e.target.value)}>
        <option value="monthly">monthly</option>
        <option value="weekly">weekly</option>
        <option value="once">one-time</option>
      </select>
      <button style={{ ...btn(T.amber, "#3A2E12"), gridColumn: "1 / -1", justifyContent: "center" }} onClick={add}><Plus size={15} /> add payment</button>
    </div>
  );
}

function DebtAdder({ onAdd }) {
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState("owe");
  const add = () => {
    const a = parseFloat(amount);
    if (!person.trim() || !a || a <= 0) return;
    onAdd({ id: crypto.randomUUID(), person: person.trim(), amount: a, note: note.trim(), direction });
    setPerson(""); setAmount(""); setNote("");
  };
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
      <div className="flex gap-2" style={{ gridColumn: "1 / -1" }}>
        <button style={{ ...ghost, flex: 1, justifyContent: "center", borderColor: direction === "owe" ? T.rose : T.line, color: direction === "owe" ? T.rose : T.sub }} onClick={() => setDirection("owe")}>i owe</button>
        <button style={{ ...ghost, flex: 1, justifyContent: "center", borderColor: direction === "owed" ? T.green : T.line, color: direction === "owed" ? T.green : T.sub }} onClick={() => setDirection("owed")}>owed to me</button>
      </div>
      <input style={inputStyle} placeholder="person" value={person} onChange={(e) => setPerson(e.target.value)} />
      <input style={inputStyle} type="number" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input style={{ ...inputStyle, gridColumn: "1 / -1" }} placeholder="for what? (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <button style={{ ...btn(T.violet), gridColumn: "1 / -1", justifyContent: "center" }} onClick={add}><Plus size={15} /> add iou</button>
    </div>
  );
}

function BudgetSettings({ budgets, onSave, onClose }) {
  const [weekly, setWeekly] = useState(budgets.weekly);
  const [cats, setCats] = useState(budgets.categories);
  const sumCats = cats.reduce((s, c) => s + (parseFloat(c.limit) || 0), 0);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(56,69,74,.28)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }} onClick={onClose}>
      <Card className="p-6" style={{ width: "min(440px,100%)", maxHeight: "85vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }} onClick={(e) => e.stopPropagation()}>
          <div className="serif" style={{ fontWeight: 500, fontSize: 20 }}>budget settings</div>
          <button style={{ background: "transparent", border: "none", color: T.sub, cursor: "pointer" }} onClick={onClose}><X size={18} /></button>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Field>
            <label style={{ fontSize: 13, color: T.sub }}>weekly budget</label>
            <input style={inputStyle} type="number" value={weekly} onChange={(e) => setWeekly(parseFloat(e.target.value) || 0)} />
          </Field>
          <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 12px" }}>category limits sum to {money(sumCats)}</div>
          <div className="flex flex-col gap-2">
            {cats.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input style={{ ...inputStyle, flex: 2 }} value={c.name} onChange={(e) => setCats(cats.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input style={{ ...inputStyle, flex: 1 }} type="number" value={c.limit} onChange={(e) => setCats(cats.map((x, j) => j === i ? { ...x, limit: parseFloat(e.target.value) || 0 } : x))} />
                <button style={{ background: "transparent", border: "none", color: T.faint, cursor: "pointer" }} onClick={() => setCats(cats.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button style={{ ...ghost, marginTop: 12, width: "100%", justifyContent: "center" }} onClick={() => setCats([...cats, { name: "New", limit: 0 }])}><Plus size={14} /> add category</button>
          <button style={{ ...btn(T.blue), marginTop: 14, width: "100%", justifyContent: "center" }} onClick={() => onSave({ weekly, categories: cats.filter((c) => c.name.trim()) })}>save budget</button>
        </div>
      </Card>
    </div>
  );
}
