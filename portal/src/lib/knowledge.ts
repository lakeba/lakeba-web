import type Anthropic from '@anthropic-ai/sdk';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { loadPublicArticles } from './news-cms';
import { serviceClient } from './admin';
import type { AskCompany } from './ask';

/*
 * The Ask Lakeba knowledge base: the same for every shareholder, so it is
 * sent in full and cached. In order:
 *   1. every published, all-investor document marked "use in Ask Lakeba"
 *      (registers can never be marked), one citable block per page part,
 *   2. public News & Media from NEWS_FROM onwards, one citable block per article,
 *      — cache breakpoint: this large part rarely changes —
 *   3. a facts sheet generated from portal data (share classes, prices,
 *      ventures, meetings),
 *   4. live approved answers from Ask review, one citable block each,
 *      — cache breakpoint: approving an answer only re-caches this small tail.
 * Its content is deterministic so the prompt cache keeps hitting until
 * something actually changes.
 */

export const NEWS_FROM = '2023-01-01';

/** What a citable block points back to. */
export type Source =
  | { kind: 'facts'; title: string }
  | { kind: 'document'; title: string; documentId: string; pages: (number | null)[] }
  | { kind: 'news'; title: string; articles: { title: string; href: string; date: string }[] }
  | { kind: 'approved'; title: string };

export type KnowledgeBase = {
  blocks: Anthropic.Beta.BetaContentBlockParam[];
  sources: Source[];
  approxTokens: number;
  documentCount: number;
  articleCount: number;
  approvedCount: number;
};

export const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());

const day = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });
export const fmtDate = (d: string | Date) => day.format(new Date(d));
const int = new Intl.NumberFormat('en-AU');

/** The company a knowledge base is for: the given one, or Lakeba Group. */
export async function resolveCompany(svc: ReturnType<typeof serviceClient>, company?: AskCompany | null): Promise<AskCompany> {
  if (company) return company;
  const { data } = await svc.from('entities').select('id, code, display_name, legal_name, relationship').eq('relationship', 'group').single();
  return data as AskCompany;
}

