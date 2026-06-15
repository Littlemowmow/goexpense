import { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine,
  PieChart, Pie, Tooltip,
} from "recharts";
import {
  Wallet, CalendarClock, Users, Plus, Trash2, Check, Settings,
  ChevronLeft, ChevronRight, AlertTriangle, ArrowDownRight, ArrowUpRight, X,
  Repeat, Download, Search, TrendingUp, Sparkles, LogOut, Maximize2,
} from "lucide-react";
import { exportPDF } from "./report";
import { supabase, supabaseConfigured } from "./supabase";
import { fetchAll, db } from "./db";

/* ---------- theme: coastal mist (calm, light) ---------- */
const T = {
  bg: "#EEF3F4", panel: "#FBFDFD", panel2: "#FFFFFF", line: "#DEE7E8",
  ink: "#38454A", sub: "#7A8990", faint: "#A9B6BA",
  blue: "#7FA6A3",   // soft teal — primary
  green: "#9DB89A",  // sage — positive
  amber: "#CBA36A",  // muted gold — due soon
  rose: "#C28B7E",   // dusty clay — alerts / negative
  violet: "#A99BC0", // dusty lavender — IOUs
  track: "#E4ECED",
  barIdle: "#CBDADC",
};
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Palladio, Georgia, 'Times New Roman', serif";
const CAT_COLORS = ["#7FA6A3", "#93B0C4", "#9DB89A", "#C9A27E", "#A99BC0", "#84B0AE", "#D2BFA0", "#A8BD9E"];
const BG = `radial-gradient(1100px 460px at 50% -240px, #FFFFFF, ${T.bg} 70%)`;

const DEFAULTS = {
  // New accounts start with NO budget set (weekly 0) so the dashboard doesn't
  // show phantom "money left to spend" before the user sets their own budget.
  // Category names are kept so the expense dropdown is usable; limits start at 0.
  budgets: {
    weekly: 0,
    categories: [
      { name: "Food", limit: 0 },
      { name: "Groceries", limit: 0 },
      { name: "Transport", limit: 0 },
      { name: "Subscriptions", limit: 0 },
      { name: "Fun", limit: 0 },
      { name: "Other", limit: 0 },
    ],
  },
};

/* ---------- date helpers (local, no TZ drift) ---------- */
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
const weekStart = (d) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const nextPeriod = (d, cadence) => cadence === "weekly" ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
const sameWeek = (iso, start) => { const d = parse(iso); return d >= start && d < addDays(start, 7); };
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today0 = () => { const x = new Date(); x.setHours(0, 0, 0, 0); return x; };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------- recurring: materialise periods that have come due ---------- */
function materializeRecurring(templates) {
  const tnow = today0();
  const additions = [];
  const updated = templates.map((t) => {
    let last = parse(t.lastDate);
    let next = nextPeriod(last, t.cadence);
    let guard = 0;
    while (next <= tnow && guard < 520) {
      additions.push({ amount: t.amount, category: t.category, note: t.note, date: fmt(next), recurringId: t.id });
      last = next; next = nextPeriod(last, t.cadence); guard++;
    }
    return { ...t, lastDate: fmt(last) };
  });
  return { additions, updated };
}

/* ---------- sample data (so an empty dashboard can demo itself) ---------- */
function buildSample() {
  const today = today0();
  const ws = weekStart(today);
  const elapsed = Math.round((today - ws) / 86400000); // 0..6
  const exp = [];
  const tw = [["Food", 18.5, "lunch"], ["Groceries", 64, "weekly shop"], ["Transport", 12, "metro"], ["Fun", 28, "cinema"], ["Subscriptions", 11.99, "spotify"], ["Food", 9.5, "coffee"], ["Food", 22, "dinner"]];
  tw.forEach((r, i) => exp.push({ amount: r[1], category: r[0], note: r[2], date: fmt(addDays(ws, Math.min(i, elapsed))) }));
  const cats = ["Food", "Groceries", "Transport", "Fun", "Subscriptions", "Other"];
  for (let wk = 1; wk <= 7; wk++) {
    const base = addDays(ws, -7 * wk);
    const n = 3 + ((wk * 7) % 4);
    for (let i = 0; i < n; i++) exp.push({ amount: 15 + ((wk * 13 + i * 7) % 70), category: cats[(wk + i) % 6], note: "", date: fmt(addDays(base, i % 6)) });
  }
  return {
    expenses: exp,
    payments: [
      { name: "Rent", amount: 1200, dueDate: fmt(addDays(today, 3)), recurring: "monthly", status: "unpaid" },
      { name: "Electricity", amount: 64.2, dueDate: fmt(addDays(today, -2)), recurring: "monthly", status: "unpaid" },
      { name: "Netflix", amount: 15.99, dueDate: fmt(addDays(today, 12)), recurring: "monthly", status: "paid" },
    ],
    debts: [
      { person: "Sara", amount: 40, note: "concert ticket", direction: "owed" },
      { person: "Mike", amount: 25, note: "dinner", direction: "owe" },
    ],
    recurring: [{ amount: 11.99, category: "Subscriptions", note: "Spotify", cadence: "monthly", lastDate: fmt(today) }],
  };
}

