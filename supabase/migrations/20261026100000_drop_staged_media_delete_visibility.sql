-- PostgreSQL requires DELETE targets to pass an applicable SELECT policy too.
-- Let authenticated owners see their own unlinked staging rows only while the
-- Storage API is executing its bulk object-delete operation. This does not grant
-- permission to download or list staged media.
drop policy if exists "Drop owners can see staged media for removal" on storage.objects;
create policy "Drop owners can see staged media for removal" on storage.objects
for select to authenticated using (
  bucket_id = 'drop-media'
  and split_part(name, '/', 1) = auth.uid()::text
  and split_part(name, '/', 2) = 'pending'
  and array_length(string_to_array(name, '/'), 1) in (4, 5)
  and not exists (
    select 1 from public.letters l where l.media_path = name
  )
  and storage.allow_only_operation('object.delete_many')
);
