-- Integrations, part 3: incoming webhooks. Each company can make addresses
-- (/api/hooks/in/<token>) that other tools post to: website forms, the company
-- secretary's register, DocuSign, or any JSON with a field mapping. What
-- arrives is kept first, answered at once and handled by the portal's worker.
-- Anything that would change the register, holdings or who is an investor
-- waits for an Admin ("Needs review"); newsletter sign-ups, contact details of
-- existing investors and signed documents (as drafts) are handled straight away.
-- Read and written by the portal server only.

create table public.inbound_endpoints (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  -- What it receives and what the portal does with it.
  kind text not null check (kind in ('newsletter.subscribe', 'person.update', 'person.add', 'data_room.request', 'register.pdf', 'document.signed')),
  -- How a sender proves it's them: lakeba (Lakeba-Signature t=,v1=), hmac_hex (X-Signature: sha256=<hex>),
  -- typeform (Typeform-Signature: sha256=<base64>), docusign (X-DocuSign-Signature-1, base64), bearer (Authorization: Bearer <secret>).
  auth text not null default 'lakeba' check (auth in ('lakeba', 'hmac_hex', 'typeform', 'docusign', 'bearer')),
  token text not null unique,
  secret_enc text not null,
  -- Field mapping (JSON paths like "data.email") and choices (data room, document category…).
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_received_at timestamptz
);
create index inbound_endpoints_entity_idx on public.inbound_endpoints (entity_id);

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  -- An incoming webhook, or (null) the company API (a register sent with a key).
  endpoint_id uuid references public.inbound_endpoints (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  kind text not null,
  source text not null default 'webhook' check (source in ('webhook', 'api')),
  received_at timestamptz not null default now(),
  -- The sender's own id for it, when it gives one (repeats are ignored).
  dedupe text,
  headers jsonb not null default '{}'::jsonb,
  body text,
  -- A file that came with it (in private storage).
  file_path text,
  status text not null default 'received' check (status in ('received', 'done', 'needs_review', 'approved', 'rejected', 'failed', 'ignored')),
  -- What the portal will do (or did), in words, and the details.
  summary text,
  result jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  processed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  unique (endpoint_id, dedupe)
);
create index inbound_messages_entity_idx on public.inbound_messages (entity_id, received_at desc);
create index inbound_messages_todo_idx on public.inbound_messages (received_at) where status = 'received';

alter table public.inbound_endpoints enable row level security;
alter table public.inbound_messages enable row level security;
revoke all on public.inbound_endpoints, public.inbound_messages from anon, authenticated;

-- Newsletter subscribers can also come from the company API or an incoming webhook.
alter table public.newsletter_subscribers drop constraint newsletter_subscribers_source_check;
alter table public.newsletter_subscribers add constraint newsletter_subscribers_source_check check (source in ('website', 'admin', 'api', 'integration'));
