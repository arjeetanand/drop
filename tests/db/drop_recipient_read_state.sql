\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin';
  end if;
end
$$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

\ir ../../supabase/migrations/20260823000000_dear_exe.sql

-- Keep the production status set relevant to this policy fixture. Assigning a
-- recipient to claim_pending is intentionally synthetic: it isolates the
-- delivered-only guard from the separate missing-recipient guard.
alter table public.letters drop constraint letters_status_check;
alter table public.letters add constraint letters_status_check
  check (status in ('draft', 'sealed', 'claim_pending', 'dispatched', 'delivered'));
create schema private;

\ir ../../supabase/migrations/20261025100000_recipient_drop_read_state.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'sender', 'Sender'),
  ('22222222-2222-4222-8222-222222222222', 'recipient', 'Recipient'),
  ('33333333-3333-4333-8333-333333333333', 'outsider', 'Outsider');
insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivered_at)
values
  ('read-delivered', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Delivered', 'Body', 'delivered', pg_catalog.now()),
  ('read-claim-pending', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Pending claim', 'Body', 'claim_pending', null),
  ('read-dispatched', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'In transit', 'Body', 'dispatched', null);

grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select on public.letters to authenticated;

select set_config('test.sender', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.recipient', '22222222-2222-4222-8222-222222222222', true);
select set_config('test.outsider', '33333333-3333-4333-8333-333333333333', true);

do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.mark_recipient_drop_read(text)', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.mark_recipient_drop_read(text)', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.get_recipient_drop_read_states(text[])', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.get_recipient_drop_read_states(text[])', 'execute') then
    raise exception 'read-state RPC grants are not limited to authenticated users';
  end if;
  if pg_catalog.has_schema_privilege('authenticated', 'private', 'usage')
    or pg_catalog.has_table_privilege('authenticated', 'private.recipient_drop_reads', 'select')
    or pg_catalog.has_table_privilege('anon', 'private.recipient_drop_reads', 'select') then
    raise exception 'clients can access the private recipient read-state table directly';
  end if;
end
$$;

-- Anonymous callers cannot invoke either RPC, even with a valid drop ID.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.mark_recipient_drop_read('read-delivered');
    raise exception 'anonymous users invoked the recipient read marker';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_recipient_drop_read_states(array['read-delivered']);
    raise exception 'anonymous users read recipient mailbox state';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- The sender cannot read the receipt or create one under the sender identity.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$
declare
  v_read_at timestamptz;
begin
  if exists (select 1 from public.get_recipient_drop_read_states(array['read-delivered'])) then
    raise exception 'the sender read a recipient read receipt';
  end if;
  v_read_at := public.mark_recipient_drop_read('read-delivered');
  if v_read_at is not null then
    raise exception 'the sender marked a recipient drop as read';
  end if;
  begin
    perform * from private.recipient_drop_reads;
    raise exception 'the sender read the private read-state table';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- The addressed recipient can mark a delivered drop once and retrieve the
-- original timestamp on later calls. Non-delivered states remain excluded.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$
declare
  v_first timestamptz;
  v_again timestamptz;
  v_observed timestamptz;
  v_count bigint;
begin
  if exists (select 1 from public.get_recipient_drop_read_states(array['read-delivered'])) then
    raise exception 'a read timestamp existed before the recipient opened the drop';
  end if;

  v_first := public.mark_recipient_drop_read('read-delivered');
  if v_first is null then
    raise exception 'the delivered recipient could not mark the drop as read';
  end if;

  select s.read_at into v_observed
  from public.get_recipient_drop_read_states(array['read-delivered']) s;
  if v_observed is distinct from v_first then
    raise exception 'the recipient could not read their own timestamp';
  end if;

  v_again := public.mark_recipient_drop_read('read-delivered');
  if v_again is distinct from v_first then
    raise exception 'repeating the mark changed its timestamp';
  end if;

  select count(*) into v_count
  from public.get_recipient_drop_read_states(array['read-delivered', 'read-claim-pending', 'read-dispatched']);
  if v_count <> 1 then
    raise exception 'recipient state returned a pending or in-transit drop';
  end if;

  if public.mark_recipient_drop_read('read-claim-pending') is not null then
    raise exception 'claim_pending drop was marked read';
  end if;
  if public.mark_recipient_drop_read('read-dispatched') is not null then
    raise exception 'dispatched in-transit drop was marked read';
  end if;

  begin
    perform * from private.recipient_drop_reads;
    raise exception 'the recipient read the private table directly';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- A different authenticated account cannot read or mark the recipient's drop.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.outsider'), true);
do $$
declare
  v_read_at timestamptz;
begin
  if exists (select 1 from public.get_recipient_drop_read_states(array['read-delivered'])) then
    raise exception 'an unrelated account read a recipient read receipt';
  end if;
  v_read_at := public.mark_recipient_drop_read('read-delivered');
  if v_read_at is not null then
    raise exception 'an unrelated account marked another user’s drop as read';
  end if;
  begin
    perform * from private.recipient_drop_reads;
    raise exception 'an unrelated account read the private read-state table';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Owner-side assertions prove every denied call left no marker behind and
-- exactly one recipient-owned marker exists for the delivered drop.
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from private.recipient_drop_reads
  where letter_id = 'read-delivered'
    and recipient_id = current_setting('test.recipient')::uuid;
  if v_count <> 1 then
    raise exception 'the delivered drop does not have exactly one recipient read marker';
  end if;
  if exists (
    select 1 from private.recipient_drop_reads
    where (letter_id = 'read-delivered' and recipient_id <> current_setting('test.recipient')::uuid)
      or letter_id in ('read-claim-pending', 'read-dispatched')
  ) then
    raise exception 'a denied sender, outsider, claim_pending, or in-transit call created read state';
  end if;
end
$$;

rollback;
