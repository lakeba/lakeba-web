import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getCollection } from 'astro:content';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { serviceClient } from './admin';
import { client, type AskCompany, type ChatTurn } from './ask';
import { articleText, factsSheet, fmtDate, NEWS_FROM, resolveCompany, sydneyToday, type KnowledgeBase, type Source } from './knowledge';

/*
 * Ask retrieval: send Claude only the passages that best match a question,
 * instead of a company's whole knowledge base.
 *
 * Passages (document pages and News & Media articles) are embedded on this
 * server with bge-small-en-v1.5; no document text goes to another provider
 * for this. match_passages() merges meaning and keyword search. The facts
 * sheet and approved answers are always included (small, cached); the
 * retrieved passages follow. The result has the same shape as the full
 * knowledge base, so citations and source links work unchanged.
 */

type Svc = ReturnType<typeof serviceClient>;
export type RetrievalSettings = { enabled: boolean; passages: number };
/** A document this short is sent whole when it is among the best matches (summary questions need all of it). */
const WHOLE_DOCUMENT_PASSAGES = 32;
const WHOLE_DOCUMENTS = 3;
/** Upper bound for the material sent with one question (characters; about 25,000 tokens). */
const MAX_CHARS = 70_000;
export const DEFAULT_RETRIEVAL: RetrievalSettings = { enabled: false, passages: 30 };

export async function loadRetrieval(svc: Svc): Promise<RetrievalSettings> {
  const { data } = await svc.from('ask_settings').select('value').eq('key', 'retrieval').maybeSingle();
  return { ...DEFAULT_RETRIEVAL, ...((data?.value as Partial<RetrievalSettings>) ?? {}) };
}

