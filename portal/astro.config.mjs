// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Server-rendered: every page checks the session. Runs as a plain Node server
// (production: a Vultr server in Sydney behind Caddy; see deploy/vultr/).
// https://astro.build/config
export default defineConfig({
  output: 'server',
  // Host names the portal may be reached on. Astro checks requests (and the
  // origin of form posts) against these. Add the production domain here.
  security: {
    allowedDomains: [
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' },
      { hostname: '192.168.1.141' }, // this Mac on the local network (plain HTTP)
      { hostname: '100.117.227.8' }, // this Mac on the Tailscale network
      { hostname: 'giuseppe-macbook-pro.tail21d16f.ts.net', protocol: 'https' }, // same, via Tailscale HTTPS
      { hostname: 'investors.lakeba.com', protocol: 'https' }, // production (Caddy in front, HTTPS only)
    ],
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
