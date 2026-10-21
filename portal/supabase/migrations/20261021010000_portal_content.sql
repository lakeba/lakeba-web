-- Phase 2–3: documents (private storage), read tracking, news, announcements,
-- board Q&A, notifications and portal settings.

-- ---------------------------------------------------------------------------
-- Audience helpers
-- ---------------------------------------------------------------------------
create function public.has_any_holder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.holder_members m where m.user_id = (select auth.uid()));
$$;

-- Shareholders, directors and (MFA-verified) admins see portal-wide content.
create function public.is_portal_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_holder() or public.current_role_is('board') or public.is_admin();
$$;

-- Adds n working days (Mon–Fri). Public holidays are not excluded.
create function public.add_working_days(start_at timestamptz, days int)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  result timestamptz := start_at;
  added int := 0;
begin
  while added < days loop
    result := result + interval '1 day';
    if extract(isodow from result at time zone 'Australia/Sydney') < 6 then
      added := added + 1;
    end if;
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: communication preference
-- ---------------------------------------------------------------------------
alter table public.profiles add column notify_email boolean not null default true;
grant update (notify_email) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create type public.document_category as enum ('report', 'agm', 'update', 'governance', 'register', 'video', 'other');
create type public.document_audience as enum ('all_investors', 'board', 'holder');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  category public.document_category not null,
  file_path text not null unique,
  mime_type text not null,
  size_bytes bigint,
  audience public.document_audience not null default 'all_investors',
  holder_id uuid references public.holders (id) on delete cascade,
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((audience = 'holder') = (holder_id is not null))
);
create index documents_published_idx on public.documents (published_at desc);

create function public.can_read_document(doc public.documents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (
    doc.published_at is not null and doc.published_at <= now() and (
      (doc.audience = 'all_investors' and (public.has_any_holder() or public.current_role_is('board')))
      or (doc.audience = 'board' and public.current_role_is('board'))
      or (doc.audience = 'holder' and public.is_holder_member(doc.holder_id))
    )
  );
$$;

create table public.document_reads (
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_read_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  read_count int not null default 1,
  primary key (document_id, user_id)
);

-- Records that the signed-in user opened a document they are allowed to see.
create function public.record_document_read(doc_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents;
begin
  select * into doc from public.documents where id = doc_id;
  if doc.id is null or not public.can_read_document(doc) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.document_reads (document_id, user_id) values (doc_id, (select auth.uid()))
  on conflict (document_id, user_id)
  do update set last_read_at = now(), read_count = public.document_reads.read_count + 1;
  perform public.log_event('document_opened', jsonb_build_object('document_id', doc_id, 'title', doc.title));
end;
$$;

-- ---------------------------------------------------------------------------
-- News, announcements, settings
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  excerpt text not null default '',
  body_md text not null default '',
  cover_url text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create type public.announcement_tone as enum ('info', 'success', 'warning');
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  link_url text,
  link_label text,
  tone public.announcement_tone not null default 'info',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.portal_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Board Q&A
-- ---------------------------------------------------------------------------
create type public.query_status as enum ('open', 'answered', 'closed');

create table public.queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (length(subject) between 3 and 200),
  status public.query_status not null default 'open',
  due_at timestamptz not null default public.add_working_days(now(), 7),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index queries_user_idx on public.queries (user_id, created_at desc);
create index queries_status_idx on public.queries (status, due_at);

create table public.query_messages (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references public.queries (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(body) between 1 and 10000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index query_messages_query_idx on public.query_messages (query_id, created_at);

-- An investor reply reopens the query; an admin public reply marks it answered.
create function public.on_query_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.internal then
    update public.queries
       set status = case when public.is_admin() then 'answered'::public.query_status else 'open'::public.query_status end,
           due_at = case when public.is_admin() then due_at else public.add_working_days(now(), 7) end,
           updated_at = now()
     where id = new.query_id;
  end if;
  return new;
end;
$$;
create trigger query_messages_after_insert
  after insert on public.query_messages
  for each row execute function public.on_query_message();

-- ---------------------------------------------------------------------------
-- Notifications (in-app inbox)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.document_reads enable row level security;
alter table public.posts enable row level security;
alter table public.announcements enable row level security;
alter table public.portal_settings enable row level security;
alter table public.queries enable row level security;
alter table public.query_messages enable row level security;
alter table public.notifications enable row level security;

create policy "documents: readers" on public.documents
  for select to authenticated using ((select public.can_read_document(documents)));
create policy "documents: admin write" on public.documents
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "document_reads: own or admin" on public.document_reads
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "posts: members read published" on public.posts
  for select to authenticated using ((select public.is_admin()) or (published_at <= now() and (select public.is_portal_member())));
create policy "posts: admin write" on public.posts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "announcements: members read current" on public.announcements
  for select to authenticated using (
    (select public.is_admin())
    or ((select public.is_portal_member()) and starts_at <= now() and (ends_at is null or ends_at > now()))
  );
create policy "announcements: admin write" on public.announcements
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "portal_settings: members read" on public.portal_settings
  for select to authenticated using ((select public.is_portal_member()));
create policy "portal_settings: admin write" on public.portal_settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "queries: own or admin" on public.queries
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "queries: members create own" on public.queries
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_portal_member()));
create policy "queries: admin update" on public.queries
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- Investors cannot set status, due date or assignee when creating.
revoke insert on public.queries from authenticated;
grant insert (user_id, subject) on public.queries to authenticated;

create policy "query_messages: read" on public.query_messages
  for select to authenticated using (
    (select public.is_admin())
    or (not internal and exists (select 1 from public.queries q where q.id = query_id and q.user_id = (select auth.uid())))
  );
create policy "query_messages: investor reply" on public.query_messages
  for insert to authenticated with check (
    author_id = (select auth.uid()) and not internal
    and exists (select 1 from public.queries q where q.id = query_id and q.user_id = (select auth.uid()) and q.status <> 'closed')
  );
create policy "query_messages: admin write" on public.query_messages
  for insert to authenticated with check ((select public.is_admin()) and author_id = (select auth.uid()));

create policy "notifications: own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: mark read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "notifications: admin insert" on public.notifications
  for insert to authenticated with check ((select public.is_admin()));

revoke execute on function public.has_any_holder() from public, anon;
revoke execute on function public.is_portal_member() from public, anon;
revoke execute on function public.can_read_document(public.documents) from public, anon;
revoke execute on function public.record_document_read(uuid) from public, anon;
grant execute on function public.has_any_holder() to authenticated;
grant execute on function public.is_portal_member() to authenticated;
grant execute on function public.can_read_document(public.documents) to authenticated;
grant execute on function public.record_document_read(uuid) to authenticated;

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Private file storage: readable only through documents the user may see.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 524288000)
on conflict (id) do nothing;

create policy "documents bucket: readers"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (select 1 from public.documents d where d.file_path = name and public.can_read_document(d))
  );
create policy "documents bucket: admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_admin());
create policy "documents bucket: admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.is_admin());
create policy "documents bucket: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());
