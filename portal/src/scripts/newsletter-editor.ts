import type { Editor } from '@tiptap/core';
import { initRichFields } from './rich-fields';
import type { Designer } from './newsletter-designer';

type RichBox = HTMLElement & { editor?: Editor };

// The newsletter issue editor: rich text boxes, sections, the HTML editor's
// Insert menu, Claude's help and the live preview of unsaved changes.
export function initNewsletterEditor() {
  const form = document.querySelector<HTMLFormElement>('#nl-form');
  if (!form) return;
  const issueId = form.dataset.issue!;
  const previewUrl = form.dataset.previewUrl!;
  const editors = initRichFields(form);
  let designer: Designer | null = null;
  let dirty = false;

  // Live preview: the unsaved form, rendered by the server, a moment after typing stops.
  const frame = form.querySelector<HTMLIFrameElement>('iframe[data-preview]');
  const previewStatus = form.querySelector<HTMLElement>('[data-preview-status]');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!frame) return;
      const mine = ++seq;
      if (previewStatus) previewStatus.textContent = 'Updating…';
      try {
        designer?.sync();
        const res = await fetch(previewUrl, { method: 'POST', body: new FormData(form) });
        if (mine !== seq) return;
        if (!res.ok) throw new Error();
        const y = frame.contentWindow?.scrollY ?? 0;
        frame.srcdoc = await res.text();
        frame.addEventListener('load', () => frame.contentWindow?.scrollTo(0, y), { once: true });
        if (previewStatus) previewStatus.textContent = 'Up to date (not saved yet)';
      } catch { if (previewStatus) previewStatus.textContent = 'Preview unavailable'; }
    }, 700);
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);

  // Sections: add, move, remove
  const list = form.querySelector<HTMLElement>('[data-sections]');
  const template = form.querySelector<HTMLTemplateElement>('[data-section-template]');
  form.querySelector('[data-add-section]')?.addEventListener('click', () => {
    if (!list || !template) return;
    const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    list.append(node);
    initRichFields(node);
    node.querySelector<HTMLInputElement>('input[name="section_title"]')?.focus();
    refresh();
  });
  list?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    const section = btn?.closest<HTMLElement>('[data-section]');
    if (!btn || !section) return;
    if (btn.hasAttribute('data-remove')) { if (confirm('Remove this section?')) { section.remove(); refresh(); } return; }
    const step = Number(btn.dataset.move);
    if (step === -1 && section.previousElementSibling) section.previousElementSibling.before(section);
    if (step === 1 && section.nextElementSibling) section.nextElementSibling.after(section);
    refresh();
  });

  // HTML editor: Tab indents, Insert menu adds placeholders, pieces or an uploaded image at the cursor.
  const code = form.querySelector<HTMLTextAreaElement>('[data-html]');
  const insertAt = (text: string) => {
    if (!code) return;
    const { selectionStart: a, selectionEnd: b, value } = code;
    code.value = value.slice(0, a) + text + value.slice(b);
    code.selectionStart = code.selectionEnd = a + text.length;
    code.focus();
    refresh();
  };
  code?.addEventListener('keydown', (e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); insertAt('  '); } });
  const insert = form.querySelector<HTMLSelectElement>('[data-insert]');
  const imageFile = form.querySelector<HTMLInputElement>('[data-html-image]');
  insert?.addEventListener('change', () => {
    const v = insert.value; insert.value = '';
    if (!v) return;
    if (v === '__image') { imageFile?.click(); return; }
    insertAt(v.startsWith('{{') ? v : `\n${v}\n`);
  });
  imageFile?.addEventListener('change', async () => {
    const f = imageFile.files?.[0]; imageFile.value = '';
    if (!f) return;
    const body = new FormData(); body.append('file', f);
    const res = await fetch('/api/admin/news-media', { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { alert(json.error ?? 'The image could not be uploaded.'); return; }
    const alt = prompt('Describe the image for people who can’t see it') ?? '';
    // Emails need full addresses for images.
    insertAt(`\n<img src="${location.origin}${json.url}" alt="${alt.replace(/"/g, '&quot;')}" width="560" style="max-width:100%;height:auto;border-radius:10px;display:block;margin:12px 0">\n`);
  });

  // Claude's help
  const assist = async (action: string, btn: HTMLButtonElement) => {
    const out = form.querySelector<HTMLElement>(`[data-assist-out="${action}"]`)!;
    const fd = new FormData(form);
    btn.disabled = true; out.textContent = 'Lakeba AI is working…';
    try {
      const text = [fd.get('intro_html'), ...fd.getAll('section_html'), fd.get('closing_html'), fd.get('html_body')].filter(Boolean).join(' ');
      const res = await fetch('/api/admin/newsletter-assist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, audience: form.querySelector<HTMLInputElement>('[name="segment"]') ? 'shareholders' : 'public', entity_id: fd.get('entity_id'), subject: fd.get('subject'), intro_html: text, closing_html: '', post_ids: fd.getAll('post_ids'), document_ids: fd.getAll('document_ids') }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No answer.');
      if (action === 'draft') {
        editors.get('intro_html')?.commands.setContent(json.intro_html);
        const input = form.querySelector<HTMLInputElement>('input[name="intro_html"]');
        if (input) input.value = json.intro_html;
        out.textContent = 'Drafted by Lakeba AI: read it through and make it yours before sending.';
        refresh();
      }
      if (action === 'subjects') {
        out.innerHTML = '';
        for (const s of json.subjects as { subject: string; preheader: string }[]) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'mr-2 mt-1 rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10'; b.textContent = s.subject;
          b.addEventListener('click', () => { form.querySelector<HTMLInputElement>('#subject')!.value = s.subject; form.querySelector<HTMLInputElement>('#preheader')!.value = s.preheader; refresh(); });
          out.append(b);
        }
      }
      if (action === 'check') {
        out.innerHTML = '';
        const items = json.issues as { quote: string; why: string }[];
        if (!items.length) { const li = document.createElement('li'); li.className = 'text-lk-green'; li.textContent = 'Nothing to flag.'; out.append(li); }
        for (const it of items) { const li = document.createElement('li'); li.className = 'rounded-lg bg-lk-orange/10 px-3 py-2 text-white/80'; li.textContent = `“${it.quote}”: ${it.why}`; out.append(li); }
      }
    } catch (e) { out.textContent = (e as Error).message; }
    finally { btn.disabled = false; }
  };
  for (const b of form.querySelectorAll<HTMLButtonElement>('[data-assist]')) b.addEventListener('click', () => assist(b.dataset.assist!, b));

  // ✨ on every text box: rewrite it as asked (Haiku).
  const addRewriteMenus = (root: ParentNode) => {
    for (const box of root.querySelectorAll<RichBox>('[data-rich]')) {
      const bar = box.firstElementChild;
      if (!bar || bar.querySelector('[data-rewrite]')) continue;
      const sel = document.createElement('select');
      sel.dataset.rewrite = '';
      sel.setAttribute('aria-label', 'Rewrite with Lakeba AI');
      sel.className = 'ml-auto rounded-md border border-lk-blue/40 bg-transparent px-1.5 py-0.5 text-xs text-lk-blue';
      sel.innerHTML = '<option value="">✨ Rewrite…</option><option value="improve">Improve</option><option value="shorter">Shorter</option><option value="friendlier">Friendlier</option><option value="formal">More formal</option><option value="expand">Expand my notes</option>';
      sel.addEventListener('change', async () => {
        const how = sel.value; sel.value = '';
        const ed = box.editor;
        if (!how || !ed) return;
        const before = ed.getHTML();
        sel.disabled = true;
        try {
          const res = await fetch('/api/admin/newsletter-assist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rewrite', instruction: how, html: before }) });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'No answer.');
          ed.commands.setContent(json.html, { emitUpdate: true });
          box.title = 'Rewritten by Lakeba AI: Ctrl/Cmd+Z in the box undoes it';
        } catch (e) { alert((e as Error).message); }
        finally { sel.disabled = false; }
      });
      bar.append(sel);
    }
  };
  addRewriteMenus(form);
  form.querySelector('[data-add-section]')?.addEventListener('click', () => setTimeout(() => addRewriteMenus(form), 0));

  // ✨ Build with AI: the whole issue from the writer's breakdown, with undo.
  const buildBtn = form.querySelector<HTMLButtonElement>('[data-ai-build]');
  const undoBtn = form.querySelector<HTMLButtonElement>('[data-ai-undo]');
  const aiStatus = form.querySelector<HTMLElement>('[data-ai-status]');
  const setVal = (sel: string, v: string) => { const el = form.querySelector<HTMLInputElement>(sel); if (el) el.value = v; };
  const editorOf = (name: string) => form.querySelector<RichBox>(`[data-rich="${name}"]`)?.editor;
  const addSection = (title: string, html: string) => {
    if (!list || !template) return;
    const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    node.querySelector<HTMLInputElement>('input[name="section_title"]')!.value = title;
    node.querySelector<HTMLElement>('[data-rich]')!.innerHTML = html;
    list.append(node);
    initRichFields(node);
    addRewriteMenus(node);
  };
  type Snapshot = { subject: string; preheader: string; intro: string; closing: string; cta: [string, string]; sections: { title: string; html: string }[]; posts: string[] };
  const snapshot = (): Snapshot => ({
    subject: form.querySelector<HTMLInputElement>('#subject')!.value, preheader: form.querySelector<HTMLInputElement>('#preheader')!.value,
    intro: editorOf('intro_html')?.getHTML() ?? '', closing: editorOf('closing_html')?.getHTML() ?? '',
    cta: [form.querySelector<HTMLInputElement>('#cta_label')?.value ?? '', form.querySelector<HTMLInputElement>('#cta_url')?.value ?? ''],
    sections: [...(list?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].map((sec) => ({ title: sec.querySelector<HTMLInputElement>('input[name="section_title"]')!.value, html: sec.querySelector<RichBox>('[data-rich]')?.editor?.getHTML() ?? '' })),
    posts: [...form.querySelectorAll<HTMLInputElement>('input[name="post_ids"]:checked')].map((x) => x.value),
  });
  const apply = (st: Snapshot) => {
    setVal('#subject', st.subject); setVal('#preheader', st.preheader);
    editorOf('intro_html')?.commands.setContent(st.intro, { emitUpdate: true });
    editorOf('closing_html')?.commands.setContent(st.closing, { emitUpdate: true });
    setVal('#cta_label', st.cta[0]); setVal('#cta_url', st.cta[1]);
    list?.querySelectorAll('[data-section]').forEach((x) => x.remove());
    for (const sec of st.sections) addSection(sec.title, sec.html);
    for (const box of form.querySelectorAll<HTMLInputElement>('input[name="post_ids"]')) box.checked = st.posts.includes(box.value);
    refresh();
  };
  let undo: Snapshot | null = null;
  let designUndo: string | null = null;
  buildBtn?.addEventListener('click', async () => {
    const brief = form.querySelector<HTMLTextAreaElement>('[data-ai-brief]')!.value.trim();
    if (brief.length < 15) { aiStatus!.textContent = 'Write a few points about what you want to say first.'; return; }
    const current = snapshot();
    const hasText = designer || current.intro.replace(/<[^>]+>/g, '').trim() || current.sections.length || current.closing.replace(/<[^>]+>/g, '').trim();
    if (hasText && !confirm(designer ? 'Replace the subject and the content area of the design with a new draft? You can undo it.' : 'Replace the subject, introduction, sections and closing with a new draft? You can undo it.')) return;
    const fd = new FormData(form);
    buildBtn.disabled = true; aiStatus!.textContent = 'Lakeba AI is writing the issue… (about half a minute)';
    try {
      const res = await fetch('/api/admin/newsletter-build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        issue_id: issueId, breakdown: brief, tone: form.querySelector<HTMLSelectElement>('[data-ai-tone]')!.value, length: form.querySelector<HTMLSelectElement>('[data-ai-length]')!.value,
        use_sources: form.querySelector<HTMLInputElement>('[data-ai-sources]')!.checked, post_ids: fd.getAll('post_ids'), document_ids: fd.getAll('document_ids'), meetings: fd.get('meetings') === 'on',
      }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No answer.');
      undo = current;
      const first = json.subjects[0] ?? { subject: current.subject, preheader: current.preheader };
      if (designer) {
        // Designer: subject and preview text, and the draft into the design's content area (Ctrl/Cmd+Z in the designer undoes it).
        designUndo = JSON.stringify(designer.editor.getProjectData());
        setVal('#subject', first.subject); setVal('#preheader', first.preheader);
        const sec = (html: string) => `<mj-section background-color="#ffffff" padding="0 28px"><mj-column><mj-text>${html}</mj-text></mj-column></mj-section>`;
        designer.fillContent([sec('{{greeting}}'), json.intro_html ? sec(json.intro_html) : '',
          ...json.sections.map((x: { title: string; html: string }) => sec(`${x.title ? `<h3 style="margin:14px 0 6px;font-size:19px">${x.title.replace(/[&<>]/g, (c: string) => `&#${c.charCodeAt(0)};`)}</h3>` : ''}${x.html}`)),
          json.cta ? `<mj-section background-color="#ffffff" padding="4px 28px"><mj-column><mj-button href="${json.cta.url}" align="left">${json.cta.label.replace(/[&<>"]/g, (c: string) => `&#${c.charCodeAt(0)};`)}</mj-button></mj-column></mj-section>` : '',
          json.closing_html ? sec(json.closing_html) : ''].join(''));
        for (const box of form.querySelectorAll<HTMLInputElement>('input[name="post_ids"]')) if (json.include_post_ids.includes(box.value)) box.checked = true;
      } else apply({
        subject: first.subject, preheader: first.preheader, intro: json.intro_html, closing: json.closing_html,
        cta: json.cta ? [json.cta.label, json.cta.url] : current.cta, sections: json.sections,
        posts: [...new Set([...current.posts, ...json.include_post_ids])],
      });
      // Other subject lines to pick from, and what to check.
      const subjects = form.querySelector<HTMLElement>('[data-ai-subjects]')!;
      subjects.innerHTML = '';
      for (const sj of json.subjects as { subject: string; preheader: string }[]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'mr-2 mt-1 rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10'; b.textContent = sj.subject;
        b.addEventListener('click', () => { setVal('#subject', sj.subject); setVal('#preheader', sj.preheader); refresh(); });
        subjects.append(b);
      }
      const checks = form.querySelector<HTMLElement>('[data-ai-checks]')!;
      checks.innerHTML = '';
      for (const c of json.checks.length ? json.checks : ['Nothing in particular: still read it through before sending.']) { const li = document.createElement('li'); li.className = 'rounded-lg bg-lk-orange/10 px-3 py-2 text-white/80'; li.textContent = c; checks.append(li); }
      form.querySelector('[data-ai-result]')!.classList.remove('hidden');
      undoBtn?.classList.remove('hidden');
      aiStatus!.textContent = 'Draft ready: read it through, fill any [square brackets], then Save.';
    } catch (e) { aiStatus!.textContent = (e as Error).message; }
    finally { buildBtn.disabled = false; }
  });
  undoBtn?.addEventListener('click', () => {
    if (!undo) return;
    if (designer && designUndo) { designer.editor.loadProjectData(JSON.parse(designUndo)); designer.sync(); setVal('#subject', undo.subject); setVal('#preheader', undo.preheader); refresh(); designUndo = null; }
    else apply(undo);
    undo = null;
    undoBtn.classList.add('hidden'); form.querySelector('[data-ai-result]')!.classList.add('hidden');
    aiStatus!.textContent = 'Back to how it was before the AI build.';
  });

  // The designer loads only in Designer mode (it is large).
  if (form.querySelector('[data-designer]')) {
    import('./newsletter-designer').then(({ initDesigner }) => { designer = initDesigner(form, () => { dirty = true; refresh(); }); (form as HTMLFormElement & { designer?: Designer | null }).designer = designer; });
  }
  form.addEventListener('submit', () => designer?.sync(), true);

  // Full screen: the editor fills the window (and the screen, where the browser allows); Esc leaves.
  const fsBtn = form.querySelector<HTMLButtonElement>('[data-fullscreen]');
  const setFull = (on: boolean) => {
    form.classList.toggle('is-fullscreen', on);
    document.documentElement.classList.toggle('nl-fullscreen-open', on);
    if (fsBtn) fsBtn.textContent = on ? '⤡ Leave full screen' : '⤢ Full screen';
    if (on && !document.fullscreenElement) form.requestFullscreen?.().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setTimeout(() => designer?.editor.refresh(), 50);
  };
  fsBtn?.addEventListener('click', () => setFull(!form.classList.contains('is-fullscreen')));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && form.classList.contains('is-fullscreen')) setFull(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && form.classList.contains('is-fullscreen') && !document.fullscreenElement) setFull(false); });

  // Preview width: desktop or a phone.
  for (const b of form.querySelectorAll<HTMLButtonElement>('[data-device]')) {
    b.addEventListener('click', () => {
      const mobile = b.dataset.device === 'mobile';
      if (frame) frame.style.width = mobile ? '390px' : '100%';
      for (const x of form.querySelectorAll<HTMLButtonElement>('[data-device]')) { const on = x === b; x.setAttribute('aria-pressed', String(on)); x.classList.toggle('bg-white/10', on); x.classList.toggle('text-white/55', !on); }
    });
  }

  // Leaving with unsaved changes asks first.
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', () => { dirty = false; });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
}
