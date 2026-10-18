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
  primary key (bucket_id, name)
);
alter table storage.objects enable row level security;

\ir ../../supabase/migrations/20260823_dear_exe.sql
\ir ../../supabase/migrations/20261018_drop_media_reactions.sql
\ir ../../supabase/migrations/20261018_restrict_sent_letter_mutation.sql
\ir ../../supabase/migrations/20261018_z_preserve_sent_drop_integrity.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username) values
  ('11111111-1111-4111-8111-111111111111', 'alice'),
  ('22222222-2222-4222-8222-222222222222', 'bobby'),
  ('33333333-3333-4333-8333-333333333333', 'other');
insert into public.letters (id, sender_id, recipient_id, subject, content, status, media_path)
values
  ('draft', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Draft', 'draft body', 'draft', null),
  ('sent', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Sent', 'sent body', 'delivered', '11111111-1111-4111-8111-111111111111/sent/photo.png');
insert into storage.objects (bucket_id, name) values
  ('drop-media', '11111111-1111-4111-8111-111111111111/sent/photo.png'),
  ('drop-media', '11111111-1111-4111-8111-111111111111/orphan/photo.png');

grant usage on schema auth, public, storage to drop_policy_smoke_authenticated;
grant select on public.letters to drop_policy_smoke_authenticated;
grant update on public.letters to drop_policy_smoke_authenticated;
grant select, delete on storage.objects to drop_policy_smoke_authenticated;
grant execute on function auth.uid() to drop_policy_smoke_authenticated;

set local role drop_policy_smoke_authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $$
declare
  actual_status text;
  actual_content text;
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

  delete from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/photo.png';
  if not exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/photo.png') then
    raise exception 'sender deleted media linked to a sent drop';
  end if;
  delete from storage.objects where name = '11111111-1111-4111-8111-111111111111/orphan/photo.png';
  if exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/orphan/photo.png') then
    raise exception 'sender could not delete an unlinked upload';
  end if;

  select count(*) into visible_media from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/photo.png';
  if visible_media <> 1 then raise exception 'sender could not read their linked media'; end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  select count(*) into visible_media from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/photo.png';
  if visible_media <> 1 then raise exception 'recipient could not read linked media'; end if;

  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  select count(*) into visible_media from storage.objects where name = '11111111-1111-4111-8111-111111111111/sent/photo.png';
  if visible_media <> 0 then raise exception 'unrelated user could read linked media'; end if;
end
$$;

rollback;
