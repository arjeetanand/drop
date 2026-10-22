-- Participants need route details, not the handoff bearer token or retry key.
revoke select on table public.relay_handoffs from authenticated;
revoke select (source_token, request_id) on table public.relay_handoffs from authenticated;

grant select (
  id,
  letter_id,
  carrier_name,
  neighborhood,
  note,
  handoff_lat,
  handoff_lng,
  accepted_lat,
  accepted_lng,
  created_at
) on table public.relay_handoffs to authenticated;
