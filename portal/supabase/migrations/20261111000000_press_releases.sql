-- Press releases, prepared by the marketing team (the press team) and approved
-- by group admins, then published on the newsroom (as a public post) with a
-- press kit, PDF and media contact. Quotes are approved by the people quoted,
-- through a link. Distribution to media comes later and builds on these.

-- People who may write press releases without being admins.
create table public.press_team (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);

create table public.press_releases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'changes_requested', 'approved', 'published', 'withdrawn')),
  head_points text not null default '',
  headline text not null default '',
  headline_options text[] not null default '{}',
  subheadline text not null default '',
  dateline_city text not null default 'SYDNEY',
  body_html text not null default '',
  quotes jsonb not null default '[]',
  summary text not null default '',
  social jsonb not null default '{}',
  checks jsonb not null default '[]',
  checks_at timestamptz,
  cover_url text,
  kit jsonb not null default '[]',
  -- Not before this time; publication is automatic at publish_at once approved.
  embargo_until timestamptz,
  publish_at timestamptz,
  post_id uuid references public.posts (id) on delete set null,
  review_note text not null default '',
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index press_releases_status_idx on public.press_releases (status, updated_at desc);

create table public.press_release_versions (
  id bigint generated always as identity primary key,
  release_id uuid not null references public.press_releases (id) on delete cascade,
  snapshot jsonb not null,
  reason text not null default 'save',
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null default now()
);
create index press_release_versions_idx on public.press_release_versions (release_id, saved_at desc);

-- A quoted person approves (or edits) their quote through a link sent by email.
create table public.press_quote_approvals (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.press_releases (id) on delete cascade,
  quote_key text not null,
  name text not null,
  email text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changed', 'cancelled')),
  original text not null,
  final text,
  comment text not null default '',
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default now() + interval '21 days'
);
create index press_quote_approvals_release_idx on public.press_quote_approvals (release_id);

-- News posts made from a press release.
alter table public.posts add column press_release_id uuid references public.press_releases (id) on delete set null;

-- The press office's boilerplate and media contact (one set for the group and the ventures).
insert into public.portal_settings (key, value) values ('press', jsonb_build_object(
  'boilerplate_html', '<p>Lakeba Group is a technology investment and venture-building company headquartered in Sydney, Australia, with operations in India, Indonesia, Italy, the United Kingdom and the United States. Lakeba builds and invests in businesses in fintech, proptech, artificial intelligence and digital services.</p>',
  'about_title', 'About Lakeba Group',
  'contact_name', 'Lakeba Media Relations',
  'contact_email', 'press@lakeba.com',
  'contact_phone', '',
  'dateline_city', 'SYDNEY'
)) on conflict (key) do nothing;

alter table public.press_team enable row level security;
alter table public.press_releases enable row level security;
alter table public.press_release_versions enable row level security;
alter table public.press_quote_approvals enable row level security;
revoke all on public.press_team, public.press_releases, public.press_release_versions, public.press_quote_approvals from anon, authenticated;