// --- Embeddings --------------------------------------------------------------
const MODEL = 'Xenova/bge-small-en-v1.5';
// bge models expect this prefix on queries (not on passages).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
type Extractor = (texts: string[], opts: { pooling: 'cls'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor> | null = null;

function loadModel() {
  extractor ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    // Downloaded once from Hugging Face, then read from this folder.
    env.cacheDir = process.env.MODEL_CACHE_DIR ?? join(process.cwd(), '.models');
    return (await pipeline('feature-extraction', MODEL, { dtype: 'q8' })) as unknown as Extractor;
  })();
  return extractor;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const model = await loadModel();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) out.push(...(await model(texts.slice(i, i + 32), { pooling: 'cls', normalize: true })).tolist());
  return out;
}
const asVector = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(',')}]`;

// --- Index ---------------------------------------------------------------------
const NEWS_CHUNK = 1200;
function chunkArticle(text: string) {
  const chunks: string[] = [];
  let current = '';
  for (const para of text.split(/\n{2,}/)) {
    if (current && current.length + para.length > NEWS_CHUNK) { chunks.push(current); current = ''; }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

let lastSync = 0;
/**
 * Embeds document passages that don't have an embedding yet and copies
 * News & Media into news_chunks (new or changed articles only). Cheap when
 * nothing changed; runs at most every 10 minutes unless forced.
 */
export async function ensureIndex(svc: Svc, force = false) {
  if (!force && Date.now() - lastSync < 10 * 60_000) return { documents: 0, news: 0 };
  lastSync = Date.now();
  let documents = 0;
  for (;;) {
    const { data: missing } = await svc.from('document_chunks').select('id, content, documents(title)').is('embedding', null).limit(256);
    if (!missing?.length) break;
    // The document's title goes with each passage, so a question naming the document finds it.
    const vectors = await embed(missing.map((c) => `${(c.documents as unknown as { title: string } | null)?.title ?? ''}\n\n${c.content}`));
    for (let i = 0; i < missing.length; i++) {
      await svc.from('document_chunks').update({ embedding: asVector(vectors[i]) }).eq('id', missing[i].id).throwOnError();
    }
    documents += missing.length;
  }

  const articles = (await getCollection('publicNews'))
    .filter((n) => n.data.date.toISOString() >= NEWS_FROM && n.body?.trim() && !n.data.external);
  const { data: stored } = await svc.from('news_chunks').select('slug, content_hash').eq('chunk_index', 0);
  const storedHash = new Map((stored ?? []).map((s) => [s.slug, s.content_hash]));
  let news = 0;
  for (const n of articles) {
    const text = articleText(n.body!);
    const hash = createHash('sha256').update(`${n.data.title}\n${n.data.venture}\n${text}`).digest('hex').slice(0, 16);
    if (storedHash.get(n.id) === hash) { storedHash.delete(n.id); continue; }
    storedHash.delete(n.id);
    const chunks = chunkArticle(text);
    const vectors = await embed(chunks.map((c) => `${n.data.title}\n\n${c}`));
    await svc.from('news_chunks').delete().eq('slug', n.id);
    await svc.from('news_chunks').insert(chunks.map((content, i) => ({
      slug: n.id, chunk_index: i, title: n.data.title, published_on: n.data.date.toISOString().slice(0, 10),
      venture: n.data.venture, content, content_hash: hash, embedding: asVector(vectors[i]),
    }))).throwOnError();
    news++;
  }
  // Articles removed from the website.
  if (storedHash.size) await svc.from('news_chunks').delete().in('slug', [...storedHash.keys()]);
  return { documents, news };
}

// --- Follow-up questions --------------------------------------------------------
/** "And the year before?" → a self-contained search query (Claude Haiku 5.5, a fraction of a cent). */
export async function standaloneQuery(turns: ChatTurn[]): Promise<{ query: string; costUsd: number }> {
  const question = turns.at(-1)!.content;
  if (turns.length < 3 || !client) return { query: question, costUsd: 0 };
  const recent = turns.slice(-5, -1).map((t) => `${t.role === 'user' ? 'Shareholder' : 'Assistant'}: ${t.content.slice(0, 800)}`).join('\n');
  try {
    const res = await client.beta.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 400,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } } } },
      system: 'Rewrite the shareholder\'s latest message as one self-contained search query for the company\'s documents, resolving references to earlier messages (names, years, figures). Return only the query.',
      messages: [{ role: 'user', content: `Conversation:\n${recent}\n\nLatest message:\n${question}` }],
    });
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { query: JSON.parse(text).query || question, costUsd: (res.usage.input_tokens * 0.1 + res.usage.output_tokens * 0.5) / 1e6 };
  } catch {
    return { query: question, costUsd: 0 };
  }
}

// --- Retrieval knowledge base -----------------------------------------------------
type Passage = { source: 'document' | 'news'; document_id: string | null; news_slug: string | null; title: string; published: string; page: number | null; chunk_index: number; content: string; score: number };

export async function retrieveKnowledgeBase(forCompany: AskCompany | null, query: string, passages = DEFAULT_RETRIEVAL.passages): Promise<KnowledgeBase & { query: string; passageCount: number }> {
  const svc = serviceClient();
  await ensureIndex(svc);
  const company = await resolveCompany(svc, forCompany);
  const isGroup = company.relationship === 'group';
  const [queryVector] = await embed([QUERY_PREFIX + query]);
  const [facts, { data: approved }, { data: found, error }] = await Promise.all([
    factsSheet(svc, company),
    svc.from('ask_approved_answers').select('id, question, answer').eq('entity_id', company.id).eq('active', true).gte('review_by', sydneyToday()).order('created_at').order('id'),
    svc.rpc('match_passages', {
      target_entity: company.id, include_shared: isGroup, news_venture: isGroup ? null : company.display_name,
      query_embedding: asVector(queryVector), query_text: query, match_count: passages,
    }),
  ]);
  if (error) throw error;

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  const sources: Source[] = [];
  let chars = facts.length;

  // Always included, and the same for every question: cached.
  blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: facts }, title: 'Portal facts sheet', citations: { enabled: true } });
  sources.push({ kind: 'facts', title: 'Portal facts sheet' });
  if (approved?.length) {
    const texts = approved.map((a) => `Question: ${a.question}\n\nApproved answer: ${a.answer}`);
    chars += texts.reduce((n, t) => n + t.length, 0);
    blocks.push({ type: 'document', source: { type: 'content', content: texts.map((text) => ({ type: 'text' as const, text })) }, title: isGroup ? 'Approved answers from Lakeba' : `Approved answers from ${company.display_name}`, citations: { enabled: true } });
    sources.push({ kind: 'approved', title: isGroup ? 'Lakeba approved answer' : `${company.display_name} approved answer` });
  }
  (blocks.at(-1) as Anthropic.Beta.BetaRequestDocumentBlock).cache_control = { type: 'ephemeral', ttl: '1h' };

  // The retrieved passages, widened: the best-matching short documents go in
  // whole; for longer ones, each matching passage brings its neighbours.
  const rows = (found ?? []) as Passage[];
  const docHits = rows.filter((r) => r.source === 'document');
  const docScore = new Map<string, number>();
  for (const p of docHits) docScore.set(p.document_id!, (docScore.get(p.document_id!) ?? 0) + p.score);
  const ranked = [...docScore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const { data: allChunks } = ranked.length
    ? await svc.from('document_chunks').select('document_id, chunk_index, page, content').in('document_id', ranked).order('chunk_index')
    : { data: [] };
  const chunksOf = new Map<string, { chunk_index: number; page: number | null; content: string }[]>();
  for (const c of allChunks ?? []) chunksOf.set(c.document_id, [...(chunksOf.get(c.document_id) ?? []), c]);
  const meta = new Map(docHits.map((p) => [p.document_id!, { title: p.title, published: p.published }]));

  let budget = MAX_CHARS - chars;
  const selected: { id: string; parts: { chunk_index: number; page: number | null; content: string }[]; whole: boolean }[] = [];
  for (const [rank, id] of ranked.entries()) {
    const all = chunksOf.get(id) ?? [];
    const size = all.reduce((n, c) => n + c.content.length, 0);
    let parts = all;
    let whole = rank < WHOLE_DOCUMENTS && all.length <= WHOLE_DOCUMENT_PASSAGES && size <= budget;
    if (!whole) {
      const wanted = new Set(docHits.filter((p) => p.document_id === id).flatMap((p) => [p.chunk_index - 1, p.chunk_index, p.chunk_index + 1]));
      parts = all.filter((c) => wanted.has(c.chunk_index));
    }
    const partSize = parts.reduce((n, c) => n + c.content.length, 0);
    if (partSize > budget) {
      // Keep only the matching passages themselves if the neighbours don't fit.
      const hits = new Set(docHits.filter((p) => p.document_id === id).map((p) => p.chunk_index));
      parts = all.filter((c) => hits.has(c.chunk_index));
      whole = false;
      if (parts.reduce((n, c) => n + c.content.length, 0) > budget) continue;
    }
    budget -= parts.reduce((n, c) => n + c.content.length, 0);
    selected.push({ id, parts, whole });
  }
  // Newest documents first, pages in order.
  selected.sort((a, b) => meta.get(b.id)!.published.localeCompare(meta.get(a.id)!.published));
  for (const { id, parts, whole } of selected) {
    const m = meta.get(id)!;
    chars += parts.reduce((n, p) => n + p.content.length, 0);
    blocks.push({
      type: 'document',
      source: { type: 'content', content: parts.map((p) => ({ type: 'text' as const, text: p.content })) },
      title: `${m.title} (published ${fmtDate(m.published)}${whole ? '' : '; excerpts'})`,
      citations: { enabled: true },
    });
    sources.push({ kind: 'document', title: m.title, documentId: id, pages: parts.map((p) => p.page) });
  }
  const news = rows.filter((r) => r.source === 'news').sort((a, b) => a.published.localeCompare(b.published))
    .filter((n) => { if (n.content.length > budget) return false; budget -= n.content.length; return true; });
  if (news.length) {
    const site = PUBLIC_SITE_URL.replace(/\/$/, '');
    const texts = news.map((n) => `${n.title} — ${fmtDate(n.published)}\n\n${n.content}`);
    chars += texts.reduce((n, t) => n + t.length, 0);
    blocks.push({ type: 'document', source: { type: 'content', content: texts.map((text) => ({ type: 'text' as const, text })) }, title: isGroup ? 'Lakeba News & Media (excerpts)' : `News & Media about ${company.display_name} (excerpts)`, citations: { enabled: true } });
    sources.push({ kind: 'news', title: 'Lakeba News & Media', articles: news.map((n) => ({ title: n.title, href: `${site}/news/${n.news_slug}/`, date: fmtDate(n.published) })) });
  }

  return {
    blocks, sources, query, passageCount: rows.length,
    approxTokens: Math.round(chars / 2.8), documentCount: selected.length, articleCount: new Set(news.map((n) => n.news_slug)).size, approvedCount: approved?.length ?? 0,
  };
}
