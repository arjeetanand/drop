\set ON_ERROR_STOP on

begin;

create role anon;
create role authenticated;
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
\ir ../../supabase/migrations/20261018000100_relay_handoff_tokens.sql
\ir ../../supabase/migrations/20261020000000_carrier_route_summary.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username) values
  ('11111111-1111-4111-8111-111111111111', 'alice'),
  ('22222222-2222-4222-8222-222222222222', 'bobby'),
  ('33333333-3333-4333-8333-333333333333', 'other');
insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivery_mode, dispatched_at)
values
  ('relay', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Relay', 'private relay body', 'dispatched', 'relay', now()),
  ('relay-draft', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Draft relay', 'draft body', 'sealed', 'relay', null),
  ('instant', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Instant', 'instant body', 'delivered', 'instant', now());
insert into storage.objects (bucket_id, name, metadata)
values (
  'drop-media',
  '11111111-1111-4111-8111-111111111111/relay-gif/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '{"mimetype":"image/gif","size":123}'
);
insert into public.letters (
  id, sender_id, recipient_id, subject, content, status, delivery_mode,
  dispatched_at, payload_kind, media_path, media_mime_type, media_size_bytes
) values (
  'relay-gif', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  'GIF relay', 'private gif caption', 'dispatched', 'relay', now(), 'gif',
  '11111111-1111-4111-8111-111111111111/relay-gif/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'image/gif', 123
);

grant usage on schema auth, public to anon, authenticated;
grant select on public.letters to authenticated;
grant execute on function auth.uid() to anon, authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform * from public.issue_relay_handoff_token('relay');
    raise exception 'an unauthenticated user started a relay';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$ begin
  begin
    perform * from public.issue_relay_handoff_token('relay');
    raise exception 'a non-sender started a relay';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$ begin
  begin
    perform * from public.issue_relay_handoff_token('relay-draft');
    raise exception 'an unsent relay was started';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.issue_relay_handoff_token('instant');
    raise exception 'an instant drop was started as a relay';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare
  v_token uuid;
  v_expires_at timestamptz;
begin
  select token, expires_at into v_token, v_expires_at
  from public.issue_relay_handoff_token('relay');
  if v_token is null or v_expires_at <= now() or v_expires_at > now() + interval '11 minutes' then
    raise exception 'the sender did not receive a short-lived relay pass';
  end if;
  perform set_config('test.relay_initial_pass', v_token::text, true);
end $$;

do $$
declare
  v_token uuid;
  v_expires_at timestamptz;
begin
  select token, expires_at into v_token, v_expires_at
  from public.issue_relay_handoff_token('relay-gif');
  if v_token is null or v_expires_at <= now() or v_expires_at > now() + interval '11 minutes' then
    raise exception 'the sender did not receive a short-lived media relay pass';
  end if;
  perform set_config('test.media_relay_pass', v_token::text, true);
end $$;

reset role;
do $$ begin
  if (select count(*) from private.relay_handoff_tokens where token_kind = 'handoff') <> 2 then
    raise exception 'relay starts did not create exactly two private capabilities';
  end if;
end $$;

set local role anon;
do $$
declare
  v_handoff_id uuid;
  v_letter_id text;
  v_carrier_token uuid;
  v_carrier_expires_at timestamptz;
  v_retry_handoff_id uuid;
  v_retry_letter_id text;
  v_retry_carrier_token uuid;
  v_retry_expires_at timestamptz;
  v_route jsonb;
begin
  if (select count(*) from public.get_carrier_relay_route(current_setting('test.relay_initial_pass')::uuid)) <> 0
    or (select count(*) from public.get_carrier_relay_route('ffffffff-ffff-4fff-8fff-ffffffffffff')) <> 0 then
    raise exception 'a handoff or unknown token exposed a carrier route';
  end if;

  select handoff_id, letter_id, successor_token, successor_expires_at
    into v_handoff_id, v_letter_id, v_carrier_token, v_carrier_expires_at
  from public.accept_relay_handoff_token(
    current_setting('test.relay_initial_pass')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Mira', 'Bandra West', 'Met at the market.'
  );
  if v_letter_id <> 'relay' or v_handoff_id is null or v_carrier_token is null or v_carrier_expires_at <= now() then
    raise exception 'the first relay handoff did not return its carrier capability';
  end if;
  perform set_config('test.first_handoff_id', v_handoff_id::text, true);
  perform set_config('test.first_carrier_token', v_carrier_token::text, true);

  select pg_catalog.to_jsonb(route) into v_route
  from public.get_carrier_relay_route(v_carrier_token) as route;
  if (select count(*) from public.get_carrier_relay_route(v_carrier_token)) <> 1
    or v_route->>'carrier_name' <> 'Mira'
    or v_route->>'neighborhood' <> 'Bandra West'
    or v_route->>'carrier_note' <> 'Met at the market.' then
    raise exception 'the active carrier could not read its route summary';
  end if;
  if v_route ?| array['letter_id', 'subject', 'content', 'payload_kind', 'media_path', 'media_mime_type', 'media_size_bytes', 'handoff_lat', 'handoff_lng', 'accepted_lat', 'accepted_lng'] then
    raise exception 'the carrier route summary exposed letter, media, or precise location data';
  end if;

  select handoff_id, letter_id, successor_token, successor_expires_at
    into v_retry_handoff_id, v_retry_letter_id, v_retry_carrier_token, v_retry_expires_at
  from public.accept_relay_handoff_token(
    current_setting('test.relay_initial_pass')::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Mira', 'Bandra West', 'Met at the market.'
  );
  if v_retry_handoff_id <> v_handoff_id or v_retry_letter_id <> v_letter_id or v_retry_carrier_token <> v_carrier_token or v_retry_expires_at <> v_carrier_expires_at then
    raise exception 'an identical retry did not return the original handoff result';
  end if;

  begin
    perform * from public.accept_relay_handoff_token(
      current_setting('test.relay_initial_pass')::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Mira', 'Bandra West', 'Changed on retry.'
    );
    raise exception 'a mismatched retry reused a consumed pass';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.accept_relay_handoff_token(
      current_setting('test.relay_initial_pass')::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'Mira', 'Bandra West', 'Met at the market.'
    );
    raise exception 'a different request reused a consumed pass';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare
  v_result jsonb;
begin
  select pg_catalog.to_jsonb(result) into v_result
  from public.accept_relay_handoff_token(
    current_setting('test.media_relay_pass')::uuid,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'GIF Carrier', 'Bandra West', 'The sealed GIF stays private.'
  ) as result;
  if v_result->>'letter_id' <> 'relay-gif' or v_result->>'handoff_id' is null or v_result->>'successor_token' is null then
    raise exception 'the coordinate-free media relay handoff failed';
  end if;
  if v_result ?| array['subject', 'content', 'payload_kind', 'media_path', 'media_mime_type', 'media_size_bytes'] then
    raise exception 'the carrier handoff result exposed message or media data';
  end if;
end $$;

do $$
declare
  v_status record;
begin
  select * into v_status
  from public.get_relay_handoff_token_status(current_setting('test.relay_initial_pass')::uuid);
  if v_status.accepted is distinct from true or v_status.accepted_by <> 'Mira' or v_status.accepted_at is null then
    raise exception 'the outgoing carrier could not confirm acceptance without reading the drop';
  end if;
end $$;

do $$
declare
  v_first_pass uuid;
  v_second_pass uuid;
begin
  select token into v_first_pass
  from public.issue_relay_pass_from_carrier(current_setting('test.first_carrier_token')::uuid);
  select token into v_second_pass
  from public.issue_relay_pass_from_carrier(current_setting('test.first_carrier_token')::uuid);
  if v_first_pass = v_second_pass then
    raise exception 'issuing a fresh carrier pass reused the previous pass';
  end if;
  perform set_config('test.revoked_carrier_pass', v_first_pass::text, true);
  perform set_config('test.active_carrier_pass', v_second_pass::text, true);
end $$;

do $$ begin
  begin
    perform * from public.accept_relay_handoff_token(
      current_setting('test.revoked_carrier_pass')::uuid,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Noor', 'Dadar'
    );
    raise exception 'a superseded carrier pass was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare
  v_handoff_id uuid;
  v_letter_id text;
  v_carrier_token uuid;
  v_retry_handoff_id uuid;
  v_retry_carrier_token uuid;
  v_route jsonb;
begin
  select handoff_id, letter_id, successor_token
    into v_handoff_id, v_letter_id, v_carrier_token
  from public.accept_relay_handoff_token(
    current_setting('test.active_carrier_pass')::uuid,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'Noor', 'Dadar', 'Passed near the station.',
    19.05, 72.82, 19.04, 72.83
  );
  if v_letter_id <> 'relay' or v_handoff_id is null or v_carrier_token is null then
    raise exception 'a relay handoff with optional coordinates failed';
  end if;
  perform set_config('test.second_handoff_id', v_handoff_id::text, true);
  perform set_config('test.second_carrier_token', v_carrier_token::text, true);

  if (select count(*) from public.get_carrier_relay_route(current_setting('test.first_carrier_token')::uuid)) <> 0
    or (select count(*) from public.get_carrier_relay_route(v_carrier_token)) <> 2 then
    raise exception 'carrier route access did not follow active token ownership';
  end if;
  select pg_catalog.to_jsonb(route) into v_route
  from public.get_carrier_relay_route(v_carrier_token) as route
  where route.handoff_id = current_setting('test.second_handoff_id')::uuid;
  if v_route->>'carrier_name' <> 'Noor' or v_route->>'neighborhood' <> 'Dadar' or v_route->>'carrier_note' <> 'Passed near the station.' then
    raise exception 'the route summary omitted the latest carrier event';
  end if;
  if v_route ?| array['letter_id', 'subject', 'content', 'payload_kind', 'media_path', 'media_mime_type', 'media_size_bytes', 'handoff_lat', 'handoff_lng', 'accepted_lat', 'accepted_lng'] then
    raise exception 'the carrier route summary exposed letter, media, or precise location data';
  end if;

  select handoff_id, successor_token into v_retry_handoff_id, v_retry_carrier_token
  from public.accept_relay_handoff_token(
    current_setting('test.active_carrier_pass')::uuid,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'Noor', 'Dadar', 'Passed near the station.',
    19.05, 72.82, 19.04, 72.83
  );
  if v_retry_handoff_id <> v_handoff_id or v_retry_carrier_token <> v_carrier_token then
    raise exception 'an identical coordinate-bearing retry changed the handoff';
  end if;
end $$;

reset role;
do $$
declare
  v_handoff record;
begin
  if (select count(*) from public.relay_handoffs where letter_id = 'relay') <> 2 then
    raise exception 'retries created duplicate relay handoffs';
  end if;
  select * into v_handoff from public.relay_handoffs where id = current_setting('test.first_handoff_id')::uuid;
  if v_handoff.handoff_lat is not null or v_handoff.accepted_lat is not null then
    raise exception 'a handoff without coordinates unexpectedly stored coordinates';
  end if;
  select * into v_handoff from public.relay_handoffs where id = current_setting('test.second_handoff_id')::uuid;
  if v_handoff.handoff_lat <> 19.05 or v_handoff.handoff_lng <> 72.82 or v_handoff.accepted_lat <> 19.04 or v_handoff.accepted_lng <> 72.83 then
    raise exception 'the coordinate-bearing handoff did not preserve its coordinates';
  end if;
end $$;

grant select on public.letters to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$ begin
  if (select count(*) from public.relay_handoffs where letter_id = 'relay') <> 2 then
    raise exception 'the sender could not read relay handoffs';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if (select count(*) from public.relay_handoffs where letter_id = 'relay') <> 2 then
    raise exception 'the recipient could not read relay handoffs';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$ begin
  if (select count(*) from public.relay_handoffs where letter_id = 'relay') <> 0 then
    raise exception 'an unrelated carrier could read relay handoffs';
  end if;
  if (select count(*) from public.letters where id = 'relay') <> 0 then
    raise exception 'an unrelated carrier could read the drop message';
  end if;
  begin
    perform token from private.relay_handoff_tokens;
    raise exception 'an unrelated carrier could read private relay capabilities';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
