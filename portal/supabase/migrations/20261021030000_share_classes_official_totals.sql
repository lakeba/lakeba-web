-- Share classes: voting flag and the official number of shares on issue.
--
-- Not every shareholder has a portal login, so the sum of holdings in the
-- portal can be lower than the shares actually on issue. Admins record the
-- official figure from the share register; percentages use it when present.

alter table public.share_classes
  add column voting boolean not null default true,
  add column official_on_issue bigint check (official_on_issue >= 0),
  add column official_as_at date,
  add constraint share_classes_official_complete check ((official_on_issue is null) = (official_as_at is null));

insert into public.share_classes (code, name, voting)
values ('F', 'F class shares (non-voting)', false)
on conflict (code) do nothing;

drop function public.shares_on_issue();

-- `total` is what percentages use: the official figure when recorded,
-- otherwise the sum of the latest holdings in the portal.
create function public.shares_on_issue()
returns table (share_class_id uuid, code text, name text, total bigint, computed_total bigint, official_as_at date, is_official boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (h.holder_id, h.share_class_id) h.share_class_id, h.shares
    from public.holdings h
    order by h.holder_id, h.share_class_id, h.as_at desc
  ), computed as (
    select c.id, coalesce(sum(l.shares), 0)::bigint as total
    from public.share_classes c
    left join latest l on l.share_class_id = c.id
    group by c.id
  )
  select c.id, c.code, c.name,
         coalesce(c.official_on_issue, k.total),
         k.total,
         c.official_as_at,
         c.official_on_issue is not null
  from public.share_classes c
  join computed k on k.id = c.id;
$$;

revoke execute on function public.shares_on_issue() from public, anon;
grant execute on function public.shares_on_issue() to authenticated;
