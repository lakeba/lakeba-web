import type { Editor, Component } from 'grapesjs';

// "Ask AI" and "Check design" in the newsletter designer. The design is sent
// as an outline with a short id per element; Claude's edits (checked by the
// server) are applied here as one change that "Undo AI change" reverses. A
// change that would drop a {{placeholder}} is not applied. The design check
// runs in the browser and costs nothing; some findings offer "Fix with AI".

type Edit = { op: string; target: string; position: string; ref: string; mjml: string; html: string; attributes: { name: string; value: string }[] };
const TEXTY = new Set(['mj-text', 'mj-button', 'mj-table']);
const tagOf = (c: Component) => String(c.get('type') || '');
const inner = (c: Component) => (c as Component & { getInnerHTML?: () => string }).getInnerHTML?.() ?? c.components().map((x) => x.toHTML()).join('');
const placeholders = (s: string) => new Set(s.match(/\{\{[a-z_]+\}\}/g) ?? []);
const NAMES: Record<string, string> = { 'mj-text': 'Text', 'mj-image': 'Image', 'mj-button': 'Button', 'mj-section': 'Section', 'mj-column': 'Column', 'mj-wrapper': 'Wrapper', 'mj-divider': 'Divider', 'mj-spacer': 'Spacer', 'mj-table': 'Table', 'mj-social': 'Social links', 'mj-body': 'Whole email', 'mj-group': 'Column group', 'mj-hero': 'Hero' };

/** Every MJML element with a short id, one per line, indented by depth. */
function outline(editor: Editor) {
  const byId = new Map<string, Component>(), idOf = new Map<Component, string>(), lines: string[] = [];
  let n = 0;
  const walk = (c: Component, depth: number) => {
    const tag = tagOf(c);
    if (tag === 'mj-head') return;
    if (!tag.startsWith('mj-')) { c.components().forEach((x) => walk(x, depth)); return; }
    const id = `c${++n}`; byId.set(id, c); idOf.set(c, id);
    const attrs = Object.entries(c.getAttributes()).filter(([k, v]) => k !== 'id' && v !== '' && v != null).map(([k, v]) => `${k}="${String(v).slice(0, 200)}"`).join(' ');
    const text = TEXTY.has(tag) ? `: ${inner(c).replace(/\s+/g, ' ').trim().slice(0, 3000)}` : '';
    lines.push(`${'  '.repeat(depth)}${id} ${tag}${attrs ? ` ${attrs}` : ''}${text}`);
    if (!TEXTY.has(tag)) c.components().forEach((x) => walk(x, depth + 1));
  };
  walk(editor.getWrapper()!, 0);
  return { text: lines.join('\n'), byId, idOf };
}

/** The selected MJML element (a click inside a text box selects its text, so walk up). */
function selectedMj(editor: Editor) {
  let c: Component | undefined | null = editor.getSelected();
  while (c && !tagOf(c).startsWith('mj-')) c = c.parent();
  return c && tagOf(c) !== 'mj-body' ? c : null;
}

function apply(byId: Map<string, Component>, e: Edit) {
  const c = byId.get(e.target); if (!c) return;
  const at = (ref: Component, pos: string): [Component, number] | null => {
    if (pos === 'inside_start') return [ref, 0];
    if (pos === 'inside_end') return [ref, ref.components().length];
    const parent = ref.parent(); if (!parent) return null;
    return [parent, ref.index() + (pos === 'after' ? 1 : 0)];
  };
  switch (e.op) {
    case 'set_attributes': c.addAttributes(Object.fromEntries(e.attributes.map((a) => [a.name, a.value]))); break;
    case 'set_text': c.components(e.html); break;
    case 'remove': c.remove(); break;
    case 'replace': c.replaceWith(e.mjml); break;
    case 'insert': { const p = at(c, e.position); if (p) p[0].append(e.mjml, { at: p[1] }); break; }
    case 'move': {
      const ref = byId.get(e.ref); if (!ref || ref === c) break;
      const p = at(ref, e.position); if (!p) break;
      const [dest, i] = p;
      const shift = c.parent() === dest && c.index() < i ? 1 : 0;
      c.move(dest, { at: i - shift });
      break;
    }
  }
}

