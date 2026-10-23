-- Shareholder emails: each company's shareholders@ mailbox (Microsoft 365) is
-- read by the portal; each email is checked (sender authentication), matched
-- to a portal account, sorted by Claude and given a draft reply that a person
-- sends (phase 1) or, later, sent automatically for safe requests.
-- Server-side only (service key); admins see them through Admin → Shareholder emails.

alter table public.entities
  add column shareholder_mailbox text check (shareholder_mailbox is null or shareholder_mailbox ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  add column email_mode text not null default 'off' check (email_mode in ('off', 'review', 'auto')),
  add column email_signature text not null default '';

create table public.shareholder_emails (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  mailbox text not null,
  graph_id text not null,
  internet_message_id text,
  conversation_id text,
  from_address text not null,
  from_name text not null default '',
  subject text not null default '',
  body_text text not null default '',
  received_at timestamptz not null,
  -- Sender checks (from Microsoft's Authentication-Results header).
  auth_spf text, auth_dkim text, auth_dmarc text,
  sender_verified boolean not null default false,
  automated boolean not null default false,
  user_id uuid references auth.users (id) on delete set null,
  -- Claude's reading of the email.
  category text,
  confidence numeric(4, 3),
  summary text,
  requested jsonb not null default '{}'::jsonb,
  classify_cost_usd numeric(10, 6),
  status text not null default 'new' check (status in ('new', 'needs_person', 'draft_ready', 'replied', 'handled', 'ignored', 'board_qa', 'error')),
  error text,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  query_id uuid references public.queries (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mailbox, graph_id)
);
create index shareholder_emails_list on public.shareholder_emails (entity_id, received_at desc);
create index shareholder_emails_status on public.shareholder_emails (status, received_at desc);
alter table public.shareholder_emails enable row level security;
revoke all on public.shareholder_emails from anon, authenticated;

create table public.shareholder_email_replies (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.shareholder_emails (id) on delete cascade,
  kind text not null check (kind in ('draft', 'sent')),
  body text not null,
  -- Portal pages to link with one-time sign-in links when sent: [{ "label": "...", "path": "/statement/..." }].
  links jsonb not null default '[]'::jsonb,
  sent_to text,
  sent_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  automatic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shareholder_email_replies_email on public.shareholder_email_replies (email_id);
alter table public.shareholder_email_replies enable row level security;
revoke all on public.shareholder_email_replies from anon, authenticated;

-- Where each mailbox's reading got to (Microsoft Graph delta link).
create table public.email_sync_state (
  mailbox text primary key,
  delta_link text,
  last_checked_at timestamptz,
  last_error text
);
alter table public.email_sync_state enable row level security;
revoke all on public.email_sync_state from anon, authenticated;

-- Group shareholders' mailbox.
update public.entities set shareholder_mailbox = 'shareholders@lakeba.com' where code = 'LKB' and shareholder_mailbox is null;
