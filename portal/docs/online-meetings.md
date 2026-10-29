# Lex in online meetings (Teams, Zoom, Google Meet, Webex)

The company secretary pastes the meeting's link on the meeting's page (**Admin → Boardroom → the meeting →
Observer → Lex in an online meeting**), confirms everyone attending agreed to the recording, and presses
**Send Lex**. A participant called **Lex (Lakeba)** joins through Recall.ai's meeting bot.

- Its camera is the portal's own Lex page (the Observer in bot mode, full screen with Lex's face and captions).
  The page hears the call through the browser's microphone and its sound goes into the call, so live text,
  "Lex, …" questions and follow-ups, Lex's voice and face, decks and the recording work as on the boardroom tablet.
- The bot's browser connects with a one-meeting pass (`board_tablets.kind = 'bot'`), like a tablet, through a
  private link only Recall sees; it reaches that meeting's Lex page and nothing else, acting for the person who
  sent it.
- As it joins, Lex says hello and the consent statement, and posts them in the meeting's chat.
- Recall keeps nothing (`retention: null`): the recording is the portal's own, deleted once the minutes are signed.
- Recall's status webhooks (`/api/hooks/recall`) show the bot's progress on the meeting page (in the lobby, in
  the meeting); when the call ends, the recording finishes and the full transcript with speakers is made.
- Teams and Google Meet hold Lex in the lobby: someone admits "Lex (Lakeba)". Zoom may ask the host to allow
  recording.

Code: `src/lib/recall.ts`, `src/pages/tablet/join/[secret].ts`, `src/pages/api/hooks/recall.ts`, the meeting page
and the Observer (bot mode from `locals.tablet.kind`). Migration `20261222000000_online_meetings`.

## Setting up Recall.ai

1. Create a Recall.ai account in the region nearest Sydney: **Asia, ap-northeast-1 (Tokyo)**. Each region is
   separate, with its own keys. The portal's default is `RECALL_API_BASE=https://ap-northeast-1.recall.ai`.
2. Make an API key and put it in `portal.env` as `RECALL_API_KEY`.
3. In Recall's dashboard → Webhooks, add the endpoint `https://investors.lakeba.com/api/hooks/recall` with the
   `bot.*` status events, and put its signing secret (`whsec_…`) in `portal.env` as `RECALL_WEBHOOK_SECRET`.
4. Restart the portal. "Lex in an online meeting" appears on meeting pages once the key is there.

Recall's bot must reach the portal over the internet, so it works with production (or a public address);
staging on the office Mac is only on Tailscale, which Recall can't reach.

Cost (Recall's published pricing, October 2026): about US$0.50 an hour of meeting, plus US$0.10 an hour for
the 4-core bot the Lex page needs; Recall's own transcription isn't used. Data: no recording or transcript is
kept by Recall; the call's audio passes through its bot in the chosen region. Lakeba's legal team should check
Recall's terms, as with Deepgram and AssemblyAI.

## Tests (30 October 2026, against a stand-in Recall on this Mac)

24 of 24: sending (link and consent checks, what Recall receives), the bot's private link and Lex page in bot
mode, signed webhooks (lobby, in the meeting, ended, done; bad signatures refused; late events ignored), leaving,
the recording finishing on "call ended", the bot's pass ending, the audit trail. Not yet tried with a real call.
