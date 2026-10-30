-- Profile photos, chosen and cropped on Profile and saved on profiles.avatar_path.
-- Private bucket: photos are served through the portal (/avatar/<file>) to signed-in
-- people only, and written with the service key on the person's own behalf.
alter table public.profiles add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
