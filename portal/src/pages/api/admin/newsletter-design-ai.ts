import type { APIRoute } from 'astro';
import { client as claude } from '../../../lib/ask';
import { serviceClient } from '../../../lib/admin';
import { newsEditor } from '../../../lib/news-editors';
import { DESIGN_RULES, EDITS_SCHEMA, checkEdits, type Edit } from '../../../lib/newsletter-design-ai';

/**
 * "Ask AI" in the newsletter designer: a request in plain words ("add the logo
 * top right") becomes small edits to the design, checked here before the
 * designer applies them. Quick actions on a selected element use Haiku; free
 * requests use Sonnet. Claude only changes the design: it can't save or send.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (!newsEditor(locals, 'newsletters')) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (!claude) return Response.json({ error: 'Claude needs the API key on the server.' }, { status: 503 });
  const b = await request.json().catch(() => null) as Record<string, unknown> | null;
  const instruction = String(b?.instruction ?? '').trim().slice(0, 1000);
  const outline = String(b?.outline ?? '').slice(0, 60000);
  const selected = /^c\d{1,5}$/.test(String(b?.selected ?? '')) ? String(b!.selected) : '';
  const quick = b?.quick === true;
  if (instruction.length < 3) return Response.json({ error: 'Say what you’d like to change.' }, { status: 400 });
  if (!outline.trim()) return Response.json({ error: 'The design is empty.' }, { status: 400 });

  // What the AI may use: the company's name, colour and public logo, and recent uploads.
  const origin = url.origin;
  const svc = serviceClient();
  const entityId = /^[0-9a-f-]{36}$/.test(String(b?.entity_id ?? '')) ? String(b!.entity_id) : '';
  const isPublic = b?.audience === 'public';
  const { data: company } = entityId && !isPublic ? await svc.from('entities').select('display_name, logo_url, brand_color').eq('id', entityId).maybeSingle() : { data: null };
  const library = Array.isArray(b?.library) ? (b!.library as unknown[]).map(String).filter((x) => x.startsWith(`${origin}/news-media/`)).slice(0, 12) : [];
  const logo = company?.logo_url && /^\/logos\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(company.logo_url) ? `${origin}${company.logo_url}` : '';
  const assets = [
    `Company: ${isPublic ? 'Lakeba Group (public newsletter)' : company?.display_name ?? 'Lakeba Group'}`,
    `Brand colour: ${company?.brand_color ?? '#276ae7'}`,
    logo ? `Company logo: ${logo}` : 'Company logo: none available (a logo can be uploaded to the image library, or an image in the design selected)',
    library.length ? `Image library (newest first):\n${library.map((u, i) => `${i + 1}. ${u}`).join('\n')}` : 'Image library: empty',
    `Portal address (for links): ${origin}`,
  ].join('\n');

  const ids = new Set([...outline.matchAll(/^\s*(c\d{1,5}) /gm)].map((m) => m[1]));
  const existing = new Set([...outline.matchAll(/\ssrc="([^"]+)"/g)].map((m) => m[1]));
  const model = quick ? 'claude-haiku-5-5' : 'claude-sonnet-5-5';
  try {
    const res = await claude.beta.messages.create({
      model, max_tokens: 4000,
      output_config: { effort: quick ? 'low' : 'medium', format: { type: 'json_schema', schema: EDITS_SCHEMA } },
      system: ['You change the design of a company newsletter in an email designer, as the editor asks.', ...DESIGN_RULES].join('\n'),
      messages: [{ role: 'user', content: `<assets>\n${assets}\n</assets>\n\n<outline>\n${outline}\n</outline>\n\n${selected ? `The editor has selected ${selected}: "this" or "it" means that element, and the request applies to it unless it says otherwise.\n\n` : ''}<request>\n${instruction}\n</request>` }],
    });
    const out = JSON.parse(res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('')) as { message: string; edits: Edit[] };
    const { edits, dropped } = checkEdits(out.edits ?? [], ids, origin, existing);
    await locals.supabase.rpc('log_event', { event_action: 'admin_newsletter_design_ai', event_detail: { model, quick, edits: edits.length, dropped: dropped.length, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } });
    return Response.json({ message: String(out.message ?? '').slice(0, 600), edits, dropped });
  } catch (e) {
    console.error('newsletter design ai', (e as Error).message);
    return Response.json({ error: 'Claude couldn’t change the design just now. Please try again.' }, { status: 502 });
  }
};
