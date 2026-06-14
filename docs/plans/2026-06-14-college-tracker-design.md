# College student expense tracker — design (2026-06-14)

Approved by user. Keep the coastal-mist look. Currency: USD ($).

## Core model: monthly, navigable
Selected month with `◀ Month YYYY ▶` arrows; any month viewable/editable.

Per month M:
```
income(M)   = job + family monthly-equiv + aid share(M) + one-offs in M
fixed(M)    = recurring bills monthly-equiv + one-off bills in M
free(M)     = income(M) − fixed(M)        # budget is what's left after rent
spent(M)    = sum of discretionary expenses in M
left(M)     = free(M) − spent(M)
safe/day    = left(M) / days remaining in M   (whole month if not current)
safe/week   = safe/day × 7                     # headline
pace        = spent − free×(dayOfMonth/daysInMonth)
```

## Income types
- **job**: amount + cadence (weekly|biweekly|monthly) + anchor date (paydays on calendar). monthly-equiv: weekly×52/12, biweekly×26/12, monthly×1.
- **aid**: lump amount spread over N months from a start date → amount/N per month within window; calendar marks disbursement date.
- **family**: recurring weekly|monthly (+ day).
- **oneoff**: single amount on a date.

## Bills (fixed) types
- name, amount, dueDay(1-31), cadence (monthly|weekly|once), category?, paidMonths[].
- monthly-equiv: monthly×1, weekly×52/12, once only in its month.
- Carved out of free(M) AND flagged on calendar / due.
- Paid toggle is per selected month (paidMonths holds "YYYY-MM").

## Views (top toggle)
**Dashboard** (monthly):
- Stats: safe-to-spend/week · money in · rent+fixed · left this month
- Big "this month" card: spent/free + progress, by-week bars, by-category donut, per-category monthly limits
- Cards: Income · Fixed costs & bills · Expenses · Debts & IOUs

**Calendar** (month grid):
- Day cells shaded by spend (heatmap), 🏠 bill + 💰 income markers
- Click day → detail panel (that day's items) + quick-add expense for that date
- Shared month nav with dashboard

## Data (localStorage, prefix `life-dashboard:`)
- new: `income[]`, `bills[]`
- keep: `expenses[]`, `debts[]`, `budgets{categories:[{name,limit/*monthly*/}]}`
- old `budgets.weekly` + `payments` migrated away (no real user data yet)

## Verify after build
Add job income + rent bill + an expense → check free/left/safe math; toggle to Calendar → markers + heatmap render; click a day → panel + quick-add works; month nav changes all numbers.
