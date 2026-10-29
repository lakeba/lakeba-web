import type { Access } from './access';
import type { serviceClient } from './admin';
import { addDays, fromSydney, legalCompanies, type LegalCompany } from './legal';

// Board meetings for everyone who runs them (Admin → Boardroom): Lakeba's
// Legal team for every company, and a venture's company secretary (the
// "boardroom" permission, given for one company) for its own board only. The
// board assistant (Observer, Lex, decks) is switched on per company.

type Svc = ReturnType<typeof serviceClient>;
type Level = 'view' | 'do';

/** May this person see (or run) this company's board meetings: through Legal, or the Boardroom permission? */
export const mayMeeting = (access: Access, entityId: string, level: Level = 'view') =>
  access.can(`legal.${level}`, entityId) || access.can(`boardroom.${level}`, entityId);

/** The companies whose board meetings this person may see (or run). */
export async function meetingCompanies(svc: Svc, access: Access, level: Level = 'view'): Promise<LegalCompany[]> {
  const legal = await legalCompanies(svc, access, level);
  const ids = access.companies(`boardroom.${level}`);
  if (ids !== 'all' && !ids.length) return legal;
  let q = svc.from('entities').select('id, code, display_name, legal_name, company_number, country, relationship, sort').order('sort');
  if (ids !== 'all') q = q.in('id', ids);
  const extra = ((await q).data ?? []) as LegalCompany[];
  return [...legal, ...extra.filter((c) => !legal.some((l) => l.id === c.id))].sort((a, b) => a.sort - b.sort);
}

/** Is the board assistant (Observer, Lex, decks) switched on for this company? */
export async function assistantOn(svc: Svc, entityId: string) {
  const { data } = await svc.from('entities').select('board_assistant').eq('id', entityId).maybeSingle();
  return Boolean(data?.board_assistant);
}

/** A new directors' meeting: the officers in office that day as attendees, and the minutes deadline (a month) in the calendar. */
export async function createMeeting(svc: Svc, companyId: string, input: { title: string; heldAt: string; location: string }, userId: string) {
  if (!input.heldAt || input.title.length < 3) throw new Error('Give the meeting a title and when it was held.');
  const held = fromSydney(input.heldAt);
  if (!held) throw new Error('Check when the meeting was held.');
  const officers = (await svc.from('company_officers').select('id, full_name, position, appointed_on, ceased_on').eq('entity_id', companyId)).data ?? [];
  const day = input.heldAt.slice(0, 10);
  const attendees = officers.filter((o) => o.position !== 'alternate_director' && (!o.appointed_on || o.appointed_on <= day) && (!o.ceased_on || o.ceased_on > day))
    .map((o) => ({ officer_id: o.id, name: o.full_name, role: o.position === 'secretary' ? 'secretary' : 'director', present: true }));
  const title = input.title.slice(0, 200);
  const { data: m } = await svc.from('board_meetings').insert({ entity_id: companyId, title, held_at: held.toISOString(), location: input.location.slice(0, 200), attendees, created_by: userId }).select('id').single().throwOnError();
  await svc.from('legal_obligations').insert({ entity_id: companyId, kind: 'minutes', source_key: `minutes:${m!.id}`, due_on: addDays(day, 30), created_by: userId,
    title: `Minutes of “${title}” signed by the chair`, detail: 'Minutes of directors’ meetings are recorded in the minute book within one month and signed by the chair.' });
  return m!.id as string;
}
