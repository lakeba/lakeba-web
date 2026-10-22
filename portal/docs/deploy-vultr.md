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

- **Deploy a new version**: merge to main, then GitHub → Actions → **Deploy portal** → Run.
  It builds, uploads, installs, checks the portal starts, and rolls back if not.
- **Database changes**: copy the new files from `portal/supabase/migrations/` to
  `/opt/lakeba-migrations/` on the server and run
  `bash /opt/lakeba-migrations/migrate.sh /opt/lakeba-migrations` *before* deploying
  code that needs them. Each migration runs once, in a transaction.
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
losing the server. Vultr's automatic backups cover the whole machine; an
off-server copy (e.g. Vultr Object Storage) is still to be set up.

Restore the database from a backup folder `D`:
```
docker exec -i supabase-db pg_restore -U supabase_admin -d postgres --clean --if-exists < D/database.dump
tar -xzf D/storage.tgz -C /opt/supabase/volumes
```

## Still to do before inviting shareholders

1. **Email**: an SMTP service sending from a lakeba.com address, with SPF and
   DKIM in lakeba.com's DNS (Azure DNS). Then set `SMTP_URL` in `portal.env` and
   the `SMTP_*` values in `/opt/supabase/.env`, and restart both.
2. **First admin**: create the account (`supabase-lakeba exec` or the admin API),
   set `role = 'admin'` in `public.profiles`, sign in and set up two-step.
3. **Data**: Admin → Import data with the checked workbook; then documents and
   settings with `scripts/copy-content.mjs` (through an SSH tunnel to port 8000).
4. **Check**: `scripts/check-entities.mjs` against the server (35 checks; it
   passed on the empty database on 22 October 2026).

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
