import { EVENTS } from '../integrations/events';
import { API_SCOPES } from './scopes';

// The company API, described once: the /developers page and the OpenAPI
// document (/api/v1/openapi.json) are both made from this list.

type Field = { name: string; type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'; required?: boolean; description: string };
export type Op = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; scope: string; summary: string; description?: string; query?: Field[]; body?: Field[]; bodyType?: string; tag: string };

const page: Field[] = [{ name: 'limit', type: 'integer', description: '1–200, default 50.' }, { name: 'cursor', type: 'string', description: 'next_cursor from the previous page.' }];
const since: Field = { name: 'updated_since', type: 'string', description: 'Only records changed since this date-time (ISO 8601).' };

export const OPS: Op[] = [
  { tag: 'Company', method: 'GET', path: '/company', scope: 'investors.view', summary: 'The company and its share classes, with shares on issue.' },
  { tag: 'Company', method: 'GET', path: '/share-classes', scope: 'investors.view', summary: 'Share classes and shares on issue (the official figure where there is one).' },
  { tag: 'Register', method: 'GET', path: '/holders', scope: 'investors.view', summary: 'Holders (holding entities) with their latest holdings and % ownership.', query: [...page, { name: 'include_zero', type: 'boolean', description: 'Also holders whose shares are now nil.' }] },
  { tag: 'Register', method: 'GET', path: '/holders/{id}', scope: 'investors.view', summary: 'One holder.' },
  { tag: 'Register', method: 'POST', path: '/holders/{id}/holdings', scope: 'investors.do', summary: 'A dated balance for a holder (not for companies whose holdings come from their register).', body: [{ name: 'share_class', type: 'string', required: true, description: 'Class code, e.g. ORD.' }, { name: 'shares', type: 'integer', required: true, description: 'Balance (0 or more).' }, { name: 'as_at', type: 'string', required: true, description: 'YYYY-MM-DD.' }, { name: 'reason', type: 'string', required: true, description: 'Why (kept in the audit log).' }] },
  { tag: 'Register', method: 'PUT', path: '/holders/{id}/external-ids/{system}', scope: 'investors.do', summary: 'Your system’s ID for this holder (returned as external_ids). DELETE removes it.', body: [{ name: 'external_id', type: 'string', required: true, description: 'Your ID.' }] },
  { tag: 'Register', method: 'GET', path: '/holdings', scope: 'investors.view', summary: 'The latest holding per holder and class.', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }, { name: 'share_class', type: 'string', description: 'One class, e.g. ORD.' }] },
  { tag: 'Register', method: 'GET', path: '/holdings/history', scope: 'investors.view', summary: 'Every dated balance, newest first.', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }, { name: 'share_class', type: 'string', description: 'One class.' }, { name: 'from', type: 'string', description: 'YYYY-MM-DD.' }, { name: 'to', type: 'string', description: 'YYYY-MM-DD.' }] },
  { tag: 'Register', method: 'GET', path: '/register/movements', scope: 'investors.view', summary: 'Movements on the register of members (allotments, transfers…).', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }] },
  { tag: 'Register', method: 'GET', path: '/register/imports', scope: 'investors.view', summary: 'Registers of members imported.' },
  { tag: 'Register', method: 'POST', path: '/register/imports', scope: 'investors.do', bodyType: 'application/pdf', summary: 'Send a new register of members (the PDF as the body). Never applied straight away: an Admin checks, previews and confirms it in the portal. Optional header X-File-Name.' },
  { tag: 'People', method: 'GET', path: '/people', scope: 'people.read', summary: 'Investors: name, email, phone, portal status (not_invited, invited, active) and holders.', query: [...page, { name: 'status', type: 'string', description: 'not_invited, invited or active.' }] },
  { tag: 'People', method: 'GET', path: '/people/{id}', scope: 'people.read', summary: 'One investor.' },
  { tag: 'People', method: 'POST', path: '/people', scope: 'investors.do', summary: 'Add an investor to a holder, with or without the invitation email.', body: [{ name: 'email', type: 'string', required: true, description: 'Their email.' }, { name: 'first_name', type: 'string', description: '' }, { name: 'last_name', type: 'string', description: '' }, { name: 'holder_id', type: 'string', description: 'The holder (or holder_ref).' }, { name: 'holder_ref', type: 'string', description: 'The holder’s register reference.' }, { name: 'access', type: 'string', description: 'owner (can vote, default) or viewer.' }, { name: 'invite', type: 'boolean', description: 'Send the invitation now (default false).' }] },
  { tag: 'People', method: 'PATCH', path: '/people/{id}', scope: 'investors.do', summary: 'Change an investor’s name or phone (only if they are an investor of this company alone).', body: [{ name: 'first_name', type: 'string', description: '' }, { name: 'last_name', type: 'string', description: '' }, { name: 'phone', type: 'string', description: '' }] },
  { tag: 'People', method: 'PUT', path: '/people/{id}/external-ids/{system}', scope: 'investors.do', summary: 'Your system’s ID for this investor. DELETE removes it.', body: [{ name: 'external_id', type: 'string', required: true, description: 'Your ID.' }] },
  { tag: 'Documents', method: 'GET', path: '/documents', scope: 'documents.view', summary: 'Documents (not those for one holder).', query: [...page, since, { name: 'published', type: 'boolean', description: 'Only published, or only drafts.' }, { name: 'category', type: 'string', description: '' }] },
  { tag: 'Documents', method: 'GET', path: '/documents/{id}', scope: 'documents.view', summary: 'One document, with a download link valid for 5 minutes.' },
  { tag: 'Documents', method: 'POST', path: '/documents', scope: 'documents.do', summary: 'Upload a document. It arrives as a draft: it’s published (or approved) in the portal.', body: [{ name: 'title', type: 'string', required: true, description: '' }, { name: 'category', type: 'string', description: 'report, agm, update, governance or other.' }, { name: 'audience', type: 'string', description: 'all_investors (default) or board.' }, { name: 'summary', type: 'string', description: '' }, { name: 'file_name', type: 'string', description: '' }, { name: 'content_type', type: 'string', description: 'Default application/pdf.' }, { name: 'file_base64', type: 'string', required: true, description: 'The file, base64.' }, { name: 'knowledge_base', type: 'boolean', description: 'Use it in Ask Lakeba once published.' }] },
  { tag: 'News', method: 'GET', path: '/posts', scope: 'news.view', summary: 'News posts (for investors and public), published or not.', query: [...page, since, { name: 'published', type: 'boolean', description: '' }, { name: 'full', type: 'boolean', description: 'Include the HTML.' }] },
  { tag: 'News', method: 'POST', path: '/posts', scope: 'news.do', summary: 'A news post as a draft (the HTML is cleaned like the editor’s).', body: [{ name: 'title', type: 'string', required: true, description: '' }, { name: 'excerpt', type: 'string', description: '' }, { name: 'body_html', type: 'string', description: '' }, { name: 'visibility', type: 'string', description: 'shareholders (default) or public.' }] },
  { tag: 'News', method: 'GET', path: '/announcements', scope: 'news.view', summary: 'Dashboard announcements.', query: [...page, { name: 'current', type: 'boolean', description: 'Only those showing now.' }] },
  { tag: 'Meetings', method: 'GET', path: '/meetings', scope: 'meetings.view', summary: 'Meetings (AGMs, EGMs).', query: [...page, { name: 'status', type: 'string', description: 'upcoming, open, closed or results.' }] },
  { tag: 'Meetings', method: 'GET', path: '/meetings/{id}', scope: 'meetings.view', summary: 'A meeting, its resolutions, outcomes and proxy vote totals.' },
  { tag: 'Meetings', method: 'POST', path: '/meetings', scope: 'meetings.do', summary: 'Create a meeting (upcoming; opening proxy voting is done in the portal).', body: [{ name: 'title', type: 'string', required: true, description: '' }, { name: 'kind', type: 'string', description: 'agm (default) or egm.' }, { name: 'starts_at', type: 'string', required: true, description: 'ISO date-time.' }, { name: 'proxy_deadline', type: 'string', required: true, description: 'ISO date-time, before it starts.' }, { name: 'location', type: 'string', description: '' }, { name: 'livestream_url', type: 'string', description: '' }] },
  { tag: 'Meetings', method: 'POST', path: '/meetings/{id}/resolutions', scope: 'meetings.do', summary: 'Add a resolution (before proxy voting opens).', body: [{ name: 'number', type: 'integer', required: true, description: '' }, { name: 'title', type: 'string', required: true, description: '' }, { name: 'description', type: 'string', description: '' }, { name: 'kind', type: 'string', description: 'ordinary (default) or special.' }] },
  { tag: 'Board Q&A', method: 'GET', path: '/queries', scope: 'inbox.view', summary: 'Board Q&A questions and their messages (who asked needs people.read).', query: [...page, { name: 'status', type: 'string', description: '' }] },
  { tag: 'Board Q&A', method: 'POST', path: '/queries/{id}/replies', scope: 'inbox.do', summary: 'Reply to a question; the investor is told.', body: [{ name: 'body', type: 'string', required: true, description: '' }] },
  { tag: 'Data rooms', method: 'GET', path: '/data-rooms', scope: 'documents.view', summary: 'Data rooms.' },
  { tag: 'Data rooms', method: 'GET', path: '/data-rooms/{id}', scope: 'documents.view', summary: 'A room, its documents, its guests and what they opened (names and emails need people.read).' },
  { tag: 'Data rooms', method: 'POST', path: '/data-rooms/{id}/guests', scope: 'documents.do', summary: 'Invite a guest; returns their personal link.', body: [{ name: 'name', type: 'string', required: true, description: '' }, { name: 'email', type: 'string', required: true, description: '' }, { name: 'organisation', type: 'string', description: '' }, { name: 'days', type: 'integer', description: '1–180, default 30.' }, { name: 'send_email', type: 'boolean', description: 'Email the link (default true).' }] },
  { tag: 'Data rooms', method: 'DELETE', path: '/data-rooms/{id}/guests/{guestId}', scope: 'documents.do', summary: 'Revoke a guest: their link stops working at once.' },
  { tag: 'Newsletter', method: 'GET', path: '/newsletter/subscribers', scope: 'newsletters.view', summary: 'Newsletter subscribers (also needs people.read).', query: [...page, since, { name: 'status', type: 'string', description: 'pending, subscribed or unsubscribed.' }] },
  { tag: 'Newsletter', method: 'POST', path: '/newsletter/subscribers', scope: 'newsletters.do', summary: 'Subscribe someone who asked for the newsletter.', body: [{ name: 'email', type: 'string', required: true, description: '' }, { name: 'name', type: 'string', description: '' }] },
  { tag: 'Newsletter', method: 'DELETE', path: '/newsletter/subscribers/{id}', scope: 'newsletters.do', summary: 'Unsubscribe.' },
  { tag: 'Events and webhooks', method: 'GET', path: '/events', scope: 'any', summary: 'Events of the last 30 days, for tools that poll instead of receiving webhooks.', query: [{ name: 'after', type: 'integer', description: 'The last sequence you saw.' }, { name: 'type', type: 'string', description: '' }, { name: 'limit', type: 'integer', description: '1–200.' }] },
  { tag: 'Events and webhooks', method: 'GET', path: '/webhooks', scope: 'any', summary: 'This key’s webhook subscriptions, and the events there are.' },
  { tag: 'Events and webhooks', method: 'POST', path: '/webhooks', scope: 'any', summary: 'Subscribe a URL to events (REST hooks, as Zapier and Make use them). Returns the signing secret once.', body: [{ name: 'target_url', type: 'string', required: true, description: 'https:// address.' }, { name: 'events', type: 'array', required: true, description: 'Event types.' }, { name: 'format', type: 'string', description: 'json (default), slack or teams.' }] },
  { tag: 'Events and webhooks', method: 'DELETE', path: '/webhooks/{id}', scope: 'any', summary: 'Unsubscribe.' },
];

