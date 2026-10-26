# Production: one Vultr server (portal + self-hosted Supabase)

Live at **https://investors.lakeba.com** since 22 October 2026.

| | |
|---|---|
| Server | Vultr Cloud Compute, Sydney, 2 vCPU / 4 GB, Ubuntu 26.04 LTS, `139.180.180.225` |
| Portal | Node 24 LTS, systemd service `lakeba-portal` on `127.0.0.1:4321`, releases in `/srv/lakeba-portal` |
| HTTPS | Caddy, automatic Let's Encrypt certificate (`/etc/caddy/Caddyfile`) |
| Supabase | Official self-hosted Docker setup in `/opt/supabase` (release recorded in `.supabase-version`), only db, auth, rest, storage and the gateway; gateway on `127.0.0.1:8000` |
| Secrets | `/opt/supabase/.env` (root only), `/etc/lakeba-portal/portal.env` (root + service) |
| Backups | nightly 02:30 Sydney to `/var/backups/lakeba` (14 days): database, files, settings |
| Firewall | ufw: SSH (keys only), 80, 443. Supabase and Postgres are not reachable from outside. |

Files for all of this are in `portal/deploy/vultr/`.

## Everyday

- **Deploy a new version** (only when it's time; pushes never deploy): GitHub → Actions → **Deploy portal** → Run.
  It builds, uploads, installs, checks the portal starts, and rolls back if not.
- **Database changes**: copy the new files from `portal/supabase/migrations/` to
  `/opt/lakeba-migrations/` on the server and run
  `bash /opt/lakeba-migrations/migrate.sh /opt/lakeba-migrations` *before* deploying
  code that needs them. Each migration runs once, in a transaction.
- **Ask Lakeba key**: `ssh -t root@<server> lakeba-set-anthropic-key` checks a Claude API key
  with Anthropic, stores it and restarts the portal (an empty key turns AI answers off).
  Set a spend limit in the Anthropic Console first.
- **Browser notifications**: `ssh root@<server> lakeba-set-push-keys` creates the Web Push
  (VAPID) keys on the server, stores them in `portal.env` and restarts the portal. Run it once;
  it keeps existing keys (`--rotate` replaces them, and every device must turn notifications on again).
  The portal sends queued pushes itself, and runs proxy reminders (a day before each deadline) and
  the admins' morning vote summary. Admin → Notifications shows deliveries.
- **Ask retrieval** (built 23 October 2026, **switched off**): instead of the full documents,
  Ask can answer from the best-matching passages (Admin → Ask knowledge → *How Ask answers*).
  Tested on the Mac: about US$0.10 a question at any time (full documents: about US$1.58 for
  the first question after a quiet hour, then about US$0.06), but less complete answers
  (2 of 17 test questions materially worse). If it fails, Ask falls back to full documents.
  Before using it in production: apply migration `20261025000000_ask_retrieval`, install
  the updated `lakeba-portal.service` (writable model folder), then Rebuild search index.
- **Logs**: `journalctl -u lakeba-portal -f`, `supabase-lakeba logs -f auth`.
- **Restart**: `systemctl restart lakeba-portal`; Supabase: `supabase-lakeba restart`.
- **Supabase updates**: back up (`lakeba-backup`), then in `/opt/supabase`:
  `sh update.sh --dry-run`, `sh update.sh`, `supabase-lakeba pull`,
  `supabase-lakeba up -d db auth rest storage api-gw`.
- **OS reboots**: security updates install automatically; reboot in a quiet hour
  when `/var/run/reboot-required` exists (everything restarts on its own).

## Backups and restore

`lakeba-backup` (timer `lakeba-backup.timer`) writes, per night:
`database.dump` (pg_dump custom format), `storage.tgz` (document files),
`supabase-config.tgz` and `portal.env` (secrets needed to restore), and
`SHA256SUMS`. A restore into a scratch database was tested on 22 October 2026
and matched the live database.

These copies are on the same server: they protect against mistakes, not against
losing the server. Vultr's automatic backups cover the whole machine.

**Off-server copy (Azure Blob Storage, Australia East).** Once
`/etc/lakeba-backup/offsite.env` exists, each night's folder is also packed,
encrypted with GPG (AES-256, passphrase in `/etc/lakeba-backup/passphrase`) and
uploaded with rclone to `<container>/lakeba/<date>.tar.gpg`; copies older than
35 days are deleted there. Set it up once with
`ssh -t root@<server> lakeba-set-offsite-backup` (from
`deploy/vultr/set-offsite-backup.sh`): it installs the current rclone (Ubuntu's
package is too old for Azure), asks for the storage account name, an access key
and the container, shows the new passphrase once (keep it in the password
manager: the copies can't be read without it), runs a backup and test-restores
the upload.

In Azure: a storage account used only for these backups (Standard, LRS,
region Australia East, default access tier **Cool**, public access off), with
blob soft delete on (14 days) and a private container `lakeba-backups`. The
server holds that account's access key; soft delete and any retention policy
are set in the Azure portal, which the key can't change, so a compromised server
can't erase the copies for good.

Restore on any machine with rclone and gpg:
```
rclone copy :azureblob,account=<account>,key=<key>:lakeba-backups/lakeba/<date>.tar.gpg .
gpg --decrypt <date>.tar.gpg | tar -x   # asks for the passphrase
```

Restore the database from a backup folder `D`:
```
docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists < D/database.dump
tar -xzf D/storage.tgz -C /opt/supabase/volumes
```

## Still to do before inviting shareholders

1. ~~**Email**~~ Done 22 October 2026: Microsoft 365 (`smtp.office365.com:587`) as
   `no-reply@lakeba.com`, for both the portal and Supabase sign-in emails. To change
   the account or password, run `ssh -t root@<server> lakeba-set-smtp <mailbox> [test-address]`
   (it checks the sign-in first, then updates both and restarts them).
2. **First admin**: create the account (`supabase-lakeba exec` or the admin API),
   set `role = 'admin'` in `public.profiles`, sign in and set up two-step.
3. **Data**: Admin → Import data with the checked workbook; then documents and
   settings with `scripts/copy-content.mjs` (through an SSH tunnel to port 8000).
4. **Check**: `scripts/check-entities.mjs` against the server (35 checks; it
   passed on the empty database on 22 October 2026).

## Ventures' own domains (not live yet)

Every company is on `investors.lakeba.com` (picked with the company switcher). A venture with a full
portal can also have its own domain, `investors.mist.com` (Admin → Companies → a company → Domain
and mail). There are no `{venture}.investors.lakeba.com` addresses.

The venture adds a CNAME to `investors.lakeba.com` (or, where its DNS provider can't, an A record with
the server's address, `PORTAL_SERVER_IP`), and the check puts it in use (no Lakeba approval).
- **Sign-in:** still happens on `investors.lakeba.com`. A one-time pass carries it to the venture's
  domain, only for people who belong to that venture alone, with no staff role, and only while the
  domain still points here. Everyone else opens the venture on `investors.lakeba.com`.
- **Emails:** keep linking to `investors.lakeba.com`. Never use a venture's domain for sign-in links.
- **If the server's address ever changes:** ventures with an A record must update it. Look for
  `company_domain_verified` entries whose `found` starts with `A`.

To switch own domains on (once):

1. **Caddy:** certificates for own domains come from Caddy's on-demand TLS, which asks the portal first;
   the portal says yes only for verified domains. Add the global block at the top of the Caddyfile, keep
   the `investors.lakeba.com` block as it is, add the catch-all block after it, and make port 80 redirect
   to HTTPS (instead of `respond 404`), then `caddy validate` and `systemctl reload caddy`:
   ```
   {
     on_demand_tls {
       ask http://127.0.0.1:4321/api/public/domain-check
     }
   }
   https:// {
     tls { on_demand }
     header -Server
     reverse_proxy 127.0.0.1:4321
   }
   http:// {
     redir https://{host}{uri} 308
   }
   ```
2. **Portal:** `PORTAL_DOMAIN=investors.lakeba.com` in `/etc/lakeba-portal/portal.env`, then restart
   `lakeba-portal`. It only tells the portal its own address; nothing changes for people who don't use
   an own domain, and sessions stay where they are.
3. **Check:**
   - A venture presses "Check now" on Domain and mail.
   - Signed out, `https://investors.<venture>.com/` should open its sign-in page on
     `investors.lakeba.com` (`?venture=<short name>`).
   - The first visit fetches its certificate, which takes a few seconds.

Passkeys don't need changes: they are only ever used on `investors.lakeba.com`.

The portal turns away any host name that isn't Lakeba's or a verified venture domain
(`src/lib/known-hosts.mjs`).

**A venture's own Microsoft 365** (same page): its Microsoft 365 administrator approves the portal's app
with a link; then the portal reads its shareholder mailbox there and sends its emails from its own
address (after a test email). Before the first venture does this, in Azure (Entra ID) the app
"Lakeba Investor Portal – Mail" must be **multi-tenant**, have the redirect address
`https://investors.lakeba.com/auth/ms-consent`, and have the application permissions **Mail.ReadWrite**
and **Mail.Send**. Each venture can then limit the app to its own mailboxes in Exchange, as Lakeba does.
Newsletters still go through Lakeba's mail, in the venture's name.

**A venture whose email is in Lakeba's own Microsoft 365** (a controlled venture whose domain was added
there, like `ezifin.com`; the page tells from Microsoft's public record of the domain): nothing to approve.
- Its shareholder address is `shareholders@<venture domain>`. Lakeba's IT makes it a shared mailbox and
  adds it to the mailboxes the portal's app may use (the same list as Lakeba's shareholder mailboxes).
- A Lakeba group admin then sends a test from it on Domain and mail. Only addresses on the venture's own
  domain, in Lakeba's Microsoft 365, are accepted. From then on the portal's emails to its investors come
  from it.
- A group admin sets it as the venture's mailbox in Shareholder emails, so the portal reads it too.

**A venture on Google Workspace** (same page, "on Google Workspace"):
- *Sending from its own address* needs nothing from Lakeba: the venture's Google administrator turns on
  Gmail's SMTP relay for the server's address (`PORTAL_SERVER_IP`, 139.180.180.225), only for addresses
  in its domains and with TLS; the portal sends through `smtp-relay.gmail.com:587` after a test email.
- *Reading its shareholder mailbox* uses one Google service account of Lakeba's, made once: a Google
  Cloud project with the Gmail API on, a service account with a JSON key, the key file on the server
  (root and the service only) and `GOOGLE_SERVICE_ACCOUNT_FILE=<path>` in `portal.env`. Each venture's
  administrator then allows its Client ID with the scope `https://www.googleapis.com/auth/gmail.modify`
  (domain-wide delegation); the page shows both. Google applies that to every mailbox in the venture's
  domain, so tell the venture: the portal only ever opens the shareholder mailbox saved in its settings.

**The guided set-up** (same page): the portal looks up the venture's mail and name servers to tell whether
it uses Microsoft 365 or Google and where its DNS is managed (GoDaddy, Cloudflare…), and shows only those
steps, with values to copy. A waiting domain is checked every minute while the page is open, and a failed
check says why (nothing yet, the whole address typed in the Name box, Cloudflare's orange cloud, a record
pointing at a website builder). The venture's admins can **send the steps** to whoever looks after their
domain or email: a private link (`/setup/<token>`, 7 days, only a hash kept, can be stopped) that needs no
portal account; that person can check DNS, approve Microsoft 365, send test emails and check the Gmail
mailbox, but not stop or disconnect anything. Finished steps and **Ask Lakeba for help** reach the admins'
Inbox ("Venture set-up" notifications; help requests go to Lakeba's group admins only). Microsoft's step 4
limits the portal to the venture's mailboxes with Exchange's RBAC for Applications (a management scope plus
the "Application Mail Full Access" role), then removes the organisation-wide approval in Entra. Needs
migration `20261124000000_venture_setup_guide`.

## Rebuilding the server from scratch

1. New Ubuntu server in Sydney with your SSH key; DNS A record to its IP.
2. `DEPLOY_PUBKEY="…" bash setup.sh` (from `portal/deploy/vultr/`).
3. Install Docker (official apt repository) and run Supabase's official
   `setup.sh -y --skip-deps --project-dir supabase` in `/opt`; copy in
   `docker-compose.lakeba.yml` and restore `supabase-config.tgz` from a backup
   (it holds the keys the data was made with).
4. `supabase-lakeba up -d db auth rest storage api-gw`, restore `database.dump`
   and `storage.tgz`, put back `portal.env`, install `backup.sh` and its timer.
5. Update the GitHub `production` secrets (`VULTR_HOST`, `VULTR_KNOWN_HOSTS`)
   and run **Deploy portal**.
