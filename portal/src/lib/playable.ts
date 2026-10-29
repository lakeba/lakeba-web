import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Browsers record meetings as WebM (or Ogg, or MP4 on Apple devices) without the file's length or a seek
// index, so players can play them but can't show the time or move along. ffmpeg copies the sound as it is
// (no re-encoding) into a file with both. Without ffmpeg on the server the recording is kept as recorded.

const FORMATS: Record<string, string[]> = { webm: ['-f', 'webm'], ogg: ['-f', 'ogg'], m4a: ['-f', 'mp4', '-movflags', '+faststart'] };
let available: Promise<boolean> | null = null;
const ffmpeg = (args: string[]) => new Promise<void>((done, fail) => execFile('ffmpeg', args, { timeout: 300_000 }, (e) => (e ? fail(e) : done())));
export const hasFfmpeg = () => (available ??= ffmpeg(['-hide_banner', '-version']).then(() => true, () => false));

/** The recording with its length and seek index (the sound copied unchanged); as it was if that isn't possible. */
export async function playable(audio: Buffer, ext: string) {
  const format = FORMATS[ext];
  if (!format || !audio.length || !(await hasFfmpeg())) return audio;
  const dir = await mkdtemp(join(tmpdir(), 'lex-audio-'));
  try {
    await writeFile(join(dir, `in.${ext}`), audio);
    await ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, `in.${ext}`), '-map', '0:a', '-c', 'copy', ...format, join(dir, `out.${ext}`)]);
    const out = await readFile(join(dir, `out.${ext}`));
    return out.length > audio.length / 2 ? out : audio;
  } catch (e) {
    console.error('playable', (e as Error).message);
    return audio;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
