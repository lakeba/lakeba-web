import { createHash, randomBytes } from 'node:crypto';
import { PUBLIC_SITE_URL } from 'astro:env/server';
import type { serviceClient } from './admin';
import { memberIds } from './notify';
import sanitize from 'sanitize-html';
import { cleanHtml } from './news-cms';
import { latestPrices } from './holdings';
import { sendRaw } from './mail';
import { makeEmailSafe, wrapDesigned } from './newsletter-design';

type Svc = ReturnType<typeof serviceClient>;

// Newsletters (Admin → Newsletters): an issue for one company's shareholders,
// or the public newsletter for subscribers from the website. When an issue
// is sent, every recipient gets a personal copy (their name, their holding,
// their unsubscribe link) stored in newsletter_recipients; the worker sends
// them at a gentle pace through Microsoft 365.

export type IssueContent = {
  intro_html?: string; closing_html?: string;
  sections?: { title: string; html: string }[];
  brief?: string; // the writer's breakdown for "Build with AI"

  post_ids?: string[]; document_ids?: string[];
  meetings?: boolean; holding?: boolean;
  cta_label?: string; cta_url?: string;
};
export type Issue = {
  id: string; audience: 'shareholders' | 'public'; entity_id: string; subject: string; preheader: string;
  content: IssueContent; segment: { segment: 'all' | 'quiet' | 'class'; share_class_id?: string };
  mode?: 'compose' | 'html' | 'design'; html_body?: string; mjml?: string; design_json?: unknown; design_html?: string;
  status: string; scheduled_at: string | null; sent_at: string | null;
};
export type Company = { id: string; code: string; display_name: string; legal_name: string | null; brand_color: string | null; relationship: string; shareholder_mailbox: string | null };

