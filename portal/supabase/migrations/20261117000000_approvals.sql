-- Approvals (Admin → Approvals), optional per item: whoever prepares a
-- document, news post, newsletter, meeting or trade can ask for approval. It
-- then can't be published, sent, opened for voting or completed until
-- someone with "approve" for that area (and company) approves it, and that
-- can't be the person who asked. Changing an approved item asks again.
-- One row per item (its current approval); the history is in the audit log.
-- Used through the server only.

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('document', 'post', 'newsletter', 'meeting', 'trade')),
  item_id uuid not null,
  area text not null,
  entity_id uuid references public.entities (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  title text not null default '',
  note text not null default '',
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  unique (item_type, item_id)
);
create index approvals_status_idx on public.approvals (status, area);

alter table public.approvals enable row level security;
revoke all on public.approvals from anon, authenticated;
