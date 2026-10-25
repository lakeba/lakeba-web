-- Press office, phase 3: where each release went beyond the newsroom and the
-- journalists: social networks (posted by the portal, or shared by hand with
-- the link recorded) and wire services (the release package submitted, with
-- the cost and the wire's link to it).
create table public.press_channel_posts (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.press_releases (id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'bluesky', 'x', 'wire', 'other')),
  target text not null default '',
  status text not null default 'posted' check (status in ('posted', 'submitted', 'failed')),
  text text not null default '',
  url text not null default '',
  external_id text not null default '',
  cost numeric(10, 2),
  currency text not null default 'AUD',
  error text not null default '',
  posted_by uuid references auth.users (id) on delete set null,
  posted_at timestamptz not null default now()
);
create index press_channel_posts_release_idx on public.press_channel_posts (release_id, posted_at desc);
alter table public.press_channel_posts enable row level security;
revoke all on public.press_channel_posts from anon, authenticated;

-- Tell the company's investors in the portal when the release is published (the usual news notification).
alter table public.press_releases add column notify_investors boolean not null default false;
