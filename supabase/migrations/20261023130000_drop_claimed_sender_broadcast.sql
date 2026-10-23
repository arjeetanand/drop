-- Tell the sender when an accountless instant text Drop is explicitly claimed.
-- Realtime carries only the drop ID; the sender reloads the row through RLS.

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
  elsif old.status = 'claim_pending'
    and new.status = 'delivered'
    and old.delivery_mode = 'instant'
    and new.delivery_mode = 'instant'
    and old.recipient_id is null
    and new.recipient_id is not null then
    perform realtime.send(
      pg_catalog.jsonb_build_object('drop_id', new.id),
      'drop_received',
      'user:' || new.sender_id::text || ':drop-inbox',
      true
    );
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
