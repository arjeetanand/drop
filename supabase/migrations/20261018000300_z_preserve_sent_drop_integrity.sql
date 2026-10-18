drop policy if exists "Users can update their unsent letters" on public.letters;
create policy "Users can update their unsent letters" on public.letters
  for update
  using (auth.uid() = sender_id and status in ('draft', 'sealed'))
  with check (auth.uid() = sender_id and status in ('draft', 'sealed'));

drop policy if exists "Drop owners can remove media" on storage.objects;
create policy "Drop owners can remove media" on storage.objects for delete using (
  bucket_id = 'drop-media'
  and split_part(name, '/', 1) = auth.uid()::text
  and not exists (
    select 1 from public.letters l where l.media_path = name
  )
);
