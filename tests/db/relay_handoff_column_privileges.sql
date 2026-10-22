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
\ir ../../supabase/migrations/20261022000000_restrict_relay_handoff_column_select.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username) values
  ('11111111-1111-4111-8111-111111111111', 'alice'),
  ('22222222-2222-4222-8222-222222222222', 'bobby'),
  ('33333333-3333-4333-8333-333333333333', 'other');
insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivery_mode, dispatched_at)
values (
  'relay',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Relay',
  'private relay body',
  'dispatched',
  'relay',
  now()
);
insert into private.relay_handoff_tokens (token, letter_id, token_kind, expires_at)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'relay',
  'handoff',
  now() + interval '10 minutes'
);
insert into public.relay_handoffs (
  id,
  letter_id,
  source_token,
  request_id,
  carrier_name,
  neighborhood,
  note,
  handoff_lat,
  handoff_lng,
  accepted_lat,
  accepted_lng,
  created_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'relay',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Mira',
  'Bandra West',
  'Met at the market.',
  19.05,
  72.82,
  null,
  null,
  now()
);

grant usage on schema auth, public to anon, authenticated;
grant select on public.letters to authenticated;
grant execute on function auth.uid() to anon, authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
declare
  v_count integer;
begin
  select count(id) into v_count
  from public.relay_handoffs
  where letter_id = 'relay';
  if v_count <> 1 then
    raise exception 'the sender could not read an authorized handoff row';
  end if;

  perform id, letter_id, carrier_name, neighborhood, note,
    handoff_lat, handoff_lng, accepted_lat, accepted_lng, created_at
  from public.relay_handoffs
  where letter_id = 'relay';

  begin
    perform source_token from public.relay_handoffs where letter_id = 'relay';
    raise exception 'an authenticated participant could read the source bearer token';
  exception when insufficient_privilege then null;
  end;

  begin
    perform request_id from public.relay_handoffs where letter_id = 'relay';
    raise exception 'an authenticated participant could read the idempotency key';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
declare
  v_count integer;
begin
  select count(id) into v_count
  from public.relay_handoffs
  where letter_id = 'relay';
  if v_count <> 1 then
    raise exception 'the recipient lost participant access to route details';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
declare
  v_count integer;
begin
  select count(id) into v_count
  from public.relay_handoffs
  where letter_id = 'relay';
  if v_count <> 0 then
    raise exception 'an unrelated account could read a handoff row';
  end if;
end $$;

rollback;
