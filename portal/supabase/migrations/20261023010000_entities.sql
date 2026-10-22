-- Phase 1 of "all investors": every company the portal serves is an entity.
--
-- Lakeba Group Limited is the group; controlled ventures get a full portal for
-- their own shareholders; non-controlling investments are portfolio entries
-- that group shareholders see. Share classes, documents, posts, announcements,
-- meetings and Board Q&A belong to an entity, and existing rows move to the group.
--
-- Who sees an entity is worked out from the register, never set by hand:
--   - a holder you are linked to has a holding in one of its classes, or
--   - you are on its board (entity_board; role 'board' = the group's board), or
--   - you are an MFA-verified admin.
-- Former holders keep access while they stay linked (their history is kept);
-- remove the link to end it.

create type public.entity_relationship as enum ('group', 'controlled', 'portfolio');
create type public.entity_portal as enum ('full', 'portfolio', 'none');

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  display_name text not null,
  legal_name text,
  company_number text,
  country text not null default 'Australia',
  relationship public.entity_relationship not null,
  portal public.entity_portal not null,
  lakeba_stake numeric(5, 2) check (lakeba_stake between 0 and 100),
  stake_as_at date,
  website text,
  brand_color text check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (relationship <> 'group' or portal = 'full')
);
create unique index entities_one_group on public.entities ((true)) where relationship = 'group';

insert into public.entities (code, display_name, legal_name, relationship, portal, sort) values
  ('LKB', 'Lakeba Group', 'Lakeba Group Limited', 'group', 'full', 0),
  ('EZF', 'Ezifin', null, 'controlled', 'full', 10),
  ('DOX', 'DoxAI', null, 'controlled', 'full', 20),
  ('BRK', 'Bricklet', null, 'controlled', 'full', 30),
  ('SHF', 'Shelfie', null, 'controlled', 'full', 40),
  ('WHK', 'Whitehawk', null, 'portfolio', 'portfolio', 50),
  ('MIST', 'MIST', null, 'portfolio', 'portfolio', 60),
  ('AST', 'Assetora', null, 'portfolio', 'portfolio', 70),
  ('APR', 'Appreci', null, 'portfolio', 'portfolio', 80),
  ('ZUC', 'Zucoins', null, 'portfolio', 'portfolio', 90),
  ('EZP', 'EziProp', null, 'portfolio', 'portfolio', 100);

create function public.group_entity_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.entities where relationship = 'group';
$$;

