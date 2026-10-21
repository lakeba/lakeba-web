# Moving investors to the new portal

How to move from the WordPress Investor Portal to this portal with no gap in access.

## 1. Decide and provision

- [ ] Choose hosting (Vercel or Cloudflare) and swap the Node adapter in `astro.config.mjs` for that host's adapter.
- [ ] Create a hosted Supabase project in an Australian region. Push the schema with `npx supabase link` then `npx supabase db push`.
- [ ] In Supabase Auth:
  - set the Site URL to the portal's address (e.g. `https://investors.lakeba.com`) and add `https://investors.lakeba.com/**` as a redirect URL
  - enable TOTP MFA
  - enable Turnstile captcha
  - configure custom SMTP (for example Resend or Postmark) and brand the email templates
- [ ] Set the portal's environment variables (see `.env.example`). `SUPABASE_SECRET_KEY` and `ANTHROPIC_API_KEY` are server-side secrets.
- [ ] Point `investors.lakeba.com` at the host.

## 2. Export from WordPress

Fill the three files in `migration-templates/`. Keep the exports encrypted, and delete them after import.

| File | Source in WordPress |
|---|---|
| `investors.csv` | Users with investor access: email, names, phone, and the holder they belong to |
| `holdings.csv` | The share register as at the latest date, one row per holder and share class (the share registry export is the best source) |
| `documents.csv` + files | The PDFs on the investor portal page, with title, category and date |

Holder `registry_ref` values must match between files. Use the share registry's holder number where possible.

## 3. Import

```bash
# Validate only: prints counts and any problems, writes nothing.
node --env-file=.env.production scripts/import-legacy.mjs ./export

# Import without sending emails, check in the admin area, then invite.
node --env-file=.env.production scripts/import-legacy.mjs ./export --apply
```

- Check **Admin → Holders & holdings**: the total on issue must match the register.
- Check **Admin → Investors**: every investor must have a holder linked.
- Sign in as a test investor and compare the dashboard with the old portal.

Passwords cannot be carried over from WordPress. Send invitations when ready, either from **Admin → Investors** (resend invite) or by re-running the import with `--invite`. Each investor sets a new password from the email, which also confirms their address.

## 4. Switch over

1. Email investors the date of the move and what to expect: a "set your password" email and optional two-step verification.
2. Run both portals in parallel for two weeks. Post a banner on the old portal pointing to the new one.
3. At cut-over, redirect the old URLs on lakeba.com:
   ```nginx
   location = /investor-portal/ { return 301 https://investors.lakeba.com/; }
   location = /change-password/ { return 301 https://investors.lakeba.com/forgot-password; }
   ```
4. Remove investor-only files from the WordPress uploads folder, and check that the old URLs return 404.
5. Disable investor accounts in WordPress, then remove the portal page template and its plugins.

## 5. After the move

- Watch **Admin → Audit log** for failed sign-ins and **Admin → Board Q&A** for help requests in the first weeks.
- Agree how long audit logs and Q&A threads are kept, and record it in the privacy policy.