/* ---------- upcoming bills: project unpaid + recurring payments forward ---------- */
function projectUpcomingBills(payments, horizonDays = 90) {
  const today = today0();
  const end = addDays(today, horizonDays);
  const out = [];
  payments.forEach((p) => {
    const isRecurring = p.recurring && p.recurring !== "once";
    if (!isRecurring) {
      if (p.status === "paid") return; // paid one-offs are done
      out.push({ id: `${p.id}-0`, name: p.name, amount: p.amount, date: p.dueDate, recurring: false, overdue: parse(p.dueDate) < today });
      return;
    }
    let d = parse(p.dueDate);
    let guard = 0;
    while (d <= end && guard < 300) {
      out.push({ id: `${p.id}-${guard}`, name: p.name, amount: p.amount, date: fmt(d), recurring: p.recurring, overdue: d < today });
      d = nextPeriod(d, p.recurring === "weekly" ? "weekly" : "monthly");
      guard++;
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- small ui ---------- */
const Card = ({ children, style, className = "", onClick }) => (
  <div className={`card ${className}`} onClick={onClick} style={{ background: T.panel, borderRadius: 22, border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(56,69,74,.03), 0 18px 40px -24px rgba(56,69,74,.18)", ...style }}>{children}</div>
);
const Field = ({ children }) => <div className="flex flex-col gap-1">{children}</div>;
const inputStyle = { background: "#FFFFFF", border: `1px solid ${T.line}`, color: T.ink, borderRadius: 12, padding: "10px 12px", fontSize: 14, outline: "none", width: "100%" };
const btn = (bg, fg = "#FFFFFF") => ({ background: bg, color: fg, border: "none", borderRadius: 12, padding: "10px 16px", fontSize: 14, fontWeight: 600, letterSpacing: .2, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, boxShadow: "0 1px 2px rgba(56,69,74,.10)" });
const ghost = { background: "transparent", color: T.sub, border: `1px solid ${T.line}`, borderRadius: 12, padding: "9px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 };
const Wordmark = ({ size = 12.5 }) => <div style={{ fontSize: size, fontWeight: 800, letterSpacing: 0.6, color: T.blue }}>GO<span style={{ color: T.ink }}>expense</span></div>;

function Progress({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max && max > 0;
  return (
    <div style={{ height: 8, background: T.track, borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: over ? T.rose : color, borderRadius: 99, transition: "width .5s ease" }} />
    </div>
  );
}

/* measures its own width, then renders a fixed-size chart — avoids
   recharts ResponsiveContainer's -1 first-paint warning entirely */
function Chart({ height, children }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => { const cw = entries[0].contentRect.width; if (cw > 0) setW(Math.floor(cw)); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} style={{ height, width: "100%" }}>{w > 0 ? children(w) : null}</div>;
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: T.bg, border: `1px solid ${T.line}`, borderRadius: 11, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, letterSpacing: .2,
              background: on ? T.panel2 : "transparent", color: on ? T.ink : T.sub, boxShadow: on ? "0 1px 2px rgba(56,69,74,.12)" : "none", transition: "all .15s ease" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const GlobalStyle = () => <style>{`*{box-sizing:border-box} input::placeholder{color:${T.faint}} .num{font-feature-settings:"tnum";font-variant-numeric:tabular-nums} .serif{font-family:${SERIF}} .card{transition:transform .18s ease, border-color .18s ease} .card:hover{transform:translateY(-2px); border-color:#CCD9DA} .ico-btn:hover{color:${T.ink}!important}`}</style>;

function Splash({ text = "settling in…" }) {
  return <div style={{ background: BG, color: T.sub, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: SERIF, fontStyle: "italic", fontSize: 16, padding: 20, textAlign: "center" }}>{text}</div>;
}

/* ---------- auth ---------- */
function LoginScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setMsg("");
    if (!email.trim() || pw.length < 6) { setErr("Enter an email and a password of at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw });
        if (error) throw error;
        if (!data.session) setMsg("Account created. Check your email to confirm, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      }
    } catch (e2) {
      setErr(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  const swap = () => { setMode((m) => (m === "signup" ? "signin" : "signup")); setErr(""); setMsg(""); };

  return (
    <div style={{ background: BG, minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <GlobalStyle />
      <Card className="p-6" style={{ width: "min(400px, 100%)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ display: "inline-flex" }}><Wordmark size={18} /></div>
          <div className="serif" style={{ fontStyle: "italic", color: T.sub, fontSize: 15, marginTop: 4 }}>{mode === "signup" ? "create your account" : "welcome back"}</div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input style={inputStyle} type="email" autoComplete="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={inputStyle} type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <div style={{ fontSize: 12.5, color: T.rose, background: T.rose + "1A", borderRadius: 10, padding: "8px 11px" }}>{err}</div>}
          {msg && <div style={{ fontSize: 12.5, color: T.green, background: T.green + "1A", borderRadius: 10, padding: "8px 11px" }}>{msg}</div>}
          <button type="submit" disabled={busy} style={{ ...btn(T.blue), justifyContent: "center", marginTop: 4, opacity: busy ? 0.6 : 1 }}>{busy ? "…" : mode === "signup" ? "sign up" : "sign in"}</button>
        </form>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button onClick={swap} style={{ background: "transparent", border: "none", color: T.blue, cursor: "pointer", fontSize: 13 }}>
            {mode === "signup" ? "have an account? sign in" : "new here? create an account"}
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ---------- main ---------- */
export default function GOexpense() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState(DEFAULTS.budgets);
  const [payments, setPayments] = useState([]);
  const [debts, setDebts] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [weekRef, setWeekRef] = useState(() => weekStart(new Date()));
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [trendMode, setTrendMode] = useState("weeks");
  const [analytics, setAnalytics] = useState(null); // null | 'spent' | 'remaining' | 'bills' | 'owed'

  /* auth: current session + subscribe to changes */
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  /* load this account's data whenever the user changes */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) { setLoading(false); return; }
      setLoading(true); setDataError("");
      try {
        let d = await fetchAll();
        let nextBudgets = d.budgets;
        if (!nextBudgets) { nextBudgets = DEFAULTS.budgets; await db.upsertBudget(nextBudgets, userId); }
        if (d.recurring.length) {
          const { additions, updated } = materializeRecurring(d.recurring);
          if (additions.length) {
            await db.addExpensesBatch(additions);
            if (cancelled) return;
            await Promise.all(updated.filter((u, i) => u.lastDate !== d.recurring[i].lastDate).map((u) => db.updateRecurringLastDate(u.id, u.lastDate)));
            if (cancelled) return;
            d = await fetchAll();
            nextBudgets = d.budgets || nextBudgets;
          }
        }
        if (cancelled) return;
        setExpenses(d.expenses); setPayments(d.payments); setDebts(d.debts); setRecurring(d.recurring); setBudgets(nextBudgets);
      } catch (err) {
        if (!cancelled) setDataError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  /* derived: current week */
  const wkStart = weekRef;
  const wkExpenses = useMemo(() => expenses.filter((e) => sameWeek(e.date, wkStart)), [expenses, wkStart]);
  const spent = useMemo(() => wkExpenses.reduce((s, e) => s + e.amount, 0), [wkExpenses]);
  const remaining = budgets.weekly - spent;
  const isThisWeek = +wkStart === +weekStart(new Date());

  const lastWeekSpent = useMemo(() => expenses.filter((e) => sameWeek(e.date, addDays(wkStart, -7))).reduce((s, e) => s + e.amount, 0), [expenses, wkStart]);
  const wowDelta = spent - lastWeekSpent;

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

  /* multi-week / multi-month trend */
  const weeklyTrend = useMemo(() => {
    const base = weekStart(new Date());
    return Array.from({ length: 8 }, (_, i) => {
      const s = addDays(base, -7 * (7 - i));
      const total = expenses.filter((e) => sameWeek(e.date, s)).reduce((a, e) => a + e.amount, 0);
      return { label: s.toLocaleDateString(undefined, { month: "short", day: "numeric" }), total, current: +s === +base };
    });
  }, [expenses]);
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const total = expenses.filter((e) => e.date.startsWith(key)).reduce((a, e) => a + e.amount, 0);
      return { label: d.toLocaleDateString(undefined, { month: "short" }), total, current: i === 5 };
    });
  }, [expenses]);
  const trendData = trendMode === "weeks" ? weeklyTrend : monthlyTrend;
  const trendBudget = trendMode === "weeks" ? budgets.weekly : budgets.weekly * (52 / 12);
  const trendAvg = trendData.length ? trendData.reduce((a, d) => a + d.total, 0) / trendData.length : 0;
  const trendMax = Math.ceil(Math.max(trendBudget, ...trendData.map((d) => d.total)) * 1.1);

  /* pace: where you "should" be by now (fractional, time-of-day aware) */
  const elapsedFrac = useMemo(() => {
    if (!isThisWeek) return 1;
    const now = new Date();
    const dIdx = (now.getDay() + 6) % 7;
    const dayFrac = (now.getHours() * 60 + now.getMinutes()) / 1440;
    return Math.min(1, (dIdx + dayFrac) / 7);
  }, [isThisWeek]);
  const dayIdx = isThisWeek ? Math.min(6, (new Date().getDay() + 6) % 7) : 6;
  const pace = budgets.weekly * elapsedFrac;
  const paceDelta = spent - pace;
  const noBudget = budgets.weekly === 0;
  const paceLabel = noBudget ? "set a weekly budget"
    : isThisWeek
      ? (Math.abs(paceDelta) < 1 ? "on pace" : paceDelta > 0 ? `${money(paceDelta)} over pace` : `${money(-paceDelta)} under pace`)
      : (remaining >= 0 ? `finished ${money(remaining)} under` : `finished ${money(-remaining)} over`);
  const paceColor = noBudget ? T.amber
    : isThisWeek
      ? (Math.abs(paceDelta) < 1 ? T.sub : paceDelta > 0 ? T.amber : T.green)
      : (remaining >= 0 ? T.green : T.rose);

  /* payments */
  const sortedPayments = useMemo(() => [...payments].sort((a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === "unpaid" ? -1 : 1)), [payments]);
  const dueSoon = useMemo(() => payments.filter((p) => p.status === "unpaid" && parse(p.dueDate) <= addDays(today0(), 7)), [payments]);
  const overdue = useMemo(() => payments.filter((p) => p.status === "unpaid" && parse(p.dueDate) < today0()), [payments]);
  const unpaidTotal = useMemo(() => payments.filter((p) => p.status === "unpaid").reduce((s, p) => s + p.amount, 0), [payments]);

  /* debts */
  const iOwe = useMemo(() => debts.filter((d) => d.direction === "owe").reduce((s, d) => s + d.amount, 0), [debts]);
  const owedToMe = useMemo(() => debts.filter((d) => d.direction === "owed").reduce((s, d) => s + d.amount, 0), [debts]);

  /* expense list: search + category filter */
  const shownExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return wkExpenses.filter((e) =>
      (!filterCat || e.category === filterCat) &&
      (!q || `${e.note || ""} ${e.category}`.toLowerCase().includes(q)));
  }, [wkExpenses, query, filterCat]);

  const isEmpty = expenses.length === 0 && payments.length === 0 && debts.length === 0;

  /* ---------- mutations (optimistic local state + Supabase write) ---------- */
  const fail = (action) => (err) => { console.error(action, err); setDataError(`Couldn't ${action}: ${err.message || err}`); };

  const addExpense = async (e, cadence) => {
    let createdTemplate;
    try {
      let recurringId;
      if (cadence && cadence !== "once") {
        createdTemplate = await db.addRecurring({ amount: e.amount, category: e.category, note: e.note, cadence, lastDate: e.date });
        setRecurring((r) => [...r, createdTemplate]); recurringId = createdTemplate.id;
      }
      const row = await db.addExpense({ ...e, recurringId });
      setExpenses((x) => [row, ...x]);
    } catch (err) {
      if (createdTemplate) { setRecurring((r) => r.filter((x) => x.id !== createdTemplate.id)); db.delRecurring(createdTemplate.id).catch(() => {}); }
      fail("save expense")(err);
    }
  };
  const repeatExpense = async (e) => {
    try {
      const row = await db.addExpense({ amount: e.amount, category: e.category, note: e.note, date: fmt(new Date()) });
      setExpenses((x) => [row, ...x]);
      if (!isThisWeek) setWeekRef(weekStart(new Date())); // keep the freshly-logged expense in view
    } catch (err) { fail("repeat expense")(err); }
  };
  const removeExpense = async (id) => {
    const item = expenses.find((e) => e.id === id);
    setExpenses((x) => x.filter((e) => e.id !== id));
    try { await db.delExpense(id); } catch (err) { if (item) setExpenses((x) => [item, ...x]); fail("delete expense")(err); }
  };
  const addPayment = async (p) => { try { const row = await db.addPayment(p); setPayments((x) => [...x, row]); } catch (err) { fail("add payment")(err); } };
  const removePayment = async (id) => {
    const item = payments.find((p) => p.id === id);
    setPayments((x) => x.filter((p) => p.id !== id));
    try { await db.delPayment(id); } catch (err) { if (item) setPayments((x) => [...x, item]); fail("delete payment")(err); }
  };
  const togglePaid = async (p) => {
    const prev = payments;
    try {
      if (p.status === "unpaid" && p.recurring && p.recurring !== "once") {
        const nd = fmt(nextPeriod(parse(p.dueDate), p.recurring === "weekly" ? "weekly" : "monthly"));
        setPayments((x) => x.map((y) => y.id === p.id ? { ...y, dueDate: nd } : y));
        await db.updatePayment(p.id, { due_date: nd });
      } else {
        const ns = p.status === "paid" ? "unpaid" : "paid";
        setPayments((x) => x.map((y) => y.id === p.id ? { ...y, status: ns } : y));
        await db.updatePayment(p.id, { status: ns });
      }
    } catch (err) { setPayments(prev); fail("update payment")(err); }
  };
  const addDebt = async (d) => { try { const row = await db.addDebt(d); setDebts((x) => [...x, row]); } catch (err) { fail("add IOU")(err); } };
  const removeDebt = async (id) => {
    const item = debts.find((d) => d.id === id);
    setDebts((x) => x.filter((d) => d.id !== id));
    try { await db.delDebt(id); } catch (err) { if (item) setDebts((x) => [...x, item]); fail("delete IOU")(err); }
  };
  const removeRecurring = async (id) => {
    const item = recurring.find((r) => r.id === id);
    setRecurring((r) => r.filter((x) => x.id !== id));
    try { await db.delRecurring(id); } catch (err) { if (item) setRecurring((r) => [...r, item]); fail("delete recurring")(err); }
  };
  const saveBudget = async (b) => { const prev = budgets; setBudgets(b); setShowSettings(false); try { await db.upsertBudget(b, userId); } catch (err) { setBudgets(prev); fail("save budget")(err); } };
  const loadSample = async () => {
    try { await db.seedSample(buildSample()); const d = await fetchAll(); setExpenses(d.expenses); setPayments(d.payments); setDebts(d.debts); setRecurring(d.recurring); if (d.budgets) setBudgets(d.budgets); }
    catch (err) { fail("load sample data")(err); }
  };
  const clearAll = async () => {
    setExpenses([]); setPayments([]); setDebts([]); setRecurring([]);
    try { await db.clearAll(); }
    catch (err) {
      fail("clear data")(err);
      // some tables may have cleared; reconcile UI with actual DB state
      try { const d = await fetchAll(); setExpenses(d.expenses); setPayments(d.payments); setDebts(d.debts); setRecurring(d.recurring); } catch { /* leave cleared */ }
    }
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setExpenses([]); setPayments([]); setDebts([]); setRecurring([]); setBudgets(DEFAULTS.budgets); setShowSettings(false);
  };

  /* greeting */
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "good morning" : hour < 18 ? "good afternoon" : "good evening";

  /* ---------- gates ---------- */
  if (!supabaseConfigured) return <Splash text="Supabase isn't configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart." />;
  if (!authReady) return <Splash />;
  if (!session) return <LoginScreen />;
  if (loading) return <Splash text="loading your data…" />;

  return (
    <div style={{ background: BG, color: T.ink, minHeight: "100vh", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", padding: "28px clamp(16px,4vw,40px)" }}>
      <GlobalStyle />

      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 26, maxWidth: 1180, marginInline: "auto", width: "100%" }}>
        <div>
          <Wordmark />
          <div className="serif" style={{ fontSize: 15, color: T.sub, fontStyle: "italic" }}>{greeting}</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 500, margin: "1px 0 0", letterSpacing: -0.4, color: T.ink }}>your week</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap" style={{ justifyContent: "flex-end" }}>
          <span className="serif" style={{ color: T.sub, fontSize: 14, fontStyle: "italic" }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
          <button style={ghost} onClick={() => exportPDF(expenses, budgets)} title="export a week-by-week PDF report"><Download size={15} /> export pdf</button>
          <button style={ghost} onClick={() => setShowSettings(true)}><Settings size={15} /> budget</button>
          <button style={ghost} onClick={signOut} title={session.user.email}><LogOut size={15} /> sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: 1180, marginInline: "auto" }}>
      {dataError && (
        <Card className="p-4" style={{ marginBottom: 16, borderColor: T.rose + "66", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: T.rose, fontSize: 13.5 }}><AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />{dataError}</span>
          <button style={ghost} onClick={() => setDataError("")}>dismiss</button>
        </Card>
      )}

      {/* first-run nudge */}
      {isEmpty && (
        <Card className="p-4" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div className="serif" style={{ color: T.sub, fontStyle: "italic", fontSize: 14.5 }}>nothing logged yet — want to see it filled in with a few weeks of sample data?</div>
          <button style={btn(T.blue)} onClick={loadSample}><Sparkles size={15} /> load sample data</button>
        </Card>
      )}

      {/* top stat strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", marginBottom: 16 }}>
        <Stat icon={<Wallet size={16} />} label="spent this week" value={money(spent)} tint={T.blue} onClick={() => setAnalytics("spent")}
          sub={lastWeekSpent > 0
            ? <span style={{ color: wowDelta > 0 ? T.rose : T.green }}>{wowDelta > 0 ? "▲" : "▼"} {money(Math.abs(wowDelta))} vs last week</span>
            : noBudget ? "no budget set yet" : `of ${money(budgets.weekly)} budget`} />
        <Stat icon={<Wallet size={16} />} label="remaining" value={noBudget ? "—" : money(remaining)} sub={noBudget ? "set one in ⚙ budget" : remaining < 0 ? "over budget" : "left to spend"} tint={noBudget ? T.sub : remaining < 0 ? T.rose : T.green} onClick={() => setAnalytics("remaining")} />
        <Stat icon={<CalendarClock size={16} />} label="unpaid bills" value={money(unpaidTotal)} sub={overdue.length ? `${overdue.length} overdue` : `${dueSoon.length} due within 7 days`} tint={overdue.length ? T.rose : T.amber} onClick={() => setAnalytics("bills")} />
        <Stat icon={<Users size={16} />} label="net owed" value={money(owedToMe - iOwe)} sub={iOwe > 0 ? `you owe ${money(iOwe)}` : "no one owes you"} tint={owedToMe - iOwe >= 0 ? T.green : T.rose} onClick={() => setAnalytics("owed")} />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))" }}>

        {/* ---- weekly budget + analytics ---- */}
        <Card className="p-5" style={{ gridColumn: "1 / -1" }}>
          <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 16 }}>
            <div className="flex items-center gap-2">
              <button className="ico-btn" style={ghost} onClick={() => setWeekRef(addDays(wkStart, -7))}><ChevronLeft size={15} /></button>
              <div className="serif" style={{ fontWeight: 500, fontSize: 19 }}>{isThisWeek ? "this week" : `week of ${wkStart.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`}</div>
              <button className="ico-btn" style={ghost} onClick={() => setWeekRef(addDays(wkStart, 7))} disabled={isThisWeek}><ChevronRight size={15} /></button>
              {!isThisWeek && <button style={{ ...ghost, color: T.blue, borderColor: "transparent" }} onClick={() => setWeekRef(weekStart(new Date()))}>today</button>}
            </div>
            <span className="num" style={{ fontSize: 12.5, fontWeight: 600, color: paceColor, background: paceColor + "22", borderRadius: 99, padding: "5px 12px" }}>{paceLabel}</span>
          </div>

          <div className="flex items-baseline gap-2" style={{ marginBottom: 8 }}>
            <span className="num" style={{ fontSize: 32, fontWeight: 600, color: T.ink }}>{money(spent)}</span>
            <span style={{ color: T.sub, fontSize: 14 }}>/ {money(budgets.weekly)}</span>
          </div>
          <Progress value={spent} max={budgets.weekly} color={T.blue} />

          <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 22 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 10, fontWeight: 500 }}>by day</div>
              <Chart height={150}>{(w) => (
                <BarChart width={w} height={150} data={byDay} margin={{ top: 4, right: 0, bottom: 0, left: -22 }}>
                  <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: T.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "rgba(56,69,74,.05)" }} contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, color: T.ink, fontSize: 13, boxShadow: "0 8px 24px -12px rgba(56,69,74,.3)" }} formatter={(v) => [money(v), "spent"]} />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                    {byDay.map((d, i) => <Cell key={i} fill={d.label === DOW[dayIdx] && isThisWeek ? T.blue : T.barIdle} />)}
                  </Bar>
                </BarChart>
              )}</Chart>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 10, fontWeight: 500 }}>by category</div>
              <div style={{ height: 150, position: "relative" }}>
                {spent > 0 ? (
                  <>
                    <Chart height={150}>{(w) => (
                      <PieChart width={w} height={150}>
                        <Pie data={byCat.filter((c) => c.value > 0)} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={3} stroke="none">
                          {byCat.filter((c) => c.value > 0).map((c, i) => <Cell key={i} fill={c.color} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, color: T.ink, fontSize: 13, boxShadow: "0 8px 24px -12px rgba(56,69,74,.3)" }} formatter={(v, n) => [money(v), n]} />
                      </PieChart>
                    )}</Chart>
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                      <div style={{ textAlign: "center" }}>
                        <div className="num" style={{ fontSize: 17, fontWeight: 600, color: T.ink }}>{money(spent)}</div>
                        <div style={{ fontSize: 10.5, color: T.faint, letterSpacing: .3 }}>spent</div>
                      </div>
                    </div>
                  </>
                ) : <div className="serif" style={{ height: "100%", display: "grid", placeItems: "center", color: T.faint, fontSize: 14, fontStyle: "italic" }}>nothing logged yet</div>}
              </div>
            </div>
          </div>

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

        {/* ---- trends ---- */}
        <Card className="p-5" style={{ gridColumn: "1 / -1" }}>
          <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 16 }}>
            <SectionTitle icon={<TrendingUp size={16} />} title="trends" noMargin />
            <div className="flex items-center gap-3">
              <span className="num" style={{ fontSize: 12.5, color: T.sub }}>avg {money(trendAvg)}</span>
              <Segmented options={[{ value: "weeks", label: "weeks" }, { value: "months", label: "months" }]} value={trendMode} onChange={setTrendMode} />
            </div>
          </div>
          <Chart height={170}>{(w) => (
            <BarChart width={w} height={170} data={trendData} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
              <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, trendMax]} tick={{ fill: T.sub, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "rgba(56,69,74,.05)" }} contentStyle={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 12, color: T.ink, fontSize: 13, boxShadow: "0 8px 24px -12px rgba(56,69,74,.3)" }} formatter={(v) => [money(v), "spent"]} />
              <ReferenceLine y={trendBudget} stroke={T.amber} strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {trendData.map((d, i) => <Cell key={i} fill={d.total > trendBudget ? T.rose : d.current ? T.blue : T.barIdle} />)}
              </Bar>
            </BarChart>
          )}</Chart>
          <div style={{ fontSize: 11.5, color: T.faint, marginTop: 6 }}>dashed line = {trendMode === "weeks" ? "weekly" : "monthly"} budget ({money(trendBudget)})</div>
        </Card>

        {/* ---- expenses ---- */}
        <Card className="p-5">
          <SectionTitle icon={<Wallet size={16} />} title="expenses" />
          <ExpenseAdder categories={budgets.categories} onAdd={addExpense} />

          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={14} color={T.faint} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
              <input style={{ ...inputStyle, paddingLeft: 32 }} placeholder="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select style={{ ...inputStyle, width: "auto" }} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="">all</option>
              {budgets.categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 14, maxHeight: 300, overflowY: "auto" }}>
            {wkExpenses.length === 0 && <Empty text="nothing logged this week yet" />}
            {wkExpenses.length > 0 && shownExpenses.length === 0 && <Empty text="no matches" />}
            {shownExpenses.map((e) => (
              <Row key={e.id} onDelete={() => removeExpense(e.id)} onRepeat={() => repeatExpense(e)}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 14 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 9, background: CAT_COLORS[budgets.categories.findIndex((c) => c.name === e.category) % CAT_COLORS.length] || T.sub, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.note || e.category}</span>
                    {e.recurringId && <Repeat size={11} color={T.faint} />}
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
          <PaymentAdder onAdd={addPayment} />
          <div style={{ marginTop: 14, maxHeight: 300, overflowY: "auto" }}>
            {payments.length === 0 && <Empty text="add rent, subscriptions, or one-off bills" />}
            {sortedPayments.map((p) => {
              const od = p.status === "unpaid" && parse(p.dueDate) < today0();
              const soon = p.status === "unpaid" && !od && parse(p.dueDate) <= addDays(today0(), 7);
              return (
                <Row key={p.id} onDelete={() => removePayment(p.id)}>
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
                    <button title={p.recurring && p.recurring !== "once" ? "mark paid · roll to next cycle" : p.status === "paid" ? "mark unpaid" : "mark paid"} style={{ ...ghost, padding: 7, color: p.status === "paid" ? T.green : T.sub }}
                      onClick={() => togglePaid(p)}><Check size={14} /></button>
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
          <DebtAdder onAdd={addDebt} />
          <div style={{ marginTop: 14, maxHeight: 280, overflowY: "auto" }}>
            {debts.length === 0 && <Empty text="track who you owe and who owes you" />}
            {debts.map((d) => (
              <Row key={d.id} onDelete={() => removeDebt(d.id)}>
                <div style={{ minWidth: 0 }}>
                  <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}>
                    {d.direction === "owe" ? <ArrowUpRight size={14} color={T.rose} /> : <ArrowDownRight size={14} color={T.green} />}
                    {d.person}
                  </div>
                  {d.note && <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>{d.note}</div>}
                </div>
                <span className="num" style={{ fontWeight: 600, color: d.direction === "owe" ? T.rose : T.green }}>{d.direction === "owe" ? "-" : "+"}{money(d.amount)}</span>
              </Row>
            ))}
          </div>
        </Card>
      </div>
      </div>

      {analytics && <AnalyticsModal kind={analytics} onClose={() => setAnalytics(null)}
        ctx={{ spent, remaining, budgets, noBudget, wkExpenses, byCat, weeklyTrend, payments, debts, iOwe, owedToMe, unpaidTotal, overdue }} />}

      {showSettings && <BudgetSettings budgets={budgets} recurring={recurring}
        onDeleteRecurring={removeRecurring}
        onClearAll={() => { clearAll(); setShowSettings(false); }}
        onSave={saveBudget} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/* ---------- subcomponents ---------- */
function Stat({ icon, label, value, sub, tint, onClick }) {
  return (
    <Card className="p-5" onClick={onClick} style={{ borderTop: `2.5px solid ${tint}`, cursor: onClick ? "pointer" : "default", position: "relative" }}>
      {onClick && <Maximize2 size={12} color={T.faint} style={{ position: "absolute", top: 13, right: 13 }} />}
      <div className="flex items-center gap-2" style={{ color: tint, fontSize: 12.5, fontWeight: 500 }}>{icon}{label}</div>
      <div className="num" style={{ fontSize: 25, fontWeight: 600, margin: "8px 0 3px", color: T.ink }}>{value}</div>
      <div style={{ fontSize: 12, color: T.sub }}>{sub}</div>
    </Card>
  );
}
function SectionTitle({ icon, title, noMargin }) {
  return <div className="flex items-center gap-2 serif" style={{ fontWeight: 500, fontSize: 18, marginBottom: noMargin ? 0 : 14 }}><span style={{ color: T.blue }}>{icon}</span>{title}</div>;
}
function Empty({ text }) { return <div className="serif" style={{ color: T.faint, fontSize: 14, fontStyle: "italic", padding: "16px 2px", textAlign: "center" }}>{text}</div>; }
function Mini({ label, value, tint }) {
  return <div style={{ flex: 1, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 12, padding: "9px 11px" }}>
    <div style={{ fontSize: 11, color: T.sub }}>{label}</div>
    <div className="num" style={{ fontSize: 15, fontWeight: 600, color: tint }}>{value}</div>
  </div>;
}
function Row({ children, onDelete, onRepeat }) {
  return (
    <div className="flex items-center justify-between gap-3 group" style={{ padding: "11px 2px", borderBottom: `1px solid ${T.line}` }}>
      <div className="flex items-center justify-between gap-3" style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <div className="flex items-center gap-1">
        {onRepeat && <button onClick={onRepeat} title="log again today" style={{ background: "transparent", border: "none", color: T.faint, cursor: "pointer", padding: 4 }}><Repeat size={14} /></button>}
        <button onClick={onDelete} title="remove" style={{ background: "transparent", border: "none", color: T.faint, cursor: "pointer", padding: 4 }}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

function ExpenseAdder({ categories, onAdd }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories[0]?.name || "Other");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(fmt(new Date()));
  const [cadence, setCadence] = useState("once");
  const add = () => {
    const a = parseFloat(amount);
    if (!a || a <= 0) return;
    onAdd({ amount: a, category, note: note.trim(), date }, cadence);
    setAmount(""); setNote(""); setCadence("once");
  };
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <input style={inputStyle} type="number" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
        {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      <input style={inputStyle} placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="flex items-center justify-between gap-2" style={{ gridColumn: "1 / -1" }}>
        <Segmented options={[{ value: "once", label: "once" }, { value: "weekly", label: "weekly" }, { value: "monthly", label: "monthly" }]} value={cadence} onChange={setCadence} />
        {cadence !== "once" && <span style={{ fontSize: 11.5, color: T.faint }}>auto-logs each {cadence.replace("ly", "")}</span>}
      </div>
      <button style={{ ...btn(T.blue), gridColumn: "1 / -1", justifyContent: "center" }} onClick={add}><Plus size={15} /> {cadence === "once" ? "log expense" : "log + set recurring"}</button>
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
    onAdd({ name: name.trim(), amount: a, dueDate, recurring, status: "unpaid" });
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
    onAdd({ person: person.trim(), amount: a, note: note.trim(), direction });
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

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(56,69,74,.28)", backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }} onClick={onClose}>
      <Card className="p-6" style={{ width: "min(560px,100%)", maxHeight: "86vh", overflowY: "auto" }}>
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
            <div className="serif" style={{ fontWeight: 500, fontSize: 20 }}>{title}</div>
            <button style={{ background: "transparent", border: "none", color: T.sub, cursor: "pointer" }} onClick={onClose}><X size={18} /></button>
          </div>
          {children}
        </div>
      </Card>
    </div>
  );
}

function AnalyticsModal({ kind, ctx, onClose }) {
  const { spent, remaining, budgets, noBudget, wkExpenses, byCat, weeklyTrend, payments, debts, iOwe, owedToMe, unpaidTotal, overdue } = ctx;
  const subhead = { fontSize: 12.5, color: T.sub, margin: "16px 0 8px", fontWeight: 500 };
  const rowS = { fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${T.line}` };

  if (kind === "spent") {
    const top = [...wkExpenses].sort((a, b) => b.amount - a.amount).slice(0, 6);
    const cats = byCat.filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
    return (
      <Modal title="spending analytics" onClose={onClose}>
        <div className="flex items-baseline gap-2" style={{ marginBottom: 14 }}>
          <span className="num" style={{ fontSize: 30, fontWeight: 600 }}>{money(spent)}</span>
          <span style={{ color: T.sub, fontSize: 13 }}>this week{!noBudget && ` · ${money(Math.abs(remaining))} ${remaining < 0 ? "over" : "left"}`}</span>
        </div>
        <div style={{ ...subhead, marginTop: 0 }}>last 8 weeks</div>
        <Chart height={150}>{(w) => (
          <BarChart width={w} height={150} data={weeklyTrend} margin={{ top: 4, right: 0, bottom: 0, left: -22 }}>
            <XAxis dataKey="label" tick={{ fill: T.sub, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.sub, fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => [money(v), "spent"]} contentStyle={{ borderRadius: 12, fontSize: 13, border: `1px solid ${T.line}` }} />
            <Bar dataKey="total" radius={[5, 5, 0, 0]}>{weeklyTrend.map((d, i) => <Cell key={i} fill={d.current ? T.blue : T.barIdle} />)}</Bar>
          </BarChart>
        )}</Chart>
        <div style={subhead}>by category (this week)</div>
        {cats.length === 0 ? <Empty text="nothing logged this week" /> : cats.map((c, i) => {
          const pct = spent > 0 ? Math.round((c.value / spent) * 100) : 0;
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div className="flex items-center justify-between" style={{ fontSize: 13, marginBottom: 4 }}>
                <span className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: 9, background: c.color }} />{c.name}</span>
                <span className="num" style={{ color: T.sub }}>{money(c.value)} · {pct}%</span>
              </div>
              <Progress value={c.value} max={spent || 1} color={c.color} />
            </div>
          );
        })}
        <div style={subhead}>biggest expenses this week</div>
        {top.length === 0 ? <Empty text="none" /> : top.map((e) => (
          <div key={e.id} className="flex items-center justify-between" style={rowS}>
            <span>{e.note || e.category} <span style={{ color: T.faint }}>· {e.category}</span></span>
            <span className="num" style={{ fontWeight: 600 }}>{money(e.amount)}</span>
          </div>
        ))}
      </Modal>
    );
  }

  if (kind === "remaining") {
    return (
      <Modal title="budget analytics" onClose={onClose}>
        {noBudget ? <Empty text="no budget set yet — set one with the ⚙ budget button" /> : (
          <>
            <div className="flex gap-2" style={{ marginBottom: 16 }}>
              <Mini label="weekly budget" value={money(budgets.weekly)} tint={T.ink} />
              <Mini label="spent" value={money(spent)} tint={T.blue} />
              <Mini label="remaining" value={money(remaining)} tint={remaining < 0 ? T.rose : T.green} />
            </div>
            <div style={{ ...subhead, marginTop: 0 }}>category limits (this week)</div>
            {byCat.map((c, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div className="flex items-center justify-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: 9, background: c.color }} />{c.name}</span>
                  <span className="num" style={{ color: c.limit && c.value > c.limit ? T.rose : T.sub }}>{money(c.value)}{c.limit ? ` / ${money(c.limit)}` : ""}</span>
                </div>
                <Progress value={c.value} max={c.limit || c.value || 1} color={c.color} />
              </div>
            ))}
          </>
        )}
      </Modal>
    );
  }

  if (kind === "bills") {
    const bills = projectUpcomingBills(payments, 90);
    const horizonTotal = bills.reduce((s, b) => s + b.amount, 0);
    let running = 0;
    return (
      <Modal title="upcoming bills" onClose={onClose}>
        <div className="flex gap-2" style={{ marginBottom: 14 }}>
          <Mini label="unpaid now" value={money(unpaidTotal)} tint={overdue.length ? T.rose : T.amber} />
          <Mini label="next 90 days" value={money(horizonTotal)} tint={T.ink} />
          <Mini label="bills" value={String(bills.length)} tint={T.sub} />
        </div>
        {bills.length === 0 ? <Empty text="no upcoming bills — add rent, subscriptions, etc. in “payments due”" /> : bills.map((b) => {
          running += b.amount;
          const d = parse(b.date);
          const days = Math.round((d - today0()) / 86400000);
          return (
            <div key={b.id} className="flex items-center justify-between" style={{ ...rowS, padding: "9px 0" }}>
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-1" style={{ fontWeight: 600 }}>{b.name}{b.recurring && <Repeat size={11} color={T.faint} />}</div>
                <div style={{ fontSize: 11.5, color: b.overdue ? T.rose : days <= 7 ? T.amber : T.sub }}>
                  {b.overdue ? "overdue · " : ""}{d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}{!b.overdue && days >= 0 ? ` · in ${days}d` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontWeight: 600 }}>{money(b.amount)}</div>
                <div className="num" style={{ fontSize: 11, color: T.faint }}>Σ {money(running)}</div>
              </div>
            </div>
          );
        })}
      </Modal>
    );
  }

  // owed
  const owe = debts.filter((d) => d.direction === "owe").sort((a, b) => b.amount - a.amount);
  const owed = debts.filter((d) => d.direction === "owed").sort((a, b) => b.amount - a.amount);
  return (
    <Modal title="debts & ious" onClose={onClose}>
      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        <Mini label="you owe" value={money(iOwe)} tint={T.rose} />
        <Mini label="owed to you" value={money(owedToMe)} tint={T.green} />
        <Mini label="net" value={money(owedToMe - iOwe)} tint={owedToMe - iOwe >= 0 ? T.green : T.rose} />
      </div>
      <div style={{ ...subhead, marginTop: 4 }}>you owe</div>
      {owe.length === 0 ? <Empty text="you owe no one" /> : owe.map((d) => (
        <div key={d.id} className="flex items-center justify-between" style={rowS}>
          <span>{d.person}{d.note && <span style={{ color: T.faint }}> · {d.note}</span>}</span>
          <span className="num" style={{ fontWeight: 600, color: T.rose }}>{money(d.amount)}</span>
        </div>
      ))}
      <div style={subhead}>owed to you</div>
      {owed.length === 0 ? <Empty text="no one owes you" /> : owed.map((d) => (
        <div key={d.id} className="flex items-center justify-between" style={rowS}>
          <span>{d.person}{d.note && <span style={{ color: T.faint }}> · {d.note}</span>}</span>
          <span className="num" style={{ fontWeight: 600, color: T.green }}>{money(d.amount)}</span>
        </div>
      ))}
    </Modal>
  );
}

function BudgetSettings({ budgets, recurring, onDeleteRecurring, onClearAll, onSave, onClose }) {
  const [weekly, setWeekly] = useState(budgets.weekly);
  const [cats, setCats] = useState(() => budgets.categories.map((c) => ({ ...c, _k: crypto.randomUUID() })));
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
              <div key={c._k} className="flex gap-2 items-center">
                <input style={{ ...inputStyle, flex: 2 }} value={c.name} onChange={(e) => setCats(cats.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input style={{ ...inputStyle, flex: 1 }} type="number" value={c.limit} onChange={(e) => setCats(cats.map((x, j) => j === i ? { ...x, limit: parseFloat(e.target.value) || 0 } : x))} />
                <button style={{ background: "transparent", border: "none", color: T.faint, cursor: "pointer" }} onClick={() => setCats(cats.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button style={{ ...ghost, marginTop: 12, width: "100%", justifyContent: "center" }} onClick={() => setCats([...cats, { name: "New", limit: 0, _k: crypto.randomUUID() }])}><Plus size={14} /> add category</button>

          {recurring && recurring.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="flex items-center gap-2" style={{ fontSize: 13, color: T.sub, marginBottom: 8 }}><Repeat size={14} /> recurring expenses</div>
              <div className="flex flex-col gap-2">
                {recurring.map((r) => (
                  <div key={r.id} className="flex items-center justify-between" style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 12, padding: "8px 11px" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.note || r.category}</div>
                      <div style={{ fontSize: 11.5, color: T.sub }}>{money(r.amount)} · {r.category} · {r.cadence}</div>
                    </div>
                    <button style={{ background: "transparent", border: "none", color: T.faint, cursor: "pointer" }} onClick={() => onDeleteRecurring(r.id)}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button style={{ ...btn(T.blue), marginTop: 18, width: "100%", justifyContent: "center" }} onClick={() => onSave({ weekly, categories: cats.filter((c) => c.name.trim()).map((c) => ({ name: c.name, limit: c.limit })) })}>save budget</button>
          {onClearAll && (
            <button style={{ ...ghost, marginTop: 10, width: "100%", justifyContent: "center", color: T.rose, borderColor: "#E8D6D0" }}
              onClick={() => { if (window.confirm("Clear all expenses, payments, debts, and recurring items? This can't be undone.")) onClearAll(); }}>
              <Trash2 size={14} /> clear all data
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
