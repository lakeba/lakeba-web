-- Boardroom tablets: a tablet (the Lex app, or any browser at /tablet) shows a
-- six-digit code; the company secretary, signed in with two-step, enters it on
-- the meeting's page; the tablet then opens that meeting's Observer, acting for
-- the secretary who connected it, and nothing else. It lets go when the
-- meeting is finished, when someone disconnects it, or after 12 hours.
--
-- The tablet holds a random secret (a cookie); only its hash is kept here, as
-- is the code's. Read and written by the portal's server only.

create table public.board_tablets (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique,
  code_hash text,
  code_expires_at timestamptz,
  device_name text not null default '' check (length(device_name) <= 80),
  meeting_id uuid references public.board_meetings (id) on delete cascade,
  entity_id uuid references public.entities (id) on delete cascade,
  paired_by uuid references auth.users (id) on delete cascade,
  paired_at timestamptz,
  expires_at timestamptz,
  released_at timestamptz,
  released_why text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index board_tablets_code_idx on public.board_tablets (code_hash) where meeting_id is null;
create index board_tablets_meeting_idx on public.board_tablets (meeting_id) where released_at is null;

alter table public.board_tablets enable row level security;
revoke all on public.board_tablets from anon, authenticated;
