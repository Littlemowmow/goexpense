-- Life Ops · Command Center — initial schema
-- Run this in the Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → paste all of this → Run
-- Safe to re-run (drops + recreates policies; tables use IF NOT EXISTS).

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- TABLES (one budgets row per user; the rest are per-item)
-- user_id defaults to the logged-in user, so the client never sends it.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.budgets (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  weekly numeric not null default 260,
  categories jsonb not null default '[
    {"name":"Food","limit":70},
    {"name":"Groceries","limit":55},
    {"name":"Transport","limit":30},
    {"name":"Subscriptions","limit":25},
    {"name":"Fun","limit":45},
    {"name":"Other","limit":35}
  ]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric not null,
  category text not null,
  note text not null default '',
  spent_on date not null,
  recurring_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists expenses_user_idx on public.expenses(user_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  amount numeric not null,
  due_date date not null,
  recurring text not null default 'monthly',
  status text not null default 'unpaid',
  created_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments(user_id);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person text not null,
  amount numeric not null,
  note text not null default '',
  direction text not null,
  created_at timestamptz not null default now()
);
create index if not exists debts_user_idx on public.debts(user_id);

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric not null,
  category text not null,
  note text not null default '',
  cadence text not null,
  last_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists recurring_user_idx on public.recurring_expenses(user_id);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — every account sees only its own rows
-- ─────────────────────────────────────────────────────────────

alter table public.budgets            enable row level security;
alter table public.expenses           enable row level security;
alter table public.payments           enable row level security;
alter table public.debts              enable row level security;
alter table public.recurring_expenses enable row level security;

drop policy if exists "own budgets"   on public.budgets;
drop policy if exists "own expenses"  on public.expenses;
drop policy if exists "own payments"  on public.payments;
drop policy if exists "own debts"     on public.debts;
drop policy if exists "own recurring" on public.recurring_expenses;

create policy "own budgets"   on public.budgets            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own expenses"  on public.expenses           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own payments"  on public.payments           for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own debts"     on public.debts              for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own recurring" on public.recurring_expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
