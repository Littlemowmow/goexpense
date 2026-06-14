/* GOexpense — printable PDF report.
   Builds a self-contained HTML report (week-by-week tables + inline SVG charts)
   and opens it in a new tab with the print dialog, so the user can "Save as PDF".
   No runtime deps — the browser's own print engine renders the visuals. */

const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISO = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
const weekStart = (d) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const C = { ink: "#38454A", sub: "#7A8990", faint: "#A9B6BA", line: "#DEE7E8", teal: "#7FA6A3", clay: "#C28B7E", gold: "#CBA36A", idle: "#CBDADC" };

/* tiny inline SVG bar chart */
function svgBars(items, { width = 540, height = 150, color = C.teal, budget = 0 } = {}) {
  const max = Math.max(1, budget, ...items.map((i) => i.value));
  const padL = 8, base = height - 22, top = 12;
  const bw = (width - padL) / items.length;
  const bars = items.map((it, i) => {
    const h = (it.value / max) * (base - top);
    const x = padL + i * bw, y = base - h;
    return `<rect x="${(x + 4).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" fill="${it.over ? C.clay : color}"/>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 6}" font-size="9" fill="${C.sub}" text-anchor="middle">${esc(it.label)}</text>`;
  }).join("");
  const by = base - (budget / max) * (base - top);
  const budLine = budget ? `<line x1="${padL}" x2="${width}" y1="${by.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${C.gold}" stroke-width="1.2" stroke-dasharray="4 4"/>` : "";
  return `<svg width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${budLine}${bars}</svg>`;
}

export function buildReportHTML(expenses, budgets) {
  const weekly = budgets?.weekly || 0;
  const cats = budgets?.categories || [];
  // group by week-start ISO
  const byWeek = {};
  for (const e of expenses) {
    const k = isoDate(weekStart(parseISO(e.date)));
    (byWeek[k] ||= []).push(e);
  }
  const weekKeys = Object.keys(byWeek).sort().reverse(); // newest first
  const grand = expenses.reduce((s, e) => s + e.amount, 0);

  // overall weekly-trend chart (chronological, last 10 weeks that exist)
  const trendKeys = [...weekKeys].sort().slice(-10);
  const trendItems = trendKeys.map((k) => {
    const t = byWeek[k].reduce((s, e) => s + e.amount, 0);
    const d = parseISO(k);
    return { label: `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, value: t, over: t > weekly };
  });

  const weekSections = weekKeys.map((k) => {
    const rows = byWeek[k].slice().sort((a, b) => a.date.localeCompare(b.date));
    const total = rows.reduce((s, e) => s + e.amount, 0);
    const ws = parseISO(k), we = addDays(ws, 6);
    const title = `${ws.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${we.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    const over = weekly && total > weekly;
    // by-category bar for this week
    const catMap = {};
    rows.forEach((e) => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
    const catItems = cats.map((c) => ({ label: c.name, value: catMap[c.name] || 0, over: c.limit && (catMap[c.name] || 0) > c.limit }))
      .filter((c) => c.value > 0);
    const extra = Object.keys(catMap).filter((n) => !cats.some((c) => c.name === n)).map((n) => ({ label: n, value: catMap[n], over: false }));
    const allCats = [...catItems, ...extra];
    const rowsHTML = rows.map((e) => `<tr>
      <td>${parseISO(e.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
      <td>${esc(e.category)}</td>
      <td>${esc(e.note || "—")}</td>
      <td class="amt">${money(e.amount)}</td></tr>`).join("");
    return `<section class="week">
      <div class="wk-head">
        <h2>Week of ${esc(title)}</h2>
        <span class="badge ${over ? "over" : "ok"}">${money(total)}${weekly ? ` / ${money(weekly)}` : ""}${over ? " · over" : ""}</span>
      </div>
      ${allCats.length ? `<div class="chart">${svgBars(allCats, { height: 130 })}</div>` : ""}
      <table>
        <thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="amt">Amount</th></tr></thead>
        <tbody>${rowsHTML}</tbody>
        <tfoot><tr><td colspan="3">Week total</td><td class="amt">${money(total)}</td></tr></tfoot>
      </table>
    </section>`;
  }).join("");

  const now = new Date();
  return `<!doctype html><html><head><meta charset="utf-8"><title>GOexpense — Expense Report</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: ${C.ink}; margin: 0; }
  .serif { font-family: 'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif; }
  h1 { font-size: 26px; font-weight: 600; margin: 0; letter-spacing: -.4px; }
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  header.brand { display:flex; align-items:baseline; justify-content:space-between; border-bottom: 2px solid ${C.ink}; padding-bottom: 10px; margin-bottom: 16px; }
  .wordmark { font-weight: 800; letter-spacing: .5px; font-size: 13px; color: ${C.teal}; }
  .meta { color: ${C.sub}; font-size: 12px; }
  .summary { display:flex; gap: 22px; margin: 4px 0 22px; }
  .summary .k { font-size: 11px; color: ${C.sub}; text-transform: uppercase; letter-spacing: .4px; }
  .summary .v { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .trend { margin-bottom: 8px; }
  .legend { font-size: 11px; color: ${C.faint}; margin-bottom: 20px; }
  section.week { margin-bottom: 22px; page-break-inside: avoid; }
  .wk-head { display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; }
  .badge { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; padding: 4px 11px; border-radius: 99px; background: ${C.teal}22; color: ${C.teal}; }
  .badge.over { background: ${C.clay}22; color: ${C.clay}; }
  .chart { border: 1px solid ${C.line}; border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: ${C.sub}; font-weight: 600; border-bottom: 1.5px solid ${C.line}; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
  td { padding: 6px 8px; border-bottom: 1px solid ${C.line}; }
  .amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 1.5px solid ${C.line}; border-bottom: none; }
  .empty { color: ${C.faint}; font-style: italic; padding: 40px 0; text-align:center; }
  @media print { .noprint { display: none; } }
</style></head><body>
  <header class="brand">
    <div><span class="wordmark">GOexpense</span><h1 class="serif">Expense Report</h1></div>
    <div class="meta">${weekKeys.length} week${weekKeys.length === 1 ? "" : "s"} · generated ${now.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
  </header>
  <div class="summary">
    <div><div class="k">Total spent</div><div class="v">${money(grand)}</div></div>
    <div><div class="k">Weekly budget</div><div class="v">${money(weekly)}</div></div>
    <div><div class="k">Weeks tracked</div><div class="v">${weekKeys.length}</div></div>
  </div>
  ${trendItems.length ? `<div class="trend">${svgBars(trendItems, { height: 160, budget: weekly })}</div><div class="legend">Weekly spend · dashed line = weekly budget (${money(weekly)})</div>` : ""}
  ${weekSections || `<div class="empty">No expenses to report yet.</div>`}
</body></html>`;
}

export function exportPDF(expenses, budgets) {
  const html = buildReportHTML(expenses, budgets);
  // Hidden iframe + srcdoc: no popups, no document.write. Printing the iframe
  // prints only the report; the browser's "Save as PDF" target handles the rest.
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", left: "-9999px", top: "0", width: "800px", height: "1131px", border: "0" });
  iframe.setAttribute("aria-hidden", "true");
  iframe.srcdoc = html;
  iframe.onload = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch { /* user can still print */ }
    setTimeout(() => iframe.remove(), 1500);
  };
  document.body.appendChild(iframe);
}
