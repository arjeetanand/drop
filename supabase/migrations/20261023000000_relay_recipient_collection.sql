-- Keep every dispatched relay sealed until its recipient confirms arrival.
-- Older dispatched relay rows may still have the instant default in delivery_mode.

drop policy if exists "Users can read their letters" on public.letters;
drop policy if exists "Participants can read released drops" on public.letters;
create policy "Participants can read released drops" on public.letters for select using (
  auth.uid() = sender_id
  or (
    auth.uid() = recipient_id
    and status is distinct from 'dispatched'
  )
);

drop policy if exists "Drop participants can read media" on storage.objects;
create policy "Drop participants can read media" on storage.objects for select using (
  bucket_id = 'drop-media' and exists (
    select 1 from public.letters l
    where l.media_path = name
      and split_part(name, '/', 1) = l.sender_id::text
      and (
        l.sender_id = auth.uid()
        or (
          l.recipient_id = auth.uid()
            and l.status is distinct from 'dispatched'
        )
      )
  )
);

drop policy if exists "Drop participants can read reactions" on public.letter_reactions;
create policy "Drop participants can read reactions" on public.letter_reactions for select using (
  exists (
    select 1 from public.letters l
    where l.id = letter_id
      and (
        l.sender_id = auth.uid()
        or (
          l.recipient_id = auth.uid()
            and l.status is distinct from 'dispatched'
        )
      )
  )
);

drop policy if exists "Recipients can add reactions" on public.letter_reactions;
create policy "Recipients can add reactions" on public.letter_reactions for insert with check (
  recipient_id = auth.uid()
  and exists (
    select 1 from public.letters l
    where l.id = letter_id
      and l.recipient_id = auth.uid()
      and l.status is distinct from 'dispatched'
  )
);

drop policy if exists "Recipients can change reactions" on public.letter_reactions;
create policy "Recipients can change reactions" on public.letter_reactions for update using (
  recipient_id = auth.uid()
) with check (
  recipient_id = auth.uid()
  and exists (
    select 1 from public.letters l
    where l.id = letter_id
      and l.recipient_id = auth.uid()
      and l.status is distinct from 'dispatched'
  )
);

-- This returns only carrier check-ins. It intentionally excludes letter text,
-- subject, payload kind, attachment path, and precise coordinates.
create or replace function public.get_recipient_relay_drops()
returns table (
  id text,
  sender_display_name text,
  created_at timestamptz,
  dispatched_at timestamptz,
  handoff_count integer,
  latest_carrier text,
  latest_neighborhood text,
  latest_note text,
  latest_handoff_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    l.id,
    l.sender_display_name,
    l.created_at,
    l.dispatched_at,
    (select count(*)::integer from public.relay_handoffs h where h.letter_id = l.id),
    latest.carrier_name,
    latest.neighborhood,
    latest.note,
    latest.created_at
  from public.letters l
  left join lateral (
    select h.carrier_name, h.neighborhood, h.note, h.created_at
    from public.relay_handoffs h
    where h.letter_id = l.id
    order by h.created_at desc, h.id desc
    limit 1
  ) latest on true
  where l.recipient_id = (select auth.uid())
    and l.status = 'dispatched'
  order by l.dispatched_at desc nulls last, l.created_at desc, l.id desc
$$;

revoke all on function public.get_recipient_relay_drops() from public, anon, authenticated;
grant execute on function public.get_recipient_relay_drops() to authenticated;

-- Collection is an explicit, recipient-only, retry-safe transition. The
-- status change releases the existing row and storage policies above.
create or replace function public.collect_relay_drop(p_letter_id text)
returns table (drop_id text, delivered_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_delivery_mode text;
  v_delivered_at timestamptz;
  v_recipient_id uuid := (select auth.uid());
begin
  if v_recipient_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the drop recipient to collect it.';
  end if;

  select l.status, l.delivery_mode, l.delivered_at
    into v_status, v_delivery_mode, v_delivered_at
  from public.letters l
  where l.id = p_letter_id and l.recipient_id = v_recipient_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'This relay cannot be collected by this account.';
  end if;

  if v_status = 'delivered' and v_delivery_mode = 'relay' then
    return query select p_letter_id, v_delivered_at;
    return;
  end if;

  if v_status is distinct from 'dispatched' then
    raise exception using errcode = '42501', message = 'This relay is not ready to collect.';
  end if;

  update public.letters l
  set delivery_mode = 'relay',
      status = 'delivered',
      delivered_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where l.id = p_letter_id and l.recipient_id = v_recipient_id
  returning l.delivered_at into v_delivered_at;

  return query select p_letter_id, v_delivered_at;
end;
$$;

revoke all on function public.collect_relay_drop(text) from public, anon, authenticated;
grant execute on function public.collect_relay_drop(text) to authenticated;

-- Refresh both participants after the recipient collects the relay. Broadcast
-- payloads carry only the drop id; clients still reload through RLS.
create or replace function public.broadcast_drop_inbox_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.recipient_id is not null and new.status in ('dispatched', 'delivered') then
      perform realtime.send(
        pg_catalog.jsonb_build_object('drop_id', new.id),
        'drop_received',
        'user:' || new.recipient_id::text || ':drop-inbox',
        true
      );
    end if;
  elsif new.status is distinct from old.status
    and new.status = 'delivered'
    and new.delivery_mode = 'relay' then
    perform realtime.send(
      pg_catalog.jsonb_build_object('drop_id', new.id),
      'drop_received',
      'user:' || new.recipient_id::text || ':drop-inbox',
      true
    );
    perform realtime.send(
      pg_catalog.jsonb_build_object('drop_id', new.id),
      'drop_received',
      'user:' || new.sender_id::text || ':drop-inbox',
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function public.broadcast_drop_inbox_insert() from public, anon, authenticated;
drop trigger if exists broadcast_drop_inbox_insert on public.letters;
create trigger broadcast_drop_inbox_insert
  after insert or update on public.letters
  for each row execute function public.broadcast_drop_inbox_insert();

notify pgrst, 'reload schema';
