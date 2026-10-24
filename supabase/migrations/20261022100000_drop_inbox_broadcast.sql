-- Send an account-scoped signal when a real drop is inserted. The payload
-- contains only the drop id; the client reloads row data through its RLS query.
drop policy if exists "Recipients can read their drop inbox signals" on realtime.messages;
create policy "Recipients can read their drop inbox signals"
  on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text || ':drop-inbox'
  );

create or replace function public.broadcast_drop_inbox_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recipient_id is not null and new.status in ('dispatched', 'delivered') then
    perform realtime.send(
      pg_catalog.jsonb_build_object('drop_id', new.id),
      'drop_received',
      'user:' || new.recipient_id::text || ':drop-inbox',
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function public.broadcast_drop_inbox_insert() from public, anon, authenticated;

drop trigger if exists broadcast_drop_inbox_insert on public.letters;
create trigger broadcast_drop_inbox_insert
  after insert on public.letters
  for each row execute function public.broadcast_drop_inbox_insert();
