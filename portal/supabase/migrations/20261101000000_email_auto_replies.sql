-- Shareholder emails, phase 2: automatic replies for safe requests.
-- A company in 'auto' mode answers its chosen request types by itself when the
-- sender is a verified, registered shareholder, Claude is sure, and the limits
-- allow it. Each automatic reply waits AUTO_DELAY (5 minutes) so an admin can
-- cancel it; the worker then sends it.

alter table public.entities
  add column email_auto_categories text[] not null default array['documents', 'holding_statement', 'sign_in_help'];

alter table public.shareholder_emails
  add column auto_send_at timestamptz,
  add column auto_cancelled_by uuid references auth.users (id) on delete set null;

alter table public.shareholder_emails drop constraint shareholder_emails_status_check;
alter table public.shareholder_emails add constraint shareholder_emails_status_check
  check (status in ('new', 'needs_person', 'draft_ready', 'auto_scheduled', 'replied', 'handled', 'ignored', 'board_qa', 'error'));

create index shareholder_emails_auto_due on public.shareholder_emails (auto_send_at) where status = 'auto_scheduled';