// Colour contrast (WCAG): hex colours only; anything else is skipped.
const rgb = (s?: string) => {
  const v = String(s ?? '').trim().toLowerCase().replace(/^white$/, '#ffffff').replace(/^black$/, '#000000');
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v); if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (c: number[]) => { const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** The colour behind an element's text: a button's own background, else the nearest one around it (null over a picture). */
const background = (c: Component) => {
  if (tagOf(c) === 'mj-button') return String(c.getAttributes()['background-color'] ?? '#414141');
  for (let p: Component | null | undefined = c; p; p = p.parent()) {
    const a = p.getAttributes();
    if (a['background-url']) return null;
    const bg = p === c ? a['container-background-color'] : a['background-color'];
    if (bg) return rgb(bg) ? String(bg) : null;
  }
  return '#ffffff';
};

export function initDesignAi(form: HTMLFormElement, editor: Editor, sync: () => void, onChange: () => void) {
  const box = form.querySelector<HTMLElement>('[data-dai]'); if (!box) return;
  const input = box.querySelector<HTMLInputElement>('[data-dai-input]')!;
  const askBtn = box.querySelector<HTMLButtonElement>('[data-dai-ask]')!;
  const quick = box.querySelector<HTMLSelectElement>('[data-dai-quick]')!;
  const undoBtn = box.querySelector<HTMLButtonElement>('[data-dai-undo]')!;
  const status = box.querySelector<HTMLElement>('[data-dai-status]')!;
  const list = box.querySelector<HTMLElement>('[data-dai-issues]')!;
  const host = form.querySelector<HTMLElement>('[data-designer]')!;
  const say = (s: string) => { status.textContent = s; };
  let snapshot: unknown = null, busy = false;

  const showSelection = () => {
    const c = selectedMj(editor);
    quick.classList.toggle('hidden', !c);
    say(c ? `Selected: ${NAMES[tagOf(c)] ?? tagOf(c)}. Requests and quick actions apply to it (click the empty area around the email to ask about the whole design).` : 'Select an element first to change just that part, or ask about the whole design.');
  };
  editor.on('component:toggled', showSelection);

  async function ask(instruction: string, isQuick: boolean, target?: Component) {
    if (busy || !instruction.trim()) return;
    busy = true; askBtn.disabled = true; quick.disabled = true;
    say(isQuick ? 'Lakeba AI is working on it…' : 'Lakeba AI is working on it (this can take a few seconds)…');
    try {
      const o = outline(editor);
      const sel = target ?? selectedMj(editor);
      const fd = new FormData(form);
      const res = await fetch('/api/admin/newsletter-design-ai', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction, quick: isQuick, outline: o.text, selected: sel ? o.idOf.get(sel) ?? '' : '',
          entity_id: String(fd.get('entity_id') ?? host.dataset.entity ?? ''), audience: host.dataset.audience,
          library: editor.Assets.getAll().map((a) => (a as unknown as { getSrc: () => string }).getSrc()).slice(0, 12),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { say(json.error ?? 'Lakeba AI couldn’t change the design just now.'); return; }
      const edits = (json.edits ?? []) as Edit[];
      const note = json.dropped?.length ? ` (${json.dropped.length} unsafe or invalid change${json.dropped.length > 1 ? 's were' : ' was'} left out.)` : '';
      if (!edits.length) { say(`${json.message || 'Nothing to change.'}${note}`); return; }
      const before = editor.getProjectData(), had = placeholders(editor.getHtml());
      try { for (const e of edits) apply(o.byId, e); } catch (err) {
        editor.loadProjectData(before); console.error(err); say('That change couldn’t be applied. Try asking in other words.'); return;
      }
      const lost = [...had].filter((p) => !placeholders(editor.getHtml()).has(p));
      if (lost.length) { editor.loadProjectData(before); say(`Not applied: it would have removed ${lost.join(', ')}, which the portal fills in for each reader. Try asking in other words.`); return; }
      snapshot = before; undoBtn.classList.remove('hidden');
      sync(); onChange();
      say(`${json.message || 'Done.'}${note}`);
      if (!list.classList.contains('hidden')) check();
    } catch { say('Lakeba AI couldn’t change the design just now. Please try again.'); }
    finally { busy = false; askBtn.disabled = false; quick.disabled = false; }
  }

  askBtn.addEventListener('click', () => ask(input.value, false));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(input.value, false); } });
  quick.addEventListener('change', () => { const v = quick.value; quick.value = ''; if (v) ask(v, true); });
  undoBtn.addEventListener('click', () => {
    if (!snapshot) return;
    editor.loadProjectData(snapshot as never); snapshot = null; undoBtn.classList.add('hidden');
    sync(); onChange(); say('The AI change was undone.');
  });

  // Check design: problems that are easy to miss, each with Show (and Fix with AI where it can).
  function check() {
    const o = outline(editor), issues: { text: string; c: Component; fix?: string }[] = [];
    const add = (c: Component, text: string, fix?: string) => issues.push({ c, text, fix });
    for (const c of o.byId.values()) {
      const tag = tagOf(c), a = c.getAttributes();
      if (tag === 'mj-image') {
        const src = String(a.src ?? '');
        if (!src) add(c, 'An image has no picture yet.');
        else if (/\.svg(\?|$)/i.test(src)) add(c, 'An SVG image: Gmail and Outlook don’t show SVGs. Use PNG or JPEG.');
        if (!String(a.alt ?? '').trim()) add(c, 'An image has no description (alt text) for people who can’t see images.', 'Give this image a short, accurate alt text based on its context in the email.');
      }
      if (tag === 'mj-button' && (!a.href || a.href === '#')) add(c, 'A button doesn’t link anywhere yet.');
      if (TEXTY.has(tag)) {
        const size = parseFloat(String(a['font-size'] ?? '')), text = inner(c).replace(/<[^>]+>/g, ' ');
        if (size && size < 13) add(c, `Small text (${size}px) is hard to read on phones.`, 'Make this text at least 14px, adjusting line height to suit.');
        const color = String(a.color ?? (tag === 'mj-button' ? '#ffffff' : '#000000')), fg = rgb(color), bgv = background(c), bg = rgb(bgv ?? undefined);
        if (fg && bg) { const r = contrast(fg, bg); if (r < ((size || 14) >= 18 ? 3 : 4.5)) add(c, `Text colour ${color} on ${bgv} is hard to read (contrast ${r.toFixed(1)}:1).`, 'Change the text colour (or its background) of this element so it has good contrast and stays on brand.'); }
        const left = text.match(/\[[^\]\n{}]{3,80}\]/)?.[0];
        if (left) add(c, `Template text still to replace: “${left}”.`);
        if (/href="http:\/\//.test(inner(c)) || String(a.href ?? '').startsWith('http://')) add(c, 'A link uses http:// instead of https://.');
      }
    }
    // The ticked portal content needs its block in the design.
    const html = editor.getHtml(), body = o.byId.get('c1') ?? editor.getWrapper()!;
    const want: [string, boolean, string][] = [
      ['{{news}}', !!form.querySelector('input[name="post_ids"]:checked'), 'News is ticked, but the design has no News list block.'],
      ['{{documents}}', !!form.querySelector('input[name="document_ids"]:checked'), 'Documents are ticked, but the design has no New documents block.'],
      ['{{holding}}', !!form.querySelector<HTMLInputElement>('input[name="holding"]')?.checked, '“Show their holding” is on, but the design has no Their holding block.'],
      ['{{meetings}}', !!form.querySelector<HTMLInputElement>('input[name="meetings"]')?.checked, '“Upcoming meetings” is on, but the design has no Upcoming meetings block.'],
    ];
    for (const [ph, on, text] of want) if (on && !html.includes(ph)) add(body, text);
    const sent = form.querySelector<HTMLIFrameElement>('iframe[data-preview]')?.srcdoc ?? '';
    if (sent.length > 100_000) add(body, `The email is about ${Math.round(sent.length / 1024)} KB: Gmail cuts off emails over about 100 KB. Remove or shorten some parts.`);

    list.replaceChildren();
    list.classList.remove('hidden');
    if (!issues.length) { const li = document.createElement('li'); li.className = 'text-lk-green'; li.textContent = '✓ No problems found.'; list.append(li); return; }
    for (const i of issues) {
      const li = document.createElement('li'); li.className = 'flex flex-wrap items-center gap-2';
      const t = document.createElement('span'); t.className = 'text-white/75'; t.textContent = `• ${i.text}`; li.append(t);
      const show = document.createElement('button'); show.type = 'button'; show.className = 'rounded-full border border-white/12 px-2.5 py-0.5 text-xs'; show.textContent = 'Show';
      show.addEventListener('click', () => { editor.select(i.c); i.c.getEl()?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      li.append(show);
      if (i.fix) {
        const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'rounded-full bg-lk-blue px-2.5 py-0.5 text-xs text-[#fff]'; fix.textContent = 'Fix with AI';
        fix.addEventListener('click', () => ask(i.fix!, true, i.c));
        li.append(fix);
      }
      list.append(li);
    }
  }
  box.querySelector('[data-dai-check]')!.addEventListener('click', check);
}
