## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Portal: when a feature is added, changed or removed

The investor portal (`portal/`) describes its own features in several places. When a change adds,
changes or removes something people use, go through this list in the same change:

1. **Notifications** (`src/lib/notification-events.ts`): does it tell anyone about something new? Add
   or update a topic: its kinds, a push text, `section` and `for` for admin topics, `when` for investor
   topics that only some people have. Remove topics nothing sends any more.
2. **API** (`src/lib/api/spec.ts`, `scopes.ts`): new or changed `/api/v1` routes in the reference, with
   their scope and an example. The `/developers` pages are built from it.
3. **Webhooks**: new audit actions that matter outside the portal mapped to an event in a migration
   (`audit_to_event`), and the event described in `EVENTS` (`src/lib/integrations/events.ts`).
4. **Admin menu and access**: the page in `src/layouts/Admin.astro` or its section's tabs, its area in
   `src/lib/permissions.ts` (and any exception in `src/lib/access.ts`), the built-in roles' defaults,
   and `src/lib/admin-paths.ts` if its address differs from its file.
5. **Translations**: every investor-facing `t('…')` text in `src/i18n/` in Spanish, Italian and Chinese.
6. **What's new** (`src/lib/whats-new.ts`): one line for changes people would notice.
7. **Guided tours** (`src/lib/tours.ts`): if the change moves or removes something a tour points at
   (`data-tour="…"`), update the tour; a feature people should be shown can get a short tour and a
   `tour:` on its What's new line ("Show me"). Shareholder tours need translations too.
8. **Docs**: `portal/docs/` (deploy, integrations, online meetings…) and the Android app (`android/`)
   when the change touches them.

`npm run check:portal` (in `portal/`) checks 1–5 and 7 and reminds about 6. It runs before every deploy and
monthly (`.github/workflows/portal-checks.yml`). It can't judge whether something *should* notify
people or appear in What's new: that part is this list.
