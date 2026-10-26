-- Ventures, phase 5: a venture's own domain, and its own Microsoft 365.
--
-- Own domain: investors.mist.com is used once its DNS points to the portal
-- (custom_domain_verified_at). Sign-in still happens on investors.lakeba.com;
-- a one-time pass (sign_in_passes) carries the session to the venture's
-- domain, where cookies can't be shared: single use, for one address, valid
-- for two minutes, and only a hash of it is kept.
--
-- Microsoft 365: once the venture's administrator approves the portal's app in
-- their own Microsoft 365 (ms_tenant_id), the portal reads its shareholder
-- mailbox there and sends its emails from its own address (mail_from, after a
-- test email went through).

alter table public.entities
  add column custom_domain_verified_at timestamptz,
  add column ms_tenant_id text check (ms_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  add column mail_from text check (mail_from ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column mail_from_verified_at timestamptz;

create table public.sign_in_passes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  target_origin text not null,
  strong boolean not null default false,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sign_in_passes enable row level security;

-- Approvals asked of a venture's Microsoft 365 administrator (the "state" they come back with).
create table public.ms_consent_requests (
  state_hash text primary key,
  entity_id uuid not null references public.entities (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.ms_consent_requests enable row level security;
