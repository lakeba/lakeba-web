import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { consentWording, meetingTerms, observerMeeting, saveSegments, transcribeMeeting, type Take } from '../../../../../lib/observer';
import { liveSession, PROVIDERS, readyProviders, type Provider } from '../../../../../lib/transcription';
import { logAs, releaseTablet, tabletsOf } from '../../../../../lib/tablets';
import { meetingFacts } from '../../../../../lib/lex';

/**
 * The Observer tablet's requests for a meeting (JSON, action):
 *   consent  {chair, agreed: [names]}      the chair confirms everyone present agreed
 *   start    {provider}                    a new take; returns where to stream live audio
 *   token    {provider}                    a fresh live connection for the same take (after a drop)
 *   segments {take, provider, segments}    live text as it is finalised
 *   pause                                  ends the take
 *   finish   {provider}                    ends recording; the full pass with speakers starts
 * Audio itself goes to ./audio.
 */
export const POST: APIRoute = async ({ request, params, locals, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  const svc = serviceClient();
  const m = await observerMeeting(svc, locals.access, params.id ?? '');
  if (!m) return Response.json({ error: 'Not found.' }, { status: 404 });
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  const provider = (typeof b.provider === 'string' && b.provider in PROVIDERS ? b.provider : readyProviders()[0]) as Provider | undefined;
  const now = new Date().toISOString();
  const log = (action: string, detail: Record<string, unknown> = {}) => logAs(locals, svc, action, { entity_id: m.entity_id, meeting_id: m.id, ...detail });
  const present = m.attendees.filter((a) => a.present).map((a) => a.name);
  const takes = m.recording_takes;
  const open = takes.find((t) => !t.ended_at);
  try {
    switch (b.action) {
      case 'consent': {
        const agreed = (Array.isArray(b.agreed) ? b.agreed : []).map(String).filter((n) => present.includes(n));
        if (!present.length) return Response.json({ error: 'Tick who is at the meeting first (on the meeting page).' }, { status: 400 });
        if (agreed.length !== present.length) return Response.json({ error: 'Everyone present must agree before recording.' }, { status: 400 });
        const { data: company } = await svc.from('entities').select('display_name, legal_name').eq('id', m.entity_id).single();
        const consent = { at: now, by: locals.user!.id, by_name: [locals.profile?.first_name, locals.profile?.last_name].filter(Boolean).join(' ') || locals.profile?.email || '', chair: String(b.chair ?? '').slice(0, 200), wording: consentWording(company?.legal_name ?? company?.display_name ?? ''), present, agreed };
        await svc.from('board_meetings').update({ recording_consent: consent, updated_at: now }).eq('id', m.id).throwOnError();
        await log('admin_recorded_meeting_consent', { agreed: agreed.length });
        return Response.json({ ok: true });
      }
      case 'start': {
        if (!m.recording_consent) return Response.json({ error: 'Record everyone’s agreement first.' }, { status: 400 });
        if (m.audio_deleted_at) return Response.json({ error: 'This meeting’s minutes are signed; its recording is closed.' }, { status: 400 });
        if (!provider) return Response.json({ error: 'No transcription service is set up yet (Deepgram or AssemblyAI key).' }, { status: 503 });
        // The live connection first: if the service refuses, nothing is recorded as started.
        const live = await liveSession(provider, present.length, await meetingTerms(svc, m.entity_id, m.attendees));
        const take: Take = open ?? { take: takes.length + 1, started_at: now, ended_at: null, chunks: 0, path: null, bytes: 0, mime: String(b.mime ?? 'audio/webm').slice(0, 60) };
        const next = open ? takes : [...takes, take];
        await svc.from('board_meetings').update({ recording_status: 'recording', recording_takes: next, recording_error: null, updated_at: now }).eq('id', m.id).throwOnError();
        if (!open) await log('admin_started_meeting_recording', { take: take.take, provider });
        // Lex's facts for the meeting, gathered now so the first question doesn't wait for them.
        void meetingFacts(svc, locals.access, locals.site?.central ?? url.origin, locals.user!.id, m).catch(() => undefined);
        return Response.json({ take: take.take, started_at: take.started_at, provider, live });
      }
      case 'token': {
        if (!provider || !open) return Response.json({ error: 'Not recording.' }, { status: 400 });
        return Response.json({ live: await liveSession(provider, present.length, await meetingTerms(svc, m.entity_id, m.attendees)) });
      }
      case 'segments': {
        const take = Number(b.take);
        if (!takes.some((t) => t.take === take) || !provider) return Response.json({ error: 'Unknown take.' }, { status: 400 });
        const segs = (Array.isArray(b.segments) ? b.segments : []).slice(0, 200).map((s: Record<string, unknown>) => ({ seq: Number(s.seq) | 0, start_ms: Number(s.start_ms) || 0, end_ms: Number(s.end_ms) || 0, speaker: String(s.speaker ?? ''), text: String(s.text ?? '').trim() })).filter((s) => s.text);
        await saveSegments(svc, m.id, `live:${provider}`, take, segs);
        return Response.json({ ok: true });
      }
      case 'pause':
      case 'finish': {
        const ended = takes.map((t) => (t.ended_at ? t : { ...t, ended_at: now }));
        const finishing = b.action === 'finish';
        await svc.from('board_meetings').update({ recording_status: finishing ? 'processing' : 'paused', recording_takes: ended, updated_at: now }).eq('id', m.id).throwOnError();
        if (finishing) {
          await log('admin_finished_meeting_recording', { takes: ended.length, provider });
          if (provider) void transcribeMeeting(svc, m.id, provider).catch((e) => console.error('observer transcription', e));
          // The meeting is over: its tablets let go of it.
          for (const t of await tabletsOf(svc, m.id)) await releaseTablet(svc, t.id, 'The meeting is finished.');
        }
        return Response.json({ ok: true });
      }
    }
    return Response.json({ error: 'Unknown request.' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
};
