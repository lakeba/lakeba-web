-- Ventures, phase 4: where public news appears, and keys for the news API.
--
-- A public post can appear on its company's own website (through the news API,
-- the website component and RSS) and on lakeba.com. Posts so far stay where
-- they were (both on). A non-controlling venture's new posts stay off
-- lakeba.com unless a Lakeba group editor switches it on.
--
-- News API keys: a secret key is for a website's server; a publishable key is
-- for the component in a web page and only works from the addresses listed
-- with it. Only a hash of each key is kept.

alter table public.posts
  add column on_lakeba_site boolean not null default true,
  add column on_venture_site boolean not null default true;

create table public.news_api_keys (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('secret', 'publishable')),
  key_hash text not null unique,
  prefix text not null,
  allowed_origins text[] not null default '{}',
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index news_api_keys_entity_idx on public.news_api_keys (entity_id);
-- Read and written only by the portal's server (no policies: the service key only).
alter table public.news_api_keys enable row level security;
