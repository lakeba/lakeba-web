-- Press office, phase 4: coverage. Articles found by the monitor (the feeds
-- the press office chose, such as Google Alerts; Claude web search after each
-- release; GDELT) or added by hand, sorted by Claude (about a release, a
-- mention, or unrelated; tone; one line), linked to the journalist pitched
-- when the outlet matches, and confirmed or dismissed by a person.
create table public.press_coverage (
  id uuid primary key default gen_random_uuid(),
  release_id uuid references public.press_releases (id) on delete set null,
  entity_id uuid references public.entities (id) on delete set null,
  url text not null,
  url_key text not null unique,
  title text not null default '',
  outlet text not null default '',
  domain text not null default '',
  published_at timestamptz,
  snippet text not null default '',
  source text not null default 'manual' check (source in ('feed', 'search', 'gdelt', 'manual')),
  relevance text not null default 'mention' check (relevance in ('release', 'mention', 'unrelated')),
  sentiment text not null default 'neutral' check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  summary text not null default '',
  status text not null default 'new' check (status in ('new', 'confirmed', 'dismissed')),
  pitch_id uuid references public.press_pitches (id) on delete set null,
  contact_id uuid references public.media_contacts (id) on delete set null,
  found_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create index press_coverage_release_idx on public.press_coverage (release_id, published_at desc);
create index press_coverage_status_idx on public.press_coverage (status, found_at desc);

-- When the monitor last looked (per feed, per release search, GDELT), and what it found.
create table public.press_monitor_log (
  id bigint generated always as identity primary key,
  kind text not null,
  target text not null default '',
  found integer not null default 0,
  added integer not null default 0,
  error text not null default '',
  at timestamptz not null default now()
);
create index press_monitor_log_idx on public.press_monitor_log (kind, target, at desc);

alter table public.press_coverage enable row level security;
alter table public.press_monitor_log enable row level security;
revoke all on public.press_coverage, public.press_monitor_log from anon, authenticated;
