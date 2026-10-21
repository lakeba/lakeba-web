-- Ask Lakeba cost protection: accounts whose Ask access is paused, either
-- automatically (daily limit hit two days in a row) or by an admin.
-- Limits and the daily budget live in ask_settings (key 'limits').

create table public.ask_user_pauses (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text not null,
  paused_by uuid references public.profiles (id) on delete set null, -- null: automatic
  paused_at timestamptz not null default now()
);

alter table public.ask_user_pauses enable row level security;
create policy "ask_user_pauses: admin" on public.ask_user_pauses
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.ask_user_pauses from anon;

create index ask_exchanges_user_time_idx on public.ask_exchanges (user_id, created_at desc);
create index ask_exchanges_time_idx on public.ask_exchanges (created_at desc);
