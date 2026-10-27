-- Keep recipient read state private so the sender cannot observe a read receipt.
create table private.recipient_drop_reads (
  letter_id text not null references public.letters(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (letter_id, recipient_id)
);

create index recipient_drop_reads_recipient_idx
  on private.recipient_drop_reads (recipient_id, letter_id);

revoke all on table private.recipient_drop_reads from public, anon, authenticated, service_role;
alter table private.recipient_drop_reads enable row level security;

-- SECURITY DEFINER is required because the table itself has no client grants.
-- Ownership and delivered status are checked here, without exposing sender receipts.
create or replace function public.mark_recipient_drop_read(p_letter_id text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid := (select auth.uid());
  v_read_at timestamptz;
begin
  if v_recipient_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the Drop recipient to mark it read.';
  end if;

  insert into private.recipient_drop_reads (letter_id, recipient_id)
  select l.id, v_recipient_id
  from public.letters l
  where l.id = p_letter_id
    and l.recipient_id = v_recipient_id
    and l.sender_id is distinct from v_recipient_id
    and l.status = 'delivered'
  on conflict (letter_id, recipient_id) do nothing;

  -- A null result deliberately covers missing, undelivered, and non-recipient IDs.
  select r.read_at
    into v_read_at
  from private.recipient_drop_reads r
  join public.letters l on l.id = r.letter_id
  where r.letter_id = p_letter_id
    and r.recipient_id = v_recipient_id
    and l.recipient_id = v_recipient_id
    and l.sender_id is distinct from v_recipient_id
    and l.status = 'delivered';

  return v_read_at;
end;
$$;

-- Only return markers for delivered drops addressed to this caller.
create or replace function public.get_recipient_drop_read_states(p_letter_ids text[])
returns table(letter_id text, read_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid := (select auth.uid());
begin
  if v_recipient_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the Drop recipient to read mailbox state.';
  end if;
  if p_letter_ids is null or pg_catalog.cardinality(p_letter_ids) > 250 then
    raise exception using errcode = '22023', message = 'The Drop read-state batch is invalid.';
  end if;

  return query
  select r.letter_id, r.read_at
  from private.recipient_drop_reads r
  join public.letters l on l.id = r.letter_id
  where r.letter_id = any (p_letter_ids)
    and r.recipient_id = v_recipient_id
    and l.recipient_id = v_recipient_id
    and l.sender_id is distinct from v_recipient_id
    and l.status = 'delivered';
end;
$$;

revoke all on function public.mark_recipient_drop_read(text) from public, anon, authenticated, service_role;
grant execute on function public.mark_recipient_drop_read(text) to authenticated;
revoke all on function public.get_recipient_drop_read_states(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_recipient_drop_read_states(text[]) to authenticated;
