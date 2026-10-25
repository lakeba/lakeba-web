import { createHash, randomBytes } from 'node:crypto';
import type { serviceClient } from './admin';
import { sendMail } from './mail';
import { cleanHtml, markWebsiteChanged, plainText, saveRevision } from './news-cms';

type Svc = ReturnType<typeof serviceClient>;

// Press releases (the press office). The marketing team (press_team) and
// group admins write them; only group admins approve and publish. A published
// release is a public news post (categories: Press release) with the
// dateline, the boilerplate and the media contact, plus a press kit and PDF.
// People quoted approve their quote through a link (press_quote_approvals).

export type Quote = { key: string; name: string; title: string; email: string; text: string; status: 'none' | 'pending' | 'approved' | 'changed' };
export type KitItem = { url: string; label: string };
export type Check = { quote: string; why: string; severity: 'warning' | 'serious' };
export type Release = {
  id: string; entity_id: string | null; status: 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'withdrawn';
  head_points: string; headline: string; headline_options: string[]; subheadline: string; dateline_city: string; body_html: string;
  quotes: Quote[]; summary: string; social: { linkedin?: string; x?: string; bluesky?: string }; checks: Check[]; checks_at: string | null;
  cover_url: string | null; kit: KitItem[]; embargo_until: string | null; publish_at: string | null; post_id: string | null;
  review_note: string; submitted_by: string | null; submitted_at: string | null; approved_by: string | null; approved_at: string | null;
  published_at: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string; notify_investors: boolean;
};
export type PressSettings = { boilerplate_html: string; about_title: string; contact_name: string; contact_email: string; contact_phone: string; dateline_city: string; reply_tracking: boolean; reply_mailbox: string; wires: Wire[] };
/** A wire service the press office uses: where its desk takes submissions by email (optional), and notes (account, price). */
export type Wire = { name: string; email: string; notes: string };

export const STATUS_LABEL: Record<Release['status'], string> = {
  draft: 'Draft', in_review: 'Waiting for approval', changes_requested: 'Changes requested', approved: 'Approved, scheduled', published: 'Published', withdrawn: 'Withdrawn',
};

/** What this person may do: write (the press team and group admins) and approve (group admins). Both after two-step. */
export function pressAccess(locals: App.Locals) {
  if (!locals.user || locals.user.aal !== 'aal2') return null;
  const approver = locals.profile?.role === 'admin';
  if (!approver && !locals.pressTeam) return null;
  return { writer: true, approver };
}

export async function pressSettings(svc: Svc): Promise<PressSettings> {
  const { data } = await svc.from('portal_settings').select('value').eq('key', 'press').maybeSingle();
  const v = (data?.value ?? {}) as Partial<PressSettings>;
  return { boilerplate_html: v.boilerplate_html ?? '', about_title: v.about_title || 'About Lakeba Group', contact_name: v.contact_name ?? 'Lakeba Media Relations', contact_email: v.contact_email || 'press@lakeba.com', contact_phone: v.contact_phone ?? '', dateline_city: v.dateline_city || 'SYDNEY', reply_tracking: v.reply_tracking === true, reply_mailbox: v.reply_mailbox || 'press@lakeba.com', wires: Array.isArray(v.wires) ? v.wires : [] };
}

export async function loadRelease(svc: Svc, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await svc.from('press_releases').select('*').eq('id', id).maybeSingle();
  return data as Release | null;
}

