import { EVENTS, eventScope } from '../integrations/events';
import { API_SCOPES } from './scopes';

// The company API, described once: the /developers guide, the reference at /developers/reference and the
// OpenAPI document (/api/v1/openapi.json) are all made from this list. Examples are made up (Example Ventures,
// EXV); the schemas are worked out from them, with the field descriptions below.

type Field = { name: string; type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'; required?: boolean; description: string; example?: unknown };
export type Op = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; scope: string; summary: string; description?: string; query?: Field[]; body?: Field[]; bodyType?: string; tag: string;
  /** What a successful answer looks like (made up), and its status when it isn't 200. */
  example?: unknown; status?: number;
};

const page: Field[] = [{ name: 'limit', type: 'integer', description: '1–200, default 50.', example: 50 }, { name: 'cursor', type: 'string', description: 'next_cursor from the previous page.' }];
const since: Field = { name: 'updated_since', type: 'string', description: 'Only records changed since this date-time (ISO 8601).', example: '2026-11-01T00:00:00Z' };

// Made-up records, used across the examples.
const ID = {
  company: '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0', holder: '0b6f3c1e-4a8d-4f2b-9c55-2e7d1a9b3f10', ord: '5a1d9e7c-2b3f-4c6a-8d0e-7f4b2a9c1e33', opts: '6b2e0f8d-3c4a-4d7b-9e1f-8a5c3b0d2f44',
  person: '51aa7c20-9d4e-4b8f-a1c3-6e2f0b8d4a77', doc: 'c3e81f4a-6b2d-4a9e-8f17-0d5c9b3a2e61', meeting: '9b2e4d6f-1a3c-4e5b-9d7f-8c0a2b4e6d18', resolution: '3d5f7b9e-2c4a-4f6e-8d0b-1a3c5e7f9b20',
  room: 'e4a7c9b1-3d5f-4a2e-8b6c-1f0d9e7a5c42', guest: 'f1c3e5a7-9b2d-4f6e-8a0c-3d5b7e9f1a24', query: '7d9f1b3e-5a7c-4e2f-9b1d-6c8e0a2f4b53', subscriber: '2c4e6a8b-0d1f-4a3c-9e5b-7f9d1c3e5a86',
  webhook: '6e8a0c2e-4f6b-4d8a-9c0e-2b4d6f8a0c97', post: 'a8c0e2f4-6b8d-4a0c-8e2f-4b6d8f0a2c19', import: 'b9d1f3a5-7c9e-4b1d-8f3a-5c7e9b1d3f28', event: 'd2f4a6c8-0e2a-4c4e-9a6c-8e0a2c4e6a35',
  announcement: '8f0b2d4f-6a8c-4e0a-9c2e-4a6c8e0a2c51',
};
const holding = { company: 'EXV', share_class: 'ORD', share_class_id: ID.ord, shares: 250000, as_at: '2026-10-31', ownership_pct: 2.5 };
const holder = { id: ID.holder, name: 'Harbour Street Investments Pty Ltd <Harbour Street Fund A/C>', kind: 'company', registry_ref: 'H00042', is_group_stake: false, external_ids: { hubspot: '18205531', xero: '4d2b7c1e-90aa-4f3e-b1f2-6c0d8e2a7b55' }, holdings: [holding] };
const person = { id: ID.person, email: 'alex.morgan@example.com', first_name: 'Alex', last_name: 'Morgan', phone: '+61 400 000 000', status: 'active', last_sign_in_at: '2026-11-02T22:41:07Z', created_at: '2026-08-14T03:12:45Z', updated_at: '2026-10-30T05:01:19Z', holders: [{ holder_id: ID.holder, name: holder.name, access: 'owner' }], external_ids: { hubspot: '90311' } };
const doc = { company: 'EXV', id: ID.doc, title: 'Annual Report 2026', summary: 'Results for the year to 30 June 2026.', category: 'report', audience: 'all_investors', mime_type: 'application/pdf', size_bytes: 2483011, published_at: '2026-10-28T23:00:00Z', created_at: '2026-10-27T04:12:00Z' };
const meeting = { company: 'EXV', id: ID.meeting, title: '2026 Annual General Meeting', kind: 'agm', starts_at: '2026-11-27T00:00:00Z', location: 'Level 5, 1 Example Street, Sydney NSW', livestream_url: 'https://example.com/live/agm-2026', proxy_deadline: '2026-11-25T00:00:00Z', status: 'open', notice_document_id: ID.doc, minutes_document_id: null, created_at: '2026-10-20T01:30:00Z' };
const room = { id: ID.room, company: 'EXV', name: 'Series B due diligence', description: 'Financials and contracts for prospective investors.', closed_at: null, created_at: '2026-10-15T02:00:00Z' };
const list = (item: unknown, total = 86) => ({ data: [item], total, next_cursor: total > 1 ? 'NTA' : null });

