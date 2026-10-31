import type { APIRoute } from 'astro';

/**
 * A CRM form on any website (CRM → Marketing → Forms): one line, and the leads go straight into the CRM.
 *   <script src="https://investors.lakeba.com/embed/crm-form.js" async></script>
 *   <lakeba-form form="FORM-ID"></lakeba-form>
 * The page's utm_ parameters are sent along, so a lead is credited to its campaign. Its look follows the
 * company's colour and the page's font; the website can change it with --lf-accent, --lf-font, --lf-radius.
 */
const SCRIPT = String.raw`(() => {
  if (customElements.get('lakeba-form')) return;
  const me = document.currentScript;
  const BASE = new URL('/', me ? me.src : location.href).href;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const STYLE = ':host{display:block;font-family:var(--lf-font,inherit)}form{display:grid;gap:12px}label{display:grid;gap:4px;font-size:.9em}'
    + 'input,textarea,select{font:inherit;padding:10px 12px;border:1px solid #d4d9e2;border-radius:var(--lf-radius,10px)}textarea{min-height:90px}'
    + 'button{font:inherit;font-weight:600;padding:12px 18px;border:0;border-radius:var(--lf-radius,10px);background:var(--lf-accent,#276ae7);color:#fff;cursor:pointer;justify-self:start}'
    + '.consent{display:flex;gap:8px;align-items:flex-start;font-size:.85em}.err{color:#c0392b;font-size:.9em}.hp{position:absolute;left:-9999px}h3{margin:0}';
  class LakebaForm extends HTMLElement {
    async connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      const id = this.getAttribute('form');
      const api = BASE + 'api/public/crm/forms/' + encodeURIComponent(id || '');
      const res = await fetch(api).catch(() => null);
      if (!res || !res.ok) { root.innerHTML = ''; return; }
      const f = await res.json();
      if (f.accent) this.style.setProperty('--lf-accent', f.accent);
      const field = (x) => '<label>' + esc(x.label) + (x.required ? ' *' : '') + (x.type === 'textarea' ? '<textarea name="' + esc(x.key) + '"' + (x.required ? ' required' : '') + '></textarea>'
        : x.type === 'select' ? '<select name="' + esc(x.key) + '"' + (x.required ? ' required' : '') + '><option value=""></option>' + (x.options || []).map((o) => '<option>' + esc(o) + '</option>').join('') + '</select>'
        : '<input name="' + esc(x.key) + '" type="' + (x.type === 'email' ? 'email' : x.type === 'phone' ? 'tel' : 'text') + '"' + (x.required ? ' required' : '') + '>') + '</label>';
      root.innerHTML = '<style>' + STYLE + '</style>' + (f.headline ? '<h3>' + esc(f.headline) + '</h3>' : '') + (f.intro ? '<p>' + esc(f.intro) + '</p>' : '')
        + '<form>' + f.fields.map(field).join('') + '<input class="hp" name="website" tabindex="-1" autocomplete="off">'
        + '<label class="consent"><input type="checkbox" name="consent" required> <span>' + esc(f.consent) + '</span></label>'
        + '<p class="err" hidden></p><button>' + esc(f.button) + '</button></form>';
      const form = root.querySelector('form'); const err = root.querySelector('.err');
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true;
        const data = new FormData(form); const values = {};
        for (const x of f.fields) values[x.key] = data.get(x.key) || '';
        const utm = {}; new URLSearchParams(location.search).forEach((v, k) => { if (k.startsWith('utm_')) utm[k] = v; });
        const r = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values, consent: data.get('consent') === 'on', website: data.get('website'), utm, page: location.href }) }).catch(() => null);
        const out = r ? await r.json().catch(() => ({})) : { error: 'Couldn’t send. Please try again.' };
        if (!r || !r.ok) { err.textContent = out.error || 'Couldn’t send. Please try again.'; err.hidden = false; return; }
        if (out.redirect) { location.href = out.redirect; return; }
        root.innerHTML = '<style>' + STYLE + '</style><p>' + esc(out.thank_you) + '</p>';
      });
    }
  }
  customElements.define('lakeba-form', LakebaForm);
})();`;

export const GET: APIRoute = () => new Response(SCRIPT, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
