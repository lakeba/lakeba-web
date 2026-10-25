-- Roles and permissions (System → Users and System → Roles).
--
-- A person can hold several roles, each for the whole group (entity_id null)
-- or for one company, optionally until a date. A role is a set of
-- permissions: an area and a level ("press.view", "press.do",
-- "press.approve"). Built-in roles: admin, board, marketing, legal,
-- compliance; custom roles can be added. Investor isn't a role: it follows the
-- register (holder_members).
--
-- user_roles is now the source of truth. The older markers are kept in step
-- for the parts of the portal that still read them: profiles.role ('admin' or
-- 'board' for group-wide Admin and Board), entity_admins (company Admin) and
-- press_team (Marketing). The database checks is_admin(), is_entity_admin()
-- and current_role_is() now read user_roles (so an end date takes effect at
-- once), and the new can(permission, company) gives the other roles access.

create table public.roles (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  description text not null default '',
  builtin boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade on update cascade,
  permission text not null check (permission ~ '^[a-z]+\.(view|do|approve)$'),
  primary key (role_key, permission)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_key text not null references public.roles (key) on delete cascade on update cascade,
  entity_id uuid references public.entities (id) on delete cascade,
  expires_at timestamptz,
  note text not null default '',
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);
create unique index user_roles_once_idx on public.user_roles (user_id, role_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index user_roles_user_idx on public.user_roles (user_id);

alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
revoke all on public.roles, public.role_permissions, public.user_roles from anon, authenticated;
-- People may read their own roles (the portal shows them on the profile).
grant select on public.user_roles to authenticated;
create policy "user_roles: own" on public.user_roles for select to authenticated using (user_id = (select auth.uid()));

-- Built-in roles and their starting permissions (also in src/lib/permissions.ts).
insert into public.roles (key, name, description, builtin) values
  ('admin', 'Admin', 'Runs the portal: everything, including users and roles. For one company: everything about that company.', true),
  ('board', 'Board', 'Board members: see the register, documents, meetings and ventures; answer Board Q&A.', true),
  ('marketing', 'Marketing', 'Prepares news, press releases, newsletters and the LinkedIn campaign; approvers publish.', true),
  ('legal', 'Legal', 'Reviews and approves documents, press releases and meeting materials; sees the register and the audit log.', true),
  ('compliance', 'Compliance', 'Approves newsletters and secondary trades; sees the register, communications and the audit log.', true);

insert into public.role_permissions (role_key, permission)
select 'admin', a || '.' || l from unnest(array['investors','documents','news','press','newsletters','inbox','ask','meetings','capital','audit','users']) a
cross join unnest(array['view','do','approve']) l
where not (a in ('investors','inbox','ask','audit','users') and l = 'approve');

insert into public.role_permissions (role_key, permission) values
  ('board', 'investors.view'), ('board', 'documents.view'), ('board', 'inbox.view'), ('board', 'inbox.do'), ('board', 'meetings.view'), ('board', 'meetings.do'), ('board', 'capital.view'),
  ('marketing', 'news.view'), ('marketing', 'news.do'), ('marketing', 'press.view'), ('marketing', 'press.do'), ('marketing', 'newsletters.view'), ('marketing', 'newsletters.do'),
  ('legal', 'investors.view'), ('legal', 'documents.view'), ('legal', 'documents.approve'), ('legal', 'news.view'), ('legal', 'press.view'), ('legal', 'press.approve'), ('legal', 'inbox.view'),
  ('legal', 'ask.view'), ('legal', 'meetings.view'), ('legal', 'meetings.approve'), ('legal', 'capital.view'), ('legal', 'audit.view'),
  ('compliance', 'investors.view'), ('compliance', 'documents.view'), ('compliance', 'press.view'), ('compliance', 'newsletters.view'), ('compliance', 'newsletters.approve'), ('compliance', 'inbox.view'),
  ('compliance', 'ask.view'), ('compliance', 'meetings.view'), ('compliance', 'capital.view'), ('compliance', 'capital.approve'), ('compliance', 'audit.view'), ('compliance', 'users.view');

-- Today's assignments become roles: group admins and the group board, company admins, the press team.
insert into public.user_roles (user_id, role_key, note)
select id, 'admin', 'from the previous admin role' from public.profiles where role = 'admin';
insert into public.user_roles (user_id, role_key, note)
select id, 'board', 'from the previous board role' from public.profiles where role = 'board';
insert into public.user_roles (user_id, role_key, entity_id, note)
select user_id, 'admin', entity_id, 'from company admins' from public.entity_admins
on conflict do nothing;
insert into public.user_roles (user_id, role_key, note)
select t.user_id, 'marketing', 'from the press team' from public.press_team t join public.profiles p on p.id = t.user_id
on conflict do nothing;

-- Is this role held now (not expired)?
create or replace function public.holds_role(wanted text, target uuid default null, any_company boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role_key = wanted
      and (ur.expires_at is null or ur.expires_at > now())
      and (any_company or ur.entity_id is not distinct from target)
  );
$$;

-- The role checks used by the existing access rules, now read from user_roles.
-- current_role_is('admin'/'board') means the role for the whole group.
create or replace function public.current_role_is(wanted public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when wanted::text = 'investor'
    then exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'investor')
    else public.holds_role(wanted::text) end;
$$;

create or replace function public.is_entity_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.session_is_strong() and public.holds_role('admin', target));
$$;

