-- Phases 2–5 of "all investors": company admins, branding, per-company Ask
-- Lakeba data, and the figures needed for look-through ownership.

-- ---------------------------------------------------------------------------
-- Branding and the group's own holder
-- ---------------------------------------------------------------------------
alter table public.entities
  add column tagline text not null default '',
  add column logo_url text;

-- The holder that *is* a company (e.g. Lakeba Group Limited holding Ezifin
-- shares). Used for the group's stake in each venture; it has no login.
alter table public.holders add column represents_entity_id uuid references public.entities (id) on delete set null;
create index holders_represents_idx on public.holders (represents_entity_id) where represents_entity_id is not null;

-- ---------------------------------------------------------------------------
-- Company admins: manage one company's content, see its register
-- ---------------------------------------------------------------------------
create table public.entity_admins (
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entity_id, user_id)
);
create index entity_admins_user_idx on public.entity_admins (user_id);

-- Like admins, company admins only count in a session that passed MFA.
create function public.is_entity_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (
    coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (select 1 from public.entity_admins a where a.entity_id = target and a.user_id = (select auth.uid()))
  );
$$;

-- Companies the caller administers (all of them for group admins).
create function public.admin_entity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.entities e where public.is_entity_admin(e.id);
$$;

-- Does this holder hold (or has it held) shares in this company?
create function public.holder_in_entity(target_holder uuid, target_entity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.holdings h join public.share_classes c on c.id = h.share_class_id
    where h.holder_id = target_holder and c.entity_id = target_entity
  );
$$;

-- Company admins see their companies too.
create or replace function public.my_entity_ids()
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
  select a.entity_id from public.entity_admins a where a.user_id = (select auth.uid())
  union
  select public.group_entity_id() where public.current_role_is('board');
$$;

-- ---------------------------------------------------------------------------
-- Look-through: Lakeba's stake in each venture (register first, else stated)
-- ---------------------------------------------------------------------------
create function public.lakeba_stakes()
returns table (entity_id uuid, code text, display_name text, register_pct numeric, stated_pct numeric, stated_as_at date)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (h.holder_id, h.share_class_id) h.holder_id, h.share_class_id, h.shares
    from public.holdings h order by h.holder_id, h.share_class_id, h.as_at desc
  ), per_class as (
    select c.id, c.entity_id,
           coalesce(c.official_on_issue, sum(l.shares)) as on_issue,
           sum(l.shares) filter (where ho.represents_entity_id = public.group_entity_id()) as group_shares
    from public.share_classes c
    left join latest l on l.share_class_id = c.id
    left join public.holders ho on ho.id = l.holder_id
    where c.counts_toward_pct
    group by c.id
  ), per_entity as (
    select entity_id, sum(on_issue) as on_issue, sum(coalesce(group_shares, 0)) as group_shares
    from per_class group by entity_id
  )
  select e.id, e.code, e.display_name,
         case when p.on_issue > 0 and p.group_shares > 0 then round(p.group_shares / p.on_issue, 6) end,
         e.lakeba_stake / 100, e.stake_as_at
  from public.entities e
  left join per_entity p on p.entity_id = e.id
  where e.relationship <> 'group'
    and public.can_see_entity(public.group_entity_id());
$$;

-- ---------------------------------------------------------------------------
-- Per-company data for notifications and Ask Lakeba
-- ---------------------------------------------------------------------------
alter table public.notifications add column entity_id uuid references public.entities (id) on delete cascade;
alter table public.ask_exchanges add column entity_id uuid references public.entities (id) on delete set null;
alter table public.ask_approved_answers add column entity_id uuid not null default public.group_entity_id() references public.entities (id) on delete cascade;
alter table public.ask_test_cases add column entity_id uuid not null default public.group_entity_id() references public.entities (id) on delete cascade;
update public.ask_exchanges set entity_id = public.group_entity_id() where entity_id is null;

-- ---------------------------------------------------------------------------
-- Policies for company admins (alongside the existing admin policies)
-- ---------------------------------------------------------------------------
alter table public.entity_admins enable row level security;
create policy "entity_admins: own or admin" on public.entity_admins
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "entity_admins: admin write" on public.entity_admins
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "documents: company admins" on public.documents
  for all to authenticated
  using ((select public.is_entity_admin(entity_id)))
  with check ((select public.is_entity_admin(entity_id)) and (audience <> 'holder' or public.holder_in_entity(holder_id, entity_id)));
create policy "document_chunks: company admins" on public.document_chunks
  for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_entity_admin(d.entity_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.is_entity_admin(d.entity_id)));
create policy "document_reads: company admins read" on public.document_reads
  for select to authenticated using (exists (select 1 from public.documents d where d.id = document_id and public.is_entity_admin(d.entity_id)));

-- Company admins store files under entity/<entity id>/…
create policy "documents bucket: company admins"
  on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'entity' and public.is_entity_admin(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'entity' and public.is_entity_admin(((storage.foldername(name))[2])::uuid));

