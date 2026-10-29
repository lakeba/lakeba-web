-- Accounting, phases 3 and 4.
-- Phase 3: each pack can list its balances and charges with other group
-- companies (kept in reporting_packs.figures.ic); Lakeba matches them pair by
-- pair, removes them in the consolidated view, exports the group to Excel and
-- makes a one-page board summary (board_summaries).
-- Phase 4: year-end and audit requests: a list of what the auditor needs from
-- a venture for a financial year, each item provided (with files) by the
-- venture and ticked off by Lakeba.
-- Read and written by the portal's server only; files in the "legal" bucket.

create table public.board_summaries (
  id uuid primary key default gen_random_uuid(),
  period_end date not null unique,
  commentary text not null default '',
  ai_cost_usd numeric(10, 5) not null default 0,
  -- The PDF filed in Documents for the board, when it was.
  document_id uuid references public.documents (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.audit_requests (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  -- The financial year's last day.
  year_end date not null,
  title text not null check (length(title) between 3 and 200),
  due_on date not null,
  auditor text not null default '',
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, year_end)
);

create table public.audit_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.audit_requests (id) on delete cascade,
  sort int not null default 0,
  title text not null check (length(title) between 2 and 300),
  detail text not null default '',
  -- requested: waiting for the venture; provided; accepted by Lakeba; not_applicable.
  status text not null default 'requested' check (status in ('requested', 'provided', 'accepted', 'not_applicable')),
  -- [{path, name, size}]
  files jsonb not null default '[]',
  -- The venture's note, and Lakeba's (e.g. what is still missing).
  note text not null default '',
  review_note text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index audit_items_request_idx on public.audit_items (request_id, sort);

alter table public.board_summaries enable row level security;
alter table public.audit_requests enable row level security;
alter table public.audit_items enable row level security;
revoke all on public.board_summaries, public.audit_requests, public.audit_items from anon, authenticated;
