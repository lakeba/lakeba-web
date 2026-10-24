-- Newsletters, part 2: an issue can be written in HTML (mode 'html', with
-- placeholders such as {{news}} for the composed parts) as well as composed
-- from blocks, and issues can start from templates. Built-in templates live in
-- the code; templates people save are stored here (for one company, or for all
-- when entity_id is empty). Only the portal server reads or writes them.

alter table public.newsletter_issues
  add column mode text not null default 'compose' check (mode in ('compose', 'html')),
  add column html_body text not null default '';

create table public.newsletter_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  description text not null default '',
  audience text not null default 'any' check (audience in ('shareholders', 'public', 'any')),
  entity_id uuid references public.entities (id) on delete cascade,
  subject text not null default '',
  preheader text not null default '',
  content jsonb not null default '{}',
  mode text not null default 'compose' check (mode in ('compose', 'html')),
  html_body text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.newsletter_templates enable row level security;
revoke all on public.newsletter_templates from anon, authenticated;