export const OPS: Op[] = [
  { tag: 'Company', method: 'GET', path: '/company', scope: 'investors.view', summary: 'The company and its share classes, with shares on issue.',
    example: { data: [{ id: ID.company, code: 'EXV', name: 'Example Ventures', legal_name: 'Example Ventures Pty Ltd', company_number: '123 456 789', country: 'AU', relationship: 'portfolio', website: 'https://example.com', holdings_from_register: true, share_classes: [{ id: ID.ord, code: 'ORD', name: 'Ordinary shares', kind: 'ordinary', voting: true, counts_toward_ownership: true, on_issue: 10000000, official_on_issue: 10000000, official_as_at: '2026-10-31' }] }] } },
  { tag: 'Company', method: 'GET', path: '/share-classes', scope: 'investors.view', summary: 'Share classes and shares on issue (the official figure where there is one).',
    example: { data: [{ id: ID.ord, company: 'EXV', code: 'ORD', name: 'Ordinary shares', kind: 'ordinary', voting: true, currency: 'AUD', counts_toward_ownership: true, on_issue: 10000000, official_on_issue: 10000000, official_as_at: '2026-10-31' }, { id: ID.opts, company: 'EXV', code: 'OPTS', name: 'Options', kind: 'option', voting: false, currency: 'AUD', counts_toward_ownership: false, on_issue: 400000, official_on_issue: null, official_as_at: null }] } },
  { tag: 'Register', method: 'GET', path: '/holders', scope: 'investors.view', summary: 'Holders (holding entities) with their latest holdings and % ownership.', query: [...page, { name: 'include_zero', type: 'boolean', description: 'Also holders whose shares are now nil.' }], example: list(holder) },
  { tag: 'Register', method: 'GET', path: '/holders/{id}', scope: 'investors.view', summary: 'One holder.', example: { data: holder } },
  { tag: 'Register', method: 'POST', path: '/holders/{id}/holdings', scope: 'investors.do', summary: 'A dated balance for a holder (not for companies whose holdings come from their register).', status: 201,
    body: [{ name: 'share_class', type: 'string', required: true, description: 'Class code.', example: 'ORD' }, { name: 'shares', type: 'integer', required: true, description: 'Balance (0 or more).', example: 260000 }, { name: 'as_at', type: 'string', required: true, description: 'YYYY-MM-DD.', example: '2026-11-03' }, { name: 'reason', type: 'string', required: true, description: 'Why (kept in the audit log).', example: 'Placement of 10,000 shares' }],
    example: { data: { holder_id: ID.holder, share_class: 'ORD', shares: 260000, as_at: '2026-11-03' } } },
  { tag: 'Register', method: 'PUT', path: '/holders/{id}/external-ids/{system}', scope: 'investors.do', summary: 'Your system’s ID for this holder (returned as external_ids). DELETE removes it.',
    body: [{ name: 'external_id', type: 'string', required: true, description: 'Your ID.', example: 'CUST-00042' }], example: { data: { system: 'crm', external_id: 'CUST-00042' } } },
  { tag: 'Register', method: 'GET', path: '/holdings', scope: 'investors.view', summary: 'The latest holding per holder and class.', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }, { name: 'share_class', type: 'string', description: 'One class.', example: 'ORD' }],
    example: list({ holder_id: ID.holder, ...holding }, 89) },
  { tag: 'Register', method: 'GET', path: '/holdings/history', scope: 'investors.view', summary: 'Every dated balance, newest first.', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }, { name: 'share_class', type: 'string', description: 'One class.', example: 'ORD' }, { name: 'from', type: 'string', description: 'YYYY-MM-DD.' }, { name: 'to', type: 'string', description: 'YYYY-MM-DD.' }],
    example: list({ holder_id: ID.holder, company: 'EXV', share_class: 'ORD', shares: 250000, as_at: '2026-10-31' }, 412) },
  { tag: 'Register', method: 'GET', path: '/register/movements', scope: 'investors.view', summary: 'Movements on the register of members (allotments, transfers…).', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }],
    example: list({ holder_id: ID.holder, company: 'EXV', share_class_id: ID.ord, share_class: 'ORD', seq: 3, moved_on: '2026-07-01', kind: 'allotment', shares: 50000, balance: 250000, party_holder_id: null, consideration: 25000, certificate: '17', paid_per_share: 0.5, unpaid_per_share: 0 }, 166) },
  { tag: 'Register', method: 'GET', path: '/register/imports', scope: 'investors.view', summary: 'Registers of members imported.',
    example: { data: [{ company: 'EXV', id: ID.import, as_at: '2026-10-31', company_name: 'EXAMPLE VENTURES PTY LTD', company_number: '123 456 789', file_name: 'register-of-members-2026-10-31.pdf', holders: 86, holdings: 89, movements: 166, totals: { ORD: 10000000, OPTS: 400000 }, created_at: '2026-11-01T03:20:00Z' }], total: 1, next_cursor: null } },
  { tag: 'Register', method: 'POST', path: '/register/imports', scope: 'investors.do', bodyType: 'application/pdf', status: 202, summary: 'Send a new register of members (the PDF as the body). Never applied straight away: an Admin checks, previews and confirms it in the portal. Optional header X-File-Name.',
    example: { data: { id: ID.import, status: 'needs_review' } } },
  { tag: 'People', method: 'GET', path: '/people', scope: 'people.read', summary: 'Investors: name, email, phone, portal status (not_invited, invited, active) and holders.', query: [...page, { name: 'status', type: 'string', description: 'not_invited, invited or active.', example: 'active' }], example: list(person, 61) },
  { tag: 'People', method: 'GET', path: '/people/{id}', scope: 'people.read', summary: 'One investor.', example: { data: person } },
  { tag: 'People', method: 'POST', path: '/people', scope: 'investors.do', status: 201, summary: 'Add an investor to a holder, with or without the invitation email. 200 instead of 201 when they already had an account.',
    body: [{ name: 'email', type: 'string', required: true, description: 'Their email.', example: 'alex.morgan@example.com' }, { name: 'first_name', type: 'string', description: 'First name.', example: 'Alex' }, { name: 'last_name', type: 'string', description: 'Last name.', example: 'Morgan' }, { name: 'holder_id', type: 'string', description: 'The holder (or holder_ref).', example: ID.holder }, { name: 'holder_ref', type: 'string', description: 'The holder’s register reference.' }, { name: 'access', type: 'string', description: 'owner (can vote, default) or viewer.', example: 'owner' }, { name: 'invite', type: 'boolean', description: 'Send the invitation now (default false).', example: false }],
    example: { data: { id: ID.person, email: 'alex.morgan@example.com', existing: false, invited: false } } },
  { tag: 'People', method: 'PATCH', path: '/people/{id}', scope: 'investors.do', summary: 'Change an investor’s name or phone (only if they are an investor of this company alone).',
    body: [{ name: 'first_name', type: 'string', description: 'First name.' }, { name: 'last_name', type: 'string', description: 'Last name.' }, { name: 'phone', type: 'string', description: 'Phone; empty removes it.', example: '+61 400 000 001' }],
    example: { data: { id: ID.person, first_name: 'Alex', last_name: 'Morgan', phone: '+61 400 000 001' } } },
  { tag: 'People', method: 'PUT', path: '/people/{id}/external-ids/{system}', scope: 'investors.do', summary: 'Your system’s ID for this investor. DELETE removes it.',
    body: [{ name: 'external_id', type: 'string', required: true, description: 'Your ID.', example: 'CONTACT-9031' }], example: { data: { system: 'crm', external_id: 'CONTACT-9031' } } },
  { tag: 'Documents', method: 'GET', path: '/documents', scope: 'documents.view', summary: 'Documents (not those for one holder).', query: [...page, since, { name: 'published', type: 'boolean', description: 'Only published, or only drafts.' }, { name: 'category', type: 'string', description: 'report, agm, update, governance or other.' }],
    example: list({ ...doc, shared_with_group: false }, 20) },
  { tag: 'Documents', method: 'GET', path: '/documents/{id}', scope: 'documents.view', summary: 'One document, with a download link valid for 5 minutes.',
    example: { data: { ...doc, download_url: 'https://investors.lakeba.com/storage/v1/object/sign/documents/…?token=…', download_expires_in: 300 } } },
  { tag: 'Documents', method: 'POST', path: '/documents', scope: 'documents.do', status: 201, summary: 'Upload a document. It arrives as a draft: it’s published (or approved) in the portal.',
    body: [{ name: 'title', type: 'string', required: true, description: 'Title.', example: 'Quarterly update Q1 FY27' }, { name: 'category', type: 'string', description: 'report, agm, update, governance or other.', example: 'update' }, { name: 'audience', type: 'string', description: 'all_investors (default) or board.', example: 'all_investors' }, { name: 'summary', type: 'string', description: 'One or two sentences.' }, { name: 'file_name', type: 'string', description: 'File name.', example: 'q1-fy27-update.pdf' }, { name: 'content_type', type: 'string', description: 'Default application/pdf.', example: 'application/pdf' }, { name: 'file_base64', type: 'string', required: true, description: 'The file, base64 (up to 25 MB).', example: 'JVBERi0xLjcK…' }, { name: 'knowledge_base', type: 'boolean', description: 'Use it in Ask Lakeba once published.', example: false }],
    example: { data: { id: ID.doc, title: 'Quarterly update Q1 FY27', published: false } } },
  { tag: 'News', method: 'GET', path: '/posts', scope: 'news.view', summary: 'News posts (for investors and public), published or not.', query: [...page, since, { name: 'published', type: 'boolean', description: 'Only published, or only drafts.' }, { name: 'full', type: 'boolean', description: 'Include the HTML.' }],
    example: list({ company: 'EXV', id: ID.post, slug: 'example-ventures-signs-distribution-deal', title: 'Example Ventures signs distribution deal', excerpt: 'A three-year agreement covering Australia and New Zealand.', visibility: 'public', categories: ['Company news'], cover_url: 'https://investors.lakeba.com/news-media/example-cover.jpg', published_at: '2026-10-30T22:00:00Z', created_at: '2026-10-29T05:10:00Z', updated_at: '2026-10-30T21:58:00Z', on_lakeba_site: false, on_venture_site: true }, 152) },
  { tag: 'News', method: 'POST', path: '/posts', scope: 'news.do', status: 201, summary: 'A news post as a draft (the HTML is cleaned like the editor’s).',
    body: [{ name: 'title', type: 'string', required: true, description: 'Title.', example: 'Example Ventures opens Melbourne office' }, { name: 'excerpt', type: 'string', description: 'Short summary.' }, { name: 'body_html', type: 'string', description: 'The post, in HTML.', example: '<p>Example Ventures has opened…</p>' }, { name: 'visibility', type: 'string', description: 'shareholders (default) or public.', example: 'shareholders' }],
    example: { data: { id: ID.post, slug: 'example-ventures-opens-melbourne-office', title: 'Example Ventures opens Melbourne office', visibility: 'shareholders', published: false } } },
  { tag: 'News', method: 'GET', path: '/announcements', scope: 'news.view', summary: 'Dashboard announcements.', query: [...page, { name: 'current', type: 'boolean', description: 'Only those showing now.' }],
    example: list({ company: 'EXV', id: ID.announcement, title: 'Proxy voting is open', body: 'Lodge your votes for the 2026 AGM by 25 November.', link_url: '/meetings', link_label: 'Vote now', tone: 'info', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-25T00:00:00Z', created_at: '2026-10-31T23:00:00Z' }, 3) },
  { tag: 'Meetings', method: 'GET', path: '/meetings', scope: 'meetings.view', summary: 'Meetings (AGMs, EGMs).', query: [...page, { name: 'status', type: 'string', description: 'upcoming, open, closed or results.', example: 'open' }], example: list(meeting, 4) },
  { tag: 'Meetings', method: 'GET', path: '/meetings/{id}', scope: 'meetings.view', summary: 'A meeting, its resolutions, outcomes and proxy vote totals.',
    example: { data: { ...meeting, questions: 2, resolutions: [{ id: ID.resolution, number: 1, title: 'Re-election of a director', description: 'That Jordan Lee be re-elected as a director.', kind: 'ordinary', outcome: null, proxy_votes: { for: { holders: 31, shares: 6120000 }, against: { holders: 2, shares: 80000 }, abstain: { holders: 1, shares: 10000 } } }] } } },
  { tag: 'Meetings', method: 'POST', path: '/meetings', scope: 'meetings.do', status: 201, summary: 'Create a meeting (upcoming; opening proxy voting is done in the portal).',
    body: [{ name: 'title', type: 'string', required: true, description: 'Title.', example: '2026 Annual General Meeting' }, { name: 'kind', type: 'string', description: 'agm (default) or egm.', example: 'agm' }, { name: 'starts_at', type: 'string', required: true, description: 'ISO date-time.', example: '2026-11-27T00:00:00Z' }, { name: 'proxy_deadline', type: 'string', required: true, description: 'ISO date-time, before it starts.', example: '2026-11-25T00:00:00Z' }, { name: 'location', type: 'string', description: 'Where it’s held.' }, { name: 'livestream_url', type: 'string', description: 'Link to watch online.' }],
    example: { data: { id: ID.meeting, title: '2026 Annual General Meeting', status: 'upcoming' } } },
  { tag: 'Meetings', method: 'POST', path: '/meetings/{id}/resolutions', scope: 'meetings.do', status: 201, summary: 'Add a resolution (before proxy voting opens).',
    body: [{ name: 'number', type: 'integer', required: true, description: 'Its number on the notice.', example: 1 }, { name: 'title', type: 'string', required: true, description: 'Title.', example: 'Re-election of a director' }, { name: 'description', type: 'string', description: 'The resolution’s text.' }, { name: 'kind', type: 'string', description: 'ordinary (default) or special.', example: 'ordinary' }],
    example: { data: { id: ID.resolution, number: 1 } } },
  { tag: 'Board Q&A', method: 'GET', path: '/queries', scope: 'inbox.view', summary: 'Board Q&A questions and their messages (who asked needs people.read).', query: [...page, { name: 'status', type: 'string', description: 'open, answered or closed.' }],
    example: list({ id: ID.query, company: 'EXV', subject: 'Timing of the next capital raise', status: 'answered', created_at: '2026-10-21T09:15:00Z', updated_at: '2026-10-22T01:40:00Z', asked_by: { id: ID.person, email: 'alex.morgan@example.com', first_name: 'Alex', last_name: 'Morgan' }, messages: [{ from: 'investor', body: 'Is a capital raise planned before June?', created_at: '2026-10-21T09:15:00Z' }, { from: 'board', body: 'Nothing is planned before the AGM; we’ll update investors after it.', created_at: '2026-10-22T01:40:00Z' }] }, 12) },
  { tag: 'Board Q&A', method: 'POST', path: '/queries/{id}/replies', scope: 'inbox.do', status: 201, summary: 'Reply to a question; the investor is told.',
    body: [{ name: 'body', type: 'string', required: true, description: 'The reply.', example: 'Thank you for your question. The board will cover this at the AGM.' }], example: { data: { query_id: ID.query, replied: true } } },
  { tag: 'Data rooms', method: 'GET', path: '/data-rooms', scope: 'documents.view', summary: 'Data rooms.', example: { data: [{ ...room, document_ids: [ID.doc], active_guests: 3 }] } },
  { tag: 'Data rooms', method: 'GET', path: '/data-rooms/{id}', scope: 'documents.view', summary: 'A room, its documents, its guests and what they opened (names and emails need people.read).',
    example: { data: { ...room, documents: [{ id: ID.doc, title: 'Annual Report 2026' }], guests: [{ id: ID.guest, name: 'Sam Patel', email: 'sam.patel@example.com', organisation: 'Example Capital', status: 'agreed', expires_at: '2026-11-14T02:00:00Z', terms_accepted_at: '2026-10-16T00:12:00Z', last_seen_at: '2026-10-18T04:30:00Z', invited_at: '2026-10-15T02:05:00Z', views: [{ document_id: ID.doc, viewed_at: '2026-10-16T00:15:00Z' }] }] } } },
  { tag: 'Data rooms', method: 'POST', path: '/data-rooms/{id}/guests', scope: 'documents.do', status: 201, summary: 'Invite a guest; returns their personal link.',
    body: [{ name: 'name', type: 'string', required: true, description: 'Their name.', example: 'Sam Patel' }, { name: 'email', type: 'string', required: true, description: 'Their email.', example: 'sam.patel@example.com' }, { name: 'organisation', type: 'string', description: 'Who they’re with.', example: 'Example Capital' }, { name: 'days', type: 'integer', description: '1–180, default 30.', example: 30 }, { name: 'send_email', type: 'boolean', description: 'Email the link (default true).', example: true }],
    example: { data: { id: ID.guest, link: 'https://investors.lakeba.com/room/…', expires_in_days: 30, emailed: true } } },
  { tag: 'Data rooms', method: 'DELETE', path: '/data-rooms/{id}/guests/{guestId}', scope: 'documents.do', summary: 'Revoke a guest: their link stops working at once.', example: { data: { id: ID.guest, revoked: true } } },
  { tag: 'Newsletter', method: 'GET', path: '/newsletter/subscribers', scope: 'newsletters.view', summary: 'Newsletter subscribers (also needs people.read).', query: [...page, since, { name: 'status', type: 'string', description: 'pending, subscribed or unsubscribed.', example: 'subscribed' }],
    example: list({ id: ID.subscriber, email: 'jamie.chen@example.com', name: 'Jamie Chen', source: 'website', status: 'subscribed', confirmed_at: '2026-10-02T07:20:00Z', unsubscribed_at: null, created_at: '2026-10-02T07:18:00Z' }, 240) },
  { tag: 'Newsletter', method: 'POST', path: '/newsletter/subscribers', scope: 'newsletters.do', status: 201, summary: 'Subscribe someone who asked for the newsletter (you’re responsible for their consent). 200 instead of 201 when they were already on the list.',
    body: [{ name: 'email', type: 'string', required: true, description: 'Their email.', example: 'jamie.chen@example.com' }, { name: 'name', type: 'string', description: 'Their name.', example: 'Jamie Chen' }], example: { data: { id: ID.subscriber, status: 'subscribed' } } },
  { tag: 'Newsletter', method: 'DELETE', path: '/newsletter/subscribers/{id}', scope: 'newsletters.do', summary: 'Unsubscribe.', example: { data: { id: ID.subscriber, status: 'unsubscribed' } } },
  { tag: 'Events and webhooks', method: 'GET', path: '/events', scope: 'any', summary: 'Events of the last 30 days, for tools that poll instead of receiving webhooks. Only the events your key’s scopes cover.', query: [{ name: 'after', type: 'integer', description: 'The last sequence you saw (0 to start).', example: 0 }, { name: 'type', type: 'string', description: 'One event type.', example: 'holdings.changed' }, { name: 'limit', type: 'integer', description: '1–200.', example: 100 }],
    example: { data: [{ sequence: 1042, id: ID.event, type: 'holdings.changed', description: EVENTS['holdings.changed'], occurred_at: '2026-11-03T02:14:09Z', company: { code: 'EXV', name: 'Example Ventures' }, data: { holder_id: ID.holder, share_class: 'ORD' } }], next_after: 1042 } },
  { tag: 'Events and webhooks', method: 'GET', path: '/webhooks', scope: 'any', summary: 'This key’s webhook subscriptions, and the events there are.',
    example: { data: [{ id: ID.webhook, url: 'https://hooks.example.com/lakeba', events: ['holdings.changed'], format: 'json', active: true, created_at: '2026-11-01T00:00:00Z' }], events: [{ type: 'holdings.changed', description: EVENTS['holdings.changed'], scope: 'investors.view' }] } },
  { tag: 'Events and webhooks', method: 'POST', path: '/webhooks', scope: 'any', status: 201, summary: 'Subscribe a URL to events (REST hooks, as Zapier and Make use them). Returns the signing secret once.',
    body: [{ name: 'target_url', type: 'string', required: true, description: 'https:// address.', example: 'https://hooks.example.com/lakeba' }, { name: 'events', type: 'array', required: true, description: 'Event types (see Webhooks).', example: ['holdings.changed', 'register.imported'] }, { name: 'format', type: 'string', description: 'json (default), slack or teams.', example: 'json' }],
    example: { data: { id: ID.webhook, target_url: 'https://hooks.example.com/lakeba', events: ['holdings.changed', 'register.imported'], format: 'json', secret: 'whsec_…' } } },
  { tag: 'Events and webhooks', method: 'DELETE', path: '/webhooks/{id}', scope: 'any', summary: 'Unsubscribe.', example: { data: { id: ID.webhook, deleted: true } } },
];

// Short names for the reference's menu.
const TITLES: Record<string, string> = {
  'GET /company': 'Get the company', 'GET /share-classes': 'List share classes', 'GET /holders': 'List holders', 'GET /holders/{id}': 'Get a holder',
  'POST /holders/{id}/holdings': 'Record a holding', 'PUT /holders/{id}/external-ids/{system}': 'Set a holder’s external ID', 'GET /holdings': 'List holdings',
  'GET /holdings/history': 'Holdings history', 'GET /register/movements': 'List register movements', 'GET /register/imports': 'List register imports',
  'POST /register/imports': 'Send a register of members', 'GET /people': 'List investors', 'GET /people/{id}': 'Get an investor', 'POST /people': 'Add an investor',
  'PATCH /people/{id}': 'Update an investor', 'PUT /people/{id}/external-ids/{system}': 'Set an investor’s external ID', 'GET /documents': 'List documents',
  'GET /documents/{id}': 'Get a document', 'POST /documents': 'Upload a document', 'GET /posts': 'List news posts', 'POST /posts': 'Draft a news post',
  'GET /announcements': 'List announcements', 'GET /meetings': 'List meetings', 'GET /meetings/{id}': 'Get a meeting', 'POST /meetings': 'Create a meeting',
  'POST /meetings/{id}/resolutions': 'Add a resolution', 'GET /queries': 'List questions', 'POST /queries/{id}/replies': 'Reply to a question',
  'GET /data-rooms': 'List data rooms', 'GET /data-rooms/{id}': 'Get a data room', 'POST /data-rooms/{id}/guests': 'Invite a guest',
  'DELETE /data-rooms/{id}/guests/{guestId}': 'Revoke a guest', 'GET /newsletter/subscribers': 'List subscribers', 'POST /newsletter/subscribers': 'Add a subscriber',
  'DELETE /newsletter/subscribers/{id}': 'Unsubscribe', 'GET /events': 'List events', 'GET /webhooks': 'List webhook subscriptions', 'POST /webhooks': 'Subscribe a webhook',
  'DELETE /webhooks/{id}': 'Remove a webhook subscription',
};

// What the common fields mean, wherever they appear.
const FIELDS: Record<string, string> = {
  id: 'Lakeba’s ID (a UUID).', company: 'The company’s code.', code: 'Short code.', share_class: 'Share class code.', share_class_id: 'The share class.', holder_id: 'The holder.',
  shares: 'Number of shares.', as_at: 'The date the balance is at.', ownership_pct: 'Percentage of the class on issue (null for classes that don’t count toward ownership).',
  on_issue: 'Shares on issue: the official figure where set, otherwise the sum of holdings.', official_on_issue: 'Official shares on issue, if set.', official_as_at: 'Date of the official figure.',
  counts_toward_ownership: 'Whether holdings of this class count toward % ownership.', registry_ref: 'The holder’s reference on the register of members.', is_group_stake: 'The holder is a Lakeba group company.',
  external_ids: 'IDs in your systems, by system name.', holdings: 'Latest holding per class.', total: 'How many there are in all.', next_cursor: 'Pass as ?cursor= for the next page; null on the last page.',
  next_after: 'Pass as ?after= next time.', data: 'The result.', status: 'Status.', kind: 'Kind.', created_at: 'When it was created.', updated_at: 'When it last changed.', published_at: 'When it was published (null for drafts).',
  holders_from_register: 'Holdings come from the register of members (changed by importing a register).', holdings_from_register: 'Holdings come from the register of members (changed by importing a register).',
  relationship: 'group, controlled or portfolio.', access: 'owner (can vote) or viewer.', audience: 'all_investors or board.', category: 'report, agm, update, governance or other.', visibility: 'shareholders or public.',
  email: 'Personal data (people.read).', phone: 'Personal data (people.read).', first_name: 'Personal data (people.read).', last_name: 'Personal data (people.read).',
  sequence: 'Ever-increasing number, for ?after=.', occurred_at: 'When it happened.', proxy_votes: 'Proxy votes lodged so far, by choice.', seq: 'Order of the movement for that holder and class.',
  balance: 'Balance after the movement.', consideration: 'Amount paid.', paid_per_share: 'Amount paid per share.', unpaid_per_share: 'Amount unpaid per share.', party_holder_id: 'The other holder in a transfer.',
  download_url: 'Signed link to the file.', download_expires_in: 'Seconds the link works for.', secret: 'Signing secret for Lakeba-Signature: shown only now.', link: 'The guest’s personal link.',
};

type Schema = Record<string, unknown>;
/** A JSON schema worked out from an example, with the field descriptions. */
function schemaOf(v: unknown, name?: string): Schema {
  const d = name && FIELDS[name] ? { description: FIELDS[name] } : {};
  if (v === null) return { type: ['string', 'null'], ...d };
  if (Array.isArray(v)) return { type: 'array', items: v.length ? schemaOf(v[0]) : {}, ...d };
  if (typeof v === 'object') {
    if (name === 'external_ids' || name === 'totals') return { type: 'object', additionalProperties: { type: name === 'totals' ? 'integer' : 'string' }, ...d };
    return { type: 'object', properties: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, schemaOf(x, k)])), ...d };
  }
  return { type: typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v, ...d };
}

