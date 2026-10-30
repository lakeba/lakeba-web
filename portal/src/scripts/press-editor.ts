import { initRichFields } from './rich-fields';

// The press release editor: the rich text box, headline options, quotes,
// picture and press kit uploads, "working…" on slow buttons, and a warning
// before leaving with unsaved changes.
export function initPressEditor() {
  const form = document.querySelector<HTMLFormElement>('[data-press-form]');
  if (!form) return;
  initRichFields(form);
  let dirty = false;
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', (e) => {
    dirty = false;
    const b = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (b?.dataset.busy) setTimeout(() => { b.disabled = true; b.textContent = b.dataset.busy!; }, 0);
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  // Headline options: click to use one.
  for (const b of form.querySelectorAll<HTMLButtonElement>('[data-headline]')) {
    b.addEventListener('click', () => { const h = form.querySelector<HTMLInputElement>('#headline')!; h.value = b.dataset.headline!; dirty = true; });
  }

  // Quotes: add and remove.
  const list = form.querySelector<HTMLElement>('[data-quotes]');
  const tpl = form.querySelector<HTMLTemplateElement>('[data-quote-template]');
  form.querySelector('[data-add-quote]')?.addEventListener('click', () => {
    if (!list || !tpl) return;
    list.append(tpl.content.firstElementChild!.cloneNode(true));
    list.lastElementChild?.querySelector<HTMLInputElement>('input[name="quote_name"]')?.focus();
    dirty = true;
  });
  list?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-remove-quote]');
    if (b && confirm('Remove this quote? Remember to take it out of the text too.')) { b.closest('[data-quote]')?.remove(); dirty = true; }
  });

  // Uploads: the main picture and press kit images.
  const upload = async (file: File) => {
    const body = new FormData(); body.append('file', file);
    const res = await fetch('/api/admin/press-media', { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { alert(json.error ?? 'The image could not be uploaded.'); return null; }
    return json.url as string;
  };
  form.querySelector<HTMLInputElement>('[data-upload="cover"]')?.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    const url = await upload(f); if (!url) return;
    form.querySelector<HTMLInputElement>('input[name="cover_url"]')!.value = url;
    const box = form.querySelector<HTMLElement>('[data-cover-box]')!;
    box.replaceChildren(Object.assign(document.createElement('img'), { src: url, alt: '', className: 'aspect-video w-full object-cover' }));
    dirty = true;
  });
  const kit = form.querySelector<HTMLElement>('[data-kit]');
  form.querySelector<HTMLInputElement>('[data-upload="kit"]')?.addEventListener('change', async (e) => {
    for (const f of [...((e.target as HTMLInputElement).files ?? [])]) {
      const url = await upload(f); if (!url || !kit) continue;
      const li = document.createElement('li'); li.className = 'flex items-center gap-2';
      li.innerHTML = '<img alt="" class="size-10 rounded object-cover"><input type="hidden" name="kit_url"><input name="kit_label" placeholder="Caption / credit" class="field"><button type="button" class="text-xs text-white/45 hover:text-lk-red" data-remove-kit>Remove</button>';
      li.querySelector('img')!.src = url;
      li.querySelector<HTMLInputElement>('input[name="kit_url"]')!.value = url;
      li.querySelector<HTMLInputElement>('input[name="kit_label"]')!.value = f.name.replace(/\.[^.]+$/, '');
      kit.append(li); dirty = true;
    }
  });
  kit?.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-remove-kit]'); if (b) { b.closest('li')?.remove(); dirty = true; } });
}
