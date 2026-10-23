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
      ANTHROPIC_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Browser notifications (Web Push). Without the keys, push is simply off.
      VAPID_PUBLIC_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_PRIVATE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      VAPID_SUBJECT: envField.string({ context: 'server', access: 'secret', default: 'mailto:info@lakeba.com' }),
      // Staging tests only: extra push service address prefixes allowed (e.g. a local stand-in).
      PUSH_TEST_ENDPOINTS: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Where public News & Media articles live (the marketing site).
      PUBLIC_SITE_URL: envField.string({ context: 'server', access: 'public', default: 'https://lakeba.github.io/lakeba-web' }),
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
