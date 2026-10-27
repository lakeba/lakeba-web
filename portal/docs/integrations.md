# Integrations

How companies connect their other tools to the portal: the company API, outgoing and incoming
webhooks, HubSpot, Xero and apps (OAuth). Everything is per company and run by that company's
Admins in **Admin → Companies → the company → Integrations**; the public documentation is at
`/developers` and the machine-readable description at `/api/v1/openapi.json`.

## Rules everything follows

- **One company per key.** A key, webhook, connection or app belongs to one company and every query is
  limited to it. Only a Lakeba group Admin can make a key for all companies (on Lakeba Group).
- **Same rules as the screens.** Scopes are the admin permissions (`investors.view`, `documents.do`…);
  a key never gets more than the Admin who made it. Holdings of a company whose holdings come from its
  register can't be changed through the API: a register is sent and an Admin confirms it. Documents and
  news arrive as drafts. Opening proxy voting, publishing and sending stay in the portal.
- **Personal data is its own scope.** `people.read` (names, emails, phones, addresses) is never implied;
  without it the API and webhooks leave personal details out.
- **Everything is recorded.** Writes are in the audit log as made by the key, app or webhook; reads are
  counted per key, endpoint and day (Integrations → Usage).
- **A switch per company.** A group Admin can switch a company's integrations off: keys are refused,
  webhooks wait, HubSpot and Xero pause. Nothing is deleted.
- **Staging calls nothing outside.** `OUTBOUND_ALLOWLIST` (staging only) limits every outgoing call to
  local stand-ins; staging keys are `lk_test_…` and don't work in production (and the reverse).

## Pieces

| Piece | Where | What it does |
|---|---|---|
| API keys | Integrations → API keys | `lk_live_…`, hashed, scopes, optional expiry and IP list, rotate (old key works 7 more days), revoke |
| Company API | `/api/v1/…` (`src/pages/api/v1`, `src/lib/api`) | 39 operations: register, people, documents, news, meetings, Board Q&A, data rooms, newsletter, events, webhook subscriptions. Cursor paging, problem+json errors, 300 requests a minute per key, `Idempotency-Key` |
| Events | `integration_events` (trigger on `audit_log`) | 32 event types made from the audit log, for the company (or the companies of the holder or person) |
| Outgoing webhooks | Integrations → Outgoing webhooks (`src/lib/integrations/events.ts`) | Signed POSTs (`Lakeba-Signature: t=,v1=` HMAC-SHA256), JSON, Slack or Teams, retried for ~3 days then switched off with a notice to Admins; delivery log with Resend |
| Incoming webhooks | Integrations → Incoming webhooks, `/api/hooks/in/<token>` (`src/lib/integrations/inbound.ts`) | Newsletter sign-ups, contact details, new investors (reviewed), data room requests (reviewed), register PDFs (reviewed, then the register import), DocuSign signed documents (drafts). Five ways to verify the sender |
| HubSpot | Integrations → HubSpot (`src/lib/integrations/hubspot.ts`) | Investors → contacts, holders → companies, "Lakeba portal" properties, activity notes; opt-in: name/phone back, "Invite to portal", deal stage → data room request |
| Xero | Integrations → Xero (`src/lib/integrations/xero.ts`) | Holders → contacts (register reference, address), share capital check against chosen accounts, dividends as DRAFT bills |
| Apps (OAuth 2) | Integrations → Apps, `/oauth/authorize`, `/oauth/token` (`src/lib/integrations/oauth.ts`) | Group Admins register apps; a company Admin allows one on a consent page; access tokens (1 hour) and rotating refresh tokens (60 days); PKCE; REST-hook subscriptions (`POST/DELETE /api/v1/webhooks`) for Zapier and Make |

The worker inside the portal (`src/lib/notify-jobs.ts`) delivers webhooks and handles what was received
every 15 seconds, and syncs HubSpot and Xero every 10 minutes (or at once after connecting or "Sync now").

## Database (migrations)

- `20261129000000_data_room_test_guest` — data rooms' TEST links (already on production).
- `20261130000000_integrations_api` — `api_keys`, `api_usage`, `api_idempotency`, `integration_events`,
  `webhook_endpoints`, `webhook_deliveries`, `entities.integrations_enabled`, the audit → event trigger.
- `20261201000000_integrations_connectors` — `connections`, `external_links`, `connection_issues`, `dividend_runs`.
- `20261202000000_integrations_inbound` — `inbound_endpoints`, `inbound_messages`; newsletter sources `api`, `integration`.
- `20261203000000_integrations_oauth` — `oauth_clients`, `oauth_codes`.

All are server-only (row level security on, nothing granted to signed-in users).

## Before production

1. Back up, apply the four integrations migrations, deploy.
2. `ssh root@<server> lakeba-set-integrations-key` (copy `deploy/vultr/set-integrations-key.sh` to
   `/usr/local/bin/lakeba-set-integrations-key` first). Back the key up with the server backups.
3. For HubSpot and Xero: register Lakeba's HubSpot app and Xero app (developer accounts), with the
   return addresses `https://investors.lakeba.com/admin/companies/oauth/hubspot` and `…/oauth/xero`,
   and put their IDs and secrets in `portal.env` (`HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`,
   `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`). Until then those tabs say they aren't set up yet.
4. Never set `OUTBOUND_ALLOWLIST` or `FETCH_TEST_PREFIXES` in production.
5. Try it with one venture first: a key, a webhook to a test receiver, then HubSpot or Xero.

## Tests (staging, 27 October 2026)

Run against local stand-ins for HubSpot (port 4402), Xero (4403) and webhook receivers (4401), with
temporary accounts that are removed afterwards. Scripts are kept outside the repository.

| Area | Checks |
|---|---|
| Phase 1: keys, read API, outgoing webhooks, usage, switch | 41 |
| Phases 2–3: HubSpot and Xero | 38 |
| Phases 4–5: write API, incoming webhooks, apps, subscriptions, documentation | 66 |
| Earlier features (data rooms, investors, meetings) after the changes | 31 |

Latest full run (27–28 October 2026): 176 of 176 passed; staging left clean (no test accounts, keys,
webhooks, connections or events; the audit log back to its 17 register entries).