const TAGS: Record<string, string> = {
  Company: 'The company the key belongs to and its share classes.',
  Register: 'Holders, holdings and the register of members. For a company whose holdings come from its register, holdings change only by importing a register, which an Admin confirms.',
  People: 'Investors (people with access to holders). Reading them needs **people.read**.',
  Documents: 'Documents for investors or the board. New ones arrive as drafts, to publish in the portal.',
  News: 'News posts and dashboard announcements.',
  Meetings: 'AGMs and EGMs, resolutions and proxy vote totals. Opening voting and publishing results stay in the portal.',
  'Board Q&A': 'Questions from investors to the board.',
  'Data rooms': 'Rooms for due diligence and their guests.',
  Newsletter: 'The company’s public newsletter list. Reading it needs **people.read**.',
  'Events and webhooks': 'Events to poll, and webhook subscriptions for tools like Zapier and Make.',
};

const GUIDE = (origin: string) => `For a company’s other tools: its register, investors, documents, news, meetings, Board Q&A, data rooms and newsletter.
The full guide (HubSpot, Xero, incoming webhooks, apps) is at [/developers](${origin}/developers).

## Keys
A company’s Admins make keys in **Admin → Companies → the company → Integrations → API keys**, choosing what each key may do.
A key belongs to that company only. Send it as \`Authorization: Bearer lk_live_…\`. Test keys (\`lk_test_…\`) work on staging only.

**Try it** sends real requests from your browser with the key you enter: on the live portal they read and change real data.
The key isn’t saved by this page.

## Scopes
“do” includes “view”. **people.read** (names, emails, phones, addresses) is never implied: without it, answers and webhooks leave personal details out.

${API_SCOPES.map((s) => `- \`${s.key}\`: ${s.label}`).join('\n')}

