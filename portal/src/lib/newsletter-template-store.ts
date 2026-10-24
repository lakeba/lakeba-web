import type { serviceClient } from './admin';
import { compileMjml } from './newsletter-design';
import { fillTemplate, templateValues } from './newsletter';
import { BUILT_IN, type Template } from './newsletter-templates';

type Svc = ReturnType<typeof serviceClient>;

// Newsletter templates live in the database (newsletter_templates). The
// built-in ones are created from the code the first time they're needed
// (builtin_key), can then be edited like any other, and "Restore original"
// puts the code's version back. Every save keeps a version (the last 20).

export type TemplateRow = Template & { id: string; builtin_key: string | null; entity_id: string | null; design_json: unknown; design_html: string; mjml: string; updated_at: string; created_at: string };
const COLS = 'id, builtin_key, name, description, audience, entity_id, subject, preheader, content, mode, html_body, mjml, design_json, design_html, created_at, updated_at';

async function fromCode(t: Template) {
  return {
    builtin_key: t.id, name: t.name, description: t.description, audience: t.audience, entity_id: null, subject: t.subject, preheader: t.preheader,
    content: t.content, mode: t.mode, html_body: t.html_body, mjml: t.mjml ?? '', design_json: null, design_html: t.mjml ? (await compileMjml(t.mjml)).html : '',
  };
}

/** Creates any built-in template that isn't in the database yet. */
export async function ensureBuiltIns(svc: Svc) {
  const { data } = await svc.from('newsletter_templates').select('builtin_key').not('builtin_key', 'is', null);
  const have = new Set((data ?? []).map((r) => r.builtin_key));
  for (const t of BUILT_IN) if (!have.has(t.id)) await svc.from('newsletter_templates').insert(await fromCode(t));
}

/** Templates this admin can use: built-ins first (in the code's order), then saved ones, newest first. */
export async function listTemplates(svc: Svc, mayEdit: (entityId: string) => boolean, group: boolean) {
  await ensureBuiltIns(svc);
  const { data } = await svc.from('newsletter_templates').select(COLS).order('created_at', { ascending: false });
  const rows = ((data ?? []) as TemplateRow[]).filter((t) => (t.entity_id ? mayEdit(t.entity_id) : true) && (t.audience !== 'public' || group));
  const order = (t: TemplateRow) => (t.builtin_key ? BUILT_IN.findIndex((b) => b.id === t.builtin_key) : 100);
  return rows.sort((a, b) => order(a) - order(b));
}

export async function loadTemplate(svc: Svc, id: string) {
  const { data } = await svc.from('newsletter_templates').select(COLS).eq('id', id).maybeSingle();
  return data as TemplateRow | null;
}

/** Who may change a template: group admins for all-company ones; its company's admins otherwise. */
export const mayManageTemplate = (t: { entity_id: string | null; audience: string }, mayEdit: (id: string) => boolean, group: boolean) =>
  (t.audience === 'public' || !t.entity_id ? group : mayEdit(t.entity_id));

export async function saveTemplateVersion(svc: Svc, t: TemplateRow, by: string) {
  const { builtin_key: _k, created_at: _c, ...snapshot } = t;
  await svc.from('newsletter_template_revisions').insert({ template_id: t.id, snapshot, saved_by: by });
  const { data: old } = await svc.from('newsletter_template_revisions').select('id').eq('template_id', t.id).order('saved_at', { ascending: false }).range(20, 200);
  if (old?.length) await svc.from('newsletter_template_revisions').delete().in('id', old.map((o) => o.id));
}

/** The built-in's original content, for "Restore original". */
export async function originalOf(key: string) {
  const t = BUILT_IN.find((b) => b.id === key);
  if (!t) return null;
  const { builtin_key: _k, entity_id: _e, ...rest } = await fromCode(t);
  return rest;
}

/**
 * What a new issue gets from a template, for a company: {{company}}, {{quarter}}
 * and friends filled in, and the Lakeba blue (#276ae7) swapped for the
 * company's colour in designs.
 */
export async function issueFromTemplate(t: Pick<TemplateRow, 'subject' | 'preheader' | 'content' | 'mode' | 'html_body' | 'mjml' | 'design_json'>, company: { name: string; color: string | null }, portal: string) {
  const v = templateValues(company.name, portal);
  const recolor = (s: string) => (company.color && company.color.toLowerCase() !== '#276ae7' ? s.replace(/#276ae7/gi, company.color) : s);
  const deep = (x: unknown): unknown => (typeof x === 'string' ? fillTemplate(x, v) : Array.isArray(x) ? x.map(deep) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, deep(y)])) : x);
  const mjml = recolor(fillTemplate(t.mjml ?? '', v));
  const design_json = t.design_json ? JSON.parse(recolor(fillTemplate(JSON.stringify(t.design_json), v))) : null;
  return {
    subject: fillTemplate(t.subject, v), preheader: fillTemplate(t.preheader, v), mode: t.mode,
    content: deep(t.content) as Template['content'], html_body: fillTemplate(t.html_body ?? '', v),
    mjml, design_json, design_html: t.mode === 'design' && mjml ? (await compileMjml(mjml)).html : '',
  };
}
