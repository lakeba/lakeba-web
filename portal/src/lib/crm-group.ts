import type { serviceClient } from './admin';
import { KINDS, cleanEmail, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, namesOf, salesTeam, validEmail } from './crm';
import { notifyMembers } from './notify';

// The CRM across the group (docs/crm.md, phase 6). Sharing between two ventures starts only when both switch it
// on (CRM → Settings → Sharing) and either can stop it: each then sees that the other knows a person or company,
// who owns that relationship and their work details; the deal stage only where that side allows it. Values,
// quotes, notes, emails, recordings and people marked "don't share" never cross. Introductions go through the
// relationship's owner. Shareholders introduce businesses to ventures from the investor portal.

type Svc = ReturnType<typeof serviceClient>;
export type Sharing = { id: string; entity_a: string; entity_b: string; a_on_by: string | null; a_on_at: string | null; b_on_by: string | null; b_on_at: string | null; a_shares_stage: boolean; b_shares_stage: boolean };
const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

export async function sharingOf(svc: Svc, entityId: string) {
  const { data } = await svc.from('crm_sharing').select('*').or(`entity_a.eq.${entityId},entity_b.eq.${entityId}`);
  return (data ?? []) as Sharing[];
}
export const isActive = (s: Sharing) => Boolean(s.a_on_at && s.b_on_at);
const other = (s: Sharing, me: string) => (s.entity_a === me ? s.entity_b : s.entity_a);
/** Whether the other venture lets this one see its deal stages. */
const stageFrom = (s: Sharing, them: string) => (s.entity_a === them ? s.a_shares_stage : s.b_shares_stage);

/** One side switches sharing with another venture on or off (both must be on for anything to be shared). */
export async function setSharing(svc: Svc, me: string, them: string, on: boolean, userId: string, shareStage: boolean) {
  const [a, b] = pair(me, them);
  const mine = me === a ? 'a' : 'b';
  const { data: row } = await svc.from('crm_sharing').select('*').eq('entity_a', a).eq('entity_b', b).maybeSingle();
  const patch = { [`${mine}_on_by`]: on ? userId : null, [`${mine}_on_at`]: on ? new Date().toISOString() : null, [`${mine}_shares_stage`]: shareStage };
  if (row) await svc.from('crm_sharing').update(patch).eq('id', row.id);
  else await svc.from('crm_sharing').insert({ entity_a: a, entity_b: b, ...patch });
  await svc.from('audit_log').insert({ user_id: userId, action: on ? 'crm_sharing_on' : 'crm_sharing_off', detail: { entity_id: me, with_entity: them, stage: shareStage } });
}

