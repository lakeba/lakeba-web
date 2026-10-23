-- A passkey sign-in where the device checked the person (Face ID, Touch ID,
-- Windows Hello or a PIN: the WebAuthn "user verified" flag) is two factors
-- in one step: something you have plus something you are or know. Supabase
-- still marks those sessions aal1, so the portal records them here and the
-- admin rules accept them like a session that passed the authenticator code.
-- Rows are written only by the portal's server (service key) after Supabase
-- has verified the passkey, and go when the session ends.

create table public.passkey_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.passkey_sessions enable row level security;
revoke all on public.passkey_sessions from anon, authenticated;

-- True when this session passed two-step verification or a verified passkey sign-in.
create function public.session_is_strong()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or exists (
        select 1 from public.passkey_sessions s
        where s.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
          and s.user_id = (select auth.uid())
      );
$$;
revoke execute on function public.session_is_strong() from public, anon;
grant execute on function public.session_is_strong() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_role_is('admin') and public.session_is_strong();
$$;

create or replace function public.is_entity_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (
    public.session_is_strong()
    and exists (select 1 from public.entity_admins a where a.entity_id = target and a.user_id = (select auth.uid()))
  );
$$;
