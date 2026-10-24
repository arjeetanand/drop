-- Let only a sender listen for reaction signals about their own drops.
drop policy if exists "Senders can read their drop reaction signals" on realtime.messages;
create policy "Senders can read their drop reaction signals"
  on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text || ':drop-reactions'
  );

-- Signal only that a drop's reaction changed. The sender reloads the row
-- through its existing RLS query; neither content nor emoji is broadcast.
create or replace function public.broadcast_drop_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.emoji is not distinct from old.emoji then
      return new;
    end if;
  end if;

  select letters.sender_id
    into v_sender_id
    from public.letters as letters
    where letters.id = new.letter_id;

  if v_sender_id is not null then
    perform realtime.send(
      pg_catalog.jsonb_build_object('drop_id', new.letter_id),
      'drop_reaction_received',
      'user:' || v_sender_id::text || ':drop-reactions',
      true
    );
  end if;

  return new;
end;
$$;

revoke all on function public.broadcast_drop_reaction() from public, anon, authenticated;

-- A reaction belongs to the drop where it was created. Preventing a recipient
-- from changing that key also keeps the notification target unambiguous.
create or replace function public.prevent_drop_reaction_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.letter_id is distinct from old.letter_id then
    raise exception 'A reaction cannot be moved to another drop'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_drop_reaction_move() from public, anon, authenticated;

drop trigger if exists prevent_drop_reaction_move on public.letter_reactions;
create trigger prevent_drop_reaction_move
  before update of letter_id on public.letter_reactions
  for each row execute function public.prevent_drop_reaction_move();

drop trigger if exists broadcast_drop_reaction on public.letter_reactions;
create trigger broadcast_drop_reaction
  after insert or update on public.letter_reactions
  for each row execute function public.broadcast_drop_reaction();
