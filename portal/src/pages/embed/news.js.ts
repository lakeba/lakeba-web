import type { APIRoute } from 'astro';

/**
 * The website component: one line on any website shows the company's news.
 *   <script src="https://investors.lakeba.com/embed/news.js" data-key="pk_live_…" async></script>
 *   <lakeba-news></lakeba-news>
 * Options on <lakeba-news>: limit (default 6), category, view="list" (never opens articles in
 * place), key (another publishable key). An article opens on the same page (?news=its-slug).
 * Its look follows the company's colour and the page's font; the website can change it with
 * --ln-accent, --ln-text, --ln-muted, --ln-font and --ln-radius.
 */
const SCRIPT = String.raw`(() => {
  if (customElements.get('lakeba-news')) return;
  const me = document.currentScript;
  const API = new URL('/api/v1/news', me ? me.src : location.href).href;
  const KEY = me && me.dataset.key;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const day = (d) => new Intl.DateTimeFormat(document.documentElement.lang || 'en-AU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
  const STYLE = ':host{display:block;font-family:var(--ln-font,inherit);color:var(--ln-text,inherit)}'
    + '.grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}'
    + 'a{color:inherit;text-decoration:none}.card{display:flex;flex-direction:column;gap:8px}.card:hover h3{color:var(--ln-accent)}'
    + '.cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--ln-radius,12px);background:#eef2f8}'
    + 'h3{margin:0;font-size:1.1em;line-height:1.3}p{margin:0}.muted{color:var(--ln-muted,#6b7280);font-size:.875em}'
    + '.more{margin-top:24px;padding:10px 18px;border:1px solid var(--ln-accent);border-radius:999px;background:none;color:var(--ln-accent);font:inherit;cursor:pointer}'
    + 'article h2{margin:8px 0 4px;font-size:1.8em;line-height:1.2}article .body{margin-top:20px;line-height:1.65}article .body img{max-width:100%;height:auto}'
    + 'article .cover{margin-top:16px}.back{color:var(--ln-accent);font-size:.9em}';
  class LakebaNews extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      this.attachShadow({ mode: 'open' });
      this.items = [];
      this.render();
    }
    get key() { return this.getAttribute('key') || KEY; }
    async get(params) {
      const u = new URL(API);
      u.searchParams.set('key', this.key || '');
      for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
      const r = await fetch(u, { credentials: 'omit' });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }
    paint(html, color) {
      this.shadowRoot.innerHTML = '<style>' + STYLE + ':host{--ln-accent:' + (color || '#276ae7') + '}</style>' + html;
    }
    link(slug) {
      const u = new URL(location.href);
      if (slug) u.searchParams.set('news', slug); else u.searchParams.delete('news');
      return u.pathname + u.search;
    }
    async render() {
      const slug = this.getAttribute('view') !== 'list' && new URLSearchParams(location.search).get('news');
      try {
        if (slug && /^[a-z0-9-]{1,120}$/.test(slug)) return this.article(slug);
        const limit = Math.min(Math.max(parseInt(this.getAttribute('limit') || '6', 10) || 6, 1), 50);
        const data = await this.get({ limit, offset: this.items.length || '', category: this.getAttribute('category') });
        this.color = data.company.color;
        this.items = this.items.concat(data.items);
        const cards = this.items.map((p) => '<a class="card" href="' + esc(p.external && p.source ? p.source.url : this.link(p.slug)) + '"' + (p.external ? ' target="_blank" rel="noopener"' : '') + '>'
          + (p.cover ? '<img class="cover" src="' + esc(p.cover) + '" alt="" loading="lazy">' : '')
          + '<span class="muted">' + esc(day(p.date)) + '</span><h3>' + esc(p.title) + '</h3><p class="muted">' + esc(p.excerpt) + '</p></a>').join('');
        this.paint(this.items.length ? '<div class="grid">' + cards + '</div>' + (data.next_offset != null ? '<button class="more" part="more">More news</button>' : '') : '<p class="muted">No news yet.</p>', this.color);
        const more = this.shadowRoot.querySelector('.more');
        if (more) more.addEventListener('click', () => this.render());
      } catch (e) {
        this.paint('<p class="muted">The news couldn’t be loaded just now.</p>', this.color);
      }
    }
    async article(slug) {
      const data = await this.get({ slug });
      const p = data.item;
      document.title = p.title + ' · ' + data.company.name;
      this.paint('<a class="back" href="' + esc(this.link(null)) + '">← All news</a><article><span class="muted">' + esc(day(p.date)) + '</span><h2>' + esc(p.title) + '</h2>'
        + (p.excerpt ? '<p class="muted">' + esc(p.excerpt) + '</p>' : '') + (p.cover ? '<img class="cover" src="' + esc(p.cover) + '" alt="">' : '')
        + '<div class="body">' + p.html + '</div></article>', data.company.color);
    }
  }
  customElements.define('lakeba-news', LakebaNews);
})();`;

export const GET: APIRoute = () => new Response(SCRIPT, {
  headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=3600', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' },
});
