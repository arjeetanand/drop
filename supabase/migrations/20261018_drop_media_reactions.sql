alter table public.letters
  add column if not exists payload_kind text not null default 'text',
  add column if not exists delivery_mode text not null default 'instant',
  add column if not exists media_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_size_bytes integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'letters_payload_kind_check') then
    alter table public.letters add constraint letters_payload_kind_check check (payload_kind in ('text', 'image', 'gif'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'letters_delivery_mode_check') then
    alter table public.letters add constraint letters_delivery_mode_check check (delivery_mode in ('instant', 'relay'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'letters_media_size_bytes_check') then
    alter table public.letters add constraint letters_media_size_bytes_check check (media_size_bytes is null or media_size_bytes between 1 and 8388608);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'letters_media_mime_type_check') then
    alter table public.letters add constraint letters_media_mime_type_check check (media_mime_type is null or media_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif'));
  end if;
end $$;

create table if not exists public.letter_reactions (
  letter_id text primary key references public.letters(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('💜', '🔥', '😂', '🥹', '🫶')),
  updated_at timestamptz not null default now()
);

alter table public.letter_reactions enable row level security;
drop policy if exists "Drop participants can read reactions" on public.letter_reactions;
drop policy if exists "Recipients can add reactions" on public.letter_reactions;
drop policy if exists "Recipients can change reactions" on public.letter_reactions;

create policy "Drop participants can read reactions" on public.letter_reactions for select using (
  exists (select 1 from public.letters l where l.id = letter_id and (l.sender_id = auth.uid() or l.recipient_id = auth.uid()))
);
create policy "Recipients can add reactions" on public.letter_reactions for insert with check (
  recipient_id = auth.uid() and exists (select 1 from public.letters l where l.id = letter_id and l.recipient_id = auth.uid())
);
create policy "Recipients can change reactions" on public.letter_reactions for update using (recipient_id = auth.uid()) with check (
  recipient_id = auth.uid() and exists (select 1 from public.letters l where l.id = letter_id and l.recipient_id = auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drop-media', 'drop-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Drop owners can upload their media" on storage.objects;
drop policy if exists "Drop participants can read media" on storage.objects;
drop policy if exists "Drop owners can remove media" on storage.objects;

create policy "Drop owners can upload their media" on storage.objects for insert with check (
  bucket_id = 'drop-media' and split_part(name, '/', 1) = auth.uid()::text
);
create policy "Drop participants can read media" on storage.objects for select using (
  bucket_id = 'drop-media' and exists (
    select 1 from public.letters l
    where l.media_path = name and (l.sender_id = auth.uid() or l.recipient_id = auth.uid())
  )
);
create policy "Drop owners can remove media" on storage.objects for delete using (
  bucket_id = 'drop-media' and split_part(name, '/', 1) = auth.uid()::text
);
