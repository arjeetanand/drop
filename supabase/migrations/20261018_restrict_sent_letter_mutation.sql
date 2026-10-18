drop policy if exists "Users can update their letters" on public.letters;
create policy "Users can update their unsent letters" on public.letters
  for update
  using (auth.uid() = sender_id and status in ('draft', 'sealed'))
  with check (auth.uid() = sender_id);

drop policy if exists "Users can delete their letters" on public.letters;
create policy "Users can delete their unsent letters" on public.letters
  for delete
  using (auth.uid() = sender_id and status in ('draft', 'sealed'));
