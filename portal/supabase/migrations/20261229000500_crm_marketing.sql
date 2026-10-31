-- CRM, phase 5 (docs/crm.md): marketing and lead generation. Forms on the venture's website (and hosted
-- landing pages) that bring leads into the CRM; campaigns measured in cash paid in Xero; lead scoring by fit
-- and behaviour; email sequences sent from the salesperson's own mailbox that stop on a reply; one opt-out
-- list (the CRM's, the newsletters' and the press office's); playbooks. A new permission area "leadgen"
-- (CRM marketing): the Marketing role works there without seeing deals; sales leads and Admins have it too.

alter table public.entities
  -- The ideal customer, for lead scoring: industries, sizes, countries and job-title words.
  add column crm_ideal jsonb not null default '{"industries": [], "sizes": [], "countries": [], "titles": ["ceo", "cfo", "coo", "head", "director", "chief", "vp", "manager"]}',
  add column crm_rr_index int not null default 0;

create table public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  kind text not null default 'other' check (kind in ('webinar', 'event', 'landing', 'paid', 'referral', 'press', 'newsletter', 'email', 'partner', 'other')),
  -- utm_campaign on links and forms: how a lead is credited to it.
  utm text not null check (utm ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  starts_on date,
  ends_on date,
  -- Spend typed in, and/or Xero bills tagged with this tracking option (e.g. Campaign: Logistics webinar).
  spend numeric(14, 2) not null default 0,
  xero_tracking text,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entity_id, utm)
);

alter table public.crm_relationships
  add column score int not null default 0 check (score between 0 and 100),
  add column score_reasons jsonb not null default '[]',
  add column campaign_id uuid references public.crm_campaigns (id) on delete set null;
alter table public.crm_deals add column campaign_id uuid references public.crm_campaigns (id) on delete set null;

create table public.crm_sequences (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  -- [{ day: 0, subject, body }]: day after enrolling; {first_name}, {company}, {sender} are filled in.
  steps jsonb not null default '[]',
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.crm_enrolments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.crm_sequences (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  person_id uuid not null references public.crm_people (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  step int not null default 0,
  next_at timestamptz,
  -- active, finished, stopped (a reply, a meeting, an opt-out, the deal closed, or by hand).
  status text not null default 'active' check (status in ('active', 'finished', 'stopped')),
  stopped_reason text not null default '',
  enrolled_at timestamptz not null default now(),
  unique (sequence_id, person_id)
);
create index crm_enrolments_due_idx on public.crm_enrolments (status, next_at);

create table public.crm_forms (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  headline text not null default '',
  intro text not null default '',
  -- [{ key, label, type: text|email|phone|textarea|select, required, options }]
  fields jsonb not null default '[]',
  button text not null default 'Send',
  thank_you text not null default 'Thank you. We’ll be in touch shortly.',
  redirect_url text,
  -- Websites allowed to show the form (https://doxai.com); the hosted page always works.
  allowed_origins text[] not null default '{}',
  create_deal boolean not null default false,
  pipeline_id uuid references public.crm_pipelines (id) on delete set null,
  -- round_robin across the sales team, or one person.
  owner_rule text not null default 'round_robin' check (owner_rule in ('round_robin', 'fixed')),
  owner_id uuid references public.profiles (id) on delete set null,
  campaign_id uuid references public.crm_campaigns (id) on delete set null,
  sequence_id uuid references public.crm_sequences (id) on delete set null,
  consent_text text not null default 'I agree to be contacted about this request.',
  active boolean not null default true,
  submissions int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- What each person agreed to (or refused): sales emails, newsletters, WhatsApp, recording. One list for the group.
create table public.crm_consents (
  person_id uuid not null references public.crm_people (id) on delete cascade,
  channel text not null check (channel in ('sales_email', 'newsletter', 'whatsapp', 'recording')),
  status text not null check (status in ('yes', 'no')),
  source text not null default '',
  entity_id uuid references public.entities (id) on delete set null,
  at timestamptz not null default now(),
  primary key (person_id, channel)
);

alter table public.crm_campaigns enable row level security;
alter table public.crm_sequences enable row level security;
alter table public.crm_enrolments enable row level security;
alter table public.crm_forms enable row level security;
alter table public.crm_consents enable row level security;
revoke all on public.crm_campaigns, public.crm_sequences, public.crm_enrolments, public.crm_forms, public.crm_consents from anon, authenticated;

insert into public.role_permissions (role_key, permission) values
  ('marketing', 'leadgen.view'), ('marketing', 'leadgen.do'),
  ('sales_lead', 'leadgen.view'), ('sales_lead', 'leadgen.do'),
  ('admin', 'leadgen.view'), ('admin', 'leadgen.do')
on conflict do nothing;
