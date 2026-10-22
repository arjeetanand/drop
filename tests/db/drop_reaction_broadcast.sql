\set ON_ERROR_STOP on

begin;

create role anon;
create role authenticated;
create schema auth;
create schema storage;
create schema realtime;

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

-- A transaction-local recorder gives this SQL regression deterministic access
-- to the exact arguments sent to Realtime without requiring a WebSocket client.
create table realtime.messages (
  id bigint generated always as identity primary key,
  extension text not null,
  topic text not null,
  event text not null,
  payload jsonb not null,
  is_private boolean not null
);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('test.realtime_topic', true), '')
$$;
create function realtime.send(payload jsonb, event text, topic text, is_private boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into realtime.messages (extension, topic, event, payload, is_private)
  values ('broadcast', $3, $2, $1, $4)
$$;
-- Assertions about emitted messages run as the recipient too, who must not be
-- able to read the sender's private topic through the production RLS policy.
create function realtime.test_broadcast_count(p_event text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select count(*) from realtime.messages where event = p_event
$$;
revoke all on function realtime.test_broadcast_count(text) from public, anon;
grant execute on function realtime.test_broadcast_count(text) to authenticated;

\ir ../../supabase/migrations/20260823000000_dear_exe.sql
\ir ../../supabase/migrations/20261018000000_drop_media_reactions.sql
\ir ../../supabase/migrations/20261022100000_drop_inbox_broadcast.sql
\ir ../../supabase/migrations/20261022110000_drop_reaction_broadcast.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username) values
  ('11111111-1111-4111-8111-111111111111', 'sender'),
  ('22222222-2222-4222-8222-222222222222', 'recipient'),
  ('33333333-3333-4333-8333-333333333333', 'outsider');
insert into public.letters (id, sender_id, recipient_id, subject, content, status)
values (
  'reaction-drop',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Private drop title',
  'Private drop body',
  'delivered'
), (
  'reaction-drop-other',
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'Another private drop title',
  'Another private drop body',
  'delivered'
);

grant usage on schema auth, public, realtime to anon, authenticated;
grant select on public.letters to authenticated;
grant select, insert, update on public.letter_reactions to authenticated;
grant select on realtime.messages to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
insert into public.letter_reactions (letter_id, recipient_id, emoji)
values ('reaction-drop', '22222222-2222-4222-8222-222222222222', '🫶');

do $$
declare
  v_count bigint;
begin
  select realtime.test_broadcast_count('drop_reaction_received') into v_count;
  if v_count <> 1 then
    raise exception 'the first reaction did not emit exactly one sender signal';
  end if;
end
$$;

update public.letter_reactions
set emoji = '🫶', updated_at = updated_at + interval '1 second'
where letter_id = 'reaction-drop';

do $$
declare
  v_count bigint;
begin
  select realtime.test_broadcast_count('drop_reaction_received') into v_count;
  if v_count <> 1 then
    raise exception 're-saving the same emoji emitted a duplicate sender signal';
  end if;
end
$$;

update public.letter_reactions
set emoji = '🔥'
where letter_id = 'reaction-drop';

do $$
begin
  begin
    update public.letter_reactions
    set letter_id = 'reaction-drop-other'
    where letter_id = 'reaction-drop';

    raise exception 'changing a reaction drop was unexpectedly allowed';
  exception
    when check_violation then null;
  end;

  if not exists (
    select 1
    from public.letter_reactions
    where letter_id = 'reaction-drop'
      and recipient_id = '22222222-2222-4222-8222-222222222222'
      and emoji = '🔥'
  ) then
    raise exception 'the rejected move changed or removed the original reaction';
  end if;
  if exists (
    select 1
    from public.letter_reactions
    where letter_id = 'reaction-drop-other'
  ) then
    raise exception 'the rejected move created a reaction on another drop';
  end if;
end
$$;

reset role;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from realtime.messages
  where event = 'drop_reaction_received';
  if v_count <> 2 then
    raise exception 'reaction changes emitted the wrong number of sender signals, including for the rejected move';
  end if;
  if exists (
    select 1
    from realtime.messages
    where event = 'drop_reaction_received'
      and (
        topic <> 'user:11111111-1111-4111-8111-111111111111:drop-reactions'
        or payload <> jsonb_build_object('drop_id', 'reaction-drop')
        or not is_private
      )
  ) then
    raise exception 'a reaction signal contained data beyond the drop id or used the wrong private sender topic';
  end if;
end
$$;

insert into realtime.messages (extension, topic, event, payload, is_private)
values (
  'presence',
  'user:11111111-1111-4111-8111-111111111111:drop-reactions',
  'test_presence',
  '{}'::jsonb,
  true
);

-- Realtime authorization is limited to authenticated reads on the exact
-- sender topic; neither the recipient, an outsider, another topic, nor anon
-- may read these signals.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.realtime_topic', 'user:11111111-1111-4111-8111-111111111111:drop-reactions', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from realtime.messages where event = 'drop_reaction_received';
  if v_count <> 2 then raise exception 'the sender could not read reaction signals on their own topic'; end if;
  if exists (select 1 from realtime.messages where event = 'test_presence') then
    raise exception 'the sender policy allowed a non-broadcast Realtime message';
  end if;
end
$$;

select set_config('test.realtime_topic', 'user:22222222-2222-4222-8222-222222222222:drop-reactions', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from realtime.messages where event = 'drop_reaction_received';
  if v_count <> 0 then raise exception 'the recipient could read the sender reaction signal'; end if;
end
$$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.realtime_topic', 'user:11111111-1111-4111-8111-111111111111:drop-inbox', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from realtime.messages where event = 'drop_reaction_received';
  if v_count <> 0 then raise exception 'the sender could read reaction signals on a different topic'; end if;
end
$$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select set_config('test.realtime_topic', 'user:11111111-1111-4111-8111-111111111111:drop-reactions', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from realtime.messages where event = 'drop_reaction_received';
  if v_count <> 0 then raise exception 'an unrelated account could read the sender reaction signal'; end if;
end
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.realtime_topic', 'user:11111111-1111-4111-8111-111111111111:drop-reactions', true);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from realtime.messages where event = 'drop_reaction_received';
  if v_count <> 0 then raise exception 'an anonymous account could read the sender reaction signal'; end if;
end
$$;

rollback;
