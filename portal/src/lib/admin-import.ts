import Papa from 'papaparse';
import type { SupabaseClient } from '@supabase/supabase-js';
import { holderKindValues } from './admin-forms';

export type ImportRow = { line: number; registry_ref: string; holder_name: string; kind: string; share_class_code: string; shares: number; as_at: string };
export type PreviewRow = ImportRow & { holderId: string | null; previous: number | null; change: 'new-holder' | 'changed' | 'unchanged' | 'added' };
export type Preview = { rows: PreviewRow[]; errors: string[]; totals: { code: string; before: number; after: number }[] };

const REQUIRED = ['registry_ref', 'holder_name', 'kind', 'share_class_code', 'shares', 'as_at'] as const;

/** Parses the registry CSV into typed rows plus a list of problems. */
export function parseHoldingsCsv(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const errors: string[] = [];
  const missing = REQUIRED.filter((c) => !parsed.meta.fields?.includes(c));
  if (missing.length) return { rows: [] as ImportRow[], errors: [`Missing column(s): ${missing.join(', ')}`] };

  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const r = Object.fromEntries(REQUIRED.map((c) => [c, String(raw[c] ?? '').trim()])) as Record<(typeof REQUIRED)[number], string>;
    const shares = Number(r.shares.replace(/[, ]/g, ''));
    const problems = [
      !r.registry_ref && 'registry_ref is empty',
      !r.holder_name && 'holder_name is empty',
      !holderKindValues.includes(r.kind as never) && `kind must be one of ${holderKindValues.join(', ')}`,
      !r.share_class_code && 'share_class_code is empty',
      (!Number.isInteger(shares) || shares < 0) && 'shares must be a whole number ≥ 0',
      (!/^\d{4}-\d{2}-\d{2}$/.test(r.as_at) || Number.isNaN(Date.parse(r.as_at))) && 'as_at must be a date like 2026-06-30',
    ].filter(Boolean);
    const key = `${r.registry_ref}|${r.share_class_code}|${r.as_at}`;
    if (seen.has(key)) problems.push('duplicate of an earlier row');
    seen.add(key);
    if (problems.length) errors.push(`Line ${line}: ${problems.join('; ')}`);
    else rows.push({ line, ...r, share_class_code: r.share_class_code.toUpperCase(), shares });
  });
  return { rows, errors };
}

/** Compares parsed rows with the database to show what the import would change. */
export async function previewImport(supabase: SupabaseClient, rows: ImportRow[], parseErrors: string[]): Promise<Preview> {
  const errors = [...parseErrors];
  const [{ data: classes }, { data: holders }, { data: holdings }] = await Promise.all([
    supabase.from('share_classes').select('id, code, entities(display_name, holdings_from_register)'),
    supabase.from('holders').select('id, registry_ref'),
    supabase.from('holdings').select('holder_id, share_class_id, shares, as_at').order('as_at', { ascending: false }),
  ]);
  const classByCode = new Map((classes ?? []).map((c) => [c.code, c.id]));
  // Holdings of a company that come from its register of members are set by importing the register.
  const registerCompany = new Map((classes ?? []).map((c) => { const e = c.entities as unknown as { display_name: string; holdings_from_register: boolean } | null; return [c.id, e?.holdings_from_register ? e.display_name : null]; }));
  const holderByRef = new Map((holders ?? []).map((h) => [h.registry_ref, h.id]));
  const latest = new Map<string, number>();
  for (const h of holdings ?? []) {
    const k = `${h.holder_id}|${h.share_class_id}`;
    if (!latest.has(k)) latest.set(k, Number(h.shares));
  }

  const out: PreviewRow[] = [];
  for (const row of rows) {
    const classId = classByCode.get(row.share_class_code);
    if (!classId) { errors.push(`Line ${row.line}: unknown share class ${row.share_class_code}`); continue; }
    if (registerCompany.get(classId)) { errors.push(`Line ${row.line}: ${registerCompany.get(classId)}’s holdings come from its register of members: import the register instead (Import data → Register of members).`); continue; }
    const holderId = holderByRef.get(row.registry_ref) ?? null;
    const previous = holderId ? latest.get(`${holderId}|${classId}`) ?? null : null;
    const change = !holderId ? 'new-holder' : previous === null ? 'added' : previous === row.shares ? 'unchanged' : 'changed';
    out.push({ ...row, holderId, previous, change });
  }

  // Total on issue after the import: imported rows replace each holder's latest figure.
  const after = new Map(latest);
  for (const r of out) after.set(`${r.holderId ?? `new:${r.registry_ref}`}|${classByCode.get(r.share_class_code)}`, r.shares);
  const sum = (m: Map<string, number>, classId: string) => [...m].filter(([k]) => k.endsWith(`|${classId}`)).reduce((a, [, v]) => a + v, 0);
  const totals = (classes ?? []).map((c) => ({ code: c.code, before: sum(latest, c.id), after: sum(after, c.id) }));
  return { rows: out, errors, totals };
}

/** Applies a validated import. Returns the number of holdings rows written. */
export async function applyImport(supabase: SupabaseClient, rows: PreviewRow[]) {
  const { data: classes } = await supabase.from('share_classes').select('id, code');
  const classByCode = new Map((classes ?? []).map((c) => [c.code, c.id]));
  const newHolders = [...new Map(rows.filter((r) => !r.holderId).map((r) => [r.registry_ref, { registry_ref: r.registry_ref, name: r.holder_name, kind: r.kind }])).values()];
  if (newHolders.length) await supabase.from('holders').insert(newHolders).throwOnError();
  const { data: holders } = await supabase.from('holders').select('id, registry_ref');
  const holderByRef = new Map((holders ?? []).map((h) => [h.registry_ref, h.id]));
  const writes = rows
    .filter((r) => r.change !== 'unchanged')
    .map((r) => ({ holder_id: holderByRef.get(r.registry_ref)!, share_class_id: classByCode.get(r.share_class_code)!, shares: r.shares, as_at: r.as_at }));
  if (writes.length) await supabase.from('holdings').upsert(writes, { onConflict: 'holder_id,share_class_id,as_at' }).throwOnError();
  return { holders: newHolders.length, holdings: writes.length };
}
