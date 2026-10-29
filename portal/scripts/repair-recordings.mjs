// Gives meeting recordings made before 30 October 2026 their timing, length and seek index, so the meeting
// page's player shows the time and can skip: the sound is decoded in order and kept as M4A (AAC), as
// src/lib/playable.ts does for new recordings. Needs ffmpeg. Run where the portal runs, with its settings
// (from the portal's own folder, so it finds its libraries):
//   node --env-file=<portal.env> scripts/repair-recordings.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const dry = process.argv.includes('--dry-run');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const args = (input, output) => ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:a', '-af', 'asetpts=N/SR/TB', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', output];
const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) || 0;

const { data: meetings, error } = await svc.from('board_meetings').select('id, title, recording_takes').is('audio_deleted_at', null);
if (error) throw error;
let fixed = 0, skipped = 0;
for (const m of meetings) {
  let changed = false;
  const takes = [];
  for (const t of m.recording_takes ?? []) {
    if (!t.path || t.path.endsWith('.m4a')) { if (t.path) skipped++; takes.push(t); continue; }
    const { data } = await svc.storage.from('legal').download(t.path);
    const audio = Buffer.from(await data.arrayBuffer());
    const ext = t.path.split('.').pop();
    const dir = mkdtempSync(join(tmpdir(), 'lex-repair-'));
    try {
      writeFileSync(join(dir, `in.${ext}`), audio);
      execFileSync('ffmpeg', args(join(dir, `in.${ext}`), join(dir, 'out.m4a')), { stdio: ['ignore', 'ignore', 'ignore'] });
      const out = readFileSync(join(dir, 'out.m4a'));
      const length = seconds(join(dir, 'out.m4a'));
      if (out.length < 1000 || length < 1) throw new Error('nothing came out');
      const path = t.path.replace(/\.[a-z0-9]+$/, '.m4a');
      console.log(`${dry ? 'would repair' : 'repaired'}: ${m.title} · take ${t.take} · ${length.toFixed(1)} s · ${t.path.split('/').pop()} → ${path.split('/').pop()}`);
      if (!dry) {
        const { error: e } = await svc.storage.from('legal').upload(path, out, { contentType: 'audio/mp4', upsert: true });
        if (e) throw e;
        await svc.storage.from('legal').remove([t.path]);
        takes.push({ ...t, path, mime: 'audio/mp4', bytes: out.length }); changed = true;
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
