-- Phase 5: portfolio look-through, indicative value, digital AGM and the
-- searchable document text used by "Ask Lakeba".

-- ---------------------------------------------------------------------------
-- Portfolio look-through
-- ---------------------------------------------------------------------------
create table public.ventures (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  tagline text not null default '',
  stage text not null default '',
  lakeba_stake numeric(5, 2) check (lakeba_stake between 0 and 100),
  website text,
  status text not null default 'active' check (status in ('active', 'exited', 'building')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.venture_updates (
  id uuid primary key default gen_random_uuid(),
  venture_id uuid not null references public.ventures (id) on delete cascade,
  title text not null,
  body text not null default '',
  happened_on date not null,
  created_at timestamptz not null default now()
);
create index venture_updates_idx on public.venture_updates (venture_id, happened_on desc);

-- ---------------------------------------------------------------------------
-- Indicative value
-- ---------------------------------------------------------------------------
create table public.reference_prices (
  id uuid primary key default gen_random_uuid(),
  share_class_id uuid not null references public.share_classes (id),
  price numeric(14, 4) not null check (price >= 0),
  currency text not null default 'AUD',
  priced_on date not null,
  source text not null check (source in ('capital_raise', 'secondary_trade', 'valuation')),
  note text,
  unique (share_class_id, priced_on, source)
);

-- ---------------------------------------------------------------------------
-- Digital AGM
-- ---------------------------------------------------------------------------
create type public.meeting_status as enum ('upcoming', 'open', 'closed', 'results');
create type public.vote_choice as enum ('for', 'against', 'abstain');

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'agm' check (kind in ('agm', 'egm')),
  starts_at timestamptz not null,
  location text,
  livestream_url text,
  notice_document_id uuid references public.documents (id) on delete set null,
  minutes_document_id uuid references public.documents (id) on delete set null,
  proxy_deadline timestamptz not null,
  status public.meeting_status not null default 'upcoming',
  created_at timestamptz not null default now(),
  check (proxy_deadline <= starts_at)
);

create table public.resolutions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  number int not null,
  title text not null,
  description text not null default '',
  kind text not null default 'ordinary' check (kind in ('ordinary', 'special')),
  outcome text check (outcome in ('carried', 'not_carried', 'withdrawn')),
  unique (meeting_id, number)
);

create table public.proxy_votes (
  resolution_id uuid not null references public.resolutions (id) on delete cascade,
  holder_id uuid not null references public.holders (id) on delete cascade,
  vote public.vote_choice not null,
  lodged_by uuid not null references public.profiles (id),
  lodged_at timestamptz not null default now(),
  primary key (resolution_id, holder_id)
);

create table public.meeting_questions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 3 and 2000),
  answer text,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only owners (not read-only viewers) of a holder may vote for it.
create function public.is_holder_owner(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.holder_members m
    where m.holder_id = target and m.user_id = (select auth.uid()) and m.access = 'owner'
  );
$$;

-- Proxies can be lodged while the meeting is open and before the deadline.
create function public.proxy_window_open(res_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resolutions r join public.meetings m on m.id = r.meeting_id
    where r.id = res_id and m.status in ('upcoming', 'open') and now() < m.proxy_deadline
  );
$$;

-- Tally per resolution, weighted by each holder's latest shares in all classes.
create function public.resolution_tally(target_meeting uuid)
returns table (resolution_id uuid, vote public.vote_choice, holders bigint, shares bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (h.holder_id, h.share_class_id) h.holder_id, h.shares
    from public.holdings h order by h.holder_id, h.share_class_id, h.as_at desc
  ), weight as (
    select holder_id, sum(shares)::bigint as shares from latest group by holder_id
  )
  select v.resolution_id, v.vote, count(*)::bigint, coalesce(sum(w.shares), 0)::bigint
  from public.proxy_votes v
  join public.resolutions r on r.id = v.resolution_id
  left join weight w on w.holder_id = v.holder_id
  where r.meeting_id = target_meeting and public.is_admin()
  group by v.resolution_id, v.vote;
$$;

