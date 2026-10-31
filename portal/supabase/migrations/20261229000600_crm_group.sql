-- CRM, phase 6 (docs/crm.md): the group. Two ventures can share what their CRMs know (that they know a person
-- or company, who owns the relationship, work contact details and, if each allows, the deal stage) once both
-- switch it on; never values, quotes, notes, emails or recordings. Introductions between ventures go through
-- the relationship's owner. Shareholders introduce businesses to a venture from the investor portal and follow
-- the stage. A person can agree to hear from Lakeba's ventures ("ventures" consent).

create table public.crm_sharing (
  id uuid primary key default gen_random_uuid(),
  -- The two ventures, in id order (one row per pair).
  entity_a uuid not null references public.entities (id) on delete cascade,
  entity_b uuid not null references public.entities (id) on delete cascade,
  a_on_by uuid references auth.users (id) on delete set null,
  a_on_at timestamptz,
  b_on_by uuid references auth.users (id) on delete set null,
  b_on_at timestamptz,
  -- Whether each side shows its deal stage to the other.
  a_shares_stage boolean not null default false,
  b_shares_stage boolean not null default false,
  check (entity_a < entity_b),
  unique (entity_a, entity_b)
);

create table public.crm_introductions (
  id uuid primary key default gen_random_uuid(),
  -- Who asks: a shareholder (from the investor portal) or a salesperson of another venture.
  by_kind text not null check (by_kind in ('shareholder', 'venture')),
  by_user uuid references public.profiles (id) on delete set null,
  from_entity_id uuid references public.entities (id) on delete set null,
  to_entity_id uuid not null references public.entities (id) on delete cascade,
  person_id uuid references public.crm_people (id) on delete set null,
  company_id uuid references public.crm_companies (id) on delete set null,
  -- The relationship owner asked to make the introduction (venture to venture).
  owner_id uuid references public.profiles (id) on delete set null,
  note text not null default '',
  -- sent → accepted (introduced) / declined; then meeting, customer or not_now as the deal goes.
  stage text not null default 'sent' check (stage in ('sent', 'accepted', 'declined', 'meeting', 'customer', 'not_now')),
  deal_id uuid references public.crm_deals (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_introductions_to_idx on public.crm_introductions (to_entity_id, created_at desc);
create index crm_introductions_by_idx on public.crm_introductions (by_user, created_at desc);

alter table public.entities
  -- Shareholders may introduce businesses to it, with this one line about what it does.
  add column crm_accepts_introductions boolean not null default false,
  add column crm_pitch text not null default '';

alter table public.crm_consents drop constraint crm_consents_channel_check;
alter table public.crm_consents add constraint crm_consents_channel_check check (channel in ('sales_email', 'newsletter', 'whatsapp', 'recording', 'ventures'));

alter table public.crm_sharing enable row level security;
alter table public.crm_introductions enable row level security;
revoke all on public.crm_sharing, public.crm_introductions from anon, authenticated;