## Requests
- **Lists** return \`data\`, \`total\` and \`next_cursor\`: pass it back as \`?cursor=\`. \`limit\` is 1–200 (default 50).
- **Errors** are \`application/problem+json\` with \`status\`, \`code\` and a plain-English \`detail\`.
- **Rate limit**: 300 requests a minute per key (\`X-RateLimit-Remaining\`; 429 with \`Retry-After\` beyond).
- **Retries**: send \`Idempotency-Key: <your id>\` with writes; the same key gets the first answer again for a day.
- **Your IDs**: store your system’s ID on holders and investors (\`PUT …/external-ids/<system>\`); reads return them as \`external_ids\`.
- Every write is in the company’s audit log, as made by the key.

## Webhooks
For each event chosen, the portal POSTs JSON with the headers \`Lakeba-Event\`, \`Lakeba-Event-Id\` (to ignore repeats) and
\`Lakeba-Signature: t=<seconds>,v1=<hex>\`: the HMAC-SHA256 of \`"<t>.<body>"\` with the webhook’s secret. Answer with any 2xx within 15 seconds.
Failures are retried for about three days. The events are listed under **Webhooks**.

\`\`\`js
import { createHmac, timingSafeEqual } from 'node:crypto';

// raw: the request body exactly as received; header: Lakeba-Signature
function fromLakeba(raw, header, secret) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(\`\${m[1]}.\${raw}\`).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}
\`\`\``;

