-- Ask Lakeba (Phase C): a test set re-run after changes to documents,
-- house rules, approved answers, prompt or model. Admin-only.
-- Test cases never store who originally asked.

create table public.ask_test_cases (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(question) between 3 and 1000),
  expected_answer text check (length(expected_answer) <= 8000),
  must_include text[] not null default '{}',
  must_not_include text[] not null default '{}',
  expect_decline boolean not null default false,
  notes text,
  active boolean not null default true,
  source_exchange_id uuid references public.ask_exchanges (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.ask_test_run_status as enum ('running', 'done', 'failed');

create table public.ask_test_runs (
  id uuid primary key default gen_random_uuid(),
  status public.ask_test_run_status not null default 'running',
  label text,
  model text not null,
  total int not null,
  passed int not null default 0,
  failed int not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.ask_test_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ask_test_runs (id) on delete cascade,
  case_id uuid references public.ask_test_cases (id) on delete set null,
  question text not null,
  answer text not null default '',
  passed boolean not null,
  score smallint,
  checks jsonb not null default '[]'::jsonb,
  grader_reason text,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index ask_test_results_run_idx on public.ask_test_results (run_id);

alter table public.ask_test_cases enable row level security;
alter table public.ask_test_runs enable row level security;
alter table public.ask_test_results enable row level security;

create policy "ask_test_cases: admin" on public.ask_test_cases
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "ask_test_runs: admin" on public.ask_test_runs
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "ask_test_results: admin read" on public.ask_test_results
  for select to authenticated using ((select public.is_admin()));

revoke all on public.ask_test_cases, public.ask_test_runs, public.ask_test_results from anon;
