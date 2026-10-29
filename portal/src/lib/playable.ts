import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Browsers record meetings without the file's length or a seek index, and on some devices (Android, the
// online meeting bot) with every audio packet stamped at time 0, so players play them but can't show the time
// or move along. ffmpeg decodes the sound in order, gives it its timing again and keeps it as M4A (AAC), which
// every browser plays, Safari included. Without ffmpeg on the server the recording is kept as recorded.

let available: Promise<boolean> | null = null;
const ffmpeg = (args: string[]) => new Promise<void>((done, fail) => execFile('ffmpeg', args, { timeout: 600_000 }, (e) => (e ? fail(e) : done())));
export const hasFfmpeg = () => (available ??= ffmpeg(['-hide_banner', '-version']).then(() => true, () => false));

/** ffmpeg's arguments: the sound decoded in order (its timing from the samples), mono AAC with its index first. */
export const PLAYABLE_ARGS = (input: string, output: string) =>
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:a', '-af', 'asetpts=N/SR/TB', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', output];

/** The recording as M4A with its length, timing and seek index; as it was if that isn't possible. */
export async function playable(audio: Buffer, ext: string): Promise<{ audio: Buffer; ext: string; mime: string | null }> {
  if (!audio.length || !(await hasFfmpeg())) return { audio, ext, mime: null };
  const dir = await mkdtemp(join(tmpdir(), 'lex-audio-'));
  try {
    await writeFile(join(dir, `in.${ext}`), audio);
    await ffmpeg(PLAYABLE_ARGS(join(dir, `in.${ext}`), join(dir, 'out.m4a')));
    const out = await readFile(join(dir, 'out.m4a'));
    if (out.length < 1000) throw new Error('nothing came out');
    return { audio: out, ext: 'm4a', mime: 'audio/mp4' };
  } catch (e) {
    console.error('playable', (e as Error).message);
    return { audio, ext, mime: null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
