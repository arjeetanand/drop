\set ON_ERROR_STOP on

begin;

create role drop_policy_smoke_authenticated;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null,
  file_size_limit bigint not null,
  allowed_mime_types text[] not null
);
create table storage.objects (
  bucket_id text not null,
  name text not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (bucket_id, name)
);
alter table storage.objects enable row level security;

\ir ../../supabase/migrations/20260823000000_dear_exe.sql
\ir ../../supabase/migrations/20261018000000_drop_media_reactions.sql
\ir ../../supabase/migrations/20261018000200_restrict_sent_letter_mutation.sql
\ir ../../supabase/migrations/20261018000300_z_preserve_sent_drop_integrity.sql
\ir ../../supabase/migrations/20261018000400_zz_validated_drop_media.sql
\ir ../../supabase/migrations/20261019000000_enforce_drop_payload_media_consistency.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username) values
  ('11111111-1111-4111-8111-111111111111', 'alice'),
  ('22222222-2222-4222-8222-222222222222', 'bobby'),
  ('33333333-3333-4333-8333-333333333333', 'other');
insert into storage.objects (bucket_id, name, metadata) values
  ('drop-media', '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/orphan/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/bad/cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/sent/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/staging-path/dddddddd-dddd-4ddd-8ddd-dddddddddddd', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/pending/draft/photo.png', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/mismatch-image/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '{"mimetype":"image/gif","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/mismatch-gif/ffffffff-ffff-4fff-8fff-ffffffffffff', '{"mimetype":"image/png","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/gif-sent/88888888-8888-4888-8888-888888888888', '{"mimetype":"image/gif","size":123}'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/mismatch-text/99999999-9999-4999-8999-999999999999', '{"mimetype":"image/png","size":123}');
insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
values
  ('draft', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Draft', 'draft body', 'draft', null, null, null, 'text', 'instant'),
  ('sent', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Sent', 'sent body', 'delivered', '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'image/png', 123, 'image', 'instant'),
  ('gif-sent', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'GIF sent', '', 'delivered', '11111111-1111-4111-8111-111111111111/gif-sent/88888888-8888-4888-8888-888888888888', 'image/gif', 123, 'gif', 'instant');

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
  values ('bad', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Bad metadata', 'bad', 'delivered', '11111111-1111-4111-8111-111111111111/bad/cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'image/jpeg', 123, 'image', 'instant');
  raise exception 'a drop stored media metadata that disagrees with the object';
exception when check_violation then
  null;
end $$;

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
  values ('bad-path', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Bad path', 'bad', 'delivered', '11111111-1111-4111-8111-111111111111/sent/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'image/png', 123, 'image', 'instant');
  raise exception 'a drop linked media under another draft ID';
exception when check_violation then
  null;
end $$;

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
  values ('staging-path', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Bad', 'bad', 'delivered', '11111111-1111-4111-8111-111111111111/pending/draft/photo.png', 'image/png', 123, 'image', 'instant');
  raise exception 'a sent drop linked to an unvalidated staging object';
exception when check_violation then
  null;
end $$;

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
  values ('mismatch-image', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Wrong image kind', '', 'delivered', '11111111-1111-4111-8111-111111111111/mismatch-image/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'image/gif', 123, 'image', 'instant');
  raise exception 'an image payload was saved with GIF media';
exception when check_violation then
  null;
end $$;

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
  values ('mismatch-gif', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Wrong GIF kind', '', 'delivered', '11111111-1111-4111-8111-111111111111/mismatch-gif/ffffffff-ffff-4fff-8fff-ffffffffffff', 'image/png', 123, 'gif', 'instant');
  raise exception 'a GIF payload was saved with static image media';
exception when check_violation then
  null;
end $$;

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_mime_type, media_size_bytes, payload_kind, delivery_mode)
  values ('mismatch-text', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Wrong text kind', 'text', 'delivered', '11111111-1111-4111-8111-111111111111/mismatch-text/99999999-9999-4999-8999-999999999999', 'image/png', 123, 'text', 'instant');
  raise exception 'a text payload was saved with media attached';
exception when check_violation then
  null;
end $$;

alter table public.letters disable trigger letters_validate_drop_media_object;
do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_size_bytes, payload_kind, delivery_mode)
  values ('missing-image-mime', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Missing image MIME', '', 'delivered', '11111111-1111-4111-8111-111111111111/missing-image-mime/77777777-7777-4777-8777-777777777777', 123, 'image', 'instant');
  raise exception 'an image payload was saved without a MIME type';
exception when check_violation then
  null;
end $$;

do $$ begin
  insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path, media_size_bytes, payload_kind, delivery_mode)
  values ('missing-gif-mime', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Missing GIF MIME', '', 'delivered', '11111111-1111-4111-8111-111111111111/missing-gif-mime/66666666-6666-4666-8666-666666666666', 123, 'gif', 'instant');
  raise exception 'a GIF payload was saved without a MIME type';
exception when check_violation then
  null;
end $$;
alter table public.letters enable trigger letters_validate_drop_media_object;

grant usage on schema auth, public, storage to drop_policy_smoke_authenticated;
grant select on public.letters to drop_policy_smoke_authenticated;
grant update on public.letters to drop_policy_smoke_authenticated;
grant select, insert, update on public.letter_reactions to drop_policy_smoke_authenticated;
grant select, insert, delete on storage.objects to drop_policy_smoke_authenticated;
grant execute on function auth.uid() to drop_policy_smoke_authenticated;

set local role drop_policy_smoke_authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  actual_status text;
  actual_content text;
  actual_emoji text;
  visible_media integer;
begin
  update public.letters set status = 'sealed', content = 'edited draft' where id = 'draft';
  select status, content into actual_status, actual_content from public.letters where id = 'draft';
  if actual_status <> 'sealed' or actual_content <> 'edited draft' then
    raise exception 'sender could not edit an unsent draft';
  end if;

  begin
    update public.letters set status = 'delivered', content = 'tampered' where id = 'draft';
    raise exception 'sender promoted an unsent draft to sent';
  exception when insufficient_privilege then
    null;
  end;
  select status, content into actual_status, actual_content from public.letters where id = 'draft';
  if actual_status <> 'sealed' or actual_content <> 'edited draft' then
    raise exception 'sender promoted an unsent draft to sent';
  end if;

  update public.letters set content = 'tampered' where id = 'sent';
  select content into actual_content from public.letters where id = 'sent';
  if actual_content <> 'sent body' then
    raise exception 'sender changed a sent letter';
  end if;

  delete from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if not exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'sender deleted media linked to a sent drop';
  end if;
  delete from storage.objects where name = '11111111-1111-4111-8111-111111111111/orphan/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/orphan/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then
    raise exception 'sender could not delete an unlinked upload';
  end if;

  insert into storage.objects (bucket_id, name) values ('drop-media', '11111111-1111-4111-8111-111111111111/pending/draft/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  begin
    insert into storage.objects (bucket_id, name) values ('drop-media', '11111111-1111-4111-8111-111111111111/draft/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    raise exception 'sender uploaded directly to a final media path';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into visible_media from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if visible_media <> 1 then raise exception 'sender could not read their linked media'; end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  select count(*) into visible_media from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if visible_media <> 1 then raise exception 'recipient could not read linked media'; end if;

  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  select count(*) into visible_media from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if visible_media <> 0 then raise exception 'unrelated user could read linked media'; end if;

  begin
    insert into public.letter_reactions (letter_id, recipient_id, emoji)
    values ('sent', '33333333-3333-4333-8333-333333333333', '🔥');
    raise exception 'unrelated user added a reaction';
  exception when insufficient_privilege then
    null;
  end;
  if exists (select 1 from public.letter_reactions where letter_id = 'sent') then
    raise exception 'unrelated user could read a reaction';
  end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  insert into public.letter_reactions (letter_id, recipient_id, emoji)
  values ('sent', '22222222-2222-4222-8222-222222222222', '🫶');
  update public.letter_reactions set emoji = '🔥' where letter_id = 'sent';
  select emoji into actual_emoji from public.letter_reactions where letter_id = 'sent';
  if actual_emoji <> '🔥' then raise exception 'recipient could not add or change a reaction'; end if;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  select emoji into actual_emoji from public.letter_reactions where letter_id = 'sent';
  if actual_emoji <> '🔥' then raise exception 'sender could not read the recipient reaction'; end if;
  begin
    insert into public.letter_reactions (letter_id, recipient_id, emoji)
    values ('draft', '11111111-1111-4111-8111-111111111111', '😂');
    raise exception 'sender added a reaction';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

rollback;
