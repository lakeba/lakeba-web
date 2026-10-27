-- Integrations, part 4: apps (OAuth 2). An app that works with many companies
-- (a Zapier app, a CRM's marketplace app) is registered once by Lakeba; a
-- company's Admin then allows it for their company on a consent page, choosing
-- what it may do. The app gets an access token (an hour) and a refresh token
-- (60 days, replaced each time it's used), kept as hashes in api_keys (kind
-- 'oauth'). Only for companies, never for individual investors.
-- Read and written by the portal server only.

create table public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  name text not null check (length(name) between 2 and 80),
  description text not null default '',
  website text,
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  secret_hash text not null,
  -- The most it may ever ask for.
  scopes_allowed text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id uuid not null references public.oauth_clients (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scopes text[] not null,
  redirect_uri text not null,
  code_challenge text,
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.api_keys add constraint api_keys_client_fk foreign key (client_id) references public.oauth_clients (id) on delete cascade;

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
revoke all on public.oauth_clients, public.oauth_codes from anon, authenticated;
