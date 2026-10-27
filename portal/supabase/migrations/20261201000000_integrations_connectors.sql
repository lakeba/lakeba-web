-- Integrations, part 2: HubSpot and Xero connections, and the IDs other
-- systems use for portal records.
--
-- A company connects its own HubSpot account or Xero organisation with
-- "Connect" (OAuth); the tokens are stored encrypted. The portal then keeps
-- that tool up to date (and, where the company allows it, takes contact
-- details back). Shares, holders and the register never come from these tools.
-- Read and written by the portal server only.

create table public.external_links (
  entity_id uuid not null references public.entities (id) on delete cascade,
  local_type text not null check (local_type in ('holder', 'person')),
  local_id uuid not null,
  system text not null check (system ~ '^[a-z0-9_.-]{2,40}$'),
  external_id text not null,
  -- What was last sent, so unchanged records aren't sent again.
  synced_hash text,
  synced_at timestamptz,
  primary key (entity_id, local_type, local_id, system)
);
create index external_links_lookup_idx on public.external_links (entity_id, system, external_id);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  provider text not null check (provider in ('hubspot', 'xero')),
  status text not null default 'connecting' check (status in ('connecting', 'connected', 'paused', 'error', 'disconnected')),
  account_id text,
  account_name text,
  tokens_enc text,
  token_expires_at timestamptz,
  -- Choices made on the page: what flows which way, accounts to use…
  settings jsonb not null default '{}'::jsonb,
  -- Where each sync got to.
  cursor jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  -- The OAuth state while connecting (one use).
  state_hash text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  unique (entity_id, provider)
);

-- "Needs a look": what a sync couldn't decide by itself.
create table public.connection_issues (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections (id) on delete cascade,
  kind text not null,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  dedupe text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (connection_id, dedupe)
);

-- Dividends or distributions prepared in Xero (as draft bills, one per holder).
create table public.dividend_runs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  share_class_id uuid not null references public.share_classes (id) on delete cascade,
  record_date date not null,
  per_share numeric(14, 6) not null check (per_share > 0),
  account_code text not null,
  description text not null,
  status text not null default 'preparing' check (status in ('preparing', 'done', 'failed')),
  holders integer not null default 0,
  total numeric(16, 2) not null default 0,
  results jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.external_links enable row level security;
alter table public.connections enable row level security;
alter table public.connection_issues enable row level security;
alter table public.dividend_runs enable row level security;
revoke all on public.external_links, public.connections, public.connection_issues, public.dividend_runs from anon, authenticated;
