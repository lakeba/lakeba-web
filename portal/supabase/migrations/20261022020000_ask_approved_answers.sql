-- Ask Lakeba (Phase B): approved answers and house rules.
-- Approved answers are reviewed by Lakeba and go into the knowledge base
-- until their review-by date; house rules are added to Ask's instructions.
-- Both are admin-only; the server reads them with the service key.

create table public.ask_approved_answers (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(question) between 3 and 1000),
  answer text not null check (length(answer) between 1 and 8000),
  review_by date not null default (current_date + interval '6 months')::date,
  active boolean not null default true,
  source_exchange_id uuid references public.ask_exchanges (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ask_approved_answers_live_idx on public.ask_approved_answers (active, review_by);

create table public.ask_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.ask_approved_answers enable row level security;
alter table public.ask_settings enable row level security;

create policy "ask_approved_answers: admin" on public.ask_approved_answers
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "ask_settings: admin" on public.ask_settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.ask_approved_answers, public.ask_settings from anon;