/** The OpenAPI 3.1 document. */
export function openApi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [...(op.path.match(/\{(\w+)\}/g) ?? []).map((p) => ({ name: p.slice(1, -1), in: 'path', required: true, schema: { type: 'string' } })),
      ...(op.query ?? []).map((q) => ({ name: q.name, in: 'query', required: false, description: q.description, schema: { type: q.type } }))];
    const body = op.bodyType ? { required: true, content: { [op.bodyType]: { schema: { type: 'string', format: 'binary' } } } }
      : op.body ? { required: true, content: { 'application/json': { schema: { type: 'object', required: op.body.filter((b) => b.required).map((b) => b.name), properties: Object.fromEntries(op.body.map((b) => [b.name, { type: b.type, description: b.description, ...(b.type === 'array' ? { items: { type: 'string' } } : {}) }])) } } } }
      : undefined;
    (paths[op.path] ??= {})[op.method.toLowerCase()] = {
      tags: [op.tag], summary: op.summary, ...(op.scope !== 'any' ? { description: `Needs the “${op.scope}” scope.`, 'x-scope': op.scope } : { description: 'Any key.' }),
      ...(params.length ? { parameters: params } : {}), ...(body ? { requestBody: body } : {}),
      ...(op.method !== 'GET' ? { 'x-idempotency': 'Send an Idempotency-Key header to make retries safe.' } : {}),
      responses: { 200: { description: 'OK' }, ...(op.method === 'POST' ? { 201: { description: 'Created' } } : {}), 400: { $ref: '#/components/responses/Problem' }, 401: { $ref: '#/components/responses/Problem' }, 403: { $ref: '#/components/responses/Problem' }, 404: { $ref: '#/components/responses/Problem' }, 429: { $ref: '#/components/responses/Problem' } },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Lakeba investor portal API', version: '1.0.0', description: 'A company’s register, investors, documents, news, meetings, Board Q&A, data rooms and newsletter, for its other tools. See /developers.' },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ key: [] }],
    components: {
      securitySchemes: { key: { type: 'http', scheme: 'bearer', description: 'A company API key (lk_live_…) or an app’s access token (lk_oat_…).' }, oauth: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: `${origin}/oauth/authorize`, tokenUrl: `${origin}/oauth/token`, scopes: Object.fromEntries(API_SCOPES.map((s) => [s.key, s.label])) } } } },
      responses: { Problem: { description: 'An error (application/problem+json): status, code, detail.', content: { 'application/problem+json': { schema: { type: 'object', properties: { status: { type: 'integer' }, code: { type: 'string' }, detail: { type: 'string' } } } } } } },
    },
    paths,
    'x-webhook-events': EVENTS,
  };
}
