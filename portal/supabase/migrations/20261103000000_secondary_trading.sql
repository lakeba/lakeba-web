-- Secondary trading board. Shareholders register a non-binding interest to buy
-- or sell shares of a company; admins pair a seller with a buyer (after any
-- pre-emptive rights and board approval the constitution requires) and, once
-- the transfer is signed, mark it complete, which updates the share register.
-- Only the portal server (service key) reads or writes these tables; it checks
-- the person's holders, or the admin's company, before every change.

create table public.trading_settings (
  entity_id uuid primary key references public.entities (id) on delete cascade,
  enabled boolean not null default false,
  window_opens date,
  window_closes date,
  rules text not null default '',
  show_book boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.trade_interests (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  share_class_id uuid not null references public.share_classes (id),
  holder_id uuid not null references public.holders (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  side text not null check (side in ('buy', 'sell')),
  shares bigint not null check (shares > 0),
  price numeric(14, 4) not null check (price > 0),
  note text not null default '',
  -- open: in the book · matched: fully paired · completed · withdrawn (by the person) · cancelled (by an admin)
  status text not null default 'open' check (status in ('open', 'matched', 'completed', 'withdrawn', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trade_interests_entity_idx on public.trade_interests (entity_id, status, side);
create index trade_interests_holder_idx on public.trade_interests (holder_id);

create table public.trade_matches (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  share_class_id uuid not null references public.share_classes (id),
  sell_id uuid not null references public.trade_interests (id) on delete cascade,
  buy_id uuid not null references public.trade_interests (id) on delete cascade,
  shares bigint not null check (shares > 0),
  price numeric(14, 4) not null check (price > 0),
  -- approved: paired, transfer being arranged · completed: register updated · cancelled
  status text not null default 'approved' check (status in ('approved', 'completed', 'cancelled')),
  admin_note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_on date,
  completed_by uuid references auth.users (id) on delete set null
);
create index trade_matches_entity_idx on public.trade_matches (entity_id, status);

alter table public.trading_settings enable row level security;
alter table public.trade_interests enable row level security;
alter table public.trade_matches enable row level security;
revoke all on public.trading_settings, public.trade_interests, public.trade_matches from anon, authenticated;
