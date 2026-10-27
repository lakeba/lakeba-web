import { createHash } from 'node:crypto';
import { HUBSPOT_API_BASE } from 'astro:env/server';
import type { serviceClient } from '../admin';
import { holdersIn, peopleIn } from '../api/data';
import { brandOf } from '../brand';
import { outboundJson } from '../outbound';
import { addInvestor } from '../people';
import { accessToken, raiseIssue, type Connection } from './connections';

type Svc = ReturnType<typeof serviceClient>;

// HubSpot for one company. The portal is the source for shareholdings and
// HubSpot for the relationship:
//  - portal → HubSpot (always): investors become contacts (matched by email)
//    with "Lakeba portal" properties (shares, % ownership, status, last
//    sign-in); holders become HubSpot companies, associated with their people;
//    activity (proxy votes, Board Q&A, data room views…) becomes notes.
//  - HubSpot → portal (each one opt-in): name and phone changes; "Invite to
//    portal" on a contact; deals reaching a chosen stage ask for data room
//    access. Shares, holders and the register never come from HubSpot.

export type HubSpotSettings = { contact_details: 'portal' | 'hubspot'; invites: boolean; notes: boolean; deal_stage: string; deal_room_id: string };
export const hubspotSettings = (s: Record<string, unknown>): HubSpotSettings => ({
  contact_details: s.contact_details === 'hubspot' ? 'hubspot' : 'portal', invites: s.invites === true, notes: s.notes !== false,
  deal_stage: typeof s.deal_stage === 'string' ? s.deal_stage : '', deal_room_id: typeof s.deal_room_id === 'string' ? s.deal_room_id : '',
});

const GROUP = 'lakeba_portal';
const CONTACT_PROPS = [
  { name: 'lakeba_shareholder', label: 'Shareholder (Lakeba portal)', type: 'bool', fieldType: 'booleancheckbox', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
  { name: 'lakeba_holders', label: 'Holders (Lakeba portal)', type: 'string', fieldType: 'textarea' },
  { name: 'lakeba_shares', label: 'Shares (Lakeba portal)', type: 'number', fieldType: 'number' },
  { name: 'lakeba_ownership_pct', label: 'Ownership % (Lakeba portal)', type: 'number', fieldType: 'number' },
  { name: 'lakeba_share_classes', label: 'Share classes (Lakeba portal)', type: 'string', fieldType: 'text' },
  { name: 'lakeba_portal_status', label: 'Portal status (Lakeba portal)', type: 'enumeration', fieldType: 'select', options: [{ label: 'Not invited', value: 'not_invited' }, { label: 'Invited', value: 'invited' }, { label: 'Active', value: 'active' }] },
  { name: 'lakeba_last_sign_in', label: 'Last sign-in (Lakeba portal)', type: 'datetime', fieldType: 'date' },
  { name: 'lakeba_invite_to_portal', label: 'Invite to portal (Lakeba portal)', type: 'enumeration', fieldType: 'select', options: [{ label: '—', value: 'none' }, { label: 'Add without inviting', value: 'add' }, { label: 'Add and invite', value: 'invite' }] },
];
const COMPANY_PROPS = [
  { name: 'lakeba_holder_id', label: 'Holder ID (Lakeba portal)', type: 'string', fieldType: 'text', hasUniqueValue: true },
  { name: 'lakeba_registry_ref', label: 'Register reference (Lakeba portal)', type: 'string', fieldType: 'text' },
  { name: 'lakeba_shares', label: 'Shares (Lakeba portal)', type: 'number', fieldType: 'number' },
  { name: 'lakeba_ownership_pct', label: 'Ownership % (Lakeba portal)', type: 'number', fieldType: 'number' },
  { name: 'lakeba_holdings', label: 'Holdings (Lakeba portal)', type: 'string', fieldType: 'textarea' },
];

type Ctx = { svc: Svc; c: Connection; company: { id: string; code: string; display_name: string; relationship: string; brand_color?: string | null }; central: string; token: string };
const hs = <T = unknown>(x: Ctx, method: string, path: string, body?: unknown) => outboundJson<T>(method, `${HUBSPOT_API_BASE}${path}`, body, { authorization: `Bearer ${x.token}` });
const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const ignoreConflict = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (!/^409/.test((e as Error).message)) throw e; } };

/** The HubSpot account ("hub") behind a token. */
export async function hubspotAccount(token: string) {
  const j = await outboundJson<{ hub_id: number; hub_domain: string }>('GET', `${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${encodeURIComponent(token)}`);
  return { id: String(j.hub_id), name: j.hub_domain };
}

