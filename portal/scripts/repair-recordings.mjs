// Gives meeting recordings made before 30 October 2026 their length and seek index, so the meeting page's player
// shows the time and can skip (the sound is copied unchanged; see src/lib/playable.ts). Needs ffmpeg.
// Run where the portal runs, with its settings:
//   node --env-file=<portal.env> scripts/repair-recordings.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const dry = process.argv.includes('--dry-run');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const FORMATS = { webm: ['-f', 'webm'], ogg: ['-f', 'ogg'], m4a: ['-f', 'mp4', '-movflags', '+faststart'] };
const hasLength = (b) => b.subarray(0, 4096).indexOf(Buffer.from('4489', 'hex')) >= 0 && b.indexOf(Buffer.from('1c53bb6b', 'hex')) >= 0;

const { data: meetings, error } = await svc.from('board_meetings').select('id, title, recording_takes, audio_deleted_at').is('audio_deleted_at', null);
if (error) throw error;
let fixed = 0, skipped = 0;
for (const m of meetings) {
  let changed = false;
  const takes = [];
  for (const t of m.recording_takes ?? []) {
    const ext = t.path?.split('.').pop();
    if (!t.path || !FORMATS[ext]) { takes.push(t); continue; }
    const { data } = await svc.storage.from('legal').download(t.path);
    const audio = Buffer.from(await data.arrayBuffer());
    if (ext === 'webm' && hasLength(audio)) { skipped++; takes.push(t); continue; }
    const dir = mkdtempSync(join(tmpdir(), 'lex-repair-'));
    try {
      writeFileSync(join(dir, `in.${ext}`), audio);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, `in.${ext}`), '-map', '0:a', '-c', 'copy', ...FORMATS[ext], join(dir, `out.${ext}`)]);
      const out = readFileSync(join(dir, `out.${ext}`));
      if (out.length < audio.length / 2) throw new Error('output too small');
      console.log(`${dry ? 'would repair' : 'repaired'}: ${m.title} · take ${t.take} · ${audio.length} → ${out.length} bytes`);
      if (!dry) {
        const { error: e } = await svc.storage.from('legal').upload(t.path, out, { contentType: data.type || `audio/${ext}`, upsert: true });
        if (e) throw e;
        takes.push({ ...t, bytes: out.length }); changed = true;
      } else takes.push(t);
      fixed++;
    } catch (e) {
      console.log(`left as it was: ${m.title} · take ${t.take} (${e.message})`);
      takes.push(t);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  if (changed) await svc.from('board_meetings').update({ recording_takes: takes }).eq('id', m.id);
}
console.log(`${fixed} ${dry ? 'to repair' : 'repaired'}, ${skipped} already fine.`);
