import { ApiError, classesOf, latestHoldings, type Svc } from './core';

// Shapes the API returns, shared by its endpoints (and by the HubSpot and
// Xero connectors, which send the same facts to those tools).

type Classes = Awaited<ReturnType<typeof classesOf>>;

/** IDs other systems use for a portal record, kept per company ("hubspot", "xero", or a name an API client chose). */
export async function externalIds(svc: Svc, companyIds: string[], type: 'holder' | 'person', ids: string[]) {
  const out = new Map<string, Record<string, string>>();
  if (!ids.length) return out;
  const { data } = await svc.from('external_links').select('local_id, system, external_id').in('entity_id', companyIds).eq('local_type', type).in('local_id', ids);
  for (const r of data ?? []) out.set(r.local_id, { ...(out.get(r.local_id) ?? {}), [r.system]: r.external_id });
  return out;
}

/** The holders with holdings in these companies: their latest holding per class and ownership percentage. */
export async function holdersIn(svc: Svc, companyIds: string[], opts: { holderIds?: string[]; includeZero?: boolean } = {}) {
  const classes = await classesOf(svc, companyIds);
  const latest = await latestHoldings(svc, [...classes.keys()], opts.holderIds);
  const byHolder = Map.groupBy(latest.filter((r) => opts.includeZero || Number(r.shares) > 0), (r) => r.holder_id);
  const ids = [...byHolder.keys()];
  const holders: { id: string; name: string; kind: string; registry_ref: string | null; represents_entity_id: string | null; created_at: string }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await svc.from('holders').select('id, name, kind, registry_ref, represents_entity_id, created_at').in('id', ids.slice(i, i + 200));
    holders.push(...(data ?? []));
  }
  holders.sort((a, b) => a.name.localeCompare(b.name));
  return { classes, holders, byHolder };
}

export function holderView(h: { id: string; name: string; kind: string; registry_ref: string | null; represents_entity_id: string | null }, rows: { share_class_id: string; shares: number; as_at: string; exercise_price: number | null; expires_on: string | null }[], classes: Classes, ext?: Record<string, string>) {
  return {
    id: h.id, name: h.name, kind: h.kind, registry_ref: h.registry_ref, is_group_stake: Boolean(h.represents_entity_id), external_ids: ext ?? {},
    holdings: rows.map((r) => {
      const c = classes.get(r.share_class_id)!;
      return {
        company: c.company, share_class: c.code, share_class_id: r.share_class_id, shares: Number(r.shares), as_at: r.as_at,
        ownership_pct: c.counts_toward_pct !== false && c.on_issue ? Math.round((Number(r.shares) / c.on_issue) * 1e6) / 1e4 : null,
        ...(r.exercise_price != null ? { exercise_price: Number(r.exercise_price) } : {}), ...(r.expires_on ? { expires_on: r.expires_on } : {}),
      };
    }),
  };
}

/** One holder, if it holds (or held) shares in these companies. */
export async function holderIn(svc: Svc, companyIds: string[], id: string) {
  const v = await holdersIn(svc, companyIds, { holderIds: [id], includeZero: true });
  const h = v.holders[0];
  if (!h) throw new ApiError(404, 'not_found', 'No such holder in this company.');
  return { ...v, holder: h };
}

/** People who can see a holder in these companies (investors), with their holders and portal status. */
export async function peopleIn(svc: Svc, companyIds: string[], opts: { userIds?: string[] } = {}) {
  const { holders } = await holdersIn(svc, companyIds, { includeZero: false });
  const holderIds = holders.map((h) => h.id);
  const links: { holder_id: string; user_id: string; access: string }[] = [];
  for (let i = 0; i < holderIds.length; i += 200) {
    let q = svc.from('holder_members').select('holder_id, user_id, access').in('holder_id', holderIds.slice(i, i + 200));
    if (opts.userIds) q = q.in('user_id', opts.userIds);
    const { data } = await q;
    links.push(...(data ?? []));
  }
  const userIds = [...new Set(links.map((l) => l.user_id))];
  const profiles: { id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null; created_at: string; updated_at: string | null; first_signed_in_at: string | null }[] = [];
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await svc.from('profiles').select('id, email, first_name, last_name, phone, created_at, updated_at, first_signed_in_at').in('id', userIds.slice(i, i + 200));
    profiles.push(...(data ?? []));
  }
  const auth = new Map<string, { last_sign_in_at?: string | null; invited_at?: string | null }>();
  if (userIds.length) {
    const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) if (userIds.includes(u.id)) auth.set(u.id, u);
  }
  const { data: welcomed } = userIds.length ? await svc.from('audit_log').select('detail').eq('action', 'investor_welcomed') : { data: [] };
  const welcomedIds = new Set((welcomed ?? []).map((w) => (w.detail as { user_id?: string }).user_id));
  const holderName = new Map(holders.map((h) => [h.id, h.name]));
  const byUser = Map.groupBy(links, (l) => l.user_id);
  return profiles.sort((a, b) => a.email.localeCompare(b.email)).map((p) => {
    const a = auth.get(p.id);
    const status = a?.last_sign_in_at ? 'active' : a?.invited_at || welcomedIds.has(p.id) ? 'invited' : 'not_invited';
    return {
      id: p.id, email: p.email, first_name: p.first_name, last_name: p.last_name, phone: p.phone, status,
      last_sign_in_at: a?.last_sign_in_at ?? null, created_at: p.created_at, updated_at: p.updated_at,
      holders: (byUser.get(p.id) ?? []).map((l) => ({ holder_id: l.holder_id, name: holderName.get(l.holder_id), access: l.access })),
    };
  });
}

// ---------- Directors' meetings (the Boardroom) ----------

export type Attendee = { name: string; role: string; present: boolean };
/** Who was there: roles and attendance; names only with "people.read". */
export const attendeesView = (a: Attendee[], personal: boolean) => (a ?? []).map((x) => ({ role: x.role, present: x.present, ...(personal ? { name: x.name } : {}) }));

/** The minutes paper of each meeting: its status and when it was signed. */
export async function minutesOf(svc: Svc, meetingIds: string[]) {
  const { data } = meetingIds.length ? await svc.from('board_papers').select('meeting_id, status, signed_at, document_id').eq('kind', 'minutes').in('meeting_id', meetingIds).neq('status', 'withdrawn') : { data: [] };
  return new Map((data ?? []).map((m) => [m.meeting_id as string, { status: m.status, signed_at: m.signed_at, document_id: m.document_id }]));
}
