import Papa from 'papaparse';
import { readXlsx } from './xlsx-read.mjs';
import type { serviceClient } from './admin';
import { CURRENCIES, KINDS, cleanDomain, cleanEmail, companyDomainOf, ensureRelationship, findOrCreateCompany, findOrCreatePerson, logActivity, validEmail, type Pipeline } from './crm';

// CRM → Import: a spreadsheet or CSV of people, companies or deals (an export from another CRM, a contact
// list). Columns are matched by their headings; every person and company is matched to an existing record
// (email, web domain, name) so importing twice adds nothing twice. Records remember where they came from.

type Svc = ReturnType<typeof serviceClient>;
export type Sheet = { headers: string[]; rows: string[][] };
export const MAX_ROWS = 5000;

/** The first sheet of an .xlsx, or a CSV, as text cells under a header row. */
export async function readSheet(file: File): Promise<Sheet> {
  const buf = Buffer.from(await file.arrayBuffer());
  let grid: string[][];
  if (/\.xlsx$/i.test(file.name) || buf.subarray(0, 2).toString() === 'PK') {
    const sheets = await readXlsx(buf);
    const first = Object.values(sheets)[0] as Map<number, Map<number, unknown>> | undefined;
    if (!first) throw new Error('That workbook has no sheets.');
    const width = Math.max(0, ...[...first.values()].map((r) => Math.max(0, ...r.keys())));
    grid = [...first.keys()].sort((a, b) => a - b).map((r) => Array.from({ length: width }, (_, i) => cell(first.get(r)!.get(i + 1))));
  } else {
    const parsed = Papa.parse<string[]>(buf.toString('utf8').replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
    grid = parsed.data.map((r) => r.map((c) => String(c ?? '').trim()));
  }
  grid = grid.filter((r) => r.some((c) => c));
  if (grid.length < 2) throw new Error('The file needs a heading row and at least one row of data.');
  if (grid.length - 1 > MAX_ROWS) throw new Error(`Up to ${MAX_ROWS.toLocaleString('en-AU')} rows at a time; split the file.`);
  return { headers: grid[0].map((h) => h.trim()), rows: grid.slice(1) };
}
const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/** What each of our fields is called in other CRMs' exports and people's spreadsheets. */
const ALIASES: Record<string, string[]> = {
  full_name: ['name', 'full name', 'contact name', 'contact', 'person', 'student name'],
  first_name: ['first name', 'firstname', 'given name'],
  last_name: ['last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'email address', 'e-mail', 'work email', 'primary email'],
  phone: ['phone', 'phone number', 'telephone', 'mobile', 'mobile phone', 'cell'],
  job_title: ['job title', 'title', 'role', 'position'],
  company: ['company', 'company name', 'organisation', 'organization', 'account', 'account name', 'associated company', 'university', 'school'],
  domain: ['website', 'domain', 'company domain name', 'web', 'url', 'company website'],
  country: ['country', 'country/region'],
  city: ['city', 'town'],
  industry: ['industry', 'sector'],
  kind: ['type', 'lifecycle stage', 'contact type', 'relationship'],
  deal: ['deal name', 'deal', 'opportunity', 'opportunity name'],
  amount: ['amount', 'value', 'deal value', 'deal amount', 'revenue'],
  currency: ['currency', 'deal currency'],
  stage: ['stage', 'deal stage', 'pipeline stage', 'status'],
  close: ['close date', 'expected close', 'close', 'expected close date'],
  owner: ['owner', 'deal owner', 'contact owner', 'owner email'],
  source: ['source', 'lead source', 'original source'],
  external: ['record id', 'id', 'contact id', 'company id', 'deal id', 'hubspot id'],
};
export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Name', first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone', job_title: 'Role', company: 'Company', domain: 'Web address',
  country: 'Country', city: 'City', industry: 'Industry', kind: 'They are', deal: 'Deal name', amount: 'Value', currency: 'Currency', stage: 'Stage', close: 'Close date',
  owner: 'Owner (email)', source: 'Source', external: 'Id in the other system',
};
const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Our field → column index, from the headings. */
export function guessMapping(headers: string[]) {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [f, names] of Object.entries(ALIASES)) if (map[f] === undefined && names.includes(n)) { map[f] = i; break; }
  });
  return map;
}

export type ImportResult = { people: number; companies: number; deals: number; existing: number; skipped: { row: number; why: string }[] };

