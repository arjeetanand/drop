-- A browser push endpoint can be reused after an account switch. Retire work
-- queued for its previous owner before assigning the endpoint to the new one.
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
declare
  v_subscription_id uuid;
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

    select s.id into v_subscription_id
    from private.drop_push_subscriptions s
    where s.endpoint = p_endpoint
    for update;

    if found then
      -- Endpoint ownership changes use the same subscription-before-delivery
      -- lock order as disable and provider-gone completion.
      delete from private.drop_push_deliveries d
      using private.drop_push_outbox o
      where d.event_id = o.id
        and d.subscription_id = v_subscription_id
        and o.recipient_id is distinct from p_user_id
        and d.state in ('pending', 'leased');
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
    select s.id into v_subscription_id
    from private.drop_push_subscriptions s
    where s.user_id = p_user_id and s.endpoint = p_endpoint
    for update;

    if found then
      delete from private.drop_push_deliveries d
      where d.subscription_id = v_subscription_id;
      delete from private.drop_push_subscriptions s
      where s.id = v_subscription_id;
    end if;
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

-- Provider-gone completion takes the same subscription-before-delivery lock
-- order as endpoint transfer and disable to avoid deadlocks during account
-- switches or cleanup.
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

  if p_outcome = 'gone' then
    select s.id into v_subscription_id
    from private.drop_push_deliveries d
    join private.drop_push_subscriptions s on s.id = d.subscription_id
    where d.id = p_delivery_id
      and d.state = 'leased'
      and d.lease_token = p_lease_token
    for update of s;

    if not found then return false; end if;
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

-- Clear stale work even if an enqueue raced the account transfer. The owner
-- predicate in the lease query below remains the final recipient boundary.
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
      last_error_code = null
  from private.drop_push_outbox o, private.drop_push_subscriptions s
  where d.event_id = o.id
    and d.subscription_id = s.id
    and o.recipient_id is distinct from s.user_id
    and d.state in ('pending', 'leased');

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
    join private.drop_push_outbox o on o.id = d.event_id
    join private.drop_push_subscriptions s on s.id = d.subscription_id
    where d.attempts < 8
      and o.recipient_id = s.user_id
      and (
        (d.state = 'pending' and d.available_at <= pg_catalog.clock_timestamp())
        or (d.state = 'leased' and d.lease_expires_at <= pg_catalog.clock_timestamp())
      )
    order by d.available_at, d.id
    limit p_limit
    for update of d skip locked
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

notify pgrst, 'reload schema';
