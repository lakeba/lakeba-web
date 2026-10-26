-- Guided set-up of a venture's own domain and email, for people who aren't
-- technical. The venture's admins can send the steps to whoever looks after
-- its domain or email (an "IT person"): a private link, valid for 7 days, that
-- opens only the set-up steps, with no portal account. Only a hash of it is
-- kept. ms_connected_at: when the venture's Microsoft 365 approved the portal.

alter table public.entities add column ms_connected_at timestamptz;
update public.entities set ms_connected_at = now() where ms_tenant_id is not null;

create table public.setup_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  entity_id uuid not null references public.entities (id) on delete cascade,
  recipient_name text,
  recipient_email text not null check (recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  opened_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index setup_handoffs_entity on public.setup_handoffs (entity_id, created_at desc);
alter table public.setup_handoffs enable row level security;

-- An approval asked through a hand-off link (so the venture sees who did it).
alter table public.ms_consent_requests add column handoff_id uuid references public.setup_handoffs (id) on delete set null;
