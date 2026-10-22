# Going live: Vultr (portal) + Supabase (database, sign-in, files)

Production runs in Sydney:

- **Portal**: a Vultr Cloud Compute server (Ubuntu 24.04 LTS), Node 24 LTS
  behind Caddy, which serves `https://investors.lakeba.com` with an automatic
  certificate. Files for it are in `portal/deploy/vultr/`.
- **Database, sign-in and document storage**: a Supabase Pro project in
  Sydney (ap-southeast-2).
- **Email**: a real SMTP service sending from a lakeba.com address.

Steps marked **(you)** need an account owner. The rest can be run by whoever
deploys.

## 1. Supabase project

1. **(you)** Create an organisation on supabase.com, choose **Pro**, create a
   project in **Sydney**. Keep the database password somewhere safe. Turning on
   point-in-time recovery is recommended (Settings → Add-ons).
2. Apply the database, from `portal/`:
   ```
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   This creates every table, rule and the private `documents` bucket.
3. **Authentication → Sign In / Providers**
   - Turn **off** "Allow new users to sign up". Only invited people get
     accounts; invitations still work.
   - Email: minimum password length **12**, require lower, upper and digits.
4. **Authentication → URL Configuration**
   - Site URL: `https://investors.lakeba.com`
   - Redirect URLs: `https://investors.lakeba.com/**`
5. **Authentication → Multi-Factor**: TOTP (authenticator app) **enabled**.
6. **Authentication → Emails → SMTP Settings**: add the same SMTP service the
   portal uses, sender `investors@lakeba.com`. Without it Supabase sends only a
   few test emails an hour. Decide the **email link expiry** here: invitation,
   welcome and reset links last this long (the local setup uses 1 hour).
7. **Settings → API Keys**: note the URL, the publishable key and a secret key
   for `portal.env`.

## 2. Email

**(you)** Pick the service (Microsoft 365, Azure Communication Services Email,
Postmark, …). Whoever manages lakeba.com DNS adds its **SPF** and **DKIM**
records so mail isn't marked as spam. You need an SMTP URL like
`smtp://user:password@smtp.example.com:587`.

## 3. Vultr server

1. **(you)** Vultr → Deploy → Cloud Compute (shared CPU), **Sydney**,
   **Ubuntu 24.04 LTS**, 1–2 vCPU / 2 GB. Add your own SSH key. Turn on
   **automatic backups**.
2. **DNS (you)**: add `investors.lakeba.com` → an **A record** to the server's
   IPv4 address (and AAAA for IPv6 if shown).
3. Make a deploy key for GitHub Actions on your computer:
   ```
   ssh-keygen -t ed25519 -N "" -C github-actions -f lakeba-deploy
   ```
4. Copy `portal/deploy/vultr/` to the server and run the setup as root:
   ```
   scp -r portal/deploy/vultr root@<server-ip>:/root/lakeba-setup
   ssh root@<server-ip> 'DEPLOY_PUBKEY="$(cat)" bash /root/lakeba-setup/setup.sh' < lakeba-deploy.pub
   ```
   It installs Node 24 and Caddy, turns on the firewall (SSH, HTTP and HTTPS
   only) and automatic security updates, switches SSH to keys only, and creates
   the service.
5. Fill in the secrets on the server:
   `sudo nano /etc/lakeba-portal/portal.env` (Supabase URL and keys, SMTP URL;
   leave `ANTHROPIC_API_KEY` empty until the spend limit is set in the
   Anthropic Console).

## 4. GitHub deploy

1. GitHub → repository → Settings → Environments → **New environment**
   `production`. Optionally add yourself as a required reviewer.
2. In that environment, add the secrets:
   - `VULTR_HOST`: the server's IP
   - `VULTR_SSH_KEY`: the contents of `lakeba-deploy` (the private half)
   - `VULTR_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 <server-ip>`
3. Actions → **Deploy portal** → Run workflow. It builds the portal, uploads it,
   installs it and checks that it starts; if the new version doesn't start,
   it switches back to the previous one. Then open https://investors.lakeba.com.

## 5. First admin

1. Supabase → Authentication → Users → **Add user** → *Send invitation* to your
   own address (or create the user with a password).
2. Supabase → SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@lakeba.com';
   ```
3. Sign in at https://investors.lakeba.com. You are asked to set up two-step
   sign-in before anything else.

## 6. Data

1. **Investors**: Admin → Import data → upload the checked workbook → Check →
   Apply. Nothing is emailed.
2. **Content** (documents with their files and search text, settings, Ask
   answers): from `portal/` on the Mac, with the hosted keys in
   `.env.production` (same names as `.env`; this file is never committed):
   ```
   node scripts/copy-content.mjs --from .env --to .env.production            # dry run
   node scripts/copy-content.mjs --from .env --to .env.production --apply
   ```
   Run it after the import, so documents for a single holder find their holder.
3. **Check** the company separation against the live database:
   ```
   node --env-file=.env.production scripts/check-entities.mjs
   ```
   It creates and removes its own test rows. All checks must pass.

## 7. Invite

Start with a pilot: Admin → Investors → pick a company → *Welcome …
shareholders*, tick a few friendly shareholders, send. Then the rest, up to 50
per send.

## 8. After go-live

- Stop the Mac's portal and its Tailscale and local-network access, so there is
  one portal.
- Updates: merge to main, then run **Deploy portal**. Database changes:
  `npx supabase db push` before deploying code that needs them.
- Logs on the server: `journalctl -u lakeba-portal -f`. Restart:
  `sudo systemctl restart lakeba-portal`.
- OS reboots for kernel updates are not automatic: reboot in a quiet hour when
  `/var/run/reboot-required` exists.