export type Known = { entity_id: string; venture: string; kind: string; owner_id: string | null; owner: string | null; stage: string | null; since: string };
/** What the ventures sharing with this one know about a person or company (only shareable relationships). */
export async function alsoKnown(svc: Svc, entityId: string, who: { person_id?: string; company_id?: string }): Promise<Known[]> {
  const partners = (await sharingOf(svc, entityId)).filter(isActive);
  if (!partners.length) return [];
  const ids = partners.map((s) => other(s, entityId));
  const col = who.person_id ? 'person_id' : 'company_id';
  const id = who.person_id ?? who.company_id!;
  if (who.person_id) {
    // Someone who asked not to be shared stays unseen.
    const { data: c } = await svc.from('crm_consents').select('status').eq('person_id', who.person_id).eq('channel', 'ventures').maybeSingle();
    if (c?.status === 'no') return [];
  }
  const { data: rels } = await svc.from('crm_relationships').select('entity_id, kind, owner_id, created_at, entities(display_name)').in('entity_id', ids).eq(col, id).eq('shareable', true).is('archived_at', null);
  const names = await namesOf(svc, (rels ?? []).map((r) => r.owner_id));
  const out: Known[] = [];
  for (const r of (rels ?? []) as unknown as { entity_id: string; kind: string; owner_id: string | null; created_at: string; entities: { display_name: string } }[]) {
    const s = partners.find((p) => other(p, entityId) === r.entity_id)!;
    let stage: string | null = null;
    if (stageFrom(s, r.entity_id)) {
      const { data: d } = await svc.from('crm_deals').select('status, crm_stages(name)').eq('entity_id', r.entity_id).eq(col, id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
      stage = d ? `${(d as unknown as { crm_stages: { name: string } | null }).crm_stages?.name ?? d.status}` : null;
    }
    out.push({ entity_id: r.entity_id, venture: r.entities.display_name, kind: KINDS[r.kind] ?? r.kind, owner_id: r.owner_id, owner: r.owner_id ? names.get(r.owner_id) ?? null : null, stage, since: r.created_at.slice(0, 4) });
  }
  return out;
}

/** A salesperson asks another venture's relationship owner for an introduction. */
export async function askIntroduction(svc: Svc, o: { fromEntity: string; toEntity: string; userId: string; person_id?: string | null; company_id?: string | null; note: string; central: string }) {
  const known = await alsoKnown(svc, o.fromEntity, o.person_id ? { person_id: o.person_id } : { company_id: o.company_id! });
  const k = known.find((x) => x.entity_id === o.toEntity);
  if (!k?.owner_id) throw new Error('That venture doesn’t share an owner for this relationship.');
  const { data: intro } = await svc.from('crm_introductions').insert({ by_kind: 'venture', by_user: o.userId, from_entity_id: o.fromEntity, to_entity_id: o.toEntity, person_id: o.person_id ?? null, company_id: o.company_id ?? null, owner_id: k.owner_id, note: o.note.slice(0, 1000) }).select('id').single().throwOnError();
  const [{ data: from }, names] = await Promise.all([svc.from('entities').select('display_name').eq('id', o.fromEntity).single(), namesOf(svc, [o.userId])]);
  await notifyMembers({ kind: 'crm', origin: o.central, link: '/admin/crm/introductions', title: `${names.get(o.userId)} (${from?.display_name}) asks for an introduction`, body: o.note.slice(0, 200), userIds: [k.owner_id], entityId: o.toEntity }).catch(() => 0);
  return intro!.id as string;
}

/** A shareholder introduces a business to a venture: a warm lead in its CRM, tagged with who introduced it. */
export async function shareholderIntroduction(svc: Svc, o: { userId: string; entityId: string; company: string; name: string; email: string; role: string; how: string; central: string }) {
  const email = cleanEmail(o.email);
  if (!validEmail(email)) throw new Error('bad_email');
  const { data: ent } = await svc.from('entities').select('id, crm_enabled, crm_accepts_introductions, crm_currency').eq('id', o.entityId).single();
  if (!ent?.crm_enabled || !ent.crm_accepts_introductions) throw new Error('not_open');
  const { count } = await svc.from('crm_introductions').select('id', { count: 'exact', head: true }).eq('by_user', o.userId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= 10) throw new Error('too_many');
  const domain = companyDomainOf(email);
  const org = await findOrCreateCompany(svc, { name: o.company.slice(0, 200) || domain || email, domain, source: 'introduction' });
  const person = await findOrCreatePerson(svc, { full_name: o.name.slice(0, 200) || email, email, job_title: o.role.slice(0, 200), company_id: org.id, source: 'introduction' });
  // The team in turn (or whoever already owns them).
  const { data: rel } = await svc.from('crm_relationships').select('owner_id').eq('entity_id', o.entityId).eq('person_id', person.id).maybeSingle();
  const team = await salesTeam(svc, o.entityId);
  const owner = rel?.owner_id ?? team[Math.floor(Math.random() * Math.max(1, team.length))]?.id ?? null;
  await ensureRelationship(svc, o.entityId, { person_id: person.id }, { kind: 'lead', owner_id: owner });
  await ensureRelationship(svc, o.entityId, { company_id: org.id }, { kind: 'lead', owner_id: owner });
  const { data: shareholder } = await svc.from('profiles').select('first_name, last_name').eq('id', o.userId).single();
  const by = `${shareholder?.first_name ?? ''} ${shareholder?.last_name ?? ''}`.trim() || 'A shareholder';
  const { data: intro } = await svc.from('crm_introductions').insert({ by_kind: 'shareholder', by_user: o.userId, to_entity_id: o.entityId, person_id: person.id, company_id: org.id, owner_id: owner, note: o.how.slice(0, 1000) }).select('id').single().throwOnError();
  await logActivity(svc, { entity_id: o.entityId, kind: 'system', direction: 'in', person_id: person.id, company_id: org.id, subject: `Introduced by a Lakeba shareholder: ${by}`, body: o.how.slice(0, 1000), meta: { introduction: intro!.id } });
  await svc.from('audit_log').insert({ user_id: o.userId, action: 'crm_introduction_by_shareholder', detail: { entity_id: o.entityId, person_id: person.id } });
  if (owner) await notifyMembers({ kind: 'crm', origin: o.central, link: `/admin/crm/people/${person.id}`, title: `A shareholder introduced ${o.name || email} (${o.company})`, body: `${by}: “${o.how.slice(0, 160)}”`, userIds: [owner], entityId: o.entityId }).catch(() => 0);
  return intro!.id as string;
}

/** Where a shareholder's introduction is now, from its deal (stage only, never value). */
export function introStage(i: { stage: string }, deal: { status: string } | null) {
  if (deal?.status === 'won') return 'customer';
  if (deal?.status === 'lost') return 'not_now';
  if (deal) return 'meeting';
  return i.stage;
}

// ---------------------------------------------------------------------------
// The group's sales (CRM → Group, and the board summary's Sales section)
// ---------------------------------------------------------------------------
export type GroupRow = { code: string; name: string; currency: string; paid: number; wonDeals: number; commit: number; weighted: number; open: number; openValue: number };
/** Each venture with its CRM on, for a quarter: paid (won), commit, weighted pipeline, open deals; in A$ at the group's rates. */
export async function groupSales(svc: Svc, start: string, end: string) {
  const { data: group } = await svc.from('entities').select('crm_fx').eq('relationship', 'group').limit(1).maybeSingle();
  const fx = (group?.crm_fx ?? {}) as Record<string, number>;
  const aud = (v: number, c: string) => (c === 'AUD' ? v : v * (Number(fx[c]) || 1));
  const { data: ents } = await svc.from('entities').select('id, code, display_name, crm_currency').eq('crm_enabled', true).order('sort');
  const rows: GroupRow[] = [];
  for (const e of ents ?? []) {
    const { data: deals } = await svc.from('crm_deals').select('status, amount, currency, forecast, ai_chance, won_at, expected_close, crm_stages(chance)').eq('entity_id', e.id)
      .or(`and(status.eq.won,won_at.gte.${start},won_at.lte.${end}T23:59:59Z),status.eq.open`).limit(5000);
    const r: GroupRow = { code: e.code, name: e.display_name, currency: 'AUD', paid: 0, wonDeals: 0, commit: 0, weighted: 0, open: 0, openValue: 0 };
    for (const d of (deals ?? []) as unknown as { status: string; amount: number; currency: string; forecast: string; ai_chance: number | null; expected_close: string | null; crm_stages: { chance: number } | null }[]) {
      const v = aud(Number(d.amount), d.currency);
      if (d.status === 'won') { r.paid += v; r.wonDeals++; continue; }
      r.open++; r.openValue += v;
      r.weighted += v * (d.ai_chance ?? d.crm_stages?.chance ?? 0) / 100;
      if (d.forecast === 'commit' && (!d.expected_close || d.expected_close <= end)) r.commit += v;
    }
    rows.push(r);
  }
  return rows;
}
