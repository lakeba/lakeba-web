-- Browser (Web Push) notifications next to the Inbox and email.
--   push_subscriptions        one row per person and device that turned notifications on
--   notification_preferences  per person and category: email / push on or off (no row = the default)
--   notification_outbox       pushes waiting to be sent by the portal's worker (retries, cleanup)
--   notification_jobs         scheduled jobs already run (proxy reminders, daily vote summary)
--   admin_devices             devices an admin account has signed in from (new-device alerts)
--   profiles.first_signed_in_at  for "investor signed in for the first time" alerts

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push_subscriptions: own or admin read" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "push_subscriptions: own delete" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;
-- Subscribing goes through the portal's server, which checks the push service address.
revoke insert, update on public.push_subscriptions from authenticated;

create table public.notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category ~ '^[a-z_]{2,40}$'),
  email boolean not null,
  push boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);
alter table public.notification_preferences enable row level security;
create policy "notification_preferences: own" on public.notification_preferences
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notification_preferences from anon;

-- People who had turned email off keep it off for every investor category.
insert into public.notification_preferences (user_id, category, email, push)
select p.id, c.category, false, true
from public.profiles p
cross join (values ('documents'), ('meetings'), ('news'), ('replies'), ('holdings')) as c(category)
where p.notify_email = false
on conflict do nothing;

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index notification_outbox_pending on public.notification_outbox (next_attempt_at) where sent_at is null and failed_at is null;
create index notification_outbox_created on public.notification_outbox (created_at desc);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

create table public.notification_jobs (
  key text primary key,
  ran_at timestamptz not null default now()
);
alter table public.notification_jobs enable row level security;
revoke all on public.notification_jobs from anon, authenticated;

create table public.admin_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device)
);
alter table public.admin_devices enable row level security;
revoke all on public.admin_devices from anon, authenticated;

alter table public.profiles add column first_signed_in_at timestamptz;
-- Everyone who has signed in before is not "new".
update public.profiles p set first_signed_in_at = u.last_sign_in_at
from auth.users u where u.id = p.id and u.last_sign_in_at is not null;
