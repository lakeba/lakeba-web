-- Media outreach (press office, phase 2): the media database (outlets and
-- journalists, imported or researched with their sources), permanent
-- opt-outs, and distributions of a press release to journalists: one
-- personal pitch email each, with a private preview link (for embargoes),
-- open, click and preview tracking, and one-click unsubscribe.

create table public.media_outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'online' check (kind in ('newspaper', 'magazine', 'online', 'tv', 'radio', 'newsletter', 'podcast', 'trade', 'wire', 'other')),
  country text not null default 'AU',
  region text not null default '',
  website text not null default '',
  tipline_email text not null default '',
  beats text[] not null default '{}',
  reach text not null default '' check (reach in ('', 'national', 'metro', 'regional', 'trade', 'niche', 'international')),
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index media_outlets_name_idx on public.media_outlets (lower(name));

create table public.media_contacts (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.media_outlets (id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  email text,
  role text not null default 'journalist' check (role in ('journalist', 'editor', 'producer', 'newsdesk', 'freelancer', 'columnist', 'blogger', 'analyst', 'podcaster', 'other')),
  title text not null default '',
  beats text[] not null default '{}',
  regions text[] not null default '{}',
  phone text not null default '',
  social_url text not null default '',
  notes text not null default '',
  recent_work text not null default '',
  -- Where the contact came from, and why we may email them (Spam Act 2003).
  source text not null default 'manual' check (source in ('manual', 'import', 'research')),
  source_url text not null default '',
  consent_basis text not null default 'published_work_address' check (consent_basis in ('published_work_address', 'requested', 'relationship')),
  status text not null default 'active' check (status in ('active', 'opted_out', 'bounced', 'do_not_contact')),
  tags text[] not null default '{}',
  last_pitched_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index media_contacts_email_idx on public.media_contacts (lower(email)) where email is not null;
create index media_contacts_outlet_idx on public.media_contacts (outlet_id);

-- Opt-outs are kept by address, even if the contact is deleted or imported again.
create table public.media_optouts (
  email text primary key,
  reason text not null default 'unsubscribed',
  created_at timestamptz not null default now()
);

-- AI research of journalists: run in the background; candidates are approved by a person before being added.
create table public.media_research_runs (
  id uuid primary key default gen_random_uuid(),
  brief jsonb not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  candidates jsonb not null default '[]',
  note text not null default '',
  searches integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.press_distributions (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.press_releases (id) on delete cascade,
  follow_up_of uuid references public.press_distributions (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'preparing', 'ready', 'sending', 'sent', 'cancelled')),
  filters jsonb not null default '{}',
  subject text not null default '',
  intro text not null default '',
  availability text not null default '',
  personalise boolean not null default true,
  note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index press_distributions_release_idx on public.press_distributions (release_id, created_at desc);

create table public.press_pitches (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.press_distributions (id) on delete cascade,
  contact_id uuid references public.media_contacts (id) on delete set null,
  email text not null,
  name text not null default '',
  outlet text not null default '',
  intro text not null default '',
  token_hash text not null unique,
  subject text not null default '',
  html text not null default '',
  text_body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  clicked_at timestamptz,
  click_count integer not null default 0,
  previewed_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  unsubscribed_at timestamptz
);
create index press_pitches_distribution_idx on public.press_pitches (distribution_id);
create index press_pitches_queue_idx on public.press_pitches (status) where status = 'queued';
create unique index press_pitches_once_idx on public.press_pitches (distribution_id, lower(email));

alter table public.media_outlets enable row level security;
alter table public.media_contacts enable row level security;
alter table public.media_optouts enable row level security;
alter table public.media_research_runs enable row level security;
alter table public.press_distributions enable row level security;
alter table public.press_pitches enable row level security;
revoke all on public.media_outlets, public.media_contacts, public.media_optouts, public.media_research_runs, public.press_distributions, public.press_pitches from anon, authenticated;