-- ---------------------------------------------------------------------------
-- Searchable document text ("Ask Lakeba")
-- ---------------------------------------------------------------------------
create table public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index int not null,
  page int,
  content text not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, chunk_index)
);
create index document_chunks_tsv_idx on public.document_chunks using gin (tsv);

-- Runs as the caller, so document visibility rules still apply.
create function public.search_documents(query text, max_results int default 8)
returns table (document_id uuid, title text, page int, content text, rank real)
language sql
stable
set search_path = ''
as $$
  select c.document_id, d.title, c.page, c.content,
         ts_rank_cd(c.tsv, websearch_to_tsquery('english', query)) as rank
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.tsv @@ websearch_to_tsquery('english', query)
  order by rank desc
  limit least(max_results, 20);
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.ventures enable row level security;
alter table public.venture_updates enable row level security;
alter table public.reference_prices enable row level security;
alter table public.meetings enable row level security;
alter table public.resolutions enable row level security;
alter table public.proxy_votes enable row level security;
alter table public.meeting_questions enable row level security;
alter table public.document_chunks enable row level security;

create policy "ventures: members read" on public.ventures for select to authenticated using ((select public.is_portal_member()));
create policy "ventures: admin write" on public.ventures for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "venture_updates: members read" on public.venture_updates for select to authenticated using ((select public.is_portal_member()));
create policy "venture_updates: admin write" on public.venture_updates for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "reference_prices: members read" on public.reference_prices for select to authenticated using ((select public.is_portal_member()));
create policy "reference_prices: admin write" on public.reference_prices for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "meetings: members read" on public.meetings for select to authenticated using ((select public.is_portal_member()));
create policy "meetings: admin write" on public.meetings for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "resolutions: members read" on public.resolutions for select to authenticated using ((select public.is_portal_member()));
create policy "resolutions: admin write" on public.resolutions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "proxy_votes: own holders or admin" on public.proxy_votes
  for select to authenticated using ((select public.is_holder_member(holder_id)) or (select public.is_admin()));
create policy "proxy_votes: owners lodge" on public.proxy_votes
  for insert to authenticated with check (
    lodged_by = (select auth.uid()) and (select public.is_holder_owner(holder_id)) and (select public.proxy_window_open(resolution_id))
  );
create policy "proxy_votes: owners change" on public.proxy_votes
  for update to authenticated
  using ((select public.is_holder_owner(holder_id)) and (select public.proxy_window_open(resolution_id)))
  with check (lodged_by = (select auth.uid()) and (select public.is_holder_owner(holder_id)) and (select public.proxy_window_open(resolution_id)));

create policy "meeting_questions: own or admin" on public.meeting_questions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "meeting_questions: members ask" on public.meeting_questions
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_portal_member()));
create policy "meeting_questions: admin answer" on public.meeting_questions
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke insert on public.meeting_questions from authenticated;
grant insert (meeting_id, user_id, body) on public.meeting_questions to authenticated;

create policy "document_chunks: readable documents" on public.document_chunks
  for select to authenticated using (exists (select 1 from public.documents d where d.id = document_id));
create policy "document_chunks: admin write" on public.document_chunks
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke execute on function public.is_holder_owner(uuid) from public, anon;
revoke execute on function public.proxy_window_open(uuid) from public, anon;
revoke execute on function public.resolution_tally(uuid) from public, anon;
revoke execute on function public.search_documents(text, int) from public, anon;
grant execute on function public.is_holder_owner(uuid) to authenticated;
grant execute on function public.proxy_window_open(uuid) to authenticated;
grant execute on function public.resolution_tally(uuid) to authenticated;
grant execute on function public.search_documents(text, int) to authenticated;

revoke all on all tables in schema public from anon;

-- How often the signed-in user did something recently (for fair-use limits).
create function public.my_recent_event_count(event_action text, since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.audit_log
  where user_id = (select auth.uid()) and action = event_action and created_at >= since;
$$;
revoke execute on function public.my_recent_event_count(text, timestamptz) from public, anon;
grant execute on function public.my_recent_event_count(text, timestamptz) to authenticated;
