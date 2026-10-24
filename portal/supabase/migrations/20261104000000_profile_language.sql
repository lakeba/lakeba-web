-- The portal language each person chose (Profile → Language). Empty means
-- "use the browser's language" when it is one we have, otherwise English.
alter table public.profiles add column locale text check (locale in ('en', 'es', 'it', 'zh'));
grant update (locale) on public.profiles to authenticated;