// What an event's data usually carries (IDs and facts; names and emails only with personal data).
const EVENT_DATA: Record<string, Record<string, unknown>> = {
  holder: { holder_id: ID.holder, name: holder.name }, holdings: { holder_id: ID.holder, share_class: 'ORD', shares: 260000, as_at: '2026-11-03' },
  register: { import_id: ID.import, as_at: '2026-10-31', holders: 86 }, share_class: { share_class_id: ID.ord, official_on_issue: 10000000 },
  person: { user_id: ID.person, holder_id: ID.holder }, holder_access: { user_id: ID.person, holder_id: ID.holder, access: 'owner' },
  document: { document_id: ID.doc, title: 'Annual Report 2026' }, news: { post_id: ID.post, title: 'Example Ventures signs distribution deal' },
  meeting: { meeting_id: ID.meeting, title: '2026 Annual General Meeting' }, proxy: { meeting_id: ID.meeting, user_id: ID.person },
  query: { query_id: ID.query, subject: 'Timing of the next capital raise' }, data_room: { room_id: ID.room, guest_id: ID.guest },
  newsletter: { subscriber_id: ID.subscriber }, approval: { approval_id: '0a2c4e6a-8c0e-4a2c-8e4a-6c8e0a2c4e66', area: 'documents' },
  trade_interest: { interest_id: '4c6e8a0c-2e4a-4c6e-8a0c-2e4a6c8e0a77', side: 'sell', share_class: 'ORD' }, inbound: { message_id: '1b3d5f7a-9c1e-4b3d-8f5a-7c9e1b3d5f88', kind: 'newsletter.subscribe' },
};

