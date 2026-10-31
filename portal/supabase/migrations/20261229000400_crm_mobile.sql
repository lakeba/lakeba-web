-- CRM, phase 4 (docs/crm.md): the CRM on the phone. Salespeople link their WhatsApp number (they send a code to
-- the CRM's WhatsApp number), then update deals and ask questions there by text or voice; voice notes and
-- business cards from the CRM app on the phone. The messages are kept for a short while to answer and file
-- them (the filed note is on the deal's timeline).

create table public.crm_phones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  -- E.164 without "+", as WhatsApp sends it (61412345678); null until linked.
  phone text unique check (phone is null or phone ~ '^[1-9][0-9]{6,15}$'),
  link_code text,
  code_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, entity_id)
);

create table public.crm_whatsapp (
  id bigint generated always as identity primary key,
  message_id text not null unique,
  phone text not null,
  user_id uuid references public.profiles (id) on delete set null,
  entity_id uuid references public.entities (id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'text',
  text text not null default '',
  -- What the assistant did with it (deal updated, question answered…).
  result jsonb,
  created_at timestamptz not null default now()
);
create index crm_whatsapp_phone_idx on public.crm_whatsapp (phone, created_at desc);

alter table public.crm_phones enable row level security;
alter table public.crm_whatsapp enable row level security;
revoke all on public.crm_phones, public.crm_whatsapp from anon, authenticated;
