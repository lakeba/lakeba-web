-- Investor portal foundation: accounts, roles, holders, holdings and audit log.
-- Every table has row-level security. Investors can only read what belongs to
-- the holders they are linked to; writes are admin-only and need MFA (aal2).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('investor', 'board', 'admin');
create type public.holder_kind as enum ('individual', 'company', 'trust', 'super_fund');
create type public.member_access as enum ('owner', 'viewer');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  phone text,
  role public.app_role not null default 'investor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.holders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.holder_kind not null,
  registry_ref text unique,
  created_at timestamptz not null default now()
);

-- Links a login to the holding entities it may see (one login, many entities;
-- 'viewer' is read-only access, e.g. an accountant).
create table public.holder_members (
  holder_id uuid not null references public.holders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access public.member_access not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (holder_id, user_id)
);
create index holder_members_user_idx on public.holder_members (user_id);

create table public.share_classes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

-- One row per holder, class and "as at" date, so history is kept.
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  holder_id uuid not null references public.holders (id) on delete cascade,
  share_class_id uuid not null references public.share_classes (id),
  shares bigint not null check (shares >= 0),
  as_at date not null,
  created_at timestamptz not null default now(),
  unique (holder_id, share_class_id, as_at)
);
create index holdings_holder_idx on public.holdings (holder_id, share_class_id, as_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------
create function public.current_role_is(wanted public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = wanted
  );
$$;

-- Admin privileges only count in a session that passed MFA.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_role_is('admin')
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

create function public.is_holder_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.holder_members m
    where m.holder_id = target and m.user_id = (select auth.uid())
  );
$$;

-- Latest holding per holder and class, summed: the "total on issue" figure.
-- Investors may see the totals without seeing anyone else's rows.
create function public.shares_on_issue()
returns table (share_class_id uuid, code text, name text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (h.holder_id, h.share_class_id) h.share_class_id, h.shares
    from public.holdings h
    order by h.holder_id, h.share_class_id, h.as_at desc
  )
  select c.id, c.code, c.name, coalesce(sum(l.shares), 0)::bigint
  from public.share_classes c
  left join latest l on l.share_class_id = c.id
  group by c.id, c.code, c.name;
$$;

-- Records an event for the signed-in user. The only way clients write to the log.
create function public.log_event(event_action text, event_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (user_id, action, detail)
  values ((select auth.uid()), event_action, coalesce(event_detail, '{}'::jsonb));
$$;

revoke execute on function public.current_role_is(public.app_role) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_holder_member(uuid) from public, anon;
revoke execute on function public.shares_on_issue() from public, anon;
revoke execute on function public.log_event(text, jsonb) from public, anon;
grant execute on function public.current_role_is(public.app_role) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_holder_member(uuid) to authenticated;
grant execute on function public.shares_on_issue() to authenticated;
grant execute on function public.log_event(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile lifecycle
-- ---------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.holders enable row level security;
alter table public.holder_members enable row level security;
alter table public.share_classes enable row level security;
alter table public.holdings enable row level security;
alter table public.audit_log enable row level security;

-- profiles: read yourself; admins read and manage everyone.
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: admin update" on public.profiles
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Investors may only change their own contact fields, never role or email.
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone) on public.profiles to authenticated;

-- holders / holder_members / holdings: members read, admins manage.
create policy "holders: members read" on public.holders
  for select to authenticated using ((select public.is_holder_member(id)) or (select public.is_admin()));
create policy "holders: admin write" on public.holders
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "holder_members: read own links" on public.holder_members
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "holder_members: admin write" on public.holder_members
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "share_classes: signed-in read" on public.share_classes
  for select to authenticated using (true);
create policy "share_classes: admin write" on public.share_classes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "holdings: members read" on public.holdings
  for select to authenticated using ((select public.is_holder_member(holder_id)) or (select public.is_admin()));
create policy "holdings: admin write" on public.holdings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- audit_log: admins read; nobody writes directly (use log_event).
create policy "audit_log: admin read" on public.audit_log
  for select to authenticated using ((select public.is_admin()));

-- Nothing is readable before sign-in.
revoke all on all tables in schema public from anon;
