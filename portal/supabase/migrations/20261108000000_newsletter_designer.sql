-- Newsletters, part 3: the drag-and-drop designer (GrapesJS + MJML) and
-- editable templates. An issue or template in 'design' mode keeps the
-- designer's project (design_json) and its MJML; the portal compiles the MJML
-- into the email when saved (html_body). Built-in templates are now rows too
-- (builtin_key), editable, with "restore original" from the code. Each
-- template save keeps a version (the last 20).

alter table public.newsletter_issues drop constraint newsletter_issues_mode_check;
alter table public.newsletter_issues add constraint newsletter_issues_mode_check check (mode in ('compose', 'html', 'design'));
alter table public.newsletter_issues add column design_json jsonb, add column mjml text not null default '';

alter table public.newsletter_templates drop constraint newsletter_templates_mode_check;
alter table public.newsletter_templates add constraint newsletter_templates_mode_check check (mode in ('compose', 'html', 'design'));
alter table public.newsletter_templates
  add column builtin_key text unique,
  add column design_json jsonb,
  add column mjml text not null default '',
  add column updated_by uuid references auth.users (id) on delete set null;

create table public.newsletter_template_revisions (
  id bigint generated always as identity primary key,
  template_id uuid not null references public.newsletter_templates (id) on delete cascade,
  snapshot jsonb not null,
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null default now()
);
create index newsletter_template_revisions_idx on public.newsletter_template_revisions (template_id, saved_at desc);
alter table public.newsletter_template_revisions enable row level security;
revoke all on public.newsletter_template_revisions from anon, authenticated;
