-- Migration to support GPS pinpoints captured during seamless QR handoffs
alter table public.letter_events
  add column if not exists handoff_lat numeric(9,6),
  add column if not exists handoff_lng numeric(9,6),
  add column if not exists accepted_lat numeric(9,6),
  add column if not exists accepted_lng numeric(9,6),
  add column if not exists neighborhood text default '';

comment on column public.letter_events.handoff_lat is 'GPS latitude of outgoing carrier at handoff QR generation';
comment on column public.letter_events.handoff_lng is 'GPS longitude of outgoing carrier at handoff QR generation';
comment on column public.letter_events.accepted_lat is 'GPS latitude of incoming carrier when QR is scanned';
comment on column public.letter_events.accepted_lng is 'GPS longitude of incoming carrier when QR is scanned';
comment on column public.letter_events.neighborhood is 'Human-readable neighborhood area name at waypoint';
