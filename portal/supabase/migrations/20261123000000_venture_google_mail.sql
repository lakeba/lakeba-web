-- Ventures on Google Workspace instead of Microsoft 365.
--
-- Sending: the venture's Google administrator lets Lakeba's server send as its
-- addresses through Google's SMTP relay; after a test email the portal sends
-- from its own address that way (mail_via 'google'). mail_via 'microsoft' is
-- the Microsoft 365 route (phase 5).
-- Reading: the venture's Google administrator lets Lakeba's service account
-- read and label its shareholder mailbox (domain-wide delegation, Gmail only);
-- google_mailbox_verified_at is set once the portal could open it.

alter table public.entities
  add column mail_via text check (mail_via in ('microsoft', 'google')),
  add column google_mailbox_verified_at timestamptz;

update public.entities set mail_via = 'microsoft' where mail_from_verified_at is not null and ms_tenant_id is not null;
