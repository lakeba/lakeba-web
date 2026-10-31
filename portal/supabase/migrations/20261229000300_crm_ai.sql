-- CRM, phase 3 (docs/crm.md): Lakeba AI in the CRM. A monthly AI budget per company and what was spent on
-- what; drafts on suggested tasks (a follow-up email ready to send); sales meetings recorded by the meeting
-- bot (Recall) and turned into notes, next steps and a suggested stage; the Monday review's coaching notes;
-- questions asked of the CRM. AI pauses when the month's budget is used; everything else keeps working.

alter table public.entities add column crm_ai_monthly_usd numeric(10, 2) default 50 check (crm_ai_monthly_usd is null or crm_ai_monthly_usd >= 0);

create table public.crm_ai_usage (
  id bigint generated always as identity primary key,
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  -- today, deal_review, brief, inbox, ask, meeting, review, whatsapp, draft…
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);
create index crm_ai_usage_entity_idx on public.crm_ai_usage (entity_id, created_at desc);

alter table public.crm_tasks add column note text not null default '';

create table public.crm_recordings (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  deal_id uuid references public.crm_deals (id) on delete set null,
  bot_id text not null unique,
  meeting_url text not null,
  status text not null default 'sent',
  error text,
  transcript text,
  summary jsonb,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  finished_at timestamptz
);
create index crm_recordings_deal_idx on public.crm_recordings (deal_id);

create table public.crm_reviews (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  week date not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  note text not null default '',
  facts jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (entity_id, week, owner_id)
);

create table public.crm_ask_log (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  question text not null,
  answer text not null default '',
  sources jsonb not null default '[]',
  via text not null default 'web' check (via in ('web', 'whatsapp', 'app')),
  created_at timestamptz not null default now()
);

alter table public.crm_ai_usage enable row level security;
alter table public.crm_recordings enable row level security;
alter table public.crm_reviews enable row level security;
alter table public.crm_ask_log enable row level security;
revoke all on public.crm_ai_usage, public.crm_recordings, public.crm_reviews, public.crm_ask_log from anon, authenticated;
