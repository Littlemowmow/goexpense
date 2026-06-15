# Goals — "Saving for" (planned future expenses)

**Date:** 2026-06-15
**Status:** Approved, in implementation

## Problem

Students need to plan and save toward known future expenses — e.g. *"fall
semester is a $200 camp."* GOexpense tracks money already spent and bills due,
but has no way to set aside / track progress toward a future goal. The data
layer already has a `goals` placeholder (`localFetchAll` returns
`goals: lget("goals", [])`) and a `0002_goals.sql` migration stub, but no CRUD,
no cloud fetch, and no UI. This feature builds it.

## Decisions (locked with the user)

1. **Savings goal with progress** — named target + optional date, log
   contributions, show a progress bar and a pace nudge ("save $X/wk").
2. **Reminder flag on due date** — past the target date with money still owed,
   the card flips to a "DUE" style. No payment/expense is auto-created.
3. **Standalone** — does NOT feed the weekly budget or 90-day bills projection.
   Zero risk to existing money math.

## Data model

New `goals` entity (replaces the abandoned stub):

```js
Goal {
  id,                 // uuid
  name,               // "Fall camp"
  target,             // 200
  dueDate,            // optional ISO date — "save up by"
  note,               // optional
  contributions: [    // the savings log
    { id, amount, date }
  ],
  createdAt
}
```

`saved` is **derived** as `sum(contributions)` (never stored separately → no
drift). Derived per goal:

- `saved`, `remaining = max(0, target − saved)`, `pct = min(100, saved/target)`
- `weeksLeft = ceil((dueDate − today)/7)` when a date is set
- `perWeek = remaining / weeksLeft` → "save $X/wk to stay on pace"
- past `dueDate` with `remaining > 0` → **DUE** styling (reminder only)
- `saved ≥ target` → "✓ funded" (+ "$X extra" if over)

## Data layer (`src/db.js`)

Add to **both** `localDb` and `cloudDb`, gated by the existing
`supabaseConfigured` switch:

- `addGoal({ name, target, dueDate, note })`
- `updateGoal(id, patch)`
- `delGoal(id)`
- `addContribution(id, { amount, date })` — append to the goal's contributions
- `delContribution(goalId, contribId)` — undo a contribution

Also: include `goals` in `cloudFetchAll`, `seedSample`, and `clearAll`.

**Cloud schema** (`supabase/migrations/0002_goals.sql`, updated): a single
`goals` table with a `contributions jsonb not null default '[]'` column (no
second table). RLS `own goals` policy like every other table. The app is
local-first by default, so this SQL only matters for optional cloud mode.

## UI (`src/App.jsx`) — mirrors existing entity conventions

- **"Saving for" summary card** in the top tap-through cards row: shows total
  saved / total target across goals. Tapping opens the Goals detail view.
- **Goals detail view** (same modal pattern as upcoming bills / debts): each
  goal renders name, progress bar, `$saved / $target`, pace line, an inline
  **"+ add money"** amount input, the contribution history with per-item undo,
  and ✎ edit / 🗑 delete (matching the app's "edit anything" ethos).
- **Add-goal form**: name, target amount, optional target date, optional note.
- **Empty state**: "add your first thing to save for."

## Edge cases

- No target date → progress only; no pace line, no DUE flag.
- Overfunded → 100% bar + "✓ funded, $X extra".
- Contributions deletable to fix mistakes.
- Convenience defaults for students: contribution date defaults to today;
  target date optional; amounts accept plain numbers.

## Testing

- `npm run lint` clean.
- Manual browser verify: add a goal, add money (bar advances + pace updates),
  undo a contribution, fund past target (✓ funded), set a past due date (DUE).
- No automated test suite exists in this repo today.

## Out of scope (YAGNI)

- No budget/bills integration. No auto-conversion to expense/payment. No
  recurring goals. No PDF-report inclusion.
