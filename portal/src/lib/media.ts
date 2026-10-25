import JSZip from 'jszip';
import Papa from 'papaparse';
import type { serviceClient } from './admin';

type Svc = ReturnType<typeof serviceClient>;

// The media database: outlets and journalists. Lists come in as CSV or Excel
// (any column layout; the columns are matched to fields, then confirmed);
// contacts are kept once per email address (stored in lower case), and opted-out addresses are
// never contacted again, whatever is imported later.

export type Outlet = { id: string; name: string; kind: string; country: string; region: string; website: string; tipline_email: string; beats: string[]; reach: string; notes: string };
export type Contact = {
  id: string; outlet_id: string | null; first_name: string; last_name: string; email: string | null; role: string; title: string; beats: string[]; regions: string[];
  phone: string; social_url: string; notes: string; recent_work: string; source: 'manual' | 'import' | 'research'; source_url: string;
  consent_basis: 'published_work_address' | 'requested' | 'relationship'; status: 'active' | 'opted_out' | 'bounced' | 'do_not_contact'; tags: string[];
  last_pitched_at: string | null; created_at: string; updated_at: string;
};

export const ROLES = ['journalist', 'editor', 'producer', 'newsdesk', 'freelancer', 'columnist', 'blogger', 'analyst', 'podcaster', 'other'] as const;
export const OUTLET_KINDS = ['newspaper', 'magazine', 'online', 'tv', 'radio', 'newsletter', 'podcast', 'trade', 'wire', 'other'] as const;
export const CONSENT: Record<Contact['consent_basis'], string> = {
  published_work_address: 'Published work address (inferred consent: emails about their beat)',
  requested: 'They asked to receive our news',
  relationship: 'Existing working relationship',
};
export const STATUS: Record<Contact['status'], string> = { active: 'Active', opted_out: 'Opted out', bounced: 'Bounced', do_not_contact: 'Do not contact' };

export const validEmail = (e: string) => /^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i.test(e.trim());
export const listOf = (s: string) => [...new Set(s.split(/[;,|\n]/).map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 60)))].slice(0, 20);
export const fullName = (c: Pick<Contact, 'first_name' | 'last_name'>) => [c.first_name, c.last_name].filter(Boolean).join(' ');

// ---------- Reading lists ----------

/** The rows of a CSV, or the first sheet of an Excel file, as text cells. */
export async function readTable(file: File): Promise<{ header: string[]; rows: string[][] } | { error: string }> {
  const name = file.name.toLowerCase();
  if (file.size > 10 * 1024 * 1024) return { error: 'Files can be up to 10 MB.' };
  let table: string[][];
  if (name.endsWith('.xlsx')) {
    try { table = await readXlsx(Buffer.from(await file.arrayBuffer())); } catch { return { error: 'That Excel file couldn’t be read. Save it as .xlsx or .csv and try again.' }; }
  } else if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const parsed = Papa.parse<string[]>((await file.text()).replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
    table = parsed.data.map((r) => r.map((c) => String(c ?? '').trim()));
  } else return { error: 'Use a .csv or .xlsx file.' };
  table = table.filter((r) => r.some((c) => c));
  if (table.length < 2) return { error: 'The file has no rows under its header.' };
  if (table.length > 5001) return { error: 'Up to 5,000 contacts per import.' };
  const width = Math.max(...table.map((r) => r.length));
  return { header: Array.from({ length: width }, (_v, i) => table[0][i] || `Column ${i + 1}`), rows: table.slice(1).map((r) => Array.from({ length: width }, (_v, i) => (r[i] ?? '').slice(0, 2000))) };
}

