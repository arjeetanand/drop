create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.relay_handoff_tokens (
  token uuid primary key default pg_catalog.gen_random_uuid(),
  letter_id text not null references public.letters(id) on delete cascade,
  token_kind text not null default 'handoff' check (token_kind in ('handoff', 'carrier')),
  parent_token uuid references private.relay_handoff_tokens(token) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  request_id uuid,
  successor_token uuid,
  successor_expires_at timestamptz,
  handoff_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  check (consumed_at is null or revoked_at is null)
);

revoke all on table private.relay_handoff_tokens from public, anon, authenticated;
alter table private.relay_handoff_tokens enable row level security;

create table if not exists public.relay_handoffs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  letter_id text not null references public.letters(id) on delete cascade,
  source_token uuid not null unique references private.relay_handoff_tokens(token) on delete cascade,
  request_id uuid not null unique,
  carrier_name text not null check (char_length(carrier_name) between 1 and 60),
  neighborhood text not null check (char_length(neighborhood) between 1 and 120),
  note text not null default '' check (char_length(note) <= 500),
  handoff_lat numeric(9,6),
  handoff_lng numeric(9,6),
  accepted_lat numeric(9,6),
  accepted_lng numeric(9,6),
  created_at timestamptz not null default pg_catalog.now(),
  check ((handoff_lat is null) = (handoff_lng is null)),
  check ((accepted_lat is null) = (accepted_lng is null)),
  check (handoff_lat is null or handoff_lat between -90 and 90),
  check (handoff_lng is null or handoff_lng between -180 and 180),
  check (accepted_lat is null or accepted_lat between -90 and 90),
  check (accepted_lng is null or accepted_lng between -180 and 180)
);

create index if not exists relay_handoffs_letter_created_idx
  on public.relay_handoffs(letter_id, created_at);

alter table public.relay_handoffs enable row level security;
drop policy if exists "Drop participants can read relay handoffs" on public.relay_handoffs;
create policy "Drop participants can read relay handoffs"
  on public.relay_handoffs for select to authenticated using (
    exists (
      select 1
      from public.letters l
      where l.id = relay_handoffs.letter_id
        and (l.sender_id = (select auth.uid()) or l.recipient_id = (select auth.uid()))
    )
  );

revoke all on table public.relay_handoffs from public, anon, authenticated;
grant select on table public.relay_handoffs to authenticated;

