-- A venture's own domain needs a Lakeba group admin's approval before it goes
-- live. The venture's admins (or its IT person) can choose the address and add
-- the DNS record, but whoever controls a domain controls what reaches it, so
-- Lakeba approves each one. Addresses already set were set by group admins.

alter table public.entities add column custom_domain_approved_at timestamptz;
update public.entities set custom_domain_approved_at = now() where custom_domain is not null;
