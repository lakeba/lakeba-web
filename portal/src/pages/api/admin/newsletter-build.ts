import type { APIRoute } from 'astro';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import { client as claude } from '../../../lib/ask';
import { serviceClient } from '../../../lib/admin';
import { sourceFilters } from '../../../lib/newsletter';
import { markdownToHtml, plainText } from '../../../lib/news-cms';
import { newsEditor } from '../../../lib/news-editors';
import { BLOCKS_SCHEMA, LENGTHS, TONES, WRITING_RULES, blocksToHtml, type Block } from '../../../lib/newsletter-ai';

/**
 * "Build with AI": Claude writes a whole newsletter issue from the writer's
 * breakdown of what to communicate, using the chosen news, documents and
 * meetings as sources. The writer reviews everything before saving; nothing is
 * saved here.
 */
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['subjects', 'intro', 'sections', 'closing', 'cta', 'include_post_ids', 'checks'],
  properties: {
    subjects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['subject', 'preheader'], properties: { subject: { type: 'string' }, preheader: { type: 'string' } } } },
    intro: BLOCKS_SCHEMA,
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'blocks'], properties: { title: { type: 'string' }, blocks: BLOCKS_SCHEMA } } },
    closing: BLOCKS_SCHEMA,
    cta: { type: 'object', additionalProperties: false, required: ['label', 'url'], properties: { label: { type: 'string' }, url: { type: 'string' } } },
    include_post_ids: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const POST: APIRoute = async ({ request, locals, url }) => {
  const editor = newsEditor(locals, 'newsletters');
  if (!editor) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (!claude) return Response.json({ error: 'Lakeba AI needs the API key on the server.' }, { status: 503 });
  const b = await request.json().catch(() => null) as Record<string, unknown> | null;
  const breakdown = String(b?.breakdown ?? '').trim().slice(0, 6000);
  if (breakdown.length < 15) return Response.json({ error: 'Write a few points about what you want to say first.' }, { status: 400 });
  const svc = serviceClient();
  const { data: issue } = await svc.from('newsletter_issues').select('id, audience, entity_id').eq('id', String(b?.issue_id ?? '')).maybeSingle();
  if (!issue || !editor.mayEdit(issue.entity_id)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const { data: company } = await svc.from('entities').select('display_name, relationship').eq('id', issue.entity_id).single();
  const companyName = company!.relationship === 'group' ? 'Lakeba Group' : company!.display_name;
  const isShareholders = issue.audience === 'shareholders';
  const useSources = b?.use_sources !== false;
  const ids = (k: string) => (Array.isArray(b?.[k]) ? (b![k] as unknown[]).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 12) : []);
  const site = PUBLIC_SITE_URL.replace(/\/$/, '');

  // Sources: the ticked news in full, recent news to choose from, documents and meetings.
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const only = await sourceFilters(svc, issue);
  const [{ data: candidates }, { data: ticked }, { data: docs }, { data: meetings }] = await Promise.all([
    svc.from('posts').select('id, slug, title, excerpt, published_at, visibility').not('published_at', 'is', null).gte('published_at', since).lte('published_at', new Date().toISOString())
      .or(isShareholders ? `visibility.eq.public,entity_id.eq.${issue.entity_id}` : 'visibility.eq.public').order('published_at', { ascending: false }).limit(15),
    useSources && ids('post_ids').length ? svc.from('posts').select('id, slug, title, excerpt, body_html, body_md, published_at, visibility').in('id', ids('post_ids')).or(only.posts).not('published_at', 'is', null) : Promise.resolve({ data: [] }),
    useSources && isShareholders && ids('document_ids').length ? svc.from('documents').select('id, title, summary, published_at').in('id', ids('document_ids')).or(only.documents).not('published_at', 'is', null) : Promise.resolve({ data: [] }),
    useSources && isShareholders && b?.meetings ? svc.from('meetings').select('id, title, starts_at, proxy_deadline, location').eq('entity_id', issue.entity_id).gte('starts_at', new Date().toISOString()).order('starts_at').limit(3) : Promise.resolve({ data: [] }),
  ]);
  const postUrl = (p: { slug: string; visibility: string }) => (p.visibility === 'public' ? `${site}/news/${p.slug}/` : `${url.origin}/news/${p.slug}`);
  const allowed = new Set<string>([url.origin, `${url.origin}/agm`, `${url.origin}/documents`, 'https://lakeba.com', ...(breakdown.match(/https?:\/\/[^\s)]+/g) ?? [])]);
  for (const p of candidates ?? []) allowed.add(postUrl(p));
  for (const d of docs ?? []) allowed.add(`${url.origin}/documents/${d.id}`);
  for (const m of meetings ?? []) allowed.add(`${url.origin}/agm/${m.id}`);
  const tickedText = await Promise.all((ticked ?? []).map(async (p) => `### ${p.title} (${p.published_at?.slice(0, 10)}) — ${postUrl(p)}\n${plainText(p.body_html || (await markdownToHtml(p.body_md ?? ''))).slice(0, 3500) || p.excerpt}`));
  const sources = [
    tickedText.length ? `NEWS THE WRITER CHOSE (full text):\n${tickedText.join('\n\n')}` : '',
    `RECENT NEWS YOU MAY SUGGEST INCLUDING (id | date | title | excerpt | address):\n${(candidates ?? []).map((p) => `${p.id} | ${p.published_at?.slice(0, 10)} | ${p.title} | ${p.excerpt} | ${postUrl(p)}`).join('\n') || '(none)'}`,
    docs?.length ? `NEW DOCUMENTS (shown as a list under your text):\n${docs.map((d) => `- ${d.title} (${d.published_at?.slice(0, 10)})${d.summary ? `: ${d.summary}` : ''} — ${url.origin}/documents/${d.id}`).join('\n')}` : '',
    meetings?.length ? `UPCOMING MEETINGS (shown with dates under your text):\n${meetings.map((m) => `- ${m.title}: ${m.starts_at.slice(0, 10)}${m.location ? `, ${m.location}` : ''}; proxy votes close ${m.proxy_deadline.slice(0, 10)} — ${url.origin}/agm/${m.id}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const system = [
    `You write the quarterly newsletter of ${companyName} for ${isShareholders ? `its shareholders (most hold unlisted shares; some haven't used the investor portal yet)` : 'people who follow Lakeba: prospective investors and website visitors (not necessarily shareholders)'}.`,
    'Turn the writer’s breakdown into a complete, well-structured issue:',
    '- subjects: exactly 3 options; subject at most 60 characters, specific, no clickbait or all-caps; preheader at most 90 characters, adding to the subject.',
    '- intro: 1–2 short paragraphs that open the issue (the email adds “Dear <first name>,” itself, so don’t greet).',
    '- sections: each point of the breakdown, grouped sensibly, as a section with a clear heading and paragraphs or a bullet list. Cover every point the writer listed, in a sensible order.',
    '- closing: one short paragraph of thanks, then a sign-off line like “[Name], [Title]” for the writer to complete.',
    '- cta: one button only if there is a clear action (e.g. vote online, read the report), with its address from the allowed addresses; otherwise empty label and url.',
    '- include_post_ids: ids from the RECENT NEWS list worth listing in the news section (the news list appears after your text, so don’t repeat those stories at length; mention them briefly at most).',
    '- checks: short notes for the writer: facts to verify, placeholders to fill, anything sensitive. Empty if none.',
    isShareholders ? 'Documents and meetings are listed automatically after your text with their dates; refer to them in words only when the breakdown asks.' : 'This is not a shareholder communication: don’t mention holdings or voting.',
    `Tone: ${TONES[String(b?.tone)] ?? TONES.warm}`,
    `Length: ${LENGTHS[String(b?.length)] ?? LENGTHS.standard}`,
    ...WRITING_RULES,
    `Allowed link addresses: ${[...allowed].join(', ')}`,
  ].join('\n');

  try {
    const res = await claude.beta.messages.create({
      model: 'claude-sonnet-5-5', max_tokens: 6000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system,
      messages: [{ role: 'user', content: `<breakdown>\n${breakdown}\n</breakdown>\n\n<sources>\n${sources}\n</sources>` }],
    });
    const out = JSON.parse(res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('')) as {
      subjects: { subject: string; preheader: string }[]; intro: Block[]; sections: { title: string; blocks: Block[] }[]; closing: Block[];
      cta: { label: string; url: string }; include_post_ids: string[]; checks: string[];
    };
    const candidateIds = new Set((candidates ?? []).map((p) => p.id));
    await locals.supabase.rpc('log_event', { event_action: 'admin_newsletter_ai_build', event_detail: { issue_id: issue.id, model: 'claude-sonnet-5-5', input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } });
    return Response.json({
      subjects: out.subjects.slice(0, 3).map((s) => ({ subject: s.subject.slice(0, 120), preheader: s.preheader.slice(0, 160) })),
      intro_html: blocksToHtml(out.intro, allowed),
      sections: out.sections.slice(0, 8).map((s) => ({ title: s.title.slice(0, 120), html: blocksToHtml(s.blocks, allowed) })).filter((s) => s.title || s.html),
      closing_html: blocksToHtml(out.closing, allowed),
      cta: out.cta.label && allowed.has(out.cta.url) ? { label: out.cta.label.slice(0, 60), url: out.cta.url } : null,
      include_post_ids: out.include_post_ids.filter((id) => candidateIds.has(id)),
      checks: out.checks.slice(0, 12),
    });
  } catch (e) {
    console.error('newsletter build', (e as Error).message);
    return Response.json({ error: 'Lakeba AI couldn’t build the issue just now. Please try again.' }, { status: 502 });
  }
};
