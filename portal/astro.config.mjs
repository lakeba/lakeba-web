// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// Server-rendered: every page checks the session. The Node adapter keeps the
// app host-agnostic until the hosting decision (Vercel or Cloudflare) is made.
// https://astro.build/config
export default defineConfig({
  output: 'server',
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
      MAIL_FROM: envField.string({ context: 'server', access: 'public', default: 'Lakeba Investor Relations <investors@lakeba.com>' }),
      ANTHROPIC_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Where public News & Media articles live (the marketing site).
      PUBLIC_SITE_URL: envField.string({ context: 'server', access: 'public', default: 'https://lakeba.github.io/lakeba-web' }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // The portal shares brand styles and the logo with the marketing site.
    server: { fs: { allow: ['..'] } },
  },
});
