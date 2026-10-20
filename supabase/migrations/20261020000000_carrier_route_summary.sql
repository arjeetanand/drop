create or replace function public.get_carrier_relay_route(p_carrier_token uuid)
returns table (handoff_id uuid, carrier_name text, neighborhood text, carrier_note text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select h.id, h.carrier_name, h.neighborhood, h.note, h.created_at
  from private.relay_handoff_tokens t
  join public.letters l on l.id = t.letter_id
  join public.relay_handoffs h on h.letter_id = l.id
  where t.token = p_carrier_token
    and t.token_kind = 'carrier'
    and t.consumed_at is null
    and t.revoked_at is null
    and t.expires_at > pg_catalog.clock_timestamp()
    and l.delivery_mode = 'relay'
    and l.status = 'dispatched'
  order by h.created_at, h.id
$$;

revoke execute on function public.get_carrier_relay_route(uuid) from public, anon, authenticated;
grant execute on function public.get_carrier_relay_route(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