export async function runImport(svc: Svc, opts: { entityId: string; what: 'people' | 'companies' | 'deals'; sheet: Sheet; map: Record<string, number>; pipeline: Pipeline | null; defaultKind: string; userId: string; team: { id: string; email: string }[]; currency: string; source: string }): Promise<ImportResult> {
  const out: ImportResult = { people: 0, companies: 0, deals: 0, existing: 0, skipped: [] };
  const get = (r: string[], f: string) => (opts.map[f] !== undefined ? (r[opts.map[f]] ?? '').trim() : '');
  const stageByName = new Map((opts.pipeline?.stages ?? []).map((s) => [s.name.toLowerCase(), s]));
  const firstOpen = opts.pipeline?.stages.find((s) => s.kind === 'open');
  for (const [i, r] of opts.sheet.rows.entries()) {
    const row = i + 2;
    try {
      const ext = get(r, 'external') ? { [opts.source]: get(r, 'external') } : undefined;
      const email = cleanEmail(get(r, 'email'));
      const name = get(r, 'full_name') || [get(r, 'first_name'), get(r, 'last_name')].filter(Boolean).join(' ');
      const domain = cleanDomain(get(r, 'domain')) ?? companyDomainOf(email);
      const orgName = get(r, 'company');
      const kindRaw = norm(get(r, 'kind'));
      const kind = Object.keys(KINDS).find((k) => k === kindRaw.replace(/ /g, '_') || KINDS[k].toLowerCase() === kindRaw) ?? (kindRaw === 'opportunity' || kindRaw === 'salesqualifiedlead' ? 'prospect' : opts.defaultKind);
      const owner = opts.team.find((t) => t.email && t.email === cleanEmail(get(r, 'owner')))?.id ?? null;
      let org: { id: string; created: boolean } | null = null;
      if (orgName || (domain && opts.what !== 'people') || (domain && !email)) {
        org = await findOrCreateCompany(svc, { name: orgName || domain!, domain, country: get(r, 'country'), source: opts.source, createdBy: opts.userId, external: opts.what === 'companies' ? ext : undefined });
        if (org.created) { out.companies++; if (get(r, 'industry') || get(r, 'city')) await svc.from('crm_companies').update({ industry: get(r, 'industry').slice(0, 100), city: get(r, 'city').slice(0, 100) }).eq('id', org.id); }
        else if (opts.what === 'companies') out.existing++;
        await ensureRelationship(svc, opts.entityId, { company_id: org.id }, { kind: kind === 'student' ? 'other' : kind, owner_id: owner, createdBy: opts.userId });
      }
      let person: { id: string; created: boolean } | null = null;
      if (opts.what !== 'companies' && (name || email)) {
        if (email && !validEmail(email)) throw new Error(`“${email}” isn’t an email address`);
        person = await findOrCreatePerson(svc, { full_name: name || email, email: email || null, phone: get(r, 'phone'), job_title: get(r, 'job_title'), company_id: org?.id ?? null, source: opts.source, createdBy: opts.userId, external: opts.what === 'people' ? ext : undefined });
        if (person.created) out.people++; else if (opts.what === 'people') out.existing++;
        await ensureRelationship(svc, opts.entityId, { person_id: person.id }, { kind, owner_id: owner, createdBy: opts.userId });
      }
      if (opts.what === 'companies' && !org) throw new Error('no company name or web address');
      if (opts.what === 'people' && !person) throw new Error('no name or email');
      if (opts.what === 'deals') {
        if (!opts.pipeline || !firstOpen) throw new Error('choose a pipeline');
        const title = get(r, 'deal') || orgName || name;
        if (!title) throw new Error('no deal name, company or person');
        // The same deal from the same system, imported again: skipped.
        if (ext) {
          const { data: dup } = await svc.from('crm_deals').select('id').eq('entity_id', opts.entityId).contains('external_ids', ext).limit(1);
          if (dup?.length) { out.existing++; continue; }
        }
        const stage = stageByName.get(get(r, 'stage').toLowerCase()) ?? firstOpen;
        const amount = Number(get(r, 'amount').replace(/[^0-9.-]/g, '')) || 0;
        const cur = get(r, 'currency').toUpperCase();
        const close = /^\d{4}-\d{2}-\d{2}/.test(get(r, 'close')) ? get(r, 'close').slice(0, 10) : null;
        const now = new Date().toISOString();
        const { data: d } = await svc.from('crm_deals').insert({
          entity_id: opts.entityId, pipeline_id: opts.pipeline.id, stage_id: stage.id, status: stage.kind, title: title.slice(0, 200), company_id: org?.id ?? null, person_id: person?.id ?? null,
          owner_id: owner ?? opts.userId, amount: Math.max(0, amount), currency: CURRENCIES.includes(cur) ? cur : opts.currency, expected_close: close, source: get(r, 'source').slice(0, 100),
          won_at: stage.kind === 'won' ? now : null, lost_at: stage.kind === 'lost' ? now : null, external_ids: ext ?? {}, created_by: opts.userId,
        }).select('id').single().throwOnError();
        if (person) await svc.from('crm_deal_people').insert({ deal_id: d!.id, person_id: person.id, part: 'involved' });
        await logActivity(svc, { entity_id: opts.entityId, kind: 'system', deal_id: d!.id, subject: `Imported (${opts.source})`, created_by: opts.userId });
        out.deals++;
      }
    } catch (e) {
      out.skipped.push({ row, why: (e as Error).message });
    }
  }
  return out;
}
