-- Accountless Drop invitations keep the letter sealed until an authenticated
-- recipient with a Drop profile explicitly claims the one-time capability.

alter table public.letters
  drop constraint if exists letters_status_check;

alter table public.letters
  add constraint letters_status_check
  check (status in ('draft', 'sealed', 'claim_pending', 'dispatched', 'delivered'));

-- claim_pending is created only by the atomic sender RPC below. Normal client
-- inserts retain their existing path for direct/relay sends and drafts.
drop policy if exists "Users can create their letters" on public.letters;
create policy "Users can create their letters" on public.letters
  for insert with check (auth.uid() = sender_id and status <> 'claim_pending');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.drop_claim_invites (
  token_hash bytea primary key check (pg_catalog.octet_length(token_hash) = 32),
  letter_id text not null references public.letters(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  claimed_by uuid references public.profiles(id) on delete cascade,
  claimed_at timestamptz,
  revoked_at timestamptz,
  replaced_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  check ((claimed_by is null) = (claimed_at is null)),
  check (claimed_at is null or revoked_at is null),
  check (replaced_at is null or (claimed_at is null and revoked_at is null))
);

create index drop_claim_invites_sender_idx
  on private.drop_claim_invites(sender_id, created_at desc);
create unique index drop_claim_invites_one_current_per_letter_idx
  on private.drop_claim_invites(letter_id)
  where replaced_at is null;

revoke all on table private.drop_claim_invites from public, anon, authenticated;
alter table private.drop_claim_invites enable row level security;

-- pgcrypto is installed by the base schema migration, but its schema can vary
-- between Supabase projects. Resolve that trusted catalog value once per call
-- and quote it as an identifier; token material itself is never interpolated.
create or replace function private.hash_drop_claim_token(p_token text)
returns bytea
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  v_pgcrypto_schema name;
  v_token_hash bytea;
begin
  select n.nspname
    into v_pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception using errcode = '55000', message = 'Drop invite token hashing is unavailable.';
  end if;

  execute pg_catalog.format(
    'select %I.digest(pg_catalog.decode($1, ''hex''), ''sha256'')',
    v_pgcrypto_schema
  )
  into v_token_hash
  using pg_catalog.lower(p_token);

  return v_token_hash;
end;
$$;

revoke all on function private.hash_drop_claim_token(text) from public, anon, authenticated;

create or replace function public.issue_drop_claim_invite(
  p_letter_id text,
  p_subject text,
  p_content text,
  p_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := (select auth.uid());
  v_sender_display_name text;
  v_token_hash bytea;
  v_now timestamptz;
  v_letter public.letters%rowtype;
  v_invite private.drop_claim_invites%rowtype;
begin
  if v_sender_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the Drop sender to create an invite.';
  end if;

  select p.display_name
    into v_sender_display_name
  from public.profiles p
  where p.id = v_sender_id;
  if not found then
    raise exception using errcode = '42501', message = 'Create a Drop profile before creating an invite.';
  end if;

  if p_letter_id is null or p_letter_id = ''
    or p_subject is null or pg_catalog.char_length(p_subject) > 100
    or p_content is null or pg_catalog.char_length(p_content) > 5000
    or p_token is null or p_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'The Drop invite request is invalid.';
  end if;

  v_token_hash := private.hash_drop_claim_token(p_token);

  -- Serialize requests for a letter ID, including its first insert. Claim uses
  -- the same letter-then-invite lock order to avoid a rotation/claim deadlock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-claim:' || p_letter_id, 0)
  );

  select l.*
    into v_letter
  from public.letters l
  where l.id = p_letter_id
  for update;

  v_now := pg_catalog.clock_timestamp();

  if found then
    if v_letter.sender_id is distinct from v_sender_id
      or v_letter.status is distinct from 'claim_pending'
      or v_letter.recipient_id is not null
      or v_letter.subject is distinct from p_subject
      or v_letter.content is distinct from p_content
      or v_letter.delivery_mode is distinct from 'instant'
      or v_letter.payload_kind is distinct from 'text'
      or v_letter.media_path is not null
      or v_letter.media_mime_type is not null
      or v_letter.media_size_bytes is not null then
      raise exception using errcode = '42501', message = 'This Drop cannot be issued as an invite.';
    end if;

    select i.*
      into v_invite
    from private.drop_claim_invites i
    where i.letter_id = p_letter_id
      and i.replaced_at is null
    for update;

    if not found
      or v_invite.sender_id is distinct from v_sender_id
      or v_invite.claimed_at is not null
      or v_invite.revoked_at is not null then
      raise exception using errcode = '42501', message = 'This Drop invite is no longer available.';
    end if;

    if v_invite.token_hash is distinct from v_token_hash then
      if exists (
        select 1
        from private.drop_claim_invites i
        where i.token_hash = v_token_hash
      ) then
        raise exception using errcode = '42501', message = 'This Drop invite capability cannot be reused.';
      end if;

      update private.drop_claim_invites i
      set replaced_at = v_now
      where i.token_hash = v_invite.token_hash;

      insert into private.drop_claim_invites (
        token_hash,
        letter_id,
        sender_id,
        expires_at,
        created_at
      ) values (
        v_token_hash,
        p_letter_id,
        v_sender_id,
        v_now + interval '7 days',
        v_now
      );
    end if;

    return p_letter_id;
  end if;

  if exists (
    select 1
    from private.drop_claim_invites i
    where i.token_hash = v_token_hash
  ) then
    raise exception using errcode = '42501', message = 'This Drop invite capability cannot be reused.';
  end if;

  insert into public.letters (
    id,
    sender_id,
    sender_display_name,
    subject,
    content,
    status,
    delivery_mode,
    payload_kind,
    dispatched_at,
    created_at,
    updated_at
  ) values (
    p_letter_id,
    v_sender_id,
    v_sender_display_name,
    p_subject,
    p_content,
    'claim_pending',
    'instant',
    'text',
    v_now,
    v_now,
    v_now
  );

  insert into private.drop_claim_invites (
    token_hash,
    letter_id,
    sender_id,
    expires_at,
    created_at
  ) values (
    v_token_hash,
    p_letter_id,
    v_sender_id,
    v_now + interval '7 days',
    v_now
  );

  return p_letter_id;
end;
$$;

revoke all on function public.issue_drop_claim_invite(text, text, text, text) from public, anon, authenticated;
grant execute on function public.issue_drop_claim_invite(text, text, text, text) to authenticated;

-- Reissue from a detail page using the exact stored payload. There is only one
-- current digest per letter, so each distinct token rotation invalidates the
-- prior link immediately. Clients must single-flight reissue through link
-- sharing; the database cannot observe when a share UI has finished.
create or replace function public.reissue_drop_claim_invite(
  p_letter_id text,
  p_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := (select auth.uid());
  v_letter public.letters%rowtype;
  v_invite private.drop_claim_invites%rowtype;
begin
  if v_sender_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the Drop sender to reissue an invite.';
  end if;

  if p_letter_id is null or p_letter_id = ''
    or p_token is null or p_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'The Drop invite request is invalid.';
  end if;

  -- Keep the same per-letter serialization used by initial issue/rotation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-claim:' || p_letter_id, 0)
  );

  select l.*
    into v_letter
  from public.letters l
  where l.id = p_letter_id
  for update;

  if not found
    or v_letter.sender_id is distinct from v_sender_id
    or v_letter.status is distinct from 'claim_pending'
    or v_letter.recipient_id is not null
    or v_letter.delivery_mode is distinct from 'instant'
    or v_letter.payload_kind is distinct from 'text'
    or v_letter.media_path is not null
    or v_letter.media_mime_type is not null
    or v_letter.media_size_bytes is not null then
    raise exception using errcode = '42501', message = 'This Drop cannot be reissued as an invite.';
  end if;

  select i.*
    into v_invite
  from private.drop_claim_invites i
  where i.letter_id = p_letter_id
    and i.replaced_at is null
  for update;

  if not found
    or v_invite.sender_id is distinct from v_sender_id
    or v_invite.claimed_at is not null
    or v_invite.revoked_at is not null then
    raise exception using errcode = '42501', message = 'This Drop invite is no longer available.';
  end if;

  return public.issue_drop_claim_invite(
    p_letter_id,
    v_letter.subject,
    v_letter.content,
    p_token
  );
end;
$$;

revoke all on function public.reissue_drop_claim_invite(text, text) from public, anon, authenticated;
grant execute on function public.reissue_drop_claim_invite(text, text) to authenticated;

create or replace function public.claim_drop_invite(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid := (select auth.uid());
  v_recipient_username text;
  v_recipient_display_name text;
  v_token_hash bytea;
  v_letter_id text;
  v_letter public.letters%rowtype;
  v_invite private.drop_claim_invites%rowtype;
  v_now timestamptz;
begin
  if v_recipient_id is null then
    raise exception using errcode = '42501', message = 'Sign in with a Drop profile to claim this invite.';
  end if;

  select p.username, p.display_name
    into v_recipient_username, v_recipient_display_name
  from public.profiles p
  where p.id = v_recipient_id;
  if not found then
    raise exception using errcode = '42501', message = 'Create a Drop profile before claiming this invite.';
  end if;

  if p_token is null or p_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;
  v_token_hash := private.hash_drop_claim_token(p_token);

  -- Discover the row without locking, then take locks in the same order as
  -- issue_drop_claim_invite. Recheck the digest after locking to reject a
  -- capability that was replaced while this request waited.
  select i.letter_id
    into v_letter_id
  from private.drop_claim_invites i
  where i.token_hash = v_token_hash;
  if not found then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;

  select l.*
    into v_letter
  from public.letters l
  where l.id = v_letter_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;

  select i.*
    into v_invite
  from private.drop_claim_invites i
  where i.letter_id = v_letter_id
    and i.token_hash = v_token_hash
  for update;
  if not found
    or v_invite.sender_id is distinct from v_letter.sender_id
    or v_invite.revoked_at is not null
    or v_invite.replaced_at is not null then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;

  if v_invite.sender_id = v_recipient_id then
    raise exception using errcode = '42501', message = 'The sender cannot claim their own Drop invite.';
  end if;

  if v_invite.claimed_at is not null then
    if v_invite.claimed_by = v_recipient_id
      and v_letter.recipient_id = v_recipient_id
      and v_letter.status = 'delivered'
      and v_letter.delivery_mode = 'instant'
      and v_letter.payload_kind = 'text' then
      return v_letter_id;
    end if;

    raise exception using errcode = '42501', message = 'This Drop invite has already been claimed.';
  end if;

  if v_invite.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;

  if v_letter.status is distinct from 'claim_pending'
    or v_letter.recipient_id is not null
    or v_letter.delivery_mode is distinct from 'instant'
    or v_letter.payload_kind is distinct from 'text'
    or v_letter.media_path is not null
    or v_letter.media_mime_type is not null
    or v_letter.media_size_bytes is not null then
    raise exception using errcode = '42501', message = 'This Drop invite is no longer available.';
  end if;

  v_now := pg_catalog.clock_timestamp();

  update public.letters l
  set recipient_id = v_recipient_id,
      recipient_username = v_recipient_username,
      recipient_name = v_recipient_display_name,
      status = 'delivered',
      delivered_at = v_now,
      updated_at = v_now
  where l.id = v_letter_id;

  update private.drop_claim_invites i
  set claimed_by = v_recipient_id,
      claimed_at = v_now
  where i.letter_id = v_letter_id
    and i.token_hash = v_token_hash;

  return v_letter_id;
end;
$$;

revoke all on function public.claim_drop_invite(text) from public, anon, authenticated;
grant execute on function public.claim_drop_invite(text) to authenticated;
