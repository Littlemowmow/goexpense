# Life Ops · Command Center

A personal weekly-budget / bills / IOU dashboard. React + Vite, data stored in
your browser's `localStorage` (nothing leaves your Mac).

## Run it

**Easiest:** double-click `Life Dashboard.command` in Finder. It starts the
server and opens your browser. Leave the Terminal window open while you use it;
press `Ctrl+C` to quit.

**From the terminal:**

```bash
cd ~/Developer/life-dashboard
npm install      # first time only
npm run dev      # http://localhost:5173
```

## What it does

- **Weekly budget** with by-day bar chart, by-category donut, and pace tracking
  ("ahead of / under pace" based on what day it is).
- **Expenses** — log amount, category, note, date. Filtered to the selected week.
- **Payments due** — rent/subscriptions/one-offs, with overdue + due-soon flags
  and a paid/unpaid toggle.
- **Debts & IOUs** — who you owe and who owes you, with a running net.
- **Budget settings** (gear button) — set weekly budget and per-category limits.

Use the `‹ ›` arrows on the budget card to look back at previous weeks.

## Data

Everything persists in `localStorage` under keys prefixed `life-dashboard:`
(`expenses`, `budgets`, `payments`, `debts`). It survives restarts but is tied
to this browser profile on this Mac. Clearing browser site data wipes it.

## Build a static version

```bash
npm run build    # outputs to dist/
npm run preview  # serve the built version locally
```