/** Keeps a copy of the release before a change (the last 30). */
export async function saveVersion(svc: Svc, r: Release, by: string | null, reason: string) {
  const { id: _i, created_at: _c, ...snapshot } = r;
  await svc.from('press_release_versions').insert({ release_id: r.id, snapshot, saved_by: by, reason });
  const { data: old } = await svc.from('press_release_versions').select('id').eq('release_id', r.id).order('saved_at', { ascending: false }).range(30, 300);
  if (old?.length) await svc.from('press_release_versions').delete().in('id', old.map((o) => o.id));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const releaseDate = (iso?: string | null) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' }).format(iso ? new Date(iso) : new Date());

/** Text as it is stored in a cleaned body (the cleaner re-encodes quotes and apostrophes), to find it again. */
export const asStored = (text: string) => cleanHtml(`<p>${esc(text.trim())}</p>`).replace(/^<p>|<\/p>$/g, '');
/** Quotes whose approved words are no longer in the text exactly (edited after approval, or not found). */
export const quotesNotInText = (r: Pick<Release, 'quotes' | 'body_html'>) => r.quotes.filter((q) => q.text.trim() && !r.body_html.includes(asStored(q.text)));

/** A quote as it appears in the text. The quote's own words are what the quoted person approves. */
export const quoteHtml = (q: Pick<Quote, 'name' | 'title' | 'text'>) => `<p>“${esc(q.text.trim())}” said ${esc(q.name.trim())}${q.title.trim() ? `, ${esc(q.title.trim())}` : ''}.</p>`;

/** Things in the text the writer still has to fill in: [square brackets]. */
export const openBrackets = (r: Pick<Release, 'headline' | 'subheadline' | 'body_html' | 'summary'>) =>
  [...new Set(`${r.headline} ${r.subheadline} ${plainText(r.body_html)} ${r.summary}`.match(/\[[^\]\n]{2,120}\]/g) ?? [])];

/** The release as published: dateline on the first paragraph, then the text, the boilerplate, the media contact and ###. */
export function composeRelease(r: Release, s: PressSettings, when: string | null) {
  const dateline = `<strong>${esc((r.dateline_city || s.dateline_city).toUpperCase())}, ${esc(releaseDate(when))}</strong> – `;
  const body = r.body_html.trim() ? r.body_html.replace(/<p>/i, `<p>${dateline}`) : `<p>${dateline}</p>`;
  const contact = [s.contact_name && esc(s.contact_name), s.contact_email && `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a>`, s.contact_phone && esc(s.contact_phone)].filter(Boolean).join('<br>');
  return cleanHtml(`${body}<h3>${esc(s.about_title)}</h3>${s.boilerplate_html}<h3>Media contact</h3><p>${contact}</p><p style="text-align:center">###</p>`);
}