/*
 * can(permission, company): does the signed-in person (after two-step) hold a
 * role with this permission, for the whole group or for this company?
 * company null asks about group-level things (and is answered by group roles only).
 */
create or replace function public.can(perm text, target uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_is_strong() and exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_key = ur.role_key
    where ur.user_id = (select auth.uid())
      and (ur.expires_at is null or ur.expires_at > now())
      and rp.permission = perm
      and (ur.entity_id is null or ur.entity_id = target)
  );
$$;
revoke execute on function public.can(text, uuid) from public, anon;
grant execute on function public.can(text, uuid) to authenticated;
revoke execute on function public.holds_role(text, uuid, boolean) from public, anon;
grant execute on function public.holds_role(text, uuid, boolean) to authenticated;

-- Keep the older markers in step with user_roles.
create or replace function public.sync_legacy_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := coalesce(new.user_id, old.user_id);
begin
  update public.profiles p set role = case
      when exists (select 1 from public.user_roles r where r.user_id = uid and r.role_key = 'admin' and r.entity_id is null and (r.expires_at is null or r.expires_at > now())) then 'admin'::public.app_role
      when exists (select 1 from public.user_roles r where r.user_id = uid and r.role_key = 'board' and r.entity_id is null and (r.expires_at is null or r.expires_at > now())) then 'board'::public.app_role
      else 'investor'::public.app_role end
  where p.id = uid;
  delete from public.entity_admins a where a.user_id = uid
    and not exists (select 1 from public.user_roles r where r.user_id = uid and r.role_key = 'admin' and r.entity_id = a.entity_id);
  insert into public.entity_admins (entity_id, user_id)
    select r.entity_id, uid from public.user_roles r where r.user_id = uid and r.role_key = 'admin' and r.entity_id is not null
    on conflict do nothing;
  delete from public.press_team t where t.user_id = uid
    and not exists (select 1 from public.user_roles r where r.user_id = uid and r.role_key = 'marketing');
  insert into public.press_team (user_id)
    select uid where exists (select 1 from public.user_roles r where r.user_id = uid and r.role_key = 'marketing')
    on conflict do nothing;
  return null;
end;
$$;
create trigger user_roles_sync after insert or update or delete on public.user_roles
for each row execute function public.sync_legacy_roles();

-- ---------------------------------------------------------------------------
-- Access rules for roles other than Admin (Board, Legal, Compliance, Marketing
-- and custom roles), alongside the existing admin and company-admin rules.
-- "view" reads an area; "do" changes what company admins could change.
-- Tables used only through the server (press, newsletters, media, data rooms,
-- shareholder emails, trading) have no rules: the portal checks there.
-- ---------------------------------------------------------------------------

-- Companies where the signed-in person holds this permission (for the rules
-- below; reads the companies list itself, which a role may not otherwise see).
create or replace function public.role_entity_ids(perm text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.entities e where public.can(perm, e.id);
$$;
revoke execute on function public.role_entity_ids(text) from public, anon;
grant execute on function public.role_entity_ids(text) to authenticated;

-- News and announcements
create policy "posts: role read" on public.posts for select to authenticated using ((select public.can('news.view', entity_id)));
create policy "posts: role do" on public.posts for all to authenticated using ((select public.can('news.do', entity_id))) with check ((select public.can('news.do', entity_id)));
create policy "announcements: role read" on public.announcements for select to authenticated using ((select public.can('news.view', entity_id)));
create policy "announcements: role do" on public.announcements for all to authenticated using ((select public.can('news.do', entity_id))) with check ((select public.can('news.do', entity_id)));

-- Documents
create policy "documents: role read" on public.documents for select to authenticated using ((select public.can('documents.view', entity_id)));
create policy "documents: role do" on public.documents for all to authenticated
  using ((select public.can('documents.do', entity_id)))
  with check ((select public.can('documents.do', entity_id)) and (audience <> 'holder' or public.holder_in_entity(holder_id, entity_id)));
create policy "document_chunks: role do" on public.document_chunks for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.can('documents.do', d.entity_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.can('documents.do', d.entity_id)));
create policy "document_reads: role read" on public.document_reads for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.can('documents.view', d.entity_id)));
create policy "documents bucket: role read"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'entity' and public.can('documents.view', ((storage.foldername(name))[2])::uuid));
create policy "documents bucket: role do"
  on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'entity' and public.can('documents.do', ((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'entity' and public.can('documents.do', ((storage.foldername(name))[2])::uuid));

-- The register (read-only for roles; changes stay with admins)
create policy "share_classes: role read" on public.share_classes for select to authenticated
  using ((select public.can('investors.view', entity_id)) or (select public.can('capital.view', entity_id)));
create policy "holdings: role read" on public.holdings for select to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('investors.view', c.entity_id)));
create policy "holders: role read" on public.holders for select to authenticated
  using (exists (select 1 from public.role_entity_ids('investors.view') e where public.holder_in_entity(id, e)));