create or replace function public.issue_relay_handoff_token(p_letter_id text)
returns table (token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := pg_catalog.gen_random_uuid();
  v_expires_at timestamptz := pg_catalog.clock_timestamp() + interval '10 minutes';
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Sign in as the drop sender to start its relay.';
  end if;

  perform 1
  from public.letters l
  where l.id = p_letter_id
    and l.sender_id = (select auth.uid())
    and l.delivery_mode = 'relay'
    and l.status = 'dispatched'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This relay cannot be started by this account.';
  end if;

  update private.relay_handoff_tokens t
  set revoked_at = pg_catalog.clock_timestamp()
  where t.letter_id = p_letter_id
    and t.consumed_at is null
    and t.revoked_at is null;

  insert into private.relay_handoff_tokens (token, letter_id, token_kind, expires_at, created_by)
  values (v_token, p_letter_id, 'handoff', v_expires_at, (select auth.uid()));

  return query select v_token, v_expires_at;
end;
$$;

-- A carrier capability lasts through the carry. Mint its one-time QR/manual
-- pass only when the carrier is ready to hand the drop on.
create or replace function public.issue_relay_pass_from_carrier(p_carrier_token uuid)
returns table (token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter_id text;
  v_carrier private.relay_handoff_tokens%rowtype;
  v_token uuid := pg_catalog.gen_random_uuid();
  v_expires_at timestamptz := pg_catalog.clock_timestamp() + interval '10 minutes';
begin
  if p_carrier_token is null then
    raise exception using errcode = '22023', message = 'The carrier code is incomplete.';
  end if;

  select t.letter_id into v_letter_id
  from private.relay_handoff_tokens t
  where t.token = p_carrier_token;

  if not found then
    raise exception using errcode = '42501', message = 'This carrier code is invalid or expired.';
  end if;

  perform 1
  from public.letters l
  where l.id = v_letter_id
    and l.delivery_mode = 'relay'
    and l.status = 'dispatched'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This carrier code is invalid or expired.';
  end if;

  select t.* into v_carrier
  from private.relay_handoff_tokens t
  where t.token = p_carrier_token
  for update;

  if not found
    or v_carrier.token_kind <> 'carrier'
    or v_carrier.consumed_at is not null
    or v_carrier.revoked_at is not null
    or v_carrier.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '42501', message = 'This carrier code is invalid or expired.';
  end if;

  update private.relay_handoff_tokens t
  set revoked_at = pg_catalog.clock_timestamp()
  where t.parent_token = p_carrier_token
    and t.token_kind = 'handoff'
    and t.consumed_at is null
    and t.revoked_at is null;

  insert into private.relay_handoff_tokens (token, letter_id, token_kind, parent_token, expires_at)
  values (v_token, v_carrier.letter_id, 'handoff', p_carrier_token, v_expires_at);

  return query select v_token, v_expires_at;
end;
$$;

drop function if exists public.accept_relay_handoff_token(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric);
create function public.accept_relay_handoff_token(
  p_token uuid,
  p_request_id uuid,
  p_carrier_name text,
  p_neighborhood text,
  p_note text default null,
  p_handoff_lat numeric default null,
  p_handoff_lng numeric default null,
  p_accepted_lat numeric default null,
  p_accepted_lng numeric default null
)
returns table (handoff_id uuid, letter_id text, successor_token uuid, successor_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter_id text;
  v_parent_token uuid;
  v_parent private.relay_handoff_tokens%rowtype;
  v_pass private.relay_handoff_tokens%rowtype;
  v_event public.relay_handoffs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_next_token uuid := pg_catalog.gen_random_uuid();
  v_next_expires_at timestamptz := v_now + interval '30 days';
  v_handoff_id uuid;
  v_note text := pg_catalog.btrim(coalesce(p_note, ''));
begin
  if p_token is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'The handoff code is incomplete.';
  end if;
  if p_carrier_name is null or pg_catalog.char_length(pg_catalog.btrim(p_carrier_name)) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'Carrier name must be between 1 and 60 characters.';
  end if;
  if p_neighborhood is null or pg_catalog.char_length(pg_catalog.btrim(p_neighborhood)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Neighborhood must be between 1 and 120 characters.';
  end if;
  if pg_catalog.char_length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'Handoff notes must be 500 characters or fewer.';
  end if;
  if (p_handoff_lat is null) <> (p_handoff_lng is null)
    or (p_accepted_lat is null) <> (p_accepted_lng is null)
    or (p_handoff_lat is not null and p_handoff_lat not between -90 and 90)
    or (p_handoff_lng is not null and p_handoff_lng not between -180 and 180)
    or (p_accepted_lat is not null and p_accepted_lat not between -90 and 90)
    or (p_accepted_lng is not null and p_accepted_lng not between -180 and 180) then
    raise exception using errcode = '22023', message = 'The handoff coordinates are not valid.';
  end if;

  select t.letter_id into v_letter_id
  from private.relay_handoff_tokens t
  where t.token = p_token;

  if not found then
    raise exception using errcode = '42501', message = 'This handoff code is invalid or expired.';
  end if;

  perform 1
  from public.letters l
  where l.id = v_letter_id
    and l.delivery_mode = 'relay'
    and l.status = 'dispatched'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This handoff code is invalid or expired.';
  end if;

  select t.parent_token into v_parent_token
  from private.relay_handoff_tokens t
  where t.token = p_token;

  -- Lock parent before child, matching issue_relay_pass_from_carrier and
  -- preventing concurrent passes from creating two active carriers.
  if v_parent_token is not null then
    select t.* into v_parent
    from private.relay_handoff_tokens t
    where t.token = v_parent_token
    for update;
  end if;

  select t.* into v_pass
  from private.relay_handoff_tokens t
  where t.token = p_token
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'This handoff code is invalid or expired.';
  end if;

  if v_pass.consumed_at is not null then
    select h.* into v_event
    from public.relay_handoffs h
    where h.id = v_pass.handoff_id;

    if v_pass.request_id = p_request_id
      and v_event.id is not null
      and v_event.carrier_name = pg_catalog.btrim(p_carrier_name)
      and v_event.neighborhood = pg_catalog.btrim(p_neighborhood)
      and v_event.note = v_note
      and v_event.handoff_lat is not distinct from p_handoff_lat
      and v_event.handoff_lng is not distinct from p_handoff_lng
      and v_event.accepted_lat is not distinct from p_accepted_lat
      and v_event.accepted_lng is not distinct from p_accepted_lng then
      return query select v_pass.handoff_id, v_pass.letter_id, v_pass.successor_token, v_pass.successor_expires_at;
      return;
    end if;

    raise exception using errcode = '42501', message = 'This handoff code has already been used.';
  end if;

  if v_pass.token_kind <> 'handoff'
    or v_pass.revoked_at is not null
    or v_pass.expires_at <= v_now
    or (v_parent_token is not null and (
      v_parent.token is null
      or v_parent.token_kind <> 'carrier'
      or v_parent.consumed_at is not null
      or v_parent.revoked_at is not null
      or v_parent.expires_at <= v_now
      or v_parent.letter_id <> v_pass.letter_id
    )) then
    raise exception using errcode = '42501', message = 'This handoff code is invalid or expired.';
  end if;

  insert into public.relay_handoffs (
    letter_id, source_token, request_id, carrier_name, neighborhood, note,
    handoff_lat, handoff_lng, accepted_lat, accepted_lng, created_at
  ) values (
    v_pass.letter_id, p_token, p_request_id, pg_catalog.btrim(p_carrier_name),
    pg_catalog.btrim(p_neighborhood), v_note, p_handoff_lat, p_handoff_lng,
    p_accepted_lat, p_accepted_lng, v_now
  ) returning id into v_handoff_id;

  if v_parent_token is not null then
    update private.relay_handoff_tokens t
    set consumed_at = v_now
    where t.token = v_parent_token;

    update private.relay_handoff_tokens t
    set revoked_at = v_now
    where t.parent_token = v_parent_token
      and t.token <> p_token
      and t.consumed_at is null
      and t.revoked_at is null;
  end if;

  insert into private.relay_handoff_tokens (token, letter_id, token_kind, expires_at, created_by)
  values (v_next_token, v_pass.letter_id, 'carrier', v_next_expires_at, null);

  update private.relay_handoff_tokens t
  set consumed_at = v_now,
      request_id = p_request_id,
      successor_token = v_next_token,
      successor_expires_at = v_next_expires_at,
      handoff_id = v_handoff_id
  where t.token = p_token;

  return query select v_handoff_id, v_pass.letter_id, v_next_token, v_next_expires_at;
end;
$$;

-- Let the outgoing carrier confirm that their bearer pass was accepted without
-- granting carriers access to the relay event table or any letter data.
create or replace function public.get_relay_handoff_token_status(p_token uuid)
returns table (accepted boolean, accepted_by text, accepted_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select
    t.consumed_at is not null,
    h.carrier_name,
    t.consumed_at
  from private.relay_handoff_tokens t
  left join public.relay_handoffs h on h.id = t.handoff_id
  where t.token = p_token
    and t.token_kind = 'handoff'
    and t.revoked_at is null
    and t.created_at > pg_catalog.clock_timestamp() - interval '20 minutes'
$$;

revoke execute on function public.issue_relay_handoff_token(text) from public, anon, authenticated;
grant execute on function public.issue_relay_handoff_token(text) to authenticated;
revoke execute on function public.issue_relay_pass_from_carrier(uuid) from public, anon, authenticated;
grant execute on function public.issue_relay_pass_from_carrier(uuid) to anon, authenticated;
revoke execute on function public.accept_relay_handoff_token(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.accept_relay_handoff_token(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric) to anon, authenticated;
revoke execute on function public.get_relay_handoff_token_status(uuid) from public, anon, authenticated;
grant execute on function public.get_relay_handoff_token_status(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