-- Directors and officers per entity. The group's board is still profiles.role = 'board'.
create table public.entity_board (
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position text not null check (position in ('director', 'chair', 'company_secretary', 'observer')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  primary key (entity_id, user_id, position)
);
create index entity_board_user_idx on public.entity_board (user_id);

-- ---------------------------------------------------------------------------
-- Everything that belongs to an entity (existing rows: the group)
-- ---------------------------------------------------------------------------
alter table public.share_classes
  add column entity_id uuid not null default public.group_entity_id() references public.entities (id),
  add column kind text not null default 'ordinary' check (kind in ('ordinary', 'preference', 'options', 'convertible_note', 'safe', 'other')),
  add column counts_toward_pct boolean not null default true,
  add column currency text not null default 'AUD';
alter table public.share_classes drop constraint share_classes_code_key;
alter table public.share_classes add constraint share_classes_entity_code_key unique (entity_id, code);
create index share_classes_entity_idx on public.share_classes (entity_id);

-- Options: optional terms per holding row.
alter table public.holdings
  add column exercise_price numeric(14, 4) check (exercise_price >= 0),
  add column expires_on date;

alter table public.documents
  add column entity_id uuid not null default public.group_entity_id() references public.entities (id),
  add column shared_with_group boolean not null default false;
alter table public.posts add column entity_id uuid not null default public.group_entity_id() references public.entities (id);
alter table public.announcements add column entity_id uuid not null default public.group_entity_id() references public.entities (id);
alter table public.meetings add column entity_id uuid not null default public.group_entity_id() references public.entities (id);
alter table public.queries add column entity_id uuid not null default public.group_entity_id() references public.entities (id);
-- A portfolio card can point at its entity (ventures are the group's view of them).
alter table public.ventures add column entity_id uuid unique references public.entities (id) on delete set null;

create index documents_entity_idx on public.documents (entity_id, published_at desc);
create index posts_entity_idx on public.posts (entity_id, published_at desc);
create index meetings_entity_idx on public.meetings (entity_id, starts_at);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
create function public.my_entity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.entities e where public.is_admin()
  union
  select c.entity_id
  from public.holder_members m
  join public.holdings h on h.holder_id = m.holder_id
  join public.share_classes c on c.id = h.share_class_id
  where m.user_id = (select auth.uid())
  union
  select b.entity_id from public.entity_board b
  where b.user_id = (select auth.uid()) and (b.ends_on is null or b.ends_on >= current_date)
  union
  select public.group_entity_id() where public.current_role_is('board');
$$;

create function public.can_see_entity(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target in (select public.my_entity_ids());
$$;

create function public.is_entity_board(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (target = public.group_entity_id() and public.current_role_is('board'))
    or exists (
      select 1 from public.entity_board b
      where b.entity_id = target and b.user_id = (select auth.uid()) and (b.ends_on is null or b.ends_on >= current_date)
    );
$$;

-- Signed in and connected to at least one entity.
create or replace function public.is_portal_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.my_entity_ids());
$$;

-- Documents: the entity's shareholders (or board), plus group shareholders
-- when a venture document is marked "share with Lakeba Group shareholders".
create or replace function public.can_read_document(doc public.documents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (
    doc.published_at is not null and doc.published_at <= now() and (
      (doc.audience = 'all_investors' and (
        public.can_see_entity(doc.entity_id)
        or (doc.shared_with_group and public.can_see_entity(public.group_entity_id()))
      ))
      or (doc.audience = 'board' and public.is_entity_board(doc.entity_id))
      or (doc.audience = 'holder' and public.is_holder_member(doc.holder_id))
    )
  );
$$;

-- Totals per class, for the classes of entities the caller can see.
drop function public.shares_on_issue();
create function public.shares_on_issue()
returns table (share_class_id uuid, code text, name text, total bigint, computed_total bigint, official_as_at date, is_official boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (h.holder_id, h.share_class_id) h.share_class_id, h.shares
    from public.holdings h
    order by h.holder_id, h.share_class_id, h.as_at desc
  ), computed as (
    select c.id, coalesce(sum(l.shares), 0)::bigint as total
    from public.share_classes c
    left join latest l on l.share_class_id = c.id
    group by c.id
  )
  select c.id, c.code, c.name,
         coalesce(c.official_on_issue, k.total),
         k.total,
         c.official_as_at,
         c.official_on_issue is not null
  from public.share_classes c
  join computed k on k.id = c.id
  where c.entity_id in (select public.my_entity_ids());
$$;
revoke execute on function public.shares_on_issue() from public, anon;
grant execute on function public.shares_on_issue() to authenticated;

-- Tally weighted by each holder's latest shares in the meeting entity's voting classes.
create or replace function public.resolution_tally(target_meeting uuid)
returns table (resolution_id uuid, vote public.vote_choice, holders bigint, shares bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (h.holder_id, h.share_class_id) h.holder_id, h.share_class_id, h.shares
    from public.holdings h order by h.holder_id, h.share_class_id, h.as_at desc
  ), weight as (
    select l.holder_id, sum(l.shares)::bigint as shares
    from latest l
    join public.share_classes c on c.id = l.share_class_id
    join public.meetings m on m.entity_id = c.entity_id and m.id = target_meeting
    where c.voting
    group by l.holder_id
  )
  select v.resolution_id, v.vote, count(*)::bigint, coalesce(sum(w.shares), 0)::bigint
  from public.proxy_votes v
  join public.resolutions r on r.id = v.resolution_id
  left join weight w on w.holder_id = v.holder_id
  where r.meeting_id = target_meeting and public.is_admin()
  group by v.resolution_id, v.vote;
$$;

-- A holder may vote at a meeting only if it holds shares in that meeting's entity.
create function public.holder_in_meeting_entity(target_holder uuid, res_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.resolutions r
    join public.meetings m on m.id = r.meeting_id
    join public.share_classes c on c.entity_id = m.entity_id
    join public.holdings h on h.share_class_id = c.id and h.holder_id = target_holder
    where r.id = res_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies: replace "any portal member" with "can see this entity"
-- ---------------------------------------------------------------------------
alter table public.entities enable row level security;
alter table public.entity_board enable row level security;

create policy "entities: visible" on public.entities
  for select to authenticated using (
    (select public.can_see_entity(id))
    -- group shareholders see the portfolio companies' names (not their content)
    or (relationship <> 'group' and (select public.can_see_entity(public.group_entity_id())))
  );
create policy "entities: admin write" on public.entities
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "entity_board: own or admin" on public.entity_board
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "entity_board: admin write" on public.entity_board
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy "share_classes: signed-in read" on public.share_classes;
create policy "share_classes: visible entities" on public.share_classes
  for select to authenticated using ((select public.is_admin()) or entity_id in (select public.my_entity_ids()));

drop policy "posts: members read published" on public.posts;
create policy "posts: entity members read published" on public.posts
  for select to authenticated using ((select public.is_admin()) or (published_at <= now() and entity_id in (select public.my_entity_ids())));

drop policy "announcements: members read current" on public.announcements;
create policy "announcements: entity members read current" on public.announcements
  for select to authenticated using (
    (select public.is_admin())
    or (entity_id in (select public.my_entity_ids()) and starts_at <= now() and (ends_at is null or ends_at > now()))
  );

-- Portal settings (e.g. the secondary trading card) are the group's for now.
drop policy "portal_settings: members read" on public.portal_settings;
create policy "portal_settings: group members read" on public.portal_settings
  for select to authenticated using ((select public.can_see_entity(public.group_entity_id())));

drop policy "queries: members create own" on public.queries;
create policy "queries: members create own" on public.queries
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.can_see_entity(entity_id)));
grant insert (entity_id) on public.queries to authenticated;

-- The group's portfolio view (ventures and their updates) is for group shareholders.
drop policy "ventures: members read" on public.ventures;
create policy "ventures: group members read" on public.ventures
  for select to authenticated using ((select public.can_see_entity(public.group_entity_id())));
drop policy "venture_updates: members read" on public.venture_updates;
create policy "venture_updates: group members read" on public.venture_updates
  for select to authenticated using ((select public.can_see_entity(public.group_entity_id())));

drop policy "reference_prices: members read" on public.reference_prices;
create policy "reference_prices: visible classes" on public.reference_prices
  for select to authenticated using (
    (select public.is_admin())
    or exists (select 1 from public.share_classes c where c.id = share_class_id and c.entity_id in (select public.my_entity_ids()))
  );

drop policy "meetings: members read" on public.meetings;
create policy "meetings: entity members read" on public.meetings
  for select to authenticated using ((select public.is_admin()) or entity_id in (select public.my_entity_ids()));
drop policy "resolutions: members read" on public.resolutions;
create policy "resolutions: entity members read" on public.resolutions
  for select to authenticated using (
    (select public.is_admin())
    or exists (select 1 from public.meetings m where m.id = meeting_id and m.entity_id in (select public.my_entity_ids()))
  );

drop policy "proxy_votes: owners lodge" on public.proxy_votes;
create policy "proxy_votes: owners lodge" on public.proxy_votes
  for insert to authenticated with check (
    lodged_by = (select auth.uid()) and (select public.is_holder_owner(holder_id)) and (select public.proxy_window_open(resolution_id))
    and (select public.holder_in_meeting_entity(holder_id, resolution_id))
  );
drop policy "proxy_votes: owners change" on public.proxy_votes;
create policy "proxy_votes: owners change" on public.proxy_votes
  for update to authenticated
  using ((select public.is_holder_owner(holder_id)) and (select public.proxy_window_open(resolution_id)))
  with check (
    lodged_by = (select auth.uid()) and (select public.is_holder_owner(holder_id)) and (select public.proxy_window_open(resolution_id))
    and (select public.holder_in_meeting_entity(holder_id, resolution_id))
  );

drop policy "meeting_questions: members ask" on public.meeting_questions;
create policy "meeting_questions: entity members ask" on public.meeting_questions
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.entity_id in (select public.my_entity_ids()))
  );

revoke all on public.entities, public.entity_board from anon;
revoke execute on function public.group_entity_id() from public, anon;
revoke execute on function public.my_entity_ids() from public, anon;
revoke execute on function public.can_see_entity(uuid) from public, anon;
revoke execute on function public.is_entity_board(uuid) from public, anon;
revoke execute on function public.holder_in_meeting_entity(uuid, uuid) from public, anon;
grant execute on function public.group_entity_id() to authenticated;
grant execute on function public.my_entity_ids() to authenticated;
grant execute on function public.can_see_entity(uuid) to authenticated;
grant execute on function public.is_entity_board(uuid) to authenticated;
grant execute on function public.holder_in_meeting_entity(uuid, uuid) to authenticated;
