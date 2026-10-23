-- Company logos, uploaded in Admin → Ventures and saved on entities.logo_url.
-- Private bucket: logos are served through the portal (/company-logo/<file>),
-- like documents, so storage never has to be reachable from browsers.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy "logos bucket: signed-in read"
  on storage.objects for select to authenticated
  using (bucket_id = 'logos');
create policy "logos bucket: admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_admin());
create policy "logos bucket: admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_admin());
create policy "logos bucket: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_admin());