/** The "Lakeba portal" property group and properties, made once. */
async function ensureProperties(x: Ctx) {
  if (x.c.cursor.properties_ok) return;
  for (const object of ['contacts', 'companies']) {
    await ignoreConflict(hs(x, 'POST', `/crm/v3/properties/${object}/groups`, { name: GROUP, label: 'Lakeba portal', displayOrder: -1 }));
    for (const p of object === 'contacts' ? CONTACT_PROPS : COMPANY_PROPS) await ignoreConflict(hs(x, 'POST', `/crm/v3/properties/${object}`, { ...p, groupName: GROUP }));
  }
  x.c.cursor.properties_ok = true;
}

const links = async (x: Ctx, type: 'holder' | 'person') => {
  const { data } = await x.svc.from('external_links').select('local_id, external_id, synced_hash').eq('entity_id', x.company.id).eq('local_type', type).eq('system', 'hubspot');
  return new Map((data ?? []).map((l) => [l.local_id, l]));
};
const saveLink = (x: Ctx, type: 'holder' | 'person', localId: string, externalId: string, hash: string) =>
  x.svc.from('external_links').upsert({ entity_id: x.company.id, local_type: type, local_id: localId, system: 'hubspot', external_id: externalId, synced_hash: hash, synced_at: new Date().toISOString() });

/** Portal → HubSpot: holders as companies, investors as contacts, and their associations. Only what changed is sent. */
async function push(x: Ctx, s: HubSpotSettings) {
  const { classes, holders, byHolder } = await holdersIn(x.svc, [x.company.id]);
  const people = await peopleIn(x.svc, [x.company.id]);
  const holderLinks = await links(x, 'holder');
  const personLinks = await links(x, 'person');
  const pct = (classId: string, shares: number) => { const k = classes.get(classId)!; return k.counts_toward_pct !== false && k.on_issue ? (shares / k.on_issue) * 100 : 0; };
  const round = (n: number) => Math.round(n * 10000) / 10000;
  let sent = 0;

  // Holders → HubSpot companies (upsert on lakeba_holder_id).
  const holderProps = holders.map((h) => {
    const rows = byHolder.get(h.id) ?? [];
    return { h, props: {
      name: h.name, lakeba_holder_id: h.id, lakeba_registry_ref: h.registry_ref ?? '',
      lakeba_shares: String(rows.filter((r) => classes.get(r.share_class_id)?.counts_toward_pct !== false).reduce((a, r) => a + Number(r.shares), 0)),
      lakeba_ownership_pct: String(round(rows.reduce((a, r) => a + pct(r.share_class_id, Number(r.shares)), 0))),
      lakeba_holdings: rows.map((r) => `${Number(r.shares).toLocaleString('en-AU')} ${classes.get(r.share_class_id)?.code}`).join(', '),
    } };
  });
  const changedHolders = holderProps.filter(({ h, props }) => holderLinks.get(h.id)?.synced_hash !== hashOf(props));
  for (let i = 0; i < changedHolders.length; i += 100) {
    const batch = changedHolders.slice(i, i + 100);
    const res = await hs<{ results: { id: string; properties: { lakeba_holder_id: string } }[] }>(x, 'POST', '/crm/v3/objects/companies/batch/upsert', { inputs: batch.map(({ h, props }) => ({ id: h.id, idProperty: 'lakeba_holder_id', properties: props })) });
    for (const r of res.results ?? []) { const b = batch.find(({ h }) => h.id === r.properties.lakeba_holder_id); if (b) { await saveLink(x, 'holder', b.h.id, r.id, hashOf(b.props)); holderLinks.set(b.h.id, { local_id: b.h.id, external_id: r.id, synced_hash: hashOf(b.props) }); sent++; } }
  }

  // Investors → HubSpot contacts (upsert on email).
  const contactProps = people.map((p) => {
    const rows = p.holders.flatMap((hl) => (byHolder.get(hl.holder_id) ?? []));
    const props: Record<string, string> = {
      email: p.email, lakeba_shareholder: 'true', lakeba_holders: p.holders.map((hl) => hl.name).join('; '),
      lakeba_shares: String(rows.filter((r) => classes.get(r.share_class_id)?.counts_toward_pct !== false).reduce((a, r) => a + Number(r.shares), 0)),
      lakeba_ownership_pct: String(round(rows.reduce((a, r) => a + pct(r.share_class_id, Number(r.shares)), 0))),
      lakeba_share_classes: [...new Set(rows.map((r) => classes.get(r.share_class_id)?.code))].join(', '),
      lakeba_portal_status: p.status,
      ...(p.last_sign_in_at ? { lakeba_last_sign_in: String(new Date(p.last_sign_in_at).getTime()) } : {}),
    };
    if (s.contact_details === 'portal') Object.assign(props, { firstname: p.first_name ?? '', lastname: p.last_name ?? '', ...(p.phone ? { phone: p.phone } : {}) });
    return { p, props };
  });
  const changedPeople = contactProps.filter(({ p, props }) => personLinks.get(p.id)?.synced_hash !== hashOf(props));
  for (let i = 0; i < changedPeople.length; i += 100) {
    const batch = changedPeople.slice(i, i + 100);
    const res = await hs<{ results: { id: string; properties: { email: string } }[] }>(x, 'POST', '/crm/v3/objects/contacts/batch/upsert', { inputs: batch.map(({ p, props }) => ({ id: p.email, idProperty: 'email', properties: props })) });
    for (const r of res.results ?? []) {
      const b = batch.find(({ p }) => p.email === r.properties.email?.toLowerCase());
      if (!b) continue;
      const before = personLinks.get(b.p.id);
      await saveLink(x, 'person', b.p.id, r.id, hashOf(b.props));
      personLinks.set(b.p.id, { local_id: b.p.id, external_id: r.id, synced_hash: hashOf(b.props) });
      sent++;
      // Associate the contact with their holders' companies (when first linked or their holders changed).
      if (!before || before.synced_hash !== hashOf(b.props)) {
        for (const hl of b.p.holders) {
          const co = holderLinks.get(hl.holder_id)?.external_id;
          if (co) await ignoreConflict(hs(x, 'PUT', `/crm/v4/objects/contact/${r.id}/associations/default/company/${co}`));
        }
      }
    }
  }
  return sent;
}