create policy "holder_members: role read" on public.holder_members for select to authenticated
  using (exists (select 1 from public.role_entity_ids('investors.view') e where public.holder_in_entity(holder_id, e)));
create policy "profiles: role read" on public.profiles for select to authenticated
  using ((select public.can('users.view')) or exists (
    select 1 from public.holder_members m, public.role_entity_ids('investors.view') e
    where m.user_id = profiles.id and public.holder_in_entity(m.holder_id, e)
  ) or exists (
    select 1 from public.queries q where q.user_id = profiles.id and public.can('inbox.view', q.entity_id)
  ));
create policy "holding_notes: role read" on public.holding_notes for select to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('investors.view', c.entity_id)));
create policy "holding_notes: role do" on public.holding_notes for all to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('investors.do', c.entity_id)))
  with check (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('investors.do', c.entity_id)));

-- Meetings
create policy "meetings: role read" on public.meetings for select to authenticated using ((select public.can('meetings.view', entity_id)));
create policy "meetings: role do" on public.meetings for all to authenticated using ((select public.can('meetings.do', entity_id))) with check ((select public.can('meetings.do', entity_id)));
create policy "resolutions: role read" on public.resolutions for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and public.can('meetings.view', m.entity_id)));
create policy "resolutions: role do" on public.resolutions for all to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and public.can('meetings.do', m.entity_id)))
  with check (exists (select 1 from public.meetings m where m.id = meeting_id and public.can('meetings.do', m.entity_id)));
create policy "meeting_questions: role read" on public.meeting_questions for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and public.can('meetings.view', m.entity_id)));
create policy "meeting_questions: role answer" on public.meeting_questions for update to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and public.can('meetings.do', m.entity_id)))
  with check (exists (select 1 from public.meetings m where m.id = meeting_id and public.can('meetings.do', m.entity_id)));
create policy "proxy_votes: role read" on public.proxy_votes for select to authenticated
  using (exists (select 1 from public.resolutions r join public.meetings m on m.id = r.meeting_id where r.id = resolution_id and public.can('meetings.view', m.entity_id)));

-- Board Q&A
create policy "queries: role read" on public.queries for select to authenticated using ((select public.can('inbox.view', entity_id)));
create policy "queries: role update" on public.queries for update to authenticated using ((select public.can('inbox.do', entity_id))) with check ((select public.can('inbox.do', entity_id)));
create policy "query_messages: role read" on public.query_messages for select to authenticated
  using (exists (select 1 from public.queries q where q.id = query_id and public.can('inbox.view', q.entity_id)));
create policy "query_messages: role write" on public.query_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (select 1 from public.queries q where q.id = query_id and public.can('inbox.do', q.entity_id)));

-- Ask Lakeba
create policy "ask_exchanges: role read" on public.ask_exchanges for select to authenticated using (entity_id is not null and (select public.can('ask.view', entity_id)));
create policy "ask_exchanges: role review" on public.ask_exchanges for update to authenticated
  using (entity_id is not null and (select public.can('ask.do', entity_id))) with check (entity_id is not null and (select public.can('ask.do', entity_id)));
create policy "ask_approved_answers: role read" on public.ask_approved_answers for select to authenticated using ((select public.can('ask.view', entity_id)));
create policy "ask_approved_answers: role do" on public.ask_approved_answers for all to authenticated using ((select public.can('ask.do', entity_id))) with check ((select public.can('ask.do', entity_id)));

-- Prices
create policy "reference_prices: role read" on public.reference_prices for select to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('capital.view', c.entity_id)));
create policy "reference_prices: role do" on public.reference_prices for all to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('capital.do', c.entity_id)))
  with check (exists (select 1 from public.share_classes c where c.id = share_class_id and public.can('capital.do', c.entity_id)));

-- Audit log (group roles only)
create policy "audit_log: role read" on public.audit_log for select to authenticated using ((select public.can('audit.view')));
