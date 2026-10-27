import { ApiError, endpoint, isUuid, json, str } from '../../../../../lib/api/core';
import { notifyMembers } from '../../../../../lib/notify';

/** POST /api/v1/queries/{id}/replies — { body }: the board's reply to a Board Q&A question; the investor is told. Needs "inbox.do". */
export const POST = endpoint('queries/{id}/replies', { scope: 'inbox.do', write: true }, async ({ svc, ctx, key, companyIds, body, audit }) => {
  const id = ctx.params.id;
  const { data: q } = isUuid(id) ? await svc.from('queries').select('id, user_id, subject, entity_id, entities(display_name, relationship)').eq('id', id).in('entity_id', companyIds).maybeSingle() : { data: null };
  if (!q) throw new ApiError(404, 'not_found', 'No such question in this company.');
  const b = await body();
  const text = str(b, 'body', 10_000, true);
  // Written as the person who made the key (a reply needs an author).
  if (!key.created_by) throw new ApiError(409, 'no_author', 'The person who made this key no longer has an account: make a new key.');
  await svc.from('query_messages').insert({ query_id: id, author_id: key.created_by, body: text, internal: false }).throwOnError();
  await svc.from('queries').update({ updated_at: new Date().toISOString() }).eq('id', id!);
  const co = q.entities as unknown as { display_name: string; relationship: string };
  await notifyMembers({ kind: 'query_reply', entityId: q.entity_id, title: `Reply to your question: ${q.subject}`, body: `${co.relationship !== 'group' ? `The ${co.display_name} team` : 'The Lakeba team'} has replied to your question in the investor portal.`, link: `/board/${id}`, userIds: [q.user_id], origin: ctx.url.origin });
  await audit('admin_replied_query', { query_id: id });
  return json({ data: { query_id: id, replied: true } }, 201);
});