const xmlText = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** The first worksheet of an .xlsx (shared and inline strings, numbers as written). */
async function readXlsx(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const shared = [...((await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const firstId = /<sheet\b[^>]*r:id="([^"]+)"/.exec((await zip.file('xl/workbook.xml')?.async('string')) ?? '')?.[1];
  const target = firstId ? new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstId}"`).exec(rels) : null;
  const path = target ? `xl/${(target[1] ?? target[2]).replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = await zip.file(path)?.async('string');
  if (!sheet) throw new Error('no sheet');
  const col = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '') : xmlText(v);
      row[ref ? col(ref) : row.length] = value.trim();
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

// ---------- Matching columns to fields ----------

export const FIELDS = {
  full_name: 'Full name', first_name: 'First name', last_name: 'Last name', email: 'Email', outlet: 'Outlet / publication', role: 'Role', title: 'Job title',
  beats: 'Beats / topics', regions: 'Region', phone: 'Phone', social_url: 'LinkedIn / X / profile', notes: 'Notes', outlet_website: 'Outlet website', outlet_kind: 'Outlet type', tags: 'Tags',
} as const;
export type Field = keyof typeof FIELDS;
const GUESS: [Field, RegExp][] = [
  ['email', /e-?mail/i], ['first_name', /^first|given|forename/i], ['last_name', /^last|surname|family/i], ['full_name', /^(full ?)?name$|contact|journalist|person/i],
  ['outlet', /outlet|publication|media|masthead|company|organi[sz]ation|employer|network|station/i], ['title', /title|position|job/i], ['role', /^role|type of contact/i],
  ['beats', /beat|topic|subject|cover|section|interest|category/i], ['regions', /region|state|city|country|location/i], ['phone', /phone|mobile|tel/i],
  ['social_url', /linkedin|twitter|^x$|profile|social|handle/i], ['notes', /note|comment/i], ['outlet_website', /website|url|site/i], ['outlet_kind', /outlet type|media type|format/i], ['tags', /tag|list|group/i],
];
/** A best guess of which field each column holds. */
export function guessColumns(header: string[]): (Field | '')[] {
  const used = new Set<Field>();
  return header.map((h) => {
    const hit = GUESS.find(([f, re]) => !used.has(f) && re.test(h.trim()));
    if (hit) used.add(hit[0]);
    return hit?.[0] ?? '';
  });
}

const roleOf = (s: string): Contact['role'] => {
  const v = s.toLowerCase();
  return (ROLES.find((r) => v.includes(r)) ?? (/report|writer|correspondent|journo/.test(v) ? 'journalist' : /chief of staff|desk/.test(v) ? 'newsdesk' : /edit/.test(v) ? 'editor' : /host|present/.test(v) ? 'producer' : 'journalist')) as Contact['role'];
};
const kindOf = (s: string) => (OUTLET_KINDS.find((k) => s.toLowerCase().includes(k)) ?? (/paper|daily/.test(s.toLowerCase()) ? 'newspaper' : /tv|television/.test(s.toLowerCase()) ? 'tv' : 'online'));

/** Imports the rows with the confirmed columns: outlets by name, contacts once per email; opted-out addresses are skipped. */
export async function importContacts(svc: Svc, rows: string[][], map: (Field | '')[], o: { consent: Contact['consent_basis']; tags: string[]; by: string }) {
  const at = (row: string[], f: Field) => { const i = map.indexOf(f); return i < 0 ? '' : (row[i] ?? '').trim(); };
  const { data: optouts } = await svc.from('media_optouts').select('email');
  const out = new Set((optouts ?? []).map((x) => x.email));
  const { data: outlets } = await svc.from('media_outlets').select('id, name');
  const outletIds = new Map((outlets ?? []).map((x) => [x.name.toLowerCase(), x.id as string]));
  const result = { added: 0, updated: 0, skipped: 0, optedOut: 0, outlets: 0, problems: [] as string[] };
  for (const [n, row] of rows.entries()) {
    const email = at(row, 'email').toLowerCase().replace(/^mailto:/, '');
    let first = at(row, 'first_name'), last = at(row, 'last_name');
    if (!first && !last && at(row, 'full_name')) { const parts = at(row, 'full_name').split(/\s+/); first = parts.shift() ?? ''; last = parts.join(' '); }
    const outletName = at(row, 'outlet').slice(0, 120);
    if (!email && !first && !last) { result.skipped++; continue; }
    if (email && !validEmail(email)) { result.skipped++; if (result.problems.length < 10) result.problems.push(`Row ${n + 2}: “${email}” isn’t an email address`); continue; }
    if (email && out.has(email)) { result.optedOut++; continue; }
    let outlet_id: string | null = null;
    if (outletName) {
      outlet_id = outletIds.get(outletName.toLowerCase()) ?? null;
      if (!outlet_id) {
        const { data } = await svc.from('media_outlets').insert({ name: outletName, kind: kindOf(at(row, 'outlet_kind')), website: at(row, 'outlet_website').slice(0, 300), created_by: o.by }).select('id').single();
        if (data) { outlet_id = data.id; outletIds.set(outletName.toLowerCase(), data.id); result.outlets++; }
      }
    }
    const fields = {
      first_name: first.slice(0, 80), last_name: last.slice(0, 80), outlet_id, role: roleOf(at(row, 'role') || at(row, 'title')), title: at(row, 'title').slice(0, 160),
      beats: listOf(at(row, 'beats')), regions: listOf(at(row, 'regions')), phone: at(row, 'phone').slice(0, 60), social_url: at(row, 'social_url').slice(0, 300), notes: at(row, 'notes').slice(0, 2000),
      tags: [...new Set([...listOf(at(row, 'tags')), ...o.tags])],
    };
    const existing = email ? (await svc.from('media_contacts').select('*').eq('email', email).maybeSingle()).data as Contact | null : null;
    if (existing) {
      // Fill in what's missing; never overwrite what someone already entered.
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        const cur = existing[k as keyof Contact];
        if (Array.isArray(v)) { const merged = [...new Set([...(cur as string[]), ...v])]; if (merged.length !== (cur as string[]).length) patch[k] = merged; }
        else if (v && !cur) patch[k] = v;
      }
      if (Object.keys(patch).length) { await svc.from('media_contacts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id); result.updated++; } else result.skipped++;
    } else {
      const { error } = await svc.from('media_contacts').insert({ ...fields, email: email || null, source: 'import', consent_basis: o.consent, created_by: o.by });
      if (error) { result.skipped++; if (result.problems.length < 10) result.problems.push(`Row ${n + 2}: ${error.message}`); } else result.added++;
    }
  }
  return result;
}

/** Records an opt-out by address (permanent) and marks the contact. */
export async function optOut(svc: Svc, email: string, reason = 'unsubscribed') {
  const e = email.trim().toLowerCase();
  await svc.from('media_optouts').upsert({ email: e, reason });
  await svc.from('media_contacts').update({ status: 'opted_out', updated_at: new Date().toISOString() }).eq('email', e);
}

export type Filters = { beats?: string[]; outlets?: string[]; roles?: string[]; regions?: string[]; tags?: string[]; q?: string; contact_ids?: string[]; tiplines?: boolean };

/** Who a distribution goes to: active contacts with an email address that match, minus opt-outs; plus outlets' tip-lines if asked. */
export async function audience(svc: Svc, f: Filters) {
  const { data } = await svc.from('media_contacts').select('*').eq('status', 'active').not('email', 'is', null).limit(5000);
  const { data: outs } = await svc.from('media_outlets').select('*');
  const { data: optouts } = await svc.from('media_optouts').select('email');
  const out = new Set((optouts ?? []).map((x) => x.email));
  const outletById = new Map(((outs ?? []) as Outlet[]).map((x) => [x.id, x]));
  const lc = (xs?: string[]) => (xs ?? []).map((x) => x.toLowerCase()).filter(Boolean);
  const [beats, roles, regions, tags, outlets] = [lc(f.beats), lc(f.roles), lc(f.regions), lc(f.tags), f.outlets ?? []];
  const hit = (have: string[], want: string[]) => !want.length || have.some((h) => want.some((w) => h.toLowerCase().includes(w)));
  const q = (f.q ?? '').toLowerCase();
  const people = ((data ?? []) as Contact[]).filter((c) => !out.has(c.email!.toLowerCase())
    && (f.contact_ids?.length ? f.contact_ids.includes(c.id) : true)
    && hit([...c.beats, ...(c.outlet_id ? outletById.get(c.outlet_id)?.beats ?? [] : [])], beats) && (!roles.length || roles.includes(c.role)) && hit(c.regions, regions) && hit(c.tags, tags)
    && (!outlets.length || (c.outlet_id && outlets.includes(c.outlet_id)))
    && (!q || `${fullName(c)} ${c.email} ${c.notes} ${c.outlet_id ? outletById.get(c.outlet_id)?.name : ''}`.toLowerCase().includes(q)))
    .map((c) => ({ contact_id: c.id as string | null, email: c.email!, first_name: c.first_name, name: fullName(c), outlet: c.outlet_id ? outletById.get(c.outlet_id)?.name ?? '' : '', beats: c.beats, notes: c.notes, recent_work: c.recent_work, title: c.title }));
  if (f.tiplines) {
    for (const o of (outs ?? []) as Outlet[]) {
      if (!o.tipline_email || !validEmail(o.tipline_email) || out.has(o.tipline_email.toLowerCase())) continue;
      if ((outlets.length && !outlets.includes(o.id)) || !hit(o.beats, beats)) continue;
      if (!people.some((p) => p.email.toLowerCase() === o.tipline_email.toLowerCase())) people.push({ contact_id: null, email: o.tipline_email, first_name: '', name: `${o.name} newsdesk`, outlet: o.name, beats: o.beats, notes: '', recent_work: '', title: 'Newsdesk' });
    }
  }
  return people;
}
