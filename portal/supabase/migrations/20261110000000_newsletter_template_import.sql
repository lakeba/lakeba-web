-- Imported newsletter templates: the original (cleaned, images re-hosted) is
-- kept for comparison and for converting again; AI conversion runs in the
-- background and reports its progress here.
alter table public.newsletter_templates
  add column source_html text not null default '',
  add column source_label text not null default '',
  add column import_status text check (import_status in ('converting', 'failed')),
  add column import_note text not null default '',
  add column import_started_at timestamptz;