const NOTE_EVENTS: Record<string, (d: Record<string, string>) => string> = {
  'proxy.lodged': () => 'Lodged proxy votes in the investor portal.',
  'query.created': (d) => `Asked the board a question in the investor portal${d.subject ? `: “${d.subject}”` : ''}.`,
  'data_room.terms_accepted': () => 'Accepted the data room’s confidentiality terms.',
  'data_room.document_viewed': (d) => `Opened “${d.title ?? 'a document'}” in the data room.`,
  'person.invited': () => 'Was invited to the investor portal.',
  'trade_interest.registered': () => 'Registered an interest in buying or selling shares.',
};

/** Portal activity → notes on the HubSpot contact. */
async function notes(x: Ctx) {
  const after = Number(x.c.cursor.event_id ?? 0);
  const { data: events } = await x.svc.from('integration_events').select('id, type, data, occurred_at').eq('entity_id', x.company.id).gt('id', after).order('id').limit(200);
  if (!events?.length) return 0;
  const personLinks = await links(x, 'person');
  let made = 0;
  for (const e of events) {
    const write = NOTE_EVENTS[e.type];
    const d = e.data as Record<string, string>;
    let contact = d.user_id ? personLinks.get(d.user_id)?.external_id : undefined;
    if (!contact && d.email && e.type.startsWith('data_room')) {
      // Data room guests aren't investors: find (or make) their contact by email.
      const r = await hs<{ results: { id: string }[] }>(x, 'POST', '/crm/v3/objects/contacts/batch/upsert', { inputs: [{ id: d.email.toLowerCase(), idProperty: 'email', properties: { email: d.email.toLowerCase() } }] });
      contact = r.results?.[0]?.id;
    }
    if (write && contact) {
      await hs(x, 'POST', '/crm/v3/objects/notes', { properties: { hs_timestamp: new Date(e.occurred_at).toISOString(), hs_note_body: `${x.company.display_name}: ${write(d)}` }, associations: [{ to: { id: contact }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] });
      made++;
    }
    x.c.cursor.event_id = e.id;
  }
  return made;
}

type HsContact = { id: string; properties: Record<string, string | null>; updatedAt?: string };

/** HubSpot → portal (opt-in): name and phone changes, "Invite to portal", deals asking for the data room. */
async function pull(x: Ctx, s: HubSpotSettings) {
  const since = String(x.c.cursor.pulled_at ?? x.c.connected_at ?? new Date(0).toISOString());
  const startedAt = new Date().toISOString();
  let changed = 0;
  const filters = [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: String(new Date(since).getTime()) }];
  const res = await hs<{ results: HsContact[] }>(x, 'POST', '/crm/v3/objects/contacts/search', { filterGroups: [{ filters }], properties: ['email', 'firstname', 'lastname', 'phone', 'lakeba_invite_to_portal'], limit: 100 });
  const personLinks = await links(x, 'person');
  const byContact = new Map([...personLinks.values()].map((l) => [l.external_id, l.local_id]));
  for (const ct of res.results ?? []) {
    const p = ct.properties;
    const userId = byContact.get(ct.id);
    if (userId && s.contact_details === 'hubspot') {
      const { data: prof } = await x.svc.from('profiles').select('first_name, last_name, phone').eq('id', userId).single();
      const next = { first_name: p.firstname ?? prof?.first_name ?? null, last_name: p.lastname ?? prof?.last_name ?? null, phone: p.phone ?? prof?.phone ?? null };
      if (prof && (next.first_name !== prof.first_name || next.last_name !== prof.last_name || next.phone !== prof.phone)) {
        await x.svc.from('profiles').update(next).eq('id', userId);
        await x.svc.from('audit_log').insert({ action: 'hubspot_updated_person', detail: { company: x.company.code, user_id: userId, from: prof, to: next } });
        changed++;
      }
    }
    const ask = p.lakeba_invite_to_portal;
    if (s.invites && (ask === 'add' || ask === 'invite') && p.email) {
      if (userId) { await hs(x, 'PATCH', `/crm/v3/objects/contacts/${ct.id}`, { properties: { lakeba_invite_to_portal: 'none' } }); continue; }
      // Which holder: the contact's HubSpot company that is a portal holder.
      const assoc = await hs<{ results: { toObjectId: string | number }[] }>(x, 'GET', `/crm/v4/objects/contact/${ct.id}/associations/company`);
      const holderLinks = await links(x, 'holder');
      const byCompany = new Map([...holderLinks.values()].map((l) => [l.external_id, l.local_id]));
      const holderIds = [...new Set((assoc.results ?? []).map((a) => byCompany.get(String(a.toObjectId))).filter(Boolean))] as string[];
      if (holderIds.length !== 1) {
        await raiseIssue(x.svc, x.c, 'invite_without_holder', `${p.email}: “Invite to portal” is set in HubSpot, but the contact is linked to ${holderIds.length ? 'more than one holder' : 'no holder company'}. Link them to exactly one holder’s company in HubSpot, or add them in Admin → Investors.`, `invite:${ct.id}`, { email: p.email, contact_id: ct.id });
        continue;
      }
      const r = await addInvestor(x.svc, {
        email: p.email, firstName: p.firstname ?? '', lastName: p.lastname ?? '', holderId: holderIds[0], invite: ask === 'invite', origin: x.central, brand: brandOf(x.company as never),
        log: (action, detail) => x.svc.from('audit_log').insert({ action, detail: { ...detail, company: x.company.code, via: 'hubspot' } }),
      });
      if ('error' in r) await raiseIssue(x.svc, x.c, 'invite_failed', `${p.email}: couldn’t be added (${r.error}).`, `invite:${ct.id}`, { email: p.email });
      else { await hs(x, 'PATCH', `/crm/v3/objects/contacts/${ct.id}`, { properties: { lakeba_invite_to_portal: 'none' } }); changed++; }
    }
  }
  // Deals at the chosen stage: their contacts ask for data room access (an Admin approves it in Integrations).
  if (s.deal_stage && s.deal_room_id) {
    const deals = await hs<{ results: { id: string; properties: Record<string, string> }[] }>(x, 'POST', '/crm/v3/objects/deals/search', { filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'EQ', value: s.deal_stage }, { propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(new Date(since).getTime()) }] }], properties: ['dealname', 'dealstage'], limit: 100 });
    for (const deal of deals.results ?? []) {
      const assoc = await hs<{ results: { toObjectId: string | number }[] }>(x, 'GET', `/crm/v4/objects/deal/${deal.id}/associations/contact`);
      for (const a of assoc.results ?? []) {
        const ct = await hs<HsContact>(x, 'GET', `/crm/v3/objects/contacts/${a.toObjectId}?properties=email,firstname,lastname,company`);
        if (!ct.properties.email) continue;
        await raiseIssue(x.svc, x.c, 'data_room_request', `${[ct.properties.firstname, ct.properties.lastname].filter(Boolean).join(' ') || ct.properties.email} (deal “${deal.properties.dealname}”) is ready for the data room.`, `deal:${deal.id}:${a.toObjectId}`,
          { email: ct.properties.email.toLowerCase(), name: [ct.properties.firstname, ct.properties.lastname].filter(Boolean).join(' '), organisation: ct.properties.company ?? '', room_id: s.deal_room_id, deal: deal.properties.dealname });
      }
    }
  }
  x.c.cursor.pulled_at = startedAt;
  return changed;
}

/** One sync for one company: properties, push, notes, pull. */
export async function syncHubSpot(svc: Svc, c: Connection, company: Ctx['company'], central: string) {
  const token = await accessToken(svc, c, central);
  const x: Ctx = { svc, c, company, central, token };
  const s = hubspotSettings(c.settings);
  await ensureProperties(x);
  const sent = await push(x, s);
  const made = s.notes ? await notes(x) : 0;
  if (!s.notes) { const { data: last } = await svc.from('integration_events').select('id').eq('entity_id', company.id).order('id', { ascending: false }).limit(1).maybeSingle(); c.cursor.event_id = last?.id ?? c.cursor.event_id ?? 0; }
  const pulled = await pull(x, s);
  await svc.from('connections').update({ cursor: c.cursor, last_sync_at: new Date().toISOString(), last_error: null, status: 'connected' }).eq('id', c.id);
  return { sent, notes: made, pulled };
}