export async function factsSheet(svc: ReturnType<typeof serviceClient>, company: AskCompany) {
  const entityId = company.id;
  const isGroup = company.relationship === 'group';
  const [{ data: classes }, { data: holdings }, { data: prices }, { data: ventures }, { data: meetings }, { data: liquidity }] = await Promise.all([
    svc.from('share_classes').select('id, code, name, voting, official_on_issue, official_as_at').eq('entity_id', entityId).order('code'),
    svc.from('holdings').select('holder_id, share_class_id, shares, as_at'),
    svc.from('reference_prices').select('price, currency, priced_on, source, note, share_classes!inner(name, entity_id)').eq('share_classes.entity_id', entityId).order('priced_on'),
    isGroup ? svc.from('ventures').select('name, tagline, stage, lakeba_stake, status, venture_updates(title, body, happened_on)').order('sort') : Promise.resolve({ data: [] }),
    svc.from('meetings').select('title, starts_at, location, proxy_deadline, status, resolutions(number, title, kind, outcome)').eq('entity_id', entityId).order('starts_at'),
    isGroup ? svc.from('portal_settings').select('value').eq('key', 'liquidity').maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // Latest holding per holder and class, summed (no individual holdings are included).
  const latest = new Map<string, { classId: string; shares: number; asAt: string }>();
  for (const h of holdings ?? []) {
    const key = `${h.holder_id}|${h.share_class_id}`;
    const prev = latest.get(key);
    if (!prev || prev.asAt < h.as_at) latest.set(key, { classId: h.share_class_id, shares: Number(h.shares), asAt: h.as_at });
  }
  const held = (classId: string) => [...latest.values()].filter((h) => h.classId === classId).reduce((a, h) => a + h.shares, 0);

  const lines = [isGroup ? 'LAKEBA GROUP LIMITED — FACTS FROM THE INVESTOR PORTAL' : `${(company.legal_name || company.display_name).toUpperCase()} — FACTS FROM THE INVESTOR PORTAL`, ''];
  lines.push('Share classes:');
  for (const c of classes ?? []) {
    const total = c.official_on_issue != null
      ? `${int.format(c.official_on_issue)} shares on issue (official figure as at ${fmtDate(c.official_as_at!)})`
      : `${int.format(held(c.id))} shares held by portal shareholders (no official shares-on-issue figure recorded)`;
    lines.push(`- ${c.name} (${c.code}), ${c.voting ? 'voting' : 'non-voting'}: ${total}.`);
  }
  lines.push('', `Reference prices (indicative only; ${isGroup ? 'Lakeba' : company.display_name} shares are unlisted):`);
  for (const p of prices ?? []) {
    const cls = (p.share_classes as unknown as { name: string } | null)?.name ?? '';
    lines.push(`- ${fmtDate(p.priced_on)}: ${p.currency} ${Number(p.price).toFixed(2)} per ${cls.toLowerCase()} share — ${p.source.replace('_', ' ')}${p.note ? ` (${p.note})` : ''}.`);
  }
  if ((ventures ?? []).length) {
    lines.push('', 'Portfolio ventures:');
    for (const v of ventures ?? []) {
      lines.push(`- ${v.name}: ${v.tagline}. Stage: ${v.stage || 'n/a'}. Status: ${v.status}.${v.lakeba_stake != null ? ` Lakeba stake: ${Number(v.lakeba_stake)}%.` : ''}`);
      const updates = [...((v.venture_updates as { title: string; body: string; happened_on: string }[]) ?? [])].sort((a, b) => b.happened_on.localeCompare(a.happened_on)).slice(0, 3);
      for (const u of updates) lines.push(`  - ${fmtDate(u.happened_on)}: ${u.title}${u.body ? ` — ${u.body}` : ''}`);
    }
  }
  if ((meetings ?? []).length) {
    lines.push('', 'Shareholder meetings:');
    for (const m of meetings ?? []) {
      lines.push(`- ${m.title}: ${fmtDate(m.starts_at)}${m.location ? `, ${m.location}` : ''}. Status: ${m.status}. Proxy deadline: ${fmtDate(m.proxy_deadline)}.`);
      for (const r of [...((m.resolutions as { number: number; title: string; kind: string; outcome: string | null }[]) ?? [])].sort((a, b) => a.number - b.number)) {
        lines.push(`  - Resolution ${r.number} (${r.kind}): ${r.title}${r.outcome ? ` — ${r.outcome.replace('_', ' ')}` : ''}`);
      }
    }
  }
  const liq = liquidity?.value as { title?: string; body?: string } | undefined;
  if (liq?.body) lines.push('', `Secondary trading: ${liq.body}`);
  return lines.join('\n');
}

/** Markdown article body as plain text for the model. */
export const articleText = (md: string) =>
  md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<iframe[^>]*><\/iframe>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();

/** The knowledge base for one company (Lakeba Group when none is given). */
export async function buildKnowledgeBase(forCompany?: AskCompany | null): Promise<KnowledgeBase> {
  const svc = serviceClient();
  const now = new Date().toISOString();
  const company = await resolveCompany(svc, forCompany);
  const isGroup = company.relationship === 'group';
  const [facts, { data: docs }, news, { data: approved }] = await Promise.all([
    factsSheet(svc, company),
    svc.from('documents')
      .select('id, title, category, published_at, document_chunks(chunk_index, page, content)')
      .eq('in_knowledge_base', true).eq('audience', 'all_investors')
      // The company's documents; for the group, plus venture documents shared with group shareholders.
      .or(isGroup ? `entity_id.eq.${company.id},shared_with_group.eq.true` : `entity_id.eq.${company.id}`).not('published_at', 'is', null).lte('published_at', now)
      .order('published_at').order('id'),
    loadPublicArticles(svc),
    // Approved answers count until their review-by date.
    svc.from('ask_approved_answers').select('id, question, answer').eq('entity_id', company.id).eq('active', true).gte('review_by', sydneyToday()).order('created_at').order('id'),
  ]);

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  const sources: Source[] = [];
  let chars = facts.length;

  for (const d of docs ?? []) {
    const parts = [...(d.document_chunks as { chunk_index: number; page: number | null; content: string }[])]
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .filter((c) => c.content.trim());
    if (!parts.length) continue;
    chars += parts.reduce((a, c) => a + c.content.length, 0);
    blocks.push({
      type: 'document',
      source: { type: 'content', content: parts.map((c) => ({ type: 'text' as const, text: c.content })) },
      title: `${d.title} (published ${fmtDate(d.published_at!)})`,
      citations: { enabled: true },
    });
    sources.push({ kind: 'document', title: d.title, documentId: d.id, pages: parts.map((c) => c.page) });
  }

  const site = PUBLIC_SITE_URL.replace(/\/$/, '');
  const articles = news
    .filter((n) => n.data.date.toISOString() >= NEWS_FROM && n.body?.trim() && !n.data.external)
    // A venture's knowledge base has only the news about that venture.
    .filter((n) => isGroup || n.data.venture === company.display_name)
    .sort((a, b) => a.data.date.getTime() - b.data.date.getTime() || a.id.localeCompare(b.id));
  if (articles.length) {
    const texts = articles.map((n) => `${n.data.title} — ${fmtDate(n.data.date)} — ${n.data.venture}\n\n${articleText(n.body!)}`);
    chars += texts.reduce((a, t) => a + t.length, 0);
    blocks.push({
      type: 'document',
      source: { type: 'content', content: texts.map((text) => ({ type: 'text' as const, text })) },
      title: isGroup ? `Lakeba News & Media (from ${fmtDate(NEWS_FROM)})` : `News & Media about ${company.display_name} (from ${fmtDate(NEWS_FROM)})`,
      citations: { enabled: true },
    });
    sources.push({ kind: 'news', title: 'Lakeba News & Media', articles: articles.map((n) => ({ title: n.data.title, href: `${site}/news/${n.id}/`, date: fmtDate(n.data.date) })) });
  }

  // Documents and news rarely change: first cache breakpoint.
  const cacheHere = () => { (blocks.at(-1) as Anthropic.Beta.BetaRequestDocumentBlock).cache_control = { type: 'ephemeral', ttl: '1h' }; };
  if (blocks.length) cacheHere();

  blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: facts }, title: 'Portal facts sheet', citations: { enabled: true } });
  sources.push({ kind: 'facts', title: 'Portal facts sheet' });

  if (approved?.length) {
    const texts = approved.map((a) => `Question: ${a.question}\n\nApproved answer: ${a.answer}`);
    chars += texts.reduce((n, t) => n + t.length, 0);
    blocks.push({
      type: 'document',
      source: { type: 'content', content: texts.map((text) => ({ type: 'text' as const, text })) },
      title: isGroup ? 'Approved answers from Lakeba' : `Approved answers from ${company.display_name}`,
      citations: { enabled: true },
    });
    sources.push({ kind: 'approved', title: isGroup ? 'Lakeba approved answer' : `${company.display_name} approved answer` });
  }
  // Second breakpoint: a change to facts or approved answers re-caches only this tail.
  cacheHere();

  // About 2.8 characters per token, measured against the API's own count.
  const approxTokens = Math.round(chars / 2.8);
  return { blocks, sources, approxTokens, documentCount: (docs ?? []).length, articleCount: articles.length, approvedCount: approved?.length ?? 0 };
}
