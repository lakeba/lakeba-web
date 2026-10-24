-- The designer's compiled email is kept apart from the HTML mode's own source,
-- so switching between Designer and HTML never mixes them.
alter table public.newsletter_issues add column design_html text not null default '';
alter table public.newsletter_templates add column design_html text not null default '';
