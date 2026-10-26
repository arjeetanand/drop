-- Web Push subscriptions and delivery work are server-only. The Edge Functions
-- verify caller identity and use narrowly scoped service-role RPCs; clients
-- never receive subscription keys, endpoints, or outbox rows.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.drop_push_subscriptions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (pg_catalog.octet_length(endpoint) between 32 and 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{40,126}={0,2}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{16,126}={0,2}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com)/[^[:space:]]+$')
);

create index drop_push_subscriptions_user_idx
  on private.drop_push_subscriptions(user_id, id);

alter table private.drop_push_subscriptions enable row level security;
revoke all on table private.drop_push_subscriptions from public, anon, authenticated, service_role;

create table private.drop_push_outbox (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  letter_id text not null references public.letters(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (letter_id, recipient_id)
);

alter table private.drop_push_outbox enable row level security;
revoke all on table private.drop_push_outbox from public, anon, authenticated, service_role;

create table private.drop_push_deliveries (
  id bigint generated always as identity primary key,
  event_id uuid not null references private.drop_push_outbox(id) on delete cascade,
  subscription_id uuid not null references private.drop_push_subscriptions(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'leased', 'sent', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in (
    'rate_limited', 'provider_unavailable', 'network_error', 'endpoint_gone',
    'provider_rejected', 'provider_error', 'invalid_subscription', 'attempts_exhausted'
  )),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (event_id, subscription_id),
  check ((state = 'leased') = (lease_token is not null and lease_expires_at is not null)),
  check ((state = 'sent') = (sent_at is not null))
);

create index drop_push_deliveries_ready_idx
  on private.drop_push_deliveries(available_at, id)
  where state in ('pending', 'leased');

alter table private.drop_push_deliveries enable row level security;
revoke all on table private.drop_push_deliveries from public, anon, authenticated, service_role;

-- This RPC is called only by the authenticated Edge Function after Auth has
-- verified the bearer token. p_user_id is never accepted from the browser.
create or replace function public.manage_drop_push_subscription(
  p_action text,
  p_user_id uuid,
  p_endpoint text default null,
  p_p256dh text default null,
  p_auth text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Invalid subscription request.';
  end if;

  if p_action = 'status' then
    if p_endpoint is null then
      return exists (
        select 1 from private.drop_push_subscriptions s where s.user_id = p_user_id
      );
    end if;
    return exists (
      select 1 from private.drop_push_subscriptions s
      where s.user_id = p_user_id and s.endpoint = p_endpoint
    );
  end if;

  if p_action = 'enable' then
    if p_endpoint is null or pg_catalog.octet_length(p_endpoint) not between 32 and 2048
      or p_endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com)/[^[:space:]]+$'
      or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{40,126}={0,2}$'
      or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{16,126}={0,2}$' then
      raise exception using errcode = '22023', message = 'Invalid subscription request.';
    end if;

    insert into private.drop_push_subscriptions(user_id, endpoint, p256dh, auth_secret)
    values (p_user_id, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update
      set user_id = excluded.user_id,
          p256dh = excluded.p256dh,
          auth_secret = excluded.auth_secret,
          updated_at = pg_catalog.clock_timestamp();
    return true;
  end if;

  if p_action = 'disable' then
    if p_endpoint is null then
      raise exception using errcode = '22023', message = 'Invalid subscription request.';
    end if;
    delete from private.drop_push_subscriptions s
    where s.user_id = p_user_id and s.endpoint = p_endpoint;
    return exists (
      select 1 from private.drop_push_subscriptions s
      where s.user_id = p_user_id and s.endpoint = p_endpoint
    );
  end if;

  raise exception using errcode = '22023', message = 'Invalid subscription request.';
end;
$$;

revoke all on function public.manage_drop_push_subscription(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.manage_drop_push_subscription(text, uuid, text, text, text) to service_role;

-- Lease bounded work with SKIP LOCKED. Attempts count each lease so a worker
-- crash cannot keep a permanently failing job alive forever.
create or replace function public.lease_drop_push_deliveries(p_limit integer)
returns table (
  delivery_id bigint,
  lease_token uuid,
  attempts integer,
  event_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception using errcode = '22023', message = 'Invalid push batch size.';
  end if;

  update private.drop_push_deliveries d
  set state = 'dead',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = 'attempts_exhausted'
  where d.attempts >= 8
    and (
      (d.state = 'pending' and d.available_at <= pg_catalog.clock_timestamp())
      or (d.state = 'leased' and d.lease_expires_at <= pg_catalog.clock_timestamp())
    );

  return query
  with due as (
    select d.id
    from private.drop_push_deliveries d
    where d.attempts < 8
      and (
        (d.state = 'pending' and d.available_at <= pg_catalog.clock_timestamp())
        or (d.state = 'leased' and d.lease_expires_at <= pg_catalog.clock_timestamp())
      )
    order by d.available_at, d.id
    for update skip locked
    limit p_limit
  ), leased as (
    update private.drop_push_deliveries d
    set state = 'leased',
        attempts = d.attempts + 1,
        lease_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = pg_catalog.clock_timestamp() + interval '2 minutes'
    from due
    where d.id = due.id
    returning d.id, d.lease_token, d.attempts, d.event_id, d.subscription_id
  )
  select l.id, l.lease_token, l.attempts, l.event_id, l.subscription_id,
    s.endpoint, s.p256dh, s.auth_secret
  from leased l
  join private.drop_push_subscriptions s on s.id = l.subscription_id;
end;
$$;

revoke all on function public.lease_drop_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.lease_drop_push_deliveries(integer) to service_role;

create or replace function public.finish_drop_push_delivery(
  p_delivery_id bigint,
  p_lease_token uuid,
  p_outcome text,
  p_retry_after_seconds integer default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_subscription_id uuid;
begin
  if p_outcome not in ('sent', 'retry', 'gone', 'failed')
    or (p_error_code is not null and p_error_code not in (
      'rate_limited', 'provider_unavailable', 'network_error', 'endpoint_gone',
      'provider_rejected', 'provider_error', 'invalid_subscription'
    )) then
    raise exception using errcode = '22023', message = 'Invalid push delivery result.';
  end if;

  select d.attempts, d.subscription_id
    into v_attempts, v_subscription_id
  from private.drop_push_deliveries d
  where d.id = p_delivery_id
    and d.state = 'leased'
    and d.lease_token = p_lease_token
  for update;

  if not found then return false; end if;

  if p_outcome = 'sent' then
    update private.drop_push_deliveries d
    set state = 'sent', sent_at = pg_catalog.clock_timestamp(),
        lease_token = null, lease_expires_at = null, last_error_code = null
    where d.id = p_delivery_id;
    return true;
  end if;

  if p_outcome = 'retry' and v_attempts < 8 then
    update private.drop_push_deliveries d
    set state = 'pending',
        available_at = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => least(3600, greatest(1, coalesce(p_retry_after_seconds, 30)))),
        lease_token = null,
        lease_expires_at = null,
        last_error_code = coalesce(p_error_code, 'provider_error')
    where d.id = p_delivery_id;
    return true;
  end if;

  update private.drop_push_deliveries d
  set state = 'dead', lease_token = null, lease_expires_at = null,
      last_error_code = coalesce(p_error_code, case when p_outcome = 'retry' then 'attempts_exhausted' else 'provider_error' end)
  where d.id = p_delivery_id;

  if p_outcome = 'gone' then
    delete from private.drop_push_subscriptions s where s.id = v_subscription_id;
  end if;
  return true;
end;
$$;

revoke all on function public.finish_drop_push_delivery(bigint, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.finish_drop_push_delivery(bigint, uuid, text, integer, text) to service_role;

-- Store these values in Vault outside migrations before scheduling:
--   drop_push_project_url: local http://kong:8000 or the hosted project URL
--   drop_push_anon_key: local/hosted publishable or anon key
--   drop_push_dispatch_secret: same 32+ byte value as DROP_PUSH_DISPATCH_SECRET
-- VAPID public/private keys and subject are Edge Function secrets, not Vault
-- values in this migration. The queue remains durable if the immediate wake
-- request or scheduled fallback is unavailable.
create or replace function private.wake_drop_push_dispatch()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready boolean;
begin
  if pg_catalog.to_regnamespace('net') is null
    or pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;

  select count(distinct name) = 3
      and coalesce(bool_and(pg_catalog.length(pg_catalog.btrim(decrypted_secret)) > 0), false)
      and max(case when name = 'drop_push_dispatch_secret' then pg_catalog.length(decrypted_secret) else 0 end) >= 32
    into v_ready
  from vault.decrypted_secrets
  where name = any(array['drop_push_project_url', 'drop_push_anon_key', 'drop_push_dispatch_secret']);

  if not coalesce(v_ready, false) then return false; end if;

  execute $query$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'drop_push_project_url')
        || '/functions/v1/dispatch-drop-push',
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'drop_push_anon_key'),
        'x-drop-push-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'drop_push_dispatch_secret')
      ),
      body := '{}'::jsonb
    )
  $query$;
  return true;
end;
$$;

revoke all on function private.wake_drop_push_dispatch() from public, anon, authenticated, service_role;

-- pg_net queues the request in the transaction alongside the outbox work. The
-- minute schedule below retries after wake/network failures or a worker crash.
create or replace function private.enqueue_drop_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_delivery_count integer;
begin
  if new.status is distinct from 'delivered'
    or new.recipient_id is null
    or new.recipient_id is not distinct from new.sender_id then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'delivered'
      and old.recipient_id is not distinct from new.recipient_id then
      return new;
    end if;
  end if;

  insert into private.drop_push_outbox(letter_id, recipient_id)
  values (new.id, new.recipient_id)
  on conflict (letter_id, recipient_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    insert into private.drop_push_deliveries(event_id, subscription_id)
    select v_event_id, s.id
    from private.drop_push_subscriptions s
    where s.user_id = new.recipient_id
    on conflict (event_id, subscription_id) do nothing;
    get diagnostics v_delivery_count = row_count;
    if v_delivery_count > 0 then
      begin
        perform private.wake_drop_push_dispatch();
      exception when others then
        -- The outbox is already committed with the letter transaction. The
        -- scheduled worker is the recovery path if an immediate wake fails.
        null;
      end;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enqueue_drop_push_delivery() from public, anon, authenticated, service_role;

create trigger letters_enqueue_drop_push_delivery
after insert or update of status, recipient_id on public.letters
for each row execute function private.enqueue_drop_push_delivery();

create or replace function private.schedule_drop_push_dispatch()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secrets_ready boolean;
  v_job_id bigint;
  v_command text := $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'drop_push_project_url')
        || '/functions/v1/dispatch-drop-push',
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'drop_push_anon_key'),
        'x-drop-push-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'drop_push_dispatch_secret')
      ),
      body := '{}'::jsonb
    );
  $job$;
