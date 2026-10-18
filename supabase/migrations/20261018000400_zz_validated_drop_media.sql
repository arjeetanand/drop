alter table public.letters
  drop constraint if exists letters_media_path_staging_check,
  drop constraint if exists letters_media_path_shape_check;
-- NOT VALID preserves legacy paths while enforcing this shape on new and changed rows.
alter table public.letters
  add constraint letters_media_path_shape_check
  check (
    media_path is null or (
      array_length(string_to_array(media_path, '/'), 1) = 3
      and split_part(media_path, '/', 1) = sender_id::text
      and split_part(media_path, '/', 2) = id
      and split_part(media_path, '/', 3) ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
    )
  ) not valid;

create or replace function public.validate_drop_media_object()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  object_metadata jsonb;
  object_size text;
begin
  if new.media_path is null then
    if new.media_mime_type is not null or new.media_size_bytes is not null then
      raise exception 'Drop media metadata requires a media object.' using errcode = '23514';
    end if;
    return new;
  end if;

  select objects.metadata into object_metadata
  from storage.objects as objects
  where objects.bucket_id = 'drop-media' and objects.name = new.media_path;
  if not found or object_metadata is null then
    raise exception 'Drop media object does not exist.' using errcode = '23514';
  end if;

  object_size := object_metadata->>'size';
  if object_metadata->>'mimetype' is distinct from new.media_mime_type
    or object_size is null
    or object_size !~ '^[0-9]+$'
    or object_size::bigint is distinct from new.media_size_bytes::bigint then
    raise exception 'Drop media metadata does not match its stored object.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists letters_validate_drop_media_object on public.letters;
create trigger letters_validate_drop_media_object
before insert or update of media_path, media_mime_type, media_size_bytes on public.letters
for each row execute function public.validate_drop_media_object();

drop policy if exists "Drop owners can upload their media" on storage.objects;
drop policy if exists "Drop owners can stage their media" on storage.objects;
create policy "Drop owners can stage their media" on storage.objects for insert with check (
  bucket_id = 'drop-media'
  and split_part(name, '/', 1) = auth.uid()::text
  and split_part(name, '/', 2) = 'pending'
  and array_length(string_to_array(name, '/'), 1) = 4
  and split_part(name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
  and split_part(name, '/', 4) ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
);