async function uniqueSlug(svc: Svc, headline: string, postId: string | null) {
  const base = headline.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'press-release';
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const { data } = await svc.from('posts').select('id').eq('slug', slug).maybeSingle();
    if (!data || data.id === postId) return slug;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/** Publishes (or republishes, after a correction) the release as a public news post. */
export async function publishRelease(svc: Svc, r: Release, by: string | null) {
  const s = await pressSettings(svc);
  const when = r.published_at ?? r.publish_at ?? new Date().toISOString();
  // Releases are about the group unless a venture was chosen.
  const { data: company } = r.entity_id ? await svc.from('entities').select('id, display_name, relationship').eq('id', r.entity_id).maybeSingle() : await svc.from('entities').select('id, display_name, relationship').eq('relationship', 'group').limit(1).maybeSingle();
  const content = {
    title: r.headline.trim(), excerpt: (r.subheadline || r.summary).trim().slice(0, 400), body_html: composeRelease(r, s, when),
    seo_description: (r.summary || r.subheadline).trim().slice(0, 160), cover_url: r.cover_url,
  };
  const fields = {
    ...content, visibility: 'public', venture: company && company.relationship !== 'group' ? company.display_name : '', entity_id: company?.id ?? r.entity_id,
    categories: ['Press release'], share_image_url: r.cover_url, published_at: when, press_release_id: r.id, external: false,
    // Investors are told once, by the usual news notification, if the approver asked.
    ...(r.notify_investors ? { notify_on_publish: true } : {}),
    updated_by: by, updated_at: new Date().toISOString(),
  };
  let postId = r.post_id;
  if (postId) await svc.from('posts').update({ ...fields, slug: undefined }).eq('id', postId).throwOnError();
  else {
    const { data: post } = await svc.from('posts').insert({ ...fields, slug: await uniqueSlug(svc, r.headline, null), created_by: by }).select('id').single().throwOnError();
    postId = post!.id;
  }
  await saveRevision(svc, postId!, content, by, 'publish');
  await svc.from('press_releases').update({ status: 'published', post_id: postId, published_at: when, updated_at: new Date().toISOString() }).eq('id', r.id).throwOnError();
  // The worker rebuilds the website a couple of minutes later (one rebuild for a burst of changes).
  await markWebsiteChanged(svc);
  return postId!;
}

/** Takes a published release off the newsroom (the post stays, unpublished). */
export async function withdrawRelease(svc: Svc, r: Release, by: string | null) {
  if (r.post_id) await svc.from('posts').update({ published_at: null, updated_by: by, updated_at: new Date().toISOString() }).eq('id', r.post_id);
  await svc.from('press_releases').update({ status: 'withdrawn', updated_by: by, updated_at: new Date().toISOString() }).eq('id', r.id);
  await markWebsiteChanged(svc);
}

/** Approved releases whose time has come (the worker, every minute). */
export async function publishDue(svc: Svc) {
  const { data } = await svc.from('press_releases').select('*').eq('status', 'approved').lte('publish_at', new Date().toISOString()).limit(10);
  for (const r of (data ?? []) as Release[]) {
    try { await publishRelease(svc, r, r.approved_by); } catch (e) { console.error('press publish', r.id, (e as Error).message); }
  }
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Emails the quoted person a link to approve or edit their quote. */
export async function requestQuoteApproval(svc: Svc, r: Release, q: Quote, by: string, origin: string) {
  const token = randomBytes(24).toString('base64url');
  await svc.from('press_quote_approvals').update({ status: 'cancelled' }).eq('release_id', r.id).eq('quote_key', q.key).eq('status', 'pending');
  await svc.from('press_quote_approvals').insert({ release_id: r.id, quote_key: q.key, name: q.name, email: q.email, token_hash: hash(token), original: q.text, sent_by: by }).throwOnError();
  await sendMail({
    to: q.email, subject: `Please approve your quote: ${r.headline || 'Lakeba press release'}`,
    text: `Hello ${q.name.split(' ')[0]},\n\nLakeba is preparing a press release, “${r.headline || 'untitled'}”, which quotes you:\n\n“${q.text}”\n\nPlease approve the quote, or change it, using the button below. The link works for 21 days and doesn't need a portal account.`,
    link: `${origin}/press/quote/${token}`, linkLabel: 'Review my quote', footer: 'You receive this because a Lakeba press release quotes you. Questions: press@lakeba.com.',
  });
}

export async function quoteApprovalByToken(svc: Svc, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await svc.from('press_quote_approvals').select('*').eq('token_hash', hash(token)).maybeSingle();
  return data as null | { id: string; release_id: string; quote_key: string; name: string; email: string; status: string; original: string; final: string | null; expires_at: string };
}

/** The quoted person's answer: approved as written, or changed (the text is updated everywhere it appears). */
export async function answerQuote(svc: Svc, a: { id: string; release_id: string; quote_key: string; original: string }, final: string | null, comment: string) {
  const r = await loadRelease(svc, a.release_id);
  if (!r) return false;
  const changed = final !== null && final.trim() && final.trim() !== a.original.trim();
  await svc.from('press_quote_approvals').update({ status: changed ? 'changed' : 'approved', final: changed ? final!.trim() : a.original, comment: comment.slice(0, 1000), responded_at: new Date().toISOString() }).eq('id', a.id);
  const quotes = r.quotes.map((q) => (q.key === a.quote_key ? { ...q, text: changed ? final!.trim() : q.text, status: (changed ? 'changed' : 'approved') as Quote['status'] } : q));
  const body_html = changed ? r.body_html.split(asStored(a.original)).join(asStored(final!)) : r.body_html;
  await saveVersion(svc, r, null, changed ? 'quote changed' : 'quote approved');
  await svc.from('press_releases').update({ quotes, body_html, updated_at: new Date().toISOString() }).eq('id', r.id);
  return true;
}

// Embargo and publication times are Sydney time, whatever the server's time zone.
const SYD = 'Australia/Sydney';
function sydneyOffset(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SYD, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}
/** "2026-11-03T09:00" (a datetime-local in Sydney) → ISO. */
export function sydneyToIso(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = guess - sydneyOffset(new Date(guess)) * 60_000;
  return new Date(guess - sydneyOffset(new Date(first)) * 60_000).toISOString();
}
/** ISO → "2026-11-03T09:00" in Sydney, for a datetime-local field. */
export const isoToSydney = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + sydneyOffset(new Date(iso)) * 60_000).toISOString().slice(0, 16) : '');
export const sydneyTime = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: SYD, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
