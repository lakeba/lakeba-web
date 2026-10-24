import sanitize from 'sanitize-html';
import { Marked } from 'marked';
import { GITHUB_API_BASE, GITHUB_DEPLOY_TOKEN, WEBSITE_REPO, WEBSITE_WORKFLOW } from 'astro:env/server';
import type { serviceClient } from './admin';

type Svc = ReturnType<typeof serviceClient>;

// News written in the portal (Admin → Content → News). Bodies are HTML from
// the editor, always cleaned here before they are stored or shown. Public
// posts also go to the website, which reads /api/public/news.json when built;
// the portal asks GitHub to rebuild it a couple of minutes after a change.

export const MEDIA_PREFIX = '/news-media/';

const VIDEO_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com'];

/** What the editor may produce. Anything else (scripts, styles, event handlers) is dropped. */
export function cleanHtml(html: string) {
  return sanitize(html, {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'code', 'pre',
      'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'iframe', 'div'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-size'],
      iframe: ['src', 'width', 'height', 'allowfullscreen', 'allow', 'title'],
      th: ['colspan', 'rowspan', 'align'], td: ['colspan', 'rowspan', 'align'],
      div: ['data-youtube-video', 'data-embed'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'http'] },
    allowProtocolRelative: false,
    allowedIframeHostnames: VIDEO_HOSTS,
    // Images only from our own media store or https addresses.
    exclusiveFilter: (frame) => frame.tag === 'img' && !(frame.attribs.src?.startsWith(MEDIA_PREFIX) || frame.attribs.src?.startsWith('https://')),
    transformTags: {
      a: (tag, attribs) => ({ tagName: tag, attribs: attribs.href?.startsWith('http') ? { ...attribs, target: '_blank', rel: 'noopener' } : attribs }),
      b: 'strong', i: 'em',
    },
  });
}

const marked = new Marked();
/** Older posts and imported articles are Markdown; this turns them into clean HTML. */
export const markdownToHtml = async (md: string) => cleanHtml(await marked.parse(md));

/** Plain text of a body, for suggestions and search descriptions. */
export const plainText = (html: string) => sanitize(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

/** A media path (stored relative) as a full address for the website and feeds. */
export const absoluteMedia = (origin: string, url: string | null | undefined) => (url && url.startsWith(MEDIA_PREFIX) ? `${origin}${url}` : url ?? null);
/** The same for every image inside a body. */
export const absoluteBody = (origin: string, html: string) => html.replaceAll(`src="${MEDIA_PREFIX}`, `src="${origin}${MEDIA_PREFIX}`);

export type PostContent = { title: string; excerpt: string; body_html: string; seo_description: string; cover_url: string | null };

export async function saveRevision(svc: Svc, postId: string, content: PostContent, by: string | null, reason: 'save' | 'publish' | 'restore' | 'import' = 'save') {
  await svc.from('post_revisions').insert({ post_id: postId, ...content, saved_by: by, reason }).throwOnError();
}

/** Remember that public news changed; the worker rebuilds the website a little later. */
export async function markWebsiteChanged(svc: Svc) {
  const { data } = await svc.from('portal_settings').select('value').eq('key', 'website_sync').maybeSingle();
  const value = { ...(data?.value as object ?? {}), changed_at: new Date().toISOString() };
  await svc.from('portal_settings').upsert({ key: 'website_sync', value, updated_at: new Date().toISOString() }).throwOnError();
}

export const websiteSyncConfigured = () => Boolean(GITHUB_DEPLOY_TOKEN);

/** Starts the website's deploy workflow on GitHub. Returns why not, if it couldn't. */
export async function requestWebsiteDeploy(): Promise<string | null> {
  if (!GITHUB_DEPLOY_TOKEN) return 'no GitHub token';
  const res = await fetch(`${GITHUB_API_BASE}/repos/${WEBSITE_REPO}/actions/workflows/${WEBSITE_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${GITHUB_DEPLOY_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  return res.ok ? null : `GitHub answered ${res.status}`;
}

/** Image files a person may upload, by type. */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Published public articles in the shape Ask's knowledge code expects (it used
 * to read the website's Markdown files): body as Markdown or plain text.
 */
export async function loadPublicArticles(svc: Svc) {
  const { data } = await svc.from('posts').select('slug, title, body_md, body_html, venture, external, published_at, entities(display_name)')
    .eq('visibility', 'public').lte('published_at', new Date().toISOString());
  return (data ?? []).map((p) => ({
    id: p.slug as string,
    body: p.body_html ? plainText(p.body_html) : (p.body_md as string),
    data: { title: p.title as string, date: new Date(p.published_at!), venture: (p.venture || (p.entities as unknown as { display_name: string } | null)?.display_name || 'Lakeba Group') as string, external: Boolean(p.external) },
  }));
}
