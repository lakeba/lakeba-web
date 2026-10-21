// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// SITE/BASE are set by the GitHub Pages workflow; once lakeba.com points here,
// set SITE=https://lakeba.com and leave BASE unset.
// https://astro.build/config
export default defineConfig({
  site: process.env.SITE ?? 'https://lakeba.com',
  base: process.env.BASE ?? '/',
  vite: {
    plugins: [tailwindcss()]
  }
});
