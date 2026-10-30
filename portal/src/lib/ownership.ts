import type { serviceClient } from './admin';
import { classesOf, latestHoldings } from './api/core';

// Who owns whom among the portal's companies, from the share register (docs/group-structure-plan.md).
// A holder can be a company in the portal (holders.represents_entity_id): Lakeba Group's own stake in
// its ventures, or a venture's holding company (DoxAI Australia holding DoxAI Operations). Percentages
// are as on the register: each holder's latest balance in the classes that count toward %, against the
// official number on issue where there is one, else the shares held (as lakeba_stakes() in SQL).
// A company holding over 50% controls the other; a company's group is itself and everything it controls,
// at any depth.

type Svc = ReturnType<typeof serviceClient>;
export type Company = { id: string; code: string; display_name: string; legal_name: string | null; relationship: string; portal: string; lakeba_stake: number | null; stake_as_at: string | null };
/** One portal company's holding in another: its shares that count toward %, and the share of the total. */
export type Stake = { owner: string; company: string; shares: number; onIssue: number; pct: number; classes: { code: string; shares: number }[] };
/** Lakeba's share of a company: held directly by the group, through companies it holds, and the stake typed on the company page. */
export type LakebaShare = { direct: number; through: number; effective: number; stated: number | null };

export type Ownership = {
  companies: Map<string, Company>;
  group: Company | null;
  stakes: Stake[];
  /** Portal companies holding shares in this one, largest first. */
  ownersOf: (id: string) => Stake[];
  /** Portal companies this one holds shares in, largest first. */
  holdingsOf: (id: string) => Stake[];
  /** The company holding over 50% of this one, if any. */
  controllerOf: (id: string) => string | null;
  /** This company and every company it controls (alone or through those it controls), parents first. */
  groupOf: (id: string) => string[];
  /** Companies that control at least one other: the ventures with a group of their own (not Lakeba Group). */
  ventureGroups: () => string[];
  lakeba: (id: string) => LakebaShare;
};

const CONTROL = 0.5;

export async function ownership(svc: Svc): Promise<Ownership> {
  const [{ data: ents }, { data: reps }] = await Promise.all([
    svc.from('entities').select('id, code, display_name, legal_name, relationship, portal, lakeba_stake, stake_as_at').order('sort'),
    svc.from('holders').select('id, represents_entity_id').not('represents_entity_id', 'is', null),
  ]);
  const companies = new Map(((ents ?? []) as Company[]).map((e) => [e.id, e]));
  const group = [...companies.values()].find((e) => e.relationship === 'group') ?? null;
  const ownerOf = new Map((reps ?? []).map((h) => [h.id as string, h.represents_entity_id as string]));

  // The classes these holders hold, and every holding in them (for the shares on issue).
  const stakes: Stake[] = [];
  if (ownerOf.size) {
    const { data: rows } = await svc.from('holdings').select('share_class_id').in('holder_id', [...ownerOf.keys()]);
    const classIds = [...new Set((rows ?? []).map((r) => r.share_class_id as string))];
    const { data: owned } = classIds.length ? await svc.from('share_classes').select('entity_id').in('id', classIds) : { data: [] };
    const classes = await classesOf(svc, [...new Set((owned ?? []).map((c) => c.entity_id as string))]);
    const counting = [...classes.values()].filter((c) => c.counts_toward_pct !== false);
    const onIssue = new Map<string, number>();
    for (const c of counting) onIssue.set(c.entity_id, (onIssue.get(c.entity_id) ?? 0) + c.on_issue);
    const latest = await latestHoldings(svc, counting.map((c) => c.id), [...ownerOf.keys()]);
    const byPair = new Map<string, Stake>();
    for (const r of latest) {
      const c = classes.get(r.share_class_id)!, owner = ownerOf.get(r.holder_id)!;
      if (!Number(r.shares) || owner === c.entity_id) continue;
      const key = `${owner}|${c.entity_id}`;
      const s = byPair.get(key) ?? { owner, company: c.entity_id, shares: 0, onIssue: onIssue.get(c.entity_id) ?? 0, pct: 0, classes: [] };
      s.shares += Number(r.shares);
      const k = s.classes.find((x) => x.code === `${c.company}-${c.code}`);
      if (k) k.shares += Number(r.shares); else s.classes.push({ code: `${c.company}-${c.code}`, shares: Number(r.shares) });
      byPair.set(key, s);
    }
    for (const s of byPair.values()) { s.pct = s.onIssue > 0 ? Math.min(1, s.shares / s.onIssue) : 0; if (s.pct > 0) stakes.push(s); }
    stakes.sort((a, b) => b.pct - a.pct);
  }

  const ownersOf = (id: string) => stakes.filter((s) => s.company === id);
  const holdingsOf = (id: string) => stakes.filter((s) => s.owner === id);
  const controllerOf = (id: string) => ownersOf(id).find((s) => s.pct > CONTROL)?.owner ?? null;

  const groupOf = (id: string) => {
    // A company joins when the members hold over half of it between them; the set stops loops.
    const members = [id];
    for (let added = true; added;) {
      added = false;
      for (const c of companies.keys()) {
        if (members.includes(c)) continue;
        const held = ownersOf(c).filter((s) => members.includes(s.owner)).reduce((t, s) => t + s.pct, 0);
        if (held > CONTROL) { members.push(c); added = true; }
      }
    }
    return members;
  };
  const ventureGroups = () => [...companies.values()].filter((c) => c.relationship !== 'group' && groupOf(c.id).length > 1).map((c) => c.id);

  const memo = new Map<string, number>();
  /** Lakeba's effective share of a company: the group's own stake plus each owner's share × Lakeba's share of that owner. */
  const effective = (id: string, path: string[] = []): number => {
    if (group && id === group.id) return 1;
    if (memo.has(id)) return memo.get(id)!;
    if (path.includes(id)) return 0;
    let total = 0;
    for (const s of ownersOf(id)) {
      let of = effective(s.owner, [...path, id]);
      // An owner whose own register doesn't show Lakeba's stake: the stake typed on its page, if any.
      const stated = companies.get(s.owner)?.lakeba_stake;
      if (!of && s.owner !== group?.id && stated != null) of = Number(stated) / 100;
      total += s.pct * of;
    }
    total = Math.min(1, total);
    if (!path.length) memo.set(id, total);
    return total;
  };
  const lakeba = (id: string): LakebaShare => {
    const direct = group ? ownersOf(id).find((s) => s.owner === group.id)?.pct ?? 0 : 0;
    const eff = effective(id);
    const stated = companies.get(id)?.lakeba_stake;
    return { direct, through: Math.max(0, eff - direct), effective: eff, stated: stated == null ? null : Number(stated) / 100 };
  };

  return { companies, group, stakes, ownersOf, holdingsOf, controllerOf, groupOf, ventureGroups, lakeba };
}

/** A share as a percentage for people: 100%, 95.5%, 0.04%. */
export const pctText = (v: number) => `${v >= 0.1 ? Math.round(v * 1000) / 10 : Math.round(v * 10000) / 100}%`;
