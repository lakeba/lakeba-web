-- Legal and company secretary, phase 4: legal requests from the ventures
-- (anyone with a staff role at a venture sends one; Lakeba AI triages it and
-- gives the Legal team a first view; the Legal team answers in a thread) and
-- Legal Ask (the Legal team's questions answered from contracts, records,
-- resolutions, minutes and governance documents, with sources).
-- Read and written by the portal's server only; files in the "legal" bucket.

create table public.legal_requests (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  title text not null check (length(title) between 3 and 200),
  kind text not null default 'other' check (kind in ('contract_review', 'contract_draft', 'advice', 'corporate', 'employment', 'dispute', 'ip', 'privacy', 'other')),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'urgent')),
  -- When the requester needs it by (optional).
  needed_by date,
  status text not null default 'new' check (status in ('new', 'in_progress', 'waiting', 'done', 'cancelled')),
  requested_by uuid references public.profiles (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  -- Lakeba AI's triage: {summary, missing[], related_contracts[{id,title}], first_view, flags[]}; for the Legal team only.
  triage jsonb not null default '{}',
  ai_cost_usd numeric(10, 5) not null default 0,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index legal_requests_entity_idx on public.legal_requests (entity_id, status);
create index legal_requests_status_idx on public.legal_requests (status, created_at desc);

create table public.legal_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.legal_requests (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null default '',
  -- A note for the Legal team only, never shown to the venture.
  internal boolean not null default false,
  -- [{path, name, size}]
  files jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index legal_request_messages_idx on public.legal_request_messages (request_id, created_at);

-- Legal Ask: each question, its answer and sources (the Legal team's own history; also an audit trail).
create table public.legal_ask_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  question text not null,
  answer text not null default '',
  -- [{ref, kind, id, title, company}]
  sources jsonb not null default '[]',
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);
create index legal_ask_log_user_idx on public.legal_ask_log (user_id, created_at desc);

alter table public.legal_requests enable row level security;
alter table public.legal_request_messages enable row level security;
alter table public.legal_ask_log enable row level security;
revoke all on public.legal_requests, public.legal_request_messages, public.legal_ask_log from anon, authenticated;
