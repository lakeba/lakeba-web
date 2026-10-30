-- Guided tours (src/lib/tours.ts): the tours each person has finished or skipped, so a tour starts by
-- itself only once, on any device. "Take the tour" in the profile menu replays them. Written by the
-- portal with the service key on the person's own behalf.
alter table public.profiles add column if not exists tours_seen text[] not null default '{}';
