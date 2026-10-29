import { ANAM_API_BASE, ANAM_API_KEY, ANAM_AVATAR_ID, ANAM_VOICE_ID, SIMLI_API_BASE, SIMLI_API_KEY, SIMLI_FACE_ID, SIMLI_VOICE_ID } from 'astro:env/server';
import { outbound } from './outbound';

// Lex's lifelike face on the Observer tablet (phase 5): Anam or Simli, both
// lip-syncing Lex's ElevenLabs voice, each face with a voice that suits it,
// on a face made for Lex that resembles no real person. Both can be set up to
// compare them; the tablet chooses. The keys stay here: the tablet gets a
// short-lived session token.

export type FaceProvider = 'anam' | 'simli';
export const FACES: Record<FaceProvider, { name: string; ready: () => boolean }> = {
  anam: { name: 'Anam', ready: () => Boolean(ANAM_API_KEY && ANAM_AVATAR_ID) },
  simli: { name: 'Simli', ready: () => Boolean(SIMLI_API_KEY && SIMLI_FACE_ID) },
};
/** The ElevenLabs voice for this face, if it has its own. */
export const faceVoice = (f: string | null) => (f === 'anam' ? ANAM_VOICE_ID : f === 'simli' ? SIMLI_VOICE_ID : undefined) || undefined;
export const readyFaces = () => (Object.keys(FACES) as FaceProvider[]).filter((f) => FACES[f].ready());

/** A session token for the tablet to open Lex's face with (Anam: an hour; Simli: 5 minutes to start). */
export async function faceSession(provider: FaceProvider) {
  if (!FACES[provider].ready()) throw new Error(`${FACES[provider].name} isn’t set up on the server.`);
  if (provider === 'anam') {
    const res = await outbound('POST', `${ANAM_API_BASE}/v1/auth/session-token`, {
      headers: { authorization: `Bearer ${ANAM_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ clientLabel: 'lakeba-lex', personaConfig: { avatarId: ANAM_AVATAR_ID, avatarModel: 'cara-4', enableAudioPassthrough: true }, sessionOptions: { videoQuality: 'high' } }),
    });
    if (res.status >= 400) throw new Error(`Anam: ${res.status} ${res.text.slice(0, 200)}`);
    return { provider, token: JSON.parse(res.text).sessionToken as string };
  }
  const res = await outbound('POST', `${SIMLI_API_BASE}/compose/token`, {
    headers: { 'x-simli-api-key': SIMLI_API_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ faceId: SIMLI_FACE_ID, handleSilence: true, maxSessionLength: 10800, maxIdleTime: 1800, audioInputFormat: 'pcm16' }),
  });
  if (res.status >= 400) throw new Error(`Simli: ${res.status} ${res.text.slice(0, 200)}`);
  return { provider, token: JSON.parse(res.text).session_token as string };
}
