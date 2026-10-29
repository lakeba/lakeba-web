// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { KNOWN_HOSTS } from './src/lib/known-hosts.mjs';

// Server-rendered: every page checks the session. Runs as a plain Node server
// (production: a Vultr server in Sydney behind Caddy; see deploy/vultr/).
// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Host names the portal may be reached on (src/lib/known-hosts.mjs). Ventures' own domains
  // can't be listed ahead: any HTTPS name (and any *.localhost name, for tests on this Mac) is
  // let through here, and the middleware turns away all but verified venture domains.
  security: {
    allowedDomains: [...KNOWN_HOSTS, { protocol: 'https' }, { hostname: '**.localhost' }],
  },
  adapter: node({ mode: 'standalone' }),
  server: { port: 4322 },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_PUBLISHABLE_KEY: envField.string({ context: 'server', access: 'secret' }),
      TURNSTILE_SITE_KEY: envField.string({ context: 'server', access: 'public', optional: true }),
      // Admin-only operations (inviting users, sending notifications). Never sent to the browser.
      SUPABASE_SECRET_KEY: envField.string({ context: 'server', access: 'secret' }),
      SMTP_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Sender for portal emails; read at runtime. With Microsoft 365 it must be the signed-in mailbox (or one it may send as).
      MAIL_FROM: envField.string({ context: 'server', access: 'secret', default: 'Lakeba Investor Relations <no-reply@lakeba.com>' }),
      // Press pitches to journalists come from the press office's shared mailbox (the SMTP account has Send As on it).
      PRESS_MAIL_FROM: envField.string({ context: 'server', access: 'secret', default: 'Lakeba Media Relations <press@lakeba.com>' }),
      ANTHROPIC_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Browser notifications (Web Push). Without the keys, push is simply off.
      VAPID_PUBLIC_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_PRIVATE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_SUBJECT: envField.string({ context: 'server', access: 'secret', default: 'mailto:info@lakeba.com' }),
      // Shareholder mailboxes (Microsoft 365, via Microsoft Graph). Without them, email reading is off.
      // Certificate (MS_CLIENT_CERT_FILE: a PEM with the private key and certificate) or a client secret.
      MS_TENANT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      MS_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      MS_CLIENT_CERT_FILE: envField.string({ context: 'server', access: 'secret', optional: true }),
      MS_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Tests only: stand-in Microsoft services.
      MS_GRAPH_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://graph.microsoft.com/v1.0' }),
      MS_LOGIN_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://login.microsoftonline.com' }),
      // Staging tests only: extra push service address prefixes allowed (e.g. a local stand-in).
      PUSH_TEST_ENDPOINTS: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Staging tests only: address prefixes the safe fetcher may reach although they aren't public (e.g. a local stand-in).
      FETCH_TEST_PREFIXES: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Venture addresses: the portal's own domain (investors.lakeba.com). Ventures are reached at
      // {slug}.<this>, sign-in happens here, and the session is shared across them. Empty: one address, as before.
      PORTAL_DOMAIN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Tests on this Mac only: "investors.mist.localhost=giuseppe-macbook-pro.tail21d16f.ts.net" (comma-separated) stands in for DNS records.
      DNS_TEST_RECORDS: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Tests only: a JSON file of DNS answers ({"cname": {"name": ["target"]}, "a", "mx", "ns", "txt"}) used instead of real lookups.
      DNS_TEST_FILE: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Staging on this Mac only: every sign-in counts as two-step (ignored unless the database is the local one).
      TWO_STEP_OFF_FOR_TESTING: envField.boolean({ context: 'server', access: 'secret', default: false }),
      // Staging: read the real shareholder mailboxes, but never send from them or change them (no replies,
      // automatic or not, no Outlook categories or Gmail labels). Never set in production.
      MAILBOXES_READ_ONLY: envField.boolean({ context: 'server', access: 'secret', default: false }),
      // Integrations (Admin → Companies → Integrations). INTEGRATIONS_KEY (32 random bytes, base64) encrypts
      // stored secrets: webhook signing secrets, HubSpot and Xero tokens. OUTBOUND_ALLOWLIST, when set, is the
      // only places integrations may call (comma-separated address prefixes): staging sets it to its local
      // stand-ins, so no webhook, HubSpot or Xero call leaves this Mac. Never set it in production.
      INTEGRATIONS_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      OUTBOUND_ALLOWLIST: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Lakeba's HubSpot app and Xero app (one each, used by every venture that connects).
      HUBSPOT_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      HUBSPOT_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      HUBSPOT_AUTH_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://app.hubspot.com' }),
      HUBSPOT_API_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://api.hubapi.com' }),
      XERO_CLIENT_ID: envField.string({ context: 'server', access: 'secret', optional: true }),
      XERO_CLIENT_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      XERO_AUTH_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://login.xero.com/identity/connect' }),
      XERO_TOKEN_URL: envField.string({ context: 'server', access: 'secret', default: 'https://identity.xero.com/connect/token' }),
      XERO_API_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://api.xero.com' }),
      // Xero's granular scopes (required for apps created from March 2026): contacts, draft bills, the chart of accounts, and the two reports.
      XERO_SCOPES: envField.string({ context: 'server', access: 'secret', default: 'openid profile email offline_access accounting.contacts accounting.invoices accounting.settings.read accounting.reports.balancesheet.read accounting.reports.profitandloss.read' }),
      // Ventures on Google Workspace. Sending: Google's SMTP relay (the venture allows this server's address).
      // GOOGLE_RELAY_URL replaces it in tests (e.g. smtp://127.0.0.1:54325).
      GOOGLE_RELAY_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      PORTAL_SERVER_IP: envField.string({ context: 'server', access: 'public', default: '139.180.180.225' }),
      // Reading shareholder mailboxes: Lakeba's Google service account (its JSON key file), which a venture's
      // Google administrator allows for Gmail only. The two addresses can be pointed at stand-ins for tests.
      GOOGLE_SERVICE_ACCOUNT_FILE: envField.string({ context: 'server', access: 'secret', optional: true }),
      GOOGLE_TOKEN_URL: envField.string({ context: 'server', access: 'secret', default: 'https://oauth2.googleapis.com/token' }),
      GMAIL_API_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://gmail.googleapis.com/gmail/v1' }),
      // The public website (news articles link there; it reads /api/public/news.json when built).
      PUBLIC_SITE_URL: envField.string({ context: 'server', access: 'public', default: 'https://lakeba.github.io/lakeba-web' }),
      // Rebuilds the website when public news changes: a GitHub token that may run the website's deploy workflow.
      // Without it, an admin runs "Deploy to GitHub Pages" by hand.
      GITHUB_DEPLOY_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      WEBSITE_REPO: envField.string({ context: 'server', access: 'secret', default: 'lakeba/lakeba-web' }),
      WEBSITE_WORKFLOW: envField.string({ context: 'server', access: 'secret', default: 'deploy.yml' }),
      // Tests only: stand-in GitHub API.
      GITHUB_API_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://api.github.com' }),
      // Press releases on social networks. Bluesky: the account's handle and an app password (Settings → App passwords).
      BLUESKY_HANDLE: envField.string({ context: 'server', access: 'secret', optional: true }),
      BLUESKY_APP_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true }),
      BLUESKY_SERVICE: envField.string({ context: 'server', access: 'secret', default: 'https://bsky.social' }),
      // X (pay per post): an app's consumer key and secret, and the account's access token and secret (OAuth 1.0a).
      X_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      X_API_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      X_ACCESS_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      X_ACCESS_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      X_API_BASE: envField.string({ context: 'server', access: 'secret', default: 'https://api.x.com' }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // Local embeddings (Ask retrieval) use a native runtime: load it from node_modules, don't bundle it.
    ssr: { external: ['@huggingface/transformers', 'onnxruntime-node'] },
    // The portal shares brand styles and the logo with the marketing site.
    server: { fs: { allow: ['..'] } },
  },
});
