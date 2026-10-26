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
\ir ../../supabase/migrations/20261026110000_drop_push_notifications.sql
\ir ../../supabase/migrations/20261026120000_drop_push_recipient_scoped_delivery.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.profiles (id, username, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'push-sender', 'Push sender'),
  ('22222222-2222-4222-8222-222222222222', 'push-recipient-a', 'Recipient A'),
  ('33333333-3333-4333-8333-333333333333', 'push-recipient-b', 'Recipient B');

select public.manage_drop_push_subscription(
  'enable',
  '22222222-2222-4222-8222-222222222222',
  'https://fcm.googleapis.com/fcm/send/drop-account-switch-test',
  pg_catalog.repeat('A', 87),
  pg_catalog.repeat('B', 22)
);

insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivered_at)
values
  ('push-switch-a-leased', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'A leased', 'private', 'delivered', pg_catalog.now());

do $$
declare
  v_a_count integer;
begin
  select pg_catalog.count(*) into v_a_count
  from public.lease_drop_push_deliveries(1) leased
  join private.drop_push_outbox outbox on outbox.id = leased.event_id
  where outbox.recipient_id = '22222222-2222-4222-8222-222222222222';
  if v_a_count <> 1 then
    raise exception 'recipient A did not lease its own queued alert before the device switch';
  end if;
end
$$;

insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivered_at)
values
  ('push-switch-a-pending', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'A pending', 'private', 'delivered', pg_catalog.now());

select public.manage_drop_push_subscription(
  'enable',
  '33333333-3333-4333-8333-333333333333',
  'https://fcm.googleapis.com/fcm/send/drop-account-switch-test',
  pg_catalog.repeat('C', 87),
  pg_catalog.repeat('D', 22)
);

do $$
declare
  v_a_unresolved integer;
begin
  select pg_catalog.count(*) into v_a_unresolved
  from private.drop_push_deliveries delivery
  join private.drop_push_outbox outbox on outbox.id = delivery.event_id
  where outbox.recipient_id = '22222222-2222-4222-8222-222222222222'
    and delivery.state in ('pending', 'leased');
  if v_a_unresolved <> 0 then
    raise exception 'recipient A still has queued or leased alerts after the endpoint moved to B';
  end if;
end
$$;

-- A stale row can survive an enqueue racing the endpoint transfer. The lease
-- RPC must reject it against the subscription's current owner.
insert into private.drop_push_deliveries (event_id, subscription_id)
select outbox.id, subscription.id
from private.drop_push_outbox outbox
join private.drop_push_subscriptions subscription
  on subscription.endpoint = 'https://fcm.googleapis.com/fcm/send/drop-account-switch-test'
where outbox.letter_id = 'push-switch-a-pending'
on conflict (event_id, subscription_id) do nothing;

insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivered_at)
values
  ('push-switch-b', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'B current', 'private', 'delivered', pg_catalog.now());

do $$
declare
  v_b_count integer;
  v_a_leased integer;
  v_a_state text;
begin
  select pg_catalog.count(*) into v_b_count
  from public.lease_drop_push_deliveries(25) leased
  join private.drop_push_outbox outbox on outbox.id = leased.event_id
  where outbox.recipient_id = '33333333-3333-4333-8333-333333333333';
  if v_b_count <> 1 then
    raise exception 'recipient B did not receive exactly its own queued alert';
  end if;

  select pg_catalog.count(*) into v_a_leased
  from private.drop_push_deliveries delivery
  join private.drop_push_outbox outbox on outbox.id = delivery.event_id
  where outbox.recipient_id = '22222222-2222-4222-8222-222222222222'
    and delivery.state = 'leased';
  if v_a_leased <> 0 then
    raise exception 'recipient A alert was leased to the device now owned by B';
  end if;

  select delivery.state into v_a_state
  from private.drop_push_deliveries delivery
  join private.drop_push_outbox outbox on outbox.id = delivery.event_id
  where outbox.letter_id = 'push-switch-a-pending';
  if v_a_state is distinct from 'dead' then
    raise exception 'stale recipient A alert was not retired by the lease cleanup';
  end if;
end
$$;

rollback;
