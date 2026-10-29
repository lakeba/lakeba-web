-- Two Lakeba group companies without an investor portal: Lakeba Ventures Pty Ltd
-- (holds the group's equity in its ventures and investments) and Lakeba Scaleup
-- DevFund Pty Ltd (the services arm). They take part in Legal, Accounting
-- (group balances, consolidation) and HR, and are never shown to investors.
-- ACN and ABN from ABN Lookup, 29 October 2026. Added only where missing.

insert into public.entities (code, display_name, legal_name, company_number, relationship, portal, sort)
select v.code, v.display_name, v.legal_name, v.company_number, 'controlled', 'none', v.sort
from (values
  ('LKV', 'Lakeba Ventures', 'Lakeba Ventures Pty Ltd', '603 959 413', 1),
  ('LKS', 'Lakeba Scaleup DevFund', 'Lakeba Scaleup DevFund Pty Ltd', '600 244 031', 2)
) as v(code, display_name, legal_name, company_number, sort)
where not exists (select 1 from public.entities e where e.code = v.code);

insert into public.company_records (entity_id, acn, abn, company_type, registered_in, notes)
select e.id, e.company_number, v.abn, 'proprietary', 'NSW', 'ACN and ABN from ABN Lookup (abr.business.gov.au), 29 October 2026. Read a current ASIC extract to fill in the rest.'
from public.entities e
join (values ('LKV', '29 603 959 413'), ('LKS', '75 600 244 031')) as v(code, abn) on v.code = e.code
on conflict (entity_id) do nothing;