begin
  if pg_catalog.to_regnamespace('cron') is null
    or pg_catalog.to_regnamespace('net') is null
    or pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;

  execute $query$
    select count(distinct name) = 3
      and coalesce(bool_and(pg_catalog.length(pg_catalog.btrim(decrypted_secret)) > 0), false)
      and max(case when name = 'drop_push_dispatch_secret' then pg_catalog.length(decrypted_secret) else 0 end) >= 32
    from vault.decrypted_secrets where name = any($1)
  $query$
    into v_secrets_ready
    using array['drop_push_project_url', 'drop_push_anon_key', 'drop_push_dispatch_secret'];
  if not coalesce(v_secrets_ready, false) then return false; end if;

  execute 'select jobid from cron.job where jobname = $1 order by jobid limit 1'
    into v_job_id using 'drop-push-dispatch-minute';
  if v_job_id is not null then execute 'select cron.unschedule($1)' using v_job_id; end if;
  execute 'select cron.schedule($1, $2, $3)'
    using 'drop-push-dispatch-minute', '* * * * *', v_command;
  return true;
end;
$$;

revoke all on function private.schedule_drop_push_dispatch() from public, anon, authenticated, service_role;

do $$
begin
  if private.schedule_drop_push_dispatch() then
    raise notice 'Scheduled Drop push dispatch every minute.';
  else
    raise notice 'Drop push dispatch was not scheduled. Enable pg_cron and pg_net, create the three documented Vault secrets, then run select private.schedule_drop_push_dispatch() as the database owner.';
  end if;
exception when others then
  raise notice 'Drop push dispatch was not scheduled (%). Configure pg_cron/pg_net and Vault, then run select private.schedule_drop_push_dispatch() as the database owner.', sqlstate;
end;
$$;

comment on table private.drop_push_subscriptions is
  'Private per-user Web Push subscriptions. Endpoints and browser encryption keys are secret and never exposed to clients.';
comment on table private.drop_push_outbox is
  'Idempotent, private record of each distinct delivered Drop/recipient arrival event.';
comment on table private.drop_push_deliveries is
  'Private per-subscription retry queue for delivered Drop arrival events; delivery payloads contain no Drop content.';

notify pgrst, 'reload schema';
