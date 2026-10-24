// The newsletter designer (GrapesJS + MJML): compiling the designer's MJML
// into email HTML on the server, and making that HTML safe to send and to show
// on the portal (web version, archive, previews).

/**
 * Removes anything active from a full email document, keeping what emails
 * need: <style> blocks, Outlook's conditional comments, tables and inline
 * styles. (sanitize-html would drop the <head> styles and comments MJML relies
 * on, so this is a targeted clean-up instead; pages showing newsletters also
 * forbid scripts.)
 */
export function makeEmailSafe(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<(iframe|object|embed|applet|frameset|frame)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(iframe|object|embed|applet|frameset|frame|form|input|button|select|textarea|base|meta\s+http-equiv)\b[^>]*>/gi, '')
    .replace(/<link\b(?![^>]*rel=["']?stylesheet)[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|action|formaction|background|poster)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/-moz-binding\s*:/gi, 'x:');
}

/** MJML → email HTML, made safe. Errors are reported, not thrown, so a half-built design still previews. */
export async function compileMjml(mjml: string) {
  if (!mjml.trim()) return { html: '', errors: ['The design is empty.'] };
  const { default: mjml2html } = await import('mjml');
  try {
    const out = await mjml2html(mjml, { validationLevel: 'soft', keepComments: true, ignoreIncludes: true });
    return { html: makeEmailSafe(out.html), errors: (out.errors ?? []).map((e: { formattedMessage?: string; message?: string }) => e.formattedMessage ?? e.message ?? String(e)) };
  } catch (e) {
    return { html: '', errors: [(e as Error).message] };
  }
}

/** Headers for any page that shows newsletter HTML: no scripts, no plugins, only framed by the portal. */
export const EMAIL_PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The parts the portal adds to every designed email, whatever the design:
 * the inbox preview text at the top, and the footer (who sends it, why,
 * unsubscribe) at the bottom.
 */
export function wrapDesigned(html: string, o: { preheader: string; footer: string }) {
  const pre = `<div style="display:none!important;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden">${esc(o.preheader)}</div>`;
  const foot = `<table role="presentation" width="100%" style="border-collapse:collapse"><tr><td align="center" style="padding:8px 12px 28px"><table role="presentation" width="100%" style="max-width:600px;border-collapse:collapse"><tr><td style="font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7a90;padding:0 16px">${o.footer}</td></tr></table></td></tr></table>`;
  let out = /<body[^>]*>/i.test(html) ? html.replace(/(<body[^>]*>)/i, `$1${pre}`) : pre + html;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${foot}</body>`) : out + foot;
  return out;
}

/** The address of a YouTube or Vimeo video, recognised from a link people paste. */
export function videoOf(url: string): { kind: 'youtube' | 'vimeo'; id: string; watch: string } | null {
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,20})/.exec(url);
  if (yt) return { kind: 'youtube', id: yt[1], watch: `https://www.youtube.com/watch?v=${yt[1]}` };
  const vimeo = /vimeo\.com\/(?:video\/)?(\d{5,12})/.exec(url);
  if (vimeo) return { kind: 'vimeo', id: vimeo[1], watch: `https://vimeo.com/${vimeo[1]}` };
  return null;
}

/** A starting design from a composed issue: the same words, in the designer's layout. */
export function composeToMjml(o: { audience: string; company: string; color: string; intro: string; sections: { title: string; html: string }[]; closing: string; cta?: { label: string; url: string } | null; holding: boolean; documents: boolean; meetings: boolean }) {
  const t = (html: string) => `<mj-section background-color="#ffffff" padding="0 28px"><mj-column><mj-text>${html}</mj-text></mj-column></mj-section>`;
  const kind = o.audience === 'public' ? 'Newsletter' : 'Shareholder newsletter';
  return `<mjml><mj-head><mj-attributes><mj-all font-family="Inter, Arial, sans-serif"></mj-all><mj-text font-size="15px" line-height="1.6" color="#0b1d37" padding="6px 0"></mj-text><mj-button background-color="${o.color}" color="#ffffff" font-weight="600" border-radius="10px" inner-padding="12px 22px"></mj-button></mj-attributes><mj-style>a { color: ${o.color}; }</mj-style></mj-head>
<mj-body background-color="#eef2f8" width="620px"><mj-wrapper padding="24px 0 0">
  <mj-section background-color="${o.color}" padding="0"><mj-column><mj-spacer height="6px"></mj-spacer></mj-column></mj-section>
  <mj-section background-color="#ffffff" padding="22px 28px 4px"><mj-column><mj-text font-size="18px" font-weight="700">${esc(o.company)} <span style="font-weight:400;color:#6b7a90;font-size:14px">· ${kind}</span></mj-text></mj-column></mj-section>
  <mj-wrapper css-class="nl-content" padding="0">
    ${t('{{greeting}}')}${o.intro ? t(o.intro) : ''}
    ${o.sections.map((s) => t(`${s.title ? `<h3 style="margin:14px 0 6px;font-size:19px">${esc(s.title)}</h3>` : ''}${s.html}`)).join('\n    ')}
  </mj-wrapper>
  ${o.audience === 'shareholders' && o.holding ? t('{{holding}}') : ''}${t('{{news}}')}${o.audience === 'shareholders' && o.documents ? t('{{documents}}') : ''}${o.audience === 'shareholders' && o.meetings ? t('{{meetings}}') : ''}
  ${o.cta?.label && o.cta.url ? `<mj-section background-color="#ffffff" padding="4px 28px"><mj-column><mj-button href="${esc(o.cta.url)}" align="left">${esc(o.cta.label)}</mj-button></mj-column></mj-section>` : ''}
  <mj-section background-color="#ffffff" padding="10px 28px 26px"><mj-column><mj-text>${o.closing}${o.audience === 'shareholders' ? '{{portal_button}}' : ''}</mj-text></mj-column></mj-section>
</mj-wrapper></mj-body></mjml>`;
}
