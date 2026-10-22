-- Ask retrieval: instead of sending a company's whole knowledge base with
-- every question, Ask can send only the passages that best match it.
--
-- Passages (prefixed with their document's title) are embedded on our own
-- server (bge-small-en-v1.5, 384 dimensions; no text goes to another provider) and found by a hybrid
-- search: meaning (pgvector cosine distance) and keywords (Postgres full
-- text), merged by reciprocal rank fusion. The same filters as the full
-- knowledge base apply: published, all-investor documents marked for Ask,
-- of the company asked about (plus, for the group, venture documents
-- shared with it). Switched on per portal in ask_settings ('retrieval').

create extension if not exists vector with schema extensions;

alter table public.document_chunks add column embedding extensions.vector(384);

-- Public News & Media lives in the website's content files; its passages
-- are copied here so they can be searched the same way.
create table public.news_chunks (
  id bigint generated always as identity primary key,
  slug text not null,
  chunk_index int not null,
  title text not null,
  published_on date not null,
  venture text not null,
  content text not null,
  content_hash text not null,
  tsv tsvector generated always as (to_tsvector('english', title || ' ' || content)) stored,
  embedding extensions.vector(384),
  unique (slug, chunk_index)
);
create index news_chunks_tsv_idx on public.news_chunks using gin (tsv);

alter table public.news_chunks enable row level security;
create policy "news_chunks: admin" on public.news_chunks
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.news_chunks from anon;

-- Best-matching passages for one question. Called by the portal server with
-- the service key; never exposed to signed-in users.
create or replace function public.match_passages(
  target_entity uuid,
  include_shared boolean,
  news_venture text,          -- null: all news (the group); else only that venture's news
  query_embedding extensions.vector(384),
  query_text text,
  match_count int default 30
)
returns table (source text, document_id uuid, news_slug text, title text, published date, page int, chunk_index int, content text, score double precision)
language sql
stable
set search_path = ''
as $$
  with q as (
    select coalesce(nullif(array_to_string(tsvector_to_array(to_tsvector('english', query_text)), ' | '), ''), 'zzzz') as words
  ), docs as (
    select 'document'::text as source, c.id::text as key, d.id as document_id, null::text as news_slug, d.title,
           (d.published_at at time zone 'Australia/Sydney')::date as published, c.page, c.chunk_index, c.content,
           -- the document's title counts as part of every passage, so "the Directors Note" finds it
           setweight(to_tsvector('english', d.title), 'A') || c.tsv as tsv, c.embedding
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
    where d.in_knowledge_base and d.audience = 'all_investors'
      and d.published_at is not null and d.published_at <= now()
      and (d.entity_id = target_entity or (include_shared and d.shared_with_group))
  ), news as (
    select 'news'::text, n.id::text, null::uuid, n.slug, n.title, n.published_on, null::int, n.chunk_index, n.content, n.tsv, n.embedding
    from public.news_chunks n
    where news_venture is null or n.venture = news_venture
  ), pool as (
    select * from docs union all select * from news
  ), by_meaning as (
    select key, row_number() over (order by embedding operator(extensions.<=>) query_embedding) as r
    from pool where embedding is not null
    order by embedding operator(extensions.<=>) query_embedding
    limit match_count * 3
  ), by_words as (
    select key, row_number() over (order by ts_rank_cd(tsv, to_tsquery('english', (select words from q))) desc) as r
    from pool where tsv @@ to_tsquery('english', (select words from q))
    order by ts_rank_cd(tsv, to_tsquery('english', (select words from q))) desc
    limit match_count * 3
  ), fused as (
    select key, sum(1.0 / (60 + r)) as score
    from (select * from by_meaning union all select * from by_words) x
    group by key
  )
  select p.source, p.document_id, p.news_slug, p.title, p.published, p.page, p.chunk_index, p.content, f.score
  from fused f join pool p on p.key = f.key
  order by f.score desc
  limit match_count;
$$;

revoke execute on function public.match_passages(uuid, boolean, text, extensions.vector, text, int) from public, anon, authenticated;
grant execute on function public.match_passages(uuid, boolean, text, extensions.vector, text, int) to service_role;

-- Which way each answer was produced, for review and comparison.
alter table public.ask_exchanges
  add column mode text check (mode in ('full', 'retrieval')),
  add column retrieval_query text;
