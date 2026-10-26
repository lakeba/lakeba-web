# Deploying the ventures work (and rolling it back)

The `ventures` branch: venture settings and branding, per-venture mail, newsletters, press and
Ask, website news, own domains, Microsoft 365 / Google per venture, the guided set-up.
Production runs `main` (8a715e0) until this is merged and deployed.

## What changes for people on the day

Nothing visible to investors or Lakeba's admins beyond new settings, as long as these stay
unset in `/etc/lakeba-portal/portal.env`:

- `PORTAL_DOMAIN`: without it there are no own domains; with it, only the portal's own address is
  known (no `{venture}.investors.lakeba.com` addresses exist).
- `GOOGLE_SERVICE_ACCOUNT_FILE`: without it the Gmail mailbox step says it isn't set up.
- Lakeba's Microsoft app stays single-tenant until it's switched to multi-tenant in Azure,
  so no venture can approve it yet.
- `TWO_STEP_OFF_FOR_TESTING` must never be set (it's ignored anyway unless the database is
  the local one on the Mac).

## Steps

1. **Back up:** `ssh root@<server> lakeba-backup`, and note the release now running
   (`readlink /srv/lakeba-portal/current`).
2. **Database changes,** in this order. Copy them to `/opt/lakeba-migrations/` and run
   `bash /opt/lakeba-migrations/migrate.sh /opt/lakeba-migrations`. Each runs once, in a
   transaction.
   - `20261119000000_venture_settings` (also tags existing audit log entries with their company)
   - `20261120000000_venture_services`
   - `20261121000000_venture_news`
   - `20261122000000_venture_domains_mail`
   - `20261123000000_venture_google_mail`
   - `20261124000000_venture_setup_guide`
   - `20261125000000_venture_domain_approval`
3. **Deploy:** merge `ventures` into `main`, then GitHub → Actions → Deploy portal → Run.
4. **Check, signed out:**
   - `https://investors.lakeba.com/login` opens.
   - `/api/public/news.json` still lists Lakeba's news.
   - `/api/public/domain-check?domain=example.com` answers 404.
   - Then ask one admin to sign in and open Admin → Companies → a venture → Domain and mail.

## Rolling back

**Code:** re-run Deploy portal on `8a715e0` (or point `current` back to the noted release and
`systemctl restart lakeba-portal`).

**Database:** leave it as it is. The old code works with the new database, because the changes
only:
- add columns, with defaults, and new tables;
- make a few "unique" rules per company instead of global (newsletter subscribers, the media
  list, press opt-outs);
- tighten two Board Q&A rules.

The old code doesn't rely on what they replaced. Restore the backup from step 1 only if a
database change failed halfway. Each runs in a transaction, so that shouldn't happen. Restoring
the backup loses anything written since.

## Before switching on own domains later

- **Own domains:** Caddy's on-demand certificates and `PORTAL_DOMAIN` (deploy-vultr.md, Ventures'
  own domains). The venture then sets everything up (Domain and mail); no Lakeba approval.
  - Sign-in passes to an own domain go only to people who belong to that venture alone (no
    shares, board seat or admin role in any other company, no staff role), and only while the
    domain still points to the portal. Everyone else opens the venture on investors.lakeba.com.
  - So a venture that misused its domain could only reach sessions that see its own data.
  - `custom_domain_approved_at` (migration 20261125000000) is no longer used; it can be dropped
    after this code is deployed.
- **Microsoft 365 per venture:** make the Azure app multi-tenant.
  - The return page refuses Lakeba's own Microsoft 365, any already linked to another
    company, and any where the app isn't approved.
  - Sending addresses on Lakeba's or another company's domain are refused.
