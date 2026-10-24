-- Data rooms: a company shares chosen PDF documents with prospective investors
-- who have no portal account. Each guest gets a personal link (only its hash is
-- stored), accepts the confidentiality terms once, and every PDF they open is
-- stamped with their name, email and the date. Every view is logged.
-- Only the portal server (service key) reads or writes these tables; it checks
-- the admin's company before every change.

create table public.data_rooms (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 2 and 120),
  description text not null default '',
  nda_text text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index data_rooms_entity_idx on public.data_rooms (entity_id, created_at desc);

create table public.data_room_documents (
  room_id uuid not null references public.data_rooms (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  sort int not null default 0,
  primary key (room_id, document_id)
);

create table public.data_room_guests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.data_rooms (id) on delete cascade,
  name text not null,
  email text not null,
  organisation text not null default '',
  token_hash text not null unique,
  expires_at timestamptz not null,
  nda_accepted_at timestamptz,
  nda_accepted_ip text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index data_room_guests_room_idx on public.data_room_guests (room_id);

create table public.data_room_views (
  id bigint generated always as identity primary key,
  guest_id uuid not null references public.data_room_guests (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  viewed_at timestamptz not null default now(),
  ip text
);
create index data_room_views_guest_idx on public.data_room_views (guest_id, viewed_at desc);

alter table public.data_rooms enable row level security;
alter table public.data_room_documents enable row level security;
alter table public.data_room_guests enable row level security;
alter table public.data_room_views enable row level security;
revoke all on public.data_rooms, public.data_room_documents, public.data_room_guests, public.data_room_views from anon, authenticated;
