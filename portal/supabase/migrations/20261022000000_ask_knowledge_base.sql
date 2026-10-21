-- Ask Lakeba knowledge base: which documents the assistant may use.
--
-- Registers hold other shareholders' personal details, so they never go into
-- the knowledge base; admins can switch any other document in or out.

alter table public.documents add column in_knowledge_base boolean not null default true;
update public.documents set in_knowledge_base = false where category = 'register';
alter table public.documents add constraint documents_registers_not_in_kb
  check (category <> 'register' or not in_knowledge_base);

-- Only knowledge-base documents are searchable from Ask Lakeba.
create or replace function public.search_documents(query text, max_results int default 8)
returns table (document_id uuid, title text, page int, content text, rank real)
language sql
stable
set search_path = ''
as $$
  select c.document_id, d.title, c.page, c.content,
         ts_rank_cd(c.tsv, websearch_to_tsquery('english', query)) as rank
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where d.in_knowledge_base
    and c.tsv @@ websearch_to_tsquery('english', query)
  order by rank desc
  limit least(max_results, 20);
$$;
