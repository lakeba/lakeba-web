# lakeba.com

The public website of Lakeba Group: home, ventures, news and press. Built with [Astro](https://astro.build) and Tailwind CSS.

## Run it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static site in dist/
```

## Where things are

- `src/pages/`: the pages (home, news, press, sitemaps, robots.txt, old WordPress addresses in `[legacy].astro`).
- `src/content/news/`: news articles (Markdown). At build time, news published in the investor portal is added from `NEWS_FEED_URL` (its public news feed).
- `src/components/`, `src/layouts/`, `src/styles/brand.css`: the brand, shared in spirit with the investor portal (which keeps its own copy).
- `public/`: images, the favicon and the IndexNow key.

## Publishing

`.github/workflows/deploy.yml` ("Deploy to GitHub Pages") builds and publishes the site. It runs by hand from the Actions tab, or when the investor portal asks for a rebuild after news is published. `SITE` and `BASE` are set by the workflow; once lakeba.com points here, set `SITE=https://lakeba.com` and leave `BASE` unset.

The investor portal is a separate, private project.