/** The OpenAPI 3.1 document. */
export function openApi(origin: string) {
  const problem = { $ref: '#/components/responses/Problem' };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [...(op.path.match(/\{(\w+)\}/g) ?? []).map((p) => {
      const name = p.slice(1, -1);
      return { name, in: 'path', required: true, description: name === 'system' ? 'Your system’s name, e.g. crm or hubspot.' : 'The ID.', schema: { type: 'string' }, example: name === 'system' ? 'crm' : undefined };
    }), ...(op.query ?? []).map((q) => ({ name: q.name, in: 'query', required: false, description: q.description, schema: { type: q.type }, ...(q.example !== undefined ? { example: q.example } : {}) }))];
    if (op.method !== 'GET') params.push({ name: 'Idempotency-Key', in: 'header', required: false, description: 'Your ID for this request: a repeat with the same key gets the first answer again (for a day).', schema: { type: 'string' }, example: undefined });
    const example = op.body && Object.fromEntries(op.body.filter((b) => b.example !== undefined).map((b) => [b.name, b.example]));
    const body = op.bodyType ? { required: true, content: { [op.bodyType]: { schema: { type: 'string', format: 'binary' } } } }
      : op.body ? { required: true, content: { 'application/json': {
        schema: { type: 'object', required: op.body.filter((b) => b.required).map((b) => b.name), properties: Object.fromEntries(op.body.map((b) => [b.name, { type: b.type, description: b.description, ...(b.type === 'array' ? { items: { type: 'string' } } : {}) }])) },
        ...(example && Object.keys(example).length ? { example } : {}) } } }
      : undefined;
    const ok = String(op.status ?? 200);
    (paths[op.path] ??= {})[op.method.toLowerCase()] = {
      tags: [op.tag], summary: TITLES[`${op.method} ${op.path}`] ?? op.summary,
      description: `${op.summary}\n\n${op.scope === 'any' ? 'Any key.' : `Needs the \`${op.scope}\` scope.`}`, ...(op.scope !== 'any' ? { 'x-scope': op.scope } : {}),
      operationId: `${op.method.toLowerCase()}${op.path.replace(/\{(\w+)\}/g, 'By-$1').split(/[/-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`,
      ...(params.length ? { parameters: params } : {}), ...(body ? { requestBody: body } : {}),
      responses: {
        [ok]: { description: { 200: 'OK', 201: 'Created', 202: 'Received: waiting for an Admin' }[ok] ?? 'OK', ...(op.example ? { content: { 'application/json': { schema: schemaOf(op.example), example: op.example } } } : {}) },
        400: problem, 401: problem, 403: problem, 404: problem, ...(op.method !== 'GET' ? { 422: problem } : {}), 429: problem,
      },
    };
  }
  const webhooks = Object.fromEntries(Object.entries(EVENTS).map(([type, description]) => {
    const payload = { id: ID.event, type, occurred_at: '2026-11-03T02:14:09Z', company: { code: 'EXV', name: 'Example Ventures' }, description, data: EVENT_DATA[type.split('.')[0]] ?? {} };
    return [type, { post: {
      tags: ['Webhooks'], summary: type, description: `${description}. Sent to webhooks subscribed to \`${type}\`. Needs the \`${eventScope(type)}\` scope. \`data\` carries IDs and facts (the example shows typical fields; they vary with how it happened); names and emails only for webhooks allowed personal data.`,
      parameters: [
        { name: 'Lakeba-Event', in: 'header', required: true, schema: { type: 'string' }, example: type, description: 'The event type.' },
        { name: 'Lakeba-Event-Id', in: 'header', required: true, schema: { type: 'string' }, example: ID.event, description: 'The event’s ID: use it to ignore repeats.' },
        { name: 'Lakeba-Signature', in: 'header', required: true, schema: { type: 'string' }, example: 't=1793672049,v1=5f2b…', description: 'HMAC-SHA256 of "<t>.<body>" with the webhook’s secret.' },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: schemaOf(payload), example: payload } } },
      responses: { 200: { description: 'Any 2xx within 15 seconds counts as received.' } },
    } }];
  }));
  return {
    openapi: '3.1.0',
    info: { title: 'Lakeba investor portal API', version: '1.0.0', description: GUIDE(origin), contact: { name: 'Lakeba', url: `${origin}/developers` } },
    servers: [{ url: `${origin}/api/v1`, description: 'This portal' }],
    security: [{ key: [] }],
    tags: [...Object.entries(TAGS).map(([name, description]) => ({ name, description })), { name: 'Webhooks', description: 'What the portal sends to your webhooks.' }],
    components: {
      securitySchemes: {
        key: { type: 'http', scheme: 'bearer', description: 'A company API key (lk_live_…) or an app’s access token (lk_oat_…).' },
        oauth: { type: 'oauth2', description: 'For apps registered with Lakeba (Zapier, marketplace apps).', flows: { authorizationCode: { authorizationUrl: `${origin}/oauth/authorize`, tokenUrl: `${origin}/oauth/token`, scopes: Object.fromEntries(API_SCOPES.map((s) => [s.key, s.label])) } } },
      },
      responses: { Problem: { description: 'An error (application/problem+json).', content: { 'application/problem+json': {
        schema: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string', description: 'e.g. missing_key, invalid_key, insufficient_scope, not_found, register_company, rate_limited.' }, detail: { type: 'string', description: 'What went wrong, in plain English.' } } },
        example: { type: `${origin}/developers#insufficient_scope`, title: 'Forbidden', status: 403, code: 'insufficient_scope', detail: 'This key needs the “investors.view” scope.' } } } } },
    },
    paths,
    webhooks,
    'x-webhook-events': EVENTS,
  };
}