create policy "posts: company admins" on public.posts
  for all to authenticated using ((select public.is_entity_admin(entity_id))) with check ((select public.is_entity_admin(entity_id)));
create policy "announcements: company admins" on public.announcements
  for all to authenticated using ((select public.is_entity_admin(entity_id))) with check ((select public.is_entity_admin(entity_id)));
create policy "meetings: company admins" on public.meetings
  for all to authenticated using ((select public.is_entity_admin(entity_id))) with check ((select public.is_entity_admin(entity_id)));
create policy "resolutions: company admins" on public.resolutions
  for all to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_entity_admin(m.entity_id)))
  with check (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_entity_admin(m.entity_id)));
create policy "meeting_questions: company admins read" on public.meeting_questions
  for select to authenticated using (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_entity_admin(m.entity_id)));
create policy "meeting_questions: company admins answer" on public.meeting_questions
  for update to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_entity_admin(m.entity_id)))
  with check (exists (select 1 from public.meetings m where m.id = meeting_id and public.is_entity_admin(m.entity_id)));

create policy "queries: company admins read" on public.queries
  for select to authenticated using ((select public.is_entity_admin(entity_id)));
create policy "queries: company admins update" on public.queries
  for update to authenticated using ((select public.is_entity_admin(entity_id))) with check ((select public.is_entity_admin(entity_id)));
create policy "query_messages: company admins read" on public.query_messages
  for select to authenticated using (exists (select 1 from public.queries q where q.id = query_id and public.is_entity_admin(q.entity_id)));
create policy "query_messages: company admins write" on public.query_messages
  for insert to authenticated with check (
    author_id = (select auth.uid()) and exists (select 1 from public.queries q where q.id = query_id and public.is_entity_admin(q.entity_id))
  );

create policy "share_classes: company admins" on public.share_classes
  for all to authenticated using ((select public.is_entity_admin(entity_id))) with check ((select public.is_entity_admin(entity_id)));
create policy "reference_prices: company admins" on public.reference_prices
  for all to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.is_entity_admin(c.entity_id)))
  with check (exists (select 1 from public.share_classes c where c.id = share_class_id and public.is_entity_admin(c.entity_id)));

-- The company's register, read-only: its holders, their holdings in its
-- classes, who can sign in for them, and those people's names and emails.
create policy "holdings: company admins read" on public.holdings
  for select to authenticated using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.is_entity_admin(c.entity_id)));
create policy "holders: company admins read" on public.holders
  for select to authenticated using (exists (select 1 from public.admin_entity_ids() e where public.holder_in_entity(id, e)));
create policy "holder_members: company admins read" on public.holder_members
  for select to authenticated using (exists (select 1 from public.admin_entity_ids() e where public.holder_in_entity(holder_id, e)));
create policy "profiles: company admins read" on public.profiles
  for select to authenticated using (exists (
    select 1 from public.holder_members m, public.admin_entity_ids() e
    where m.user_id = profiles.id and public.holder_in_entity(m.holder_id, e)
  ));

create policy "ask_approved_answers: company admins" on public.ask_approved_answers
  for all to authenticated using ((select public.is_entity_admin(entity_id))) with check ((select public.is_entity_admin(entity_id)));
create policy "ask_exchanges: company admins read" on public.ask_exchanges
  for select to authenticated using (entity_id is not null and (select public.is_entity_admin(entity_id)));

revoke all on public.entity_admins from anon;
revoke execute on function public.is_entity_admin(uuid) from public, anon;
revoke execute on function public.admin_entity_ids() from public, anon;
revoke execute on function public.holder_in_entity(uuid, uuid) from public, anon;
revoke execute on function public.lakeba_stakes() from public, anon;
grant execute on function public.is_entity_admin(uuid) to authenticated;
grant execute on function public.admin_entity_ids() to authenticated;
grant execute on function public.holder_in_entity(uuid, uuid) to authenticated;
grant execute on function public.lakeba_stakes() to authenticated;

-- A reply from the company's admins (not only group admins) answers a question.
create or replace function public.on_query_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff boolean;
begin
  if not new.internal then
    select public.is_entity_admin(q.entity_id) into staff from public.queries q where q.id = new.query_id;
    update public.queries
       set status = case when staff then 'answered'::public.query_status else 'open'::public.query_status end,
           due_at = case when staff then due_at else public.add_working_days(now(), 7) end,
           updated_at = now()
     where id = new.query_id;
  end if;
  return new;
end;
$$;

-- Company admins review their company's Ask answers too.
create policy "ask_exchanges: company admins review" on public.ask_exchanges
  for update to authenticated
  using (entity_id is not null and (select public.is_entity_admin(entity_id)))
  with check (entity_id is not null and (select public.is_entity_admin(entity_id)));

-- Company admins see the tallies for their company's meetings.
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
  join public.meetings m on m.id = r.meeting_id
  left join weight w on w.holder_id = v.holder_id
  where r.meeting_id = target_meeting and public.is_entity_admin(m.entity_id)
  group by v.resolution_id, v.vote;
$$;
