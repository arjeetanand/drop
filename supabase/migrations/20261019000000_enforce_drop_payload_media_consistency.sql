alter table public.letters
  add constraint letters_payload_media_consistency_check
  check (
    (payload_kind = 'text' and media_path is null and media_mime_type is null and media_size_bytes is null)
    or (
      payload_kind = 'image'
      and media_path is not null
      and media_mime_type is not null
      and media_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and media_size_bytes is not null
    )
    or (
      payload_kind = 'gif'
      and media_path is not null
      and media_mime_type is not null
      and media_mime_type = 'image/gif'
      and media_size_bytes is not null
    )
  );
