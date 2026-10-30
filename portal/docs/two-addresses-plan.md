# Plan: investors.lakeba.com and portal.lakeba.com (two addresses, one app)

Status: **plan only, nothing built.** Written 30 October 2026.

## The idea

One portal app, one deploy, one database, answering on two addresses:

- **investors.lakeba.com**: shareholders only. Home, holdings, news, meetings and voting, Board Q&A,
  documents, Ask, inbox and profile, in every language. Ventures' shareholders use it too, branded
  for their venture, and at the venture's own domain where it has one. A venture's admins and
  directors use portal.lakeba.com, like Lakeba's staff.
- **portal.lakeba.com**: everyone who works on the companies. The admin, the board (Board Ask, the
  Boardroom, tablets, Lex and online meetings, To sign), My HR, `/developers`, the API and the
  integrations. Two-step always on. It can later be limited to known networks.

The app looks at the address first. A page asked for on the wrong address opens on the right one,
so old links (emails, bookmarks) keep working. Each address has its own sign-in and session.

People who are both staff and shareholders switch with **Open the investor portal** / **Open the
staff portal** in the profile menu, which signs them in on the other address with the one-time pass
the venture domains already use. This replaces **View as investor**.

## What goes where

| Address | Pages |
|---|---|
| investors.lakeba.com only | `/`, `/portfolio`, `/news`, `/agm`, `/board` (shareholders' Board Q&A), `/documents`, `/trading`, `/statement`, `/company`, `/inbox`, `/profile`, `/ask`, `/newsletters`, `/api/ask*`, `/api/getting-started`, `/api/note-banner` |
| portal.lakeba.com only | `/admin`, `/api/admin`, `/integrations`, `/tablet`, `/api/tablet`, `/sign`, `/my-hr`, `/developers`, `/oauth/authorize`, `/auth/ms-consent`, `/setup` (the IT person's page) |
| Both (each its own) | `/login`, `/forgot-password`, `/mfa`, `/passkey-login`, `/auth/*`, `/logout`, `/account/*`, `/api/passkeys`, `/api/push` |
| Both (no sign-in, links already sent out) | `/e`, `/n`, `/go`, `/room`, `/press`, `/news-media`, `/company-logo`, `/api/public`, `/embed`, `/api/hooks`, `/api/v1`, `/oauth/token` |

- **Wrong address:** a page view gets a permanent redirect (301) to the same path and query on the
  other address. Anything else (forms, `fetch`) gets a 404, so nothing is ever *served* on the wrong
  address.
- **The API** keeps answering on both addresses for good: companies' tools already call
  investors.lakeba.com, and API keys carry no cookies. The docs and examples show portal.lakeba.com.
- **The website news embed** (`/embed/news.js`, `/api/public`) stays on both. Ventures' websites
  already use investors.lakeba.com.
- **The route map lives in one file** (`src/lib/addresses.ts`), read by the middleware and by
  `npm run check:portal`. The check fails when a page is in no group or in two.

## Who can sign in where

- **investors.lakeba.com**: anyone with a holding, as today. Someone with a staff or board role but
  no holding is told "This address is for shareholders" and given a link to the staff portal.
- **portal.lakeba.com**: anyone with a staff role (admin roles, Finance, HR, Legal, …), a director, or
  an employee with My HR. Two-step is required for everyone there, directors included. Today it is
  required only for staff roles. Shareholders with none of these are told "This address is for Lakeba
  staff and directors" and given a link to investors.lakeba.com.
- **Directors who aren't staff** see only **My tools** (Board Ask, the board papers, To sign) and
  none of the admin sections.
- **Sessions:** the session cookies are already tied to one address (no `domain` set), so the two
  sessions are separate without changing them. Signing out on one doesn't sign you out on the other.
- **Ventures' own domains:** investor pages only. Their "admin" redirect (`CENTRAL_PATHS`) goes to
  portal.lakeba.com, with the venture's company picked. Investors still sign in on investors.lakeba.com
  and reach the venture's domain with the pass, as today.

## Passkeys: the one thing to prove first

Supabase has one passkey "relying party" per project. In production that is investors.lakeba.com,
so a passkey made there doesn't work on portal.lakeba.com as it stands. The options, best first:

1. **Related origins (recommended):** keep the relying party as investors.lakeba.com, add
   `https://portal.lakeba.com` to Supabase's `rp_origins`, and serve `/.well-known/webauthn` on
   investors.lakeba.com listing the portal's address. Existing passkeys keep working on both
   addresses, with nothing for anyone to redo. This relies on browser support for related origins.
   Chrome, Edge and Safari have it; Firefox may not. Staff on a browser without it use their
   authenticator code. **To prove on staging first**, together with Supabase accepting it.
2. **Fallback:** passkeys stay on investors.lakeba.com. On the portal, staff sign in with password
   plus authenticator code (they all have one, since two-step is required for staff).
3. **Not recommended:** moving the relying party to `lakeba.com`. Every existing passkey, investors'
   included, would stop working.

## Links the portal makes

Today one address, `locals.site.central`, is used for every link. The change is a helper,
`addressFor(path)`, that picks the address from the route map. Emails, notifications, pushes and
redirects then land on the right one without each caller having to know.

- **Notifications and emails:** admin topics link to portal.lakeba.com, investor topics to
  investors.lakeba.com. The worker's fallback (`lastOrigin` in `notify-jobs.ts`) comes from settings,
  not from the last request seen.
- **Recall bot:** its camera page (`/tablet/join/…` in `recall.ts`) uses the portal's address.
- **Integrations:** the HubSpot and Xero return addresses and the Microsoft 365 consent page move to
  portal.lakeba.com. The new URLs are registered in each console *before* the switch, and the old ones
  are kept for a month.
- **OAuth apps (the portal as sign-in for other tools):** `/oauth/authorize` moves to the portal, and
  the old address redirects there. The apps' own redirect addresses don't change.
- **The API's error links and examples** (`api/core.ts`, `api/spec.ts`): portal.lakeba.com/developers.
- **Supabase Auth** (sign-in links, password reset): add `https://portal.lakeba.com/**` to the
  redirect URLs, and make sure each sign-in link carries the address it was asked for on.
- **Push notifications:** existing subscriptions keep working. A tap on an admin notification opens
  investors.lakeba.com/admin…, which redirects to the portal. Staff can switch them on again on the
  portal so the notification opens there directly.
- **App manifests:** two of them, "Lakeba Investors" and "Lakeba Portal", so a phone shows the right
  name and icon.
- **Tablets:** the tablet cookie belongs to the address, so boardroom tablets reconnect once on
  portal.lakeba.com with a six-digit code.
- **Android Lex app:** the release build's default address (`android/README.md`, `MainActivity.kt`)
  becomes portal.lakeba.com. Installed apps can change it in their settings, so a new build isn't
  urgent.
- **Docs:** `deploy-vultr.md`, `integrations.md`, `online-meetings.md` and `ventures-rollout.md`
  mention investors.lakeba.com for staff things.

## Settings

- **Environment:** a new `STAFF_ORIGIN` (`https://portal.lakeba.com`) in `portal.env`. It's a full
  address, port included, so staging can use a second port on the Mac's Tailscale name. `PORTAL_DOMAIN`
  keeps meaning investors.lakeba.com. It could be renamed `INVESTORS_DOMAIN` at the same time, reading
  the old name as a fallback.
- **Without `STAFF_ORIGIN`, nothing changes:** the portal works on one address as today. This makes the
  code safe to deploy before the switch, and turning it off again is the rollback.
- **`KNOWN_HOSTS`:** add portal.lakeba.com.
- **Caddy:** a `portal.lakeba.com` block with the same `reverse_proxy 127.0.0.1:4321`, which gets its
  own certificate automatically. Later, optionally, a `remote_ip` rule to allow only known networks.
- **DNS:** an A record for portal.lakeba.com pointing at the Vultr server.

## Order of work

Each step can be deployed and tested on its own.

0. **Three views on one address (first, on its own).** Most of what people would see from the
   split, without a new address. Everyone who works in the portal (staff, directors, employees) gets
   three choices in the profile menu, and their choice is remembered:
   - **View all:** every menu, as before. This is where everyone starts, new and existing users alike.
   - **View as admin:** only work menus: Admin, To sign, My HR. Home opens the person's work page.
   - **View as investor:** for those who hold shares. Only shareholder menus, and admin powers are set
     aside, as View as investor does today.
   - **Shareholders** with no work in the portal never see the switch.
   - **Links:** in the admin view, a shareholder link switches to the investor view; in the investor
     view, a work link (an emailed /admin or /sign link) switches to the admin view. This is the way the
     split would switch address.
   - **Groundwork:** the lists of which pages are work and which are shareholder pages become step 1's
     route map.
1. **Code, switched off.** Route map and check rule, host check in the middleware, `addressFor`, the
   two sign-in rules, the switch link with the pass in both directions, links moved to `addressFor`,
   two manifests. With `STAFF_ORIGIN` unset, production behaves exactly as now.
2. **Staging with two addresses.** `tailscale serve` on a second port (for example `:8443`) as the
   portal address. Then try:
   - signing in on both addresses, and the switch between them;
   - passkeys with related origins in Chrome and Safari, plus what happens in Firefox;
   - an admin notification and an investor one, with their emails;
   - a tablet;
   - Lex joining an online meeting;
   - HubSpot and Xero reconnecting;
   - an OAuth app;
   - old /admin links;
   - a venture's own domain.
3. **Production preparation, with no visible change:**
   - the DNS record;
   - the Caddy block (portal.lakeba.com answers but shows the same app);
   - the new return URLs added in Azure, Xero and HubSpot (old ones kept);
   - the Supabase redirect URLs and `rp_origins`.
4. **The switch:**
   - backup;
   - set `STAFF_ORIGIN` and restart;
   - signed-out checks on both addresses;
   - a What's new entry and an email to staff and directors: the new address, signing in again,
     reconnecting tablets, switching phone notifications on again.
5. **Tidy-up, a few weeks later:**
   - remove View as investor (`investor-view.ts`, its cookie and menu item);
   - remove the old return URLs from the consoles;
   - decide about limiting the portal to known networks;
   - release the Android build with the new default address.

**Rollback** at any point after the switch: remove `STAFF_ORIGIN` and restart. Everything is on
investors.lakeba.com again and portal.lakeba.com just shows the same app.

## What staff and directors will notice

- A new address, portal.lakeba.com, where they sign in once more. Their passkey works there if
  related origins prove out. Otherwise they use password plus code.
- Directors who weren't asked for two-step before are asked to set it up.
- Their old bookmarks and emailed links still work, through the redirect.
- Tablets need one reconnection.
- Phone notifications keep coming, and they can be switched on again on the portal.
- Shareholders notice nothing, except that the Admin item and View as investor are gone from their
  menu (they never had them).

## Open questions

1. Two-step for every director on the portal, not only staff roles? (Recommended: yes.)
2. Limit portal.lakeba.com to known networks (office, VPN, Cloudflare Access) now, later, or never?
3. Rename `PORTAL_DOMAIN` to `INVESTORS_DOMAIN` during this change, or leave it?