export const SEND_PER_TICK = 5; // the worker ticks every 15 s: about 20 emails a minute
const site = () => PUBLIC_SITE_URL.replace(/\/$/, '');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (d: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' }).format(new Date(d));
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-AU');

/** The news, documents and meetings an issue shows (the same for everyone). */
export async function loadParts(svc: Svc, issue: Pick<Issue, 'audience' | 'entity_id' | 'content'>) {
  const c = issue.content;
  const [{ data: posts }, { data: docs }, { data: meetings }] = await Promise.all([
    c.post_ids?.length ? svc.from('posts').select('id, slug, title, excerpt, cover_url, visibility, external, source_url, published_at').in('id', c.post_ids).not('published_at', 'is', null) : Promise.resolve({ data: [] }),
    issue.audience === 'shareholders' && c.document_ids?.length ? svc.from('documents').select('id, title, category, published_at').in('id', c.document_ids).not('published_at', 'is', null) : Promise.resolve({ data: [] }),
    issue.audience === 'shareholders' && c.meetings ? svc.from('meetings').select('id, title, starts_at, proxy_deadline, location').eq('entity_id', issue.entity_id).gte('starts_at', new Date().toISOString()).order('starts_at').limit(3) : Promise.resolve({ data: [] }),
  ]);
  // The public newsletter only ever shows public news.
  const visiblePosts = (posts ?? []).filter((p) => issue.audience === 'shareholders' || p.visibility === 'public')
    .sort((a, b) => (c.post_ids ?? []).indexOf(a.id) - (c.post_ids ?? []).indexOf(b.id));
  return { posts: visiblePosts, docs: docs ?? [], meetings: meetings ?? [] };
}
type Parts = Awaited<ReturnType<typeof loadParts>>;

export type Personal = {
  firstName: string | null;
  holding: { shares: number; value: number | null; className: string } | null;
  setupUrl: string | null; // a never-signed-in shareholder: link that signs them in
  token: string | null; // null for previews and the archive
};

/** Placeholders an HTML-mode issue can use; the composer's parts, per reader. */
export const PLACEHOLDERS = ['greeting', 'first_name', 'holding', 'news', 'documents', 'meetings', 'portal_button', 'company'] as const;

/**
 * HTML written by an admin for an email: layout tags and inline styles are
 * kept (emails need them); scripts, forms, frames and event handlers are not.
 */
/** A whole email document (an imported template), rather than the body the portal frames. */
export const isFullDocument = (html: string) => /<!doctype\s+html|<html[\s>]/i.test(html.slice(0, 2000));

export function cleanEmailHtml(html: string) {
  // A whole document keeps its <head> styles and Outlook comments, made safe the way designs are.
  if (isFullDocument(html)) return makeEmailSafe(html);
  return sanitize(html, {
    allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'span', 'div',
      'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'center', 'small', 'sup', 'sub'],
    allowedAttributes: {
      '*': ['style', 'align', 'width', 'height', 'bgcolor', 'valign', 'role', 'dir'],
      a: ['href', 'target', 'title'], img: ['src', 'alt', 'title', 'border'],
      td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], table: ['cellpadding', 'cellspacing', 'border'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'http'] },
    allowProtocolRelative: false,
    // Old tricks inside style attributes.
    transformTags: { '*': (tagName, attribs) => ({ tagName, attribs: attribs.style && /expression\s*\(|javascript:|behaviou?r\s*:|-moz-binding/i.test(attribs.style) ? { ...attribs, style: '' } : attribs }) },
  });
}

const fill = (s: string, values: Record<string, string>) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in values ? values[k] : m));
/** {{company}}, {{quarter}} and friends in templates, filled when an issue is started. */
export function templateValues(companyName: string, portal: string, now = new Date()) {
  const month = new Intl.DateTimeFormat('en-AU', { month: 'long', timeZone: 'Australia/Sydney' }).format(now);
  const year = new Intl.DateTimeFormat('en-AU', { year: 'numeric', timeZone: 'Australia/Sydney' }).format(now);
  const q = ['March', 'June', 'September', 'December'][Math.floor(new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' })).getMonth() / 3)];
  return { company: companyName, quarter: `${q} quarter ${year}`, month_year: `${month} ${year}`, year, portal };
}
export const fillTemplate = (s: string, v: Record<string, string>) => s.replace(/\{\{\s*(company|quarter|month_year|year|portal)\s*\}\}/g, (_m, k) => v[k]);

/** The email (HTML and plain text) for one reader. `origin` is the portal's address. */
export function renderIssue(issue: Issue, company: Company, parts: Parts, me: Personal, origin: string) {
  const color = company.brand_color ?? '#276ae7';
  const brand = company.relationship === 'group' ? 'Lakeba' : company.display_name;
  const kind = issue.audience === 'public' ? 'Newsletter' : 'Shareholder newsletter';
  const blocks = issueBlocks(issue, company, parts, me, origin, color);
  const values: Record<string, string> = {
    greeting: blocks.greeting, first_name: esc(me.firstName ?? ''), holding: blocks.holding, news: blocks.news, documents: blocks.documents,
    meetings: blocks.meetings, portal_button: blocks.portal, company: esc(company.display_name),
  };
  const track = (doc: string) => (me.token ? doc.replace(/href="(https?:\/\/[^"]+)"/g, (_m, href) => `href="${origin}/n/c/${me.token}?u=${encodeURIComponent(href.replace(/&amp;|&#38;/g, '&')).replace(/'/g, '&#39;')}"`) : doc);
  const whole = issue.mode === 'design' ? issue.design_html ?? '' : issue.mode === 'html' && isFullDocument(issue.html_body ?? '') ? cleanEmailHtml(issue.html_body ?? '') : null;
  if (whole !== null) {
    // A designed (or imported) email is a whole document with its own header and layout (made safe):
    // the portal fills in the placeholders, tracks links, and adds the preview text and the compulsory footer.
    const webUrl = me.token ? `${origin}/n/v/${me.token}` : null;
    const unsubUrl = me.token ? `${origin}/n/u/${me.token}` : null;
    const why = issue.audience === 'public' ? `You receive this because you subscribed to the ${brand} newsletter.` : `You receive this as a ${company.display_name} shareholder.`;
    const footer = `${esc(company.legal_name || company.display_name)}<br>${esc(why)}${unsubUrl ? ` <a href="${esc(unsubUrl)}" style="color:#6b7a90">Unsubscribe</a>.` : ''}${issue.audience === 'shareholders' ? ' Formal notices of meetings are still sent to you.' : ''}${webUrl ? ` <a href="${esc(webUrl)}" style="color:#6b7a90">View in your browser</a>.` : ''}${me.token ? `<img src="${origin}/n/o/${me.token}.gif" width="1" height="1" alt="" style="display:block;border:0">` : ''}`;
    const html = wrapDesigned(track(fill(whole, values)), { preheader: issue.preheader, footer });
    return { html, text: textOf(html) };
  }
  let body = issue.mode === 'html'
    ? fill(cleanEmailHtml(issue.html_body ?? ''), values)
    : [blocks.greeting, blocks.intro, blocks.holding, blocks.sections, blocks.news, blocks.documents, blocks.meetings, blocks.closing, blocks.cta, blocks.portal].join('\n');
  // Every web link goes through click tracking (not in previews or the archive).
  body = track(body);
  const webUrl = me.token ? `${origin}/n/v/${me.token}` : null;
  const unsubUrl = me.token ? `${origin}/n/u/${me.token}` : null;
  const why = issue.audience === 'public' ? `You receive this because you subscribed to the ${brand} newsletter.` : `You receive this as a ${company.display_name} shareholder.`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(issue.subject)}</title></head>
<body style="margin:0;background:#eef2f8;font-family:Inter,Arial,sans-serif;color:#0b1d37">
<span style="display:none!important;opacity:0;color:transparent;max-height:0;overflow:hidden">${esc(issue.preheader)}</span>
<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:620px;border-collapse:collapse;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="height:6px;background:${color}"></td></tr>
<tr><td style="padding:22px 28px 0"><p style="margin:0;font-weight:700;font-size:18px">${esc(brand)} <span style="font-weight:400;color:#6b7a90;font-size:14px">· ${kind}</span></p>${webUrl ? `<p style="margin:4px 0 0;font-size:12px"><a href="${esc(webUrl)}" style="color:#6b7a90">View in your browser</a></p>` : ''}</td></tr>
<tr><td style="padding:22px 28px 8px;font-size:15px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #eef2f8;font-size:12px;line-height:1.6;color:#6b7a90">${esc(company.legal_name || company.display_name)}<br>${esc(why)}${unsubUrl ? ` <a href="${esc(unsubUrl)}" style="color:#6b7a90">Unsubscribe</a>.` : ''}${issue.audience === 'shareholders' ? ' Formal notices of meetings are still sent to you.' : ''}${me.token ? `<img src="${origin}/n/o/${me.token}.gif" width="1" height="1" alt="" style="display:block;border:0">` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { html, text: textOf(html) };
}

/** The composer's parts as email HTML (also what {{placeholders}} stand for in HTML mode). */
function issueBlocks(issue: Issue, company: Company, parts: Parts, me: Personal, origin: string, color: string) {
  const c = issue.content;
  const abs = (u: string | null) => (u && u.startsWith('/') ? `${origin}${u}` : u);
  const postUrl = (p: Parts['posts'][number]) => (p.external && p.source_url ? p.source_url : p.visibility === 'public' ? `${site()}/news/${p.slug}/` : `${origin}/news/${p.slug}`);
  const prose = (html: string) => cleanHtml(html)
    .replace(/<p>/g, '<p style="margin:0 0 14px;line-height:1.65">')
    .replace(/<h2>/g, '<h2 style="margin:22px 0 10px;font-size:20px;color:#0b1d37">').replace(/<h3>/g, '<h3 style="margin:18px 0 8px;font-size:17px;color:#0b1d37">')
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:20px">').replace(/<li>/g, '<li style="margin:0 0 6px">')
    .replace(/<a href="([^"]+)"[^>]*>/g, (_m, href) => `<a href="${esc(href.startsWith('/') ? origin + href : href)}" style="color:${color}">`)
    .replace(/<img src="([^"]+)"([^>]*)>/g, (_m, src, rest) => `<img src="${esc(abs(src) ?? '')}"${rest} style="max-width:100%;height:auto;border-radius:10px;margin:8px 0">`);
  const heading = (title: string) => `<h2 style="margin:30px 0 12px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#6b7a90">${esc(title)}</h2>`;
  const button = (label: string, url: string) => `<p style="margin:22px 0"><a href="${esc(url)}" style="background:${color};color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(label)}</a></p>`;
  const holdingLine = me.holding ? `You hold ${num.format(me.holding.shares)} ${me.holding.className}${me.holding.value != null ? `, worth about ${aud.format(me.holding.value)} at the latest reference price` : ''}.` : '';
  return {
    greeting: `<p style="margin:0 0 18px;font-size:16px">${esc(me.firstName ? `Dear ${me.firstName},` : 'Hello,')}</p>`,
    intro: c.intro_html ? prose(c.intro_html) : '',
    holding: issue.audience === 'shareholders' && (c.holding || issue.mode !== 'compose') && me.holding
      ? `<div style="margin:22px 0;padding:16px 18px;border-radius:12px;background:#f2f6fd;border:1px solid #dfe7f5"><p style="margin:0;font-size:13px;color:#6b7a90">YOUR HOLDING</p><p style="margin:6px 0 0;font-size:16px;color:#0b1d37">${esc(holdingLine)}</p><p style="margin:6px 0 0;font-size:12px;color:#6b7a90">Indicative only: the shares are unlisted. This is not financial advice.</p></div>` : '',
    sections: (c.sections ?? []).filter((s) => s.title || s.html).map((s) => `${s.title ? `<h2 style="margin:28px 0 10px;font-size:19px;color:#0b1d37">${esc(s.title)}</h2>` : ''}${prose(s.html ?? '')}`).join('\n'),
    news: parts.posts.length ? heading('News') + parts.posts.map((p) => {
      const url = postUrl(p);
      return `<table role="presentation" width="100%" style="margin:0 0 18px;border-collapse:collapse"><tr>${p.cover_url ? `<td width="150" style="padding:0 16px 0 0;vertical-align:top"><a href="${esc(url)}"><img src="${esc(abs(p.cover_url)!)}" width="150" alt="" style="width:150px;height:auto;border-radius:10px;display:block"></a></td>` : ''}<td style="vertical-align:top"><a href="${esc(url)}" style="font-size:16px;font-weight:700;color:#0b1d37;text-decoration:none">${esc(p.title)}</a><p style="margin:6px 0 0;font-size:14px;line-height:1.55;color:#3d4b60">${esc(p.excerpt ?? '')}</p></td></tr></table>`;
    }).join('\n') : '',
    documents: parts.docs.length ? heading('New documents') + `<ul style="margin:0;padding-left:18px">${parts.docs.map((d) => `<li style="margin:0 0 8px"><a href="${esc(`${origin}/documents/${d.id}`)}" style="color:${color}">${esc(d.title)}</a> <span style="color:#6b7a90;font-size:13px">· ${fmtDate(d.published_at!)}</span></li>`).join('')}</ul>` : '',
    meetings: parts.meetings.length ? heading('Coming up') + parts.meetings.map((m) => `<p style="margin:0 0 10px"><a href="${esc(`${origin}/agm/${m.id}`)}" style="font-weight:700;color:#0b1d37">${esc(m.title)}</a><br><span style="color:#3d4b60;font-size:14px">${fmtDate(m.starts_at)}${m.location ? ` · ${esc(m.location)}` : ''} · proxy votes close ${fmtDate(m.proxy_deadline)}</span></p>`).join('\n') : '',
    closing: c.closing_html ? `<div style="margin-top:26px">${prose(c.closing_html)}</div>` : '',
    cta: c.cta_label && c.cta_url ? button(c.cta_label, c.cta_url) : '',
    portal: me.setupUrl ? `<div style="margin:26px 0;padding:16px 18px;border-radius:12px;border:1px solid #dfe7f5"><p style="margin:0 0 4px;font-weight:700;color:#0b1d37">Your investor portal is ready</p><p style="margin:0;font-size:14px;color:#3d4b60;line-height:1.55">See your holding, documents and meetings any time, and vote online. This button signs you in; you can then choose a password.</p>${button('Open the investor portal', me.setupUrl)}</div>` : '',
  };
}

/** The composed issue as editable HTML, with placeholders for the per-reader and automatic parts. */
export function composeToHtml(issue: Issue, company: Company, parts: Parts, origin: string) {
  const b = issueBlocks({ ...issue, mode: 'compose' }, company, parts, { firstName: null, holding: null, setupUrl: null, token: null }, origin, company.brand_color ?? '#276ae7');
  const c = issue.content;
  return ['{{greeting}}', b.intro, issue.audience === 'shareholders' && c.holding ? '{{holding}}' : '', b.sections,
    c.post_ids?.length ? '{{news}}' : '', issue.audience === 'shareholders' && c.document_ids?.length ? '{{documents}}' : '', issue.audience === 'shareholders' && c.meetings ? '{{meetings}}' : '',
    b.closing, b.cta, issue.audience === 'shareholders' ? '{{portal_button}}' : ''].filter(Boolean).join('\n\n');
}

type Reader = { email: string; name: string; user_id: string | null; subscriber_id: string | null; firstName: string | null; neverSignedIn: boolean };

/** Everyone an issue goes to, after unsubscribes. */
export async function audienceOf(svc: Svc, issue: Pick<Issue, 'audience' | 'entity_id' | 'segment'>): Promise<Reader[]> {
  if (issue.audience === 'public') {
    const { data } = await svc.from('newsletter_subscribers').select('id, email, name').eq('status', 'subscribed');
    return (data ?? []).map((s) => ({ email: s.email, name: s.name, user_id: null, subscriber_id: s.id, firstName: s.name.split(' ')[0] || null, neverSignedIn: false }));
  }
  let ids = await memberIds(issue.entity_id);
  if (issue.segment.segment === 'class' && issue.segment.share_class_id) {
    const { data: hs } = await svc.from('holdings').select('holder_id, shares, as_at').eq('share_class_id', issue.segment.share_class_id).order('as_at');
    const latest = new Map<string, number>(); for (const r of hs ?? []) latest.set(r.holder_id, Number(r.shares));
    const holders = [...latest].filter(([, n]) => n > 0).map(([h]) => h);
    const { data: m } = holders.length ? await svc.from('holder_members').select('user_id').in('holder_id', holders) : { data: [] };
    const inClass = new Set((m ?? []).map((x) => x.user_id));
    ids = ids.filter((id) => inClass.has(id));
  }
  if (!ids.length) return [];
  const [{ data: people }, { data: optedOut }, { data: auth }] = await Promise.all([
    svc.from('profiles').select('id, email, first_name, last_name').in('id', ids),
    svc.from('notification_preferences').select('user_id').eq('category', 'newsletter').eq('email', false).in('user_id', ids),
    svc.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const out = new Set((optedOut ?? []).map((o) => o.user_id));
  const lastIn = new Map((auth?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));
  const quietSince = new Date(Date.now() - 90 * 86_400_000).toISOString();
  return (people ?? [])
    .filter((p) => p.email && !out.has(p.id))
    .filter((p) => issue.segment.segment !== 'quiet' || !lastIn.get(p.id) || lastIn.get(p.id)! < quietSince)
    .map((p) => ({ email: p.email, name: [p.first_name, p.last_name].filter(Boolean).join(' '), user_id: p.id, subscriber_id: null, firstName: p.first_name || null, neverSignedIn: !lastIn.get(p.id) }));
}

/** A person's holding in the company (all its share classes that count toward ownership), for the snapshot. */
async function holdingOf(svc: Svc, userId: string, entityId: string, prices: Map<string, { price: number }>) {
  const { data: links } = await svc.from('holder_members').select('holder_id').eq('user_id', userId);
  const holderIds = (links ?? []).map((l) => l.holder_id);
  if (!holderIds.length) return null;
  const { data: rows } = await svc.from('holdings').select('holder_id, share_class_id, shares, as_at, share_classes!inner(entity_id, name, counts_toward_pct)').in('holder_id', holderIds).eq('share_classes.entity_id', entityId).order('as_at');
  const latest = new Map<string, { shares: number; classId: string; name: string; counts: boolean }>();
  for (const r of rows ?? []) {
    const sc = r.share_classes as unknown as { name: string; counts_toward_pct: boolean };
    latest.set(`${r.holder_id}:${r.share_class_id}`, { shares: Number(r.shares), classId: r.share_class_id, name: sc.name, counts: sc.counts_toward_pct });
  }
  const held = [...latest.values()].filter((x) => x.counts && x.shares > 0);
  if (!held.length) return null;
  const shares = held.reduce((n, x) => n + x.shares, 0);
  const priced = held.every((x) => prices.has(x.classId));
  const value = priced ? held.reduce((n, x) => n + x.shares * prices.get(x.classId)!.price, 0) : null;
  const names = [...new Set(held.map((x) => x.name.toLowerCase()))];
  return { shares, value, className: names.length === 1 ? names[0] : 'shares' };
}

/**
 * Freezes an issue for sending: works out the readers, renders each personal
 * copy and queues it. The worker then sends them. Returns how many were queued.
 */
export async function prepareIssue(svc: Svc, issueId: string, origin: string, signInLink: (userId: string) => Promise<string>) {
  const { data: issue } = await svc.from('newsletter_issues').select('*').eq('id', issueId).single();
  const { data: company } = await svc.from('entities').select('id, code, display_name, legal_name, brand_color, relationship, shareholder_mailbox').eq('id', issue.entity_id).single();
  const parts = await loadParts(svc, issue);
  const readers = await audienceOf(svc, issue);
  const prices = await latestPrices(svc as never);
  let queued = 0;
  for (const r of readers) {
    const token = randomBytes(24).toString('base64url');
    const wantsHolding = issue.mode === 'html' ? /\{\{\s*holding\s*\}\}/.test(issue.html_body ?? '') : issue.mode === 'design' ? /\{\{\s*holding\s*\}\}/.test(issue.design_html ?? '') : issue.content.holding;
    const holding = issue.audience === 'shareholders' && wantsHolding && r.user_id ? await holdingOf(svc, r.user_id, issue.entity_id, prices) : null;
    // A problem with one reader's sign-in link only drops their button, never the issue.
    const setupUrl = issue.audience === 'shareholders' && r.user_id && r.neverSignedIn ? await signInLink(r.user_id).catch((e) => { console.error('newsletter sign-in link', (e as Error).message); return null; }) : null;
    const { html } = renderIssue(issue as Issue, company as Company, parts, { firstName: r.firstName, holding, setupUrl, token }, origin);
    const { error } = await svc.from('newsletter_recipients').insert({ issue_id: issueId, email: r.email, name: r.name, user_id: r.user_id, subscriber_id: r.subscriber_id, token_hash: hashToken(token), html });
    if (!error) queued++;
  }
  await svc.from('newsletter_issues').update({ status: 'sending' }).eq('id', issueId);
  return queued;
}

/** Plain text from a stored personal HTML copy (for the text part of the email). */
function textOf(html: string) { return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '$2 ($1)').replace(/<(br|\/p|\/h2|\/li|\/tr)[^>]*>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d))).replace(/\n{3,}/g, '\n\n').trim(); }

/** Sends the next few queued copies of issues being sent; marks issues sent when done. */
export async function sendQueued(svc: Svc, origin: string) {
  const { data: issues } = await svc.from('newsletter_issues').select('id, subject, entity_id').eq('status', 'sending');
  for (const issue of issues ?? []) {
    const { data: batch } = await svc.from('newsletter_recipients').select('id, email, html').eq('issue_id', issue.id).eq('status', 'queued').order('id').limit(SEND_PER_TICK);
    if (!batch?.length) {
      await svc.from('newsletter_issues').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', issue.id).eq('status', 'sending');
      continue;
    }
    const { data: company } = await svc.from('entities').select('shareholder_mailbox').eq('id', issue.entity_id).single();
    for (const r of batch) {
      const token = /\/n\/u\/([A-Za-z0-9_-]+)/.exec(r.html)?.[1];
      try {
        const ok = await sendRaw({
          to: r.email, subject: issue.subject, html: r.html, text: textOf(r.html),
          replyTo: company?.shareholder_mailbox ?? 'info@lakeba.com',
          headers: token ? { 'List-Unsubscribe': `<${origin}/n/u/${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
        });
        await svc.from('newsletter_recipients').update(ok ? { status: 'sent', sent_at: new Date().toISOString() } : { status: 'failed', error: 'Email sending is not configured.' }).eq('id', r.id);
      } catch (e) {
        await svc.from('newsletter_recipients').update({ status: 'failed', error: (e as Error).message.slice(0, 300) }).eq('id', r.id);
      }
    }
  }
}

/** Scheduled issues whose time has come start sending. */
export async function startScheduled(svc: Svc, origin: string, signInLink: (userId: string) => Promise<string>) {
  const { data: due } = await svc.from('newsletter_issues').select('id').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString());
  // An issue waiting for approval (optional per issue) stays scheduled until it's approved.
  const { data: held } = due?.length ? await svc.from('approvals').select('item_id').eq('item_type', 'newsletter').neq('status', 'approved').in('item_id', due.map((i) => i.id)) : { data: [] };
  const wait = new Set((held ?? []).map((h) => h.item_id));
  for (const i of due ?? []) if (!wait.has(i.id) && (await claimIssue(svc, i.id))) await prepareIssue(svc, i.id, origin, signInLink);
}

/**
 * Marks an issue as being prepared, once (started_at). It only becomes
 * 'sending' when every copy is queued, so the sender never sees it half-built.
 */
export async function claimIssue(svc: Svc, issueId: string) {
  const { data } = await svc.from('newsletter_issues').update({ started_at: new Date().toISOString() }).eq('id', issueId).in('status', ['draft', 'scheduled']).is('started_at', null).select('id');
  return Boolean(data?.length);
}

/** The person behind a personal token, if any. */
export async function recipientByToken(svc: Svc, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await svc.from('newsletter_recipients').select('id, issue_id, email, user_id, subscriber_id, html, opened_at, open_count, clicked_at, click_count, unsubscribed_at').eq('token_hash', hashToken(token)).maybeSingle();
  return data;
}

/** Unsubscribes the person behind a recipient row: a shareholder's newsletter setting, or a public subscription. */
export async function unsubscribe(svc: Svc, r: { id: number; user_id: string | null; subscriber_id: string | null }) {
  const now = new Date().toISOString();
  if (r.user_id) await svc.from('notification_preferences').upsert({ user_id: r.user_id, category: 'newsletter', email: false, push: false, updated_at: now });
  if (r.subscriber_id) await svc.from('newsletter_subscribers').update({ status: 'unsubscribed', unsubscribed_at: now }).eq('id', r.subscriber_id);
  await svc.from('newsletter_recipients').update({ unsubscribed_at: now }).eq('id', r.id);
}
