-- Newsletters: quarterly issues for a company's shareholders, and a public
-- newsletter for prospective investors and website visitors (people who
-- subscribe on the website and confirm by email). An issue is composed in
-- Admin → Newsletters; when sent, each recipient gets a row here with a
-- personal token for the web version, tracking and one-click unsubscribe.
-- Only the portal server (service key) reads or writes these tables.

create table public.newsletter_issues (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('shareholders', 'public')),
  entity_id uuid not null references public.entities (id) on delete cascade,
  subject text not null default '',
  preheader text not null default '',
  -- intro_html, post_ids, document_ids, meetings, holding, closing_html, cta_label, cta_url
  content jsonb not null default '{}',
  -- who: { segment: 'all' | 'quiet' | 'class', share_class_id }
  segment jsonb not null default '{"segment": "all"}',
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index newsletter_issues_entity_idx on public.newsletter_issues (entity_id, created_at desc);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null default '',
  source text not null default 'website' check (source in ('website', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed')),
  confirm_token_hash text unique,
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  consent_ip text,
  created_at timestamptz not null default now()
);
create unique index newsletter_subscribers_email_idx on public.newsletter_subscribers (lower(email));

create table public.newsletter_recipients (
  id bigint generated always as identity primary key,
  issue_id uuid not null references public.newsletter_issues (id) on delete cascade,
  email text not null,
  name text not null default '',
  user_id uuid references auth.users (id) on delete set null,
  subscriber_id uuid references public.newsletter_subscribers (id) on delete set null,
  token_hash text not null unique,
  -- The personal version, rendered when the issue is sent (holding figures as at that day).
  html text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  open_count int not null default 0,
  clicked_at timestamptz,
  click_count int not null default 0,
  unsubscribed_at timestamptz
);
create index newsletter_recipients_issue_idx on public.newsletter_recipients (issue_id, status);
create unique index newsletter_recipients_once on public.newsletter_recipients (issue_id, lower(email));

create table public.newsletter_clicks (
  id bigint generated always as identity primary key,
  recipient_id bigint not null references public.newsletter_recipients (id) on delete cascade,
  url text not null,
  clicked_at timestamptz not null default now()
);
create index newsletter_clicks_recipient_idx on public.newsletter_clicks (recipient_id);

alter table public.newsletter_issues enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.newsletter_recipients enable row level security;
alter table public.newsletter_clicks enable row level security;
revoke all on public.newsletter_issues, public.newsletter_subscribers, public.newsletter_recipients, public.newsletter_clicks from anon, authenticated;
