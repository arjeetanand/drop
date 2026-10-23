-- Add private, explicitly claimed photo/GIF drops. An unclaimed media drop
-- expires 30 days after first issue; rotating its invite never extends that
-- hard deadline. Physical deletion is queued only after the letter and invite
-- rows are locked in the same letter -> invite order used by claim_drop_invite.

alter table public.letters
  add column if not exists media_claim_expires_at timestamptz;

alter table public.letters
  drop constraint if exists letters_media_claim_expiry_kind_check;
alter table public.letters
  add constraint letters_media_claim_expiry_kind_check
  check (
    media_claim_expires_at is null
    or (delivery_mode = 'instant' and payload_kind in ('image', 'gif') and media_path is not null)
  );

create index if not exists letters_expired_unclaimed_media_idx
  on public.letters (media_claim_expires_at, id)
  where status = 'claim_pending' and recipient_id is null and media_claim_expires_at is not null;

create or replace function private.keep_drop_media_claim_expiry_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.media_claim_expires_at is distinct from old.media_claim_expires_at then
    raise exception using errcode = '23514', message = 'The Drop media claim expiry cannot be changed.';
  end if;
  return new;
end;
$$;

revoke all on function private.keep_drop_media_claim_expiry_immutable() from public, anon, authenticated;
drop trigger if exists letters_keep_drop_media_claim_expiry_immutable on public.letters;
create trigger letters_keep_drop_media_claim_expiry_immutable
before update of media_claim_expires_at on public.letters
for each row execute function private.keep_drop_media_claim_expiry_immutable();

create or replace function private.drop_media_final_path_is_valid(
  p_sender_id uuid,
  p_letter_id text,
  p_media_path text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_media_path is not null
    and pg_catalog.array_length(pg_catalog.string_to_array(p_media_path, '/'), 1) = 3
    and pg_catalog.split_part(p_media_path, '/', 1) = p_sender_id::text
    and pg_catalog.split_part(p_media_path, '/', 2) = p_letter_id
    and pg_catalog.split_part(p_media_path, '/', 3) ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$',
    false
  );
$$;

create or replace function private.drop_claim_media_object_matches(
  p_sender_id uuid,
  p_letter_id text,
  p_payload_kind text,
  p_media_path text,
  p_media_mime_type text,
  p_media_size_bytes integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
  v_size text;
begin
  if p_sender_id is null or p_letter_id is null or p_payload_kind is null
    or p_media_mime_type is null
    or p_payload_kind not in ('image', 'gif')
    or not private.drop_media_final_path_is_valid(p_sender_id, p_letter_id, p_media_path)
    or p_media_size_bytes is null or p_media_size_bytes < 1 or p_media_size_bytes > 8388608 then
    return false;
  end if;

  if (p_payload_kind = 'gif' and p_media_mime_type is distinct from 'image/gif')
    or (p_payload_kind = 'image' and p_media_mime_type not in ('image/jpeg', 'image/png', 'image/webp')) then
    return false;
  end if;

  select o.metadata into v_metadata
  from storage.objects o
  where o.bucket_id = 'drop-media' and o.name = p_media_path;
  if not found or v_metadata is null or v_metadata->>'mimetype' is distinct from p_media_mime_type then
    return false;
  end if;

  v_size := v_metadata->>'size';
  if v_size is null or v_size !~ '^[0-9]+$' then
    return false;
  end if;
  return v_size::bigint = p_media_size_bytes;
end;
$$;

revoke all on function private.drop_media_final_path_is_valid(uuid, text, text) from public, anon, authenticated;
revoke all on function private.drop_claim_media_object_matches(uuid, text, text, text, text, integer) from public, anon, authenticated;

-- Media issue is enabled only when the expected hourly cleanup job and its
-- Vault inputs are present. A delayed Free-project schedule still enforces the
-- claim/read deadline in SQL, but an unscheduled deployment cannot promise
-- automatic physical deletion and therefore cannot issue new media links.
create or replace function private.drop_media_cleanup_is_scheduled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secrets_ready boolean := false;
  v_job_exists boolean := false;
begin
  if pg_catalog.to_regnamespace('cron') is null
    or pg_catalog.to_regnamespace('net') is null
    or pg_catalog.to_regclass('cron.job') is null
    or pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;

  execute $query$
    select count(distinct name) = 3
      and coalesce(bool_and(pg_catalog.length(pg_catalog.btrim(decrypted_secret)) > 0), false)
      and max(case when name = 'drop_media_cleanup_secret'
        then pg_catalog.length(decrypted_secret) else 0 end) >= 32
    from vault.decrypted_secrets where name = any($1)
  $query$
    into v_secrets_ready
    using array['drop_media_cleanup_project_url', 'drop_media_cleanup_anon_key', 'drop_media_cleanup_secret'];
  if not coalesce(v_secrets_ready, false) then return false; end if;

  execute 'select exists (select 1 from cron.job where jobname = $1 and active and schedule = $2 and command like $3)'
    into v_job_exists using 'drop-expired-drop-media-hourly', '17 * * * *', '%cleanup-expired-drop-media%';
  return coalesce(v_job_exists, false);
end;
$$;

revoke all on function private.drop_media_cleanup_is_scheduled() from public, anon, authenticated, service_role;

-- The existing text RPC signature and implementation remain unchanged.
create or replace function public.issue_drop_media_claim_invite(
  p_letter_id text,
  p_subject text,
  p_content text,
  p_payload_kind text,
  p_media_path text,
  p_media_mime_type text,
  p_media_size_bytes integer,
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
  v_media_expires_at timestamptz;
  v_letter public.letters%rowtype;
  v_invite private.drop_claim_invites%rowtype;
  v_cleanup_id bigint;
  v_cleanup_cancelable boolean;
begin
  if v_sender_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the Drop sender to create an invite.';
  end if;

  select p.display_name into v_sender_display_name
  from public.profiles p where p.id = v_sender_id;
  if not found then
    raise exception using errcode = '42501', message = 'Create a Drop profile before creating an invite.';
  end if;

  if not private.drop_media_cleanup_is_scheduled() then
    raise exception using errcode = '55000', message = 'Photo and GIF claim links are not available yet.';
  end if;

  if p_letter_id is null or p_letter_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
    or p_subject is null or pg_catalog.char_length(p_subject) > 100
    or p_content is null or pg_catalog.char_length(p_content) > 5000
    or p_token is null or p_token !~ '^[0-9A-Fa-f]{64}$'
    or p_payload_kind not in ('image', 'gif')
    or not private.drop_claim_media_object_matches(
      v_sender_id, p_letter_id, p_payload_kind, p_media_path, p_media_mime_type, p_media_size_bytes
    ) then
    raise exception using errcode = '22023', message = 'The Drop media invite request is invalid.';
  end if;

  v_token_hash := private.hash_drop_claim_token(p_token);
  -- Issue/reissue serialize by draft advisory lock, then letter, then path.
  -- Claim and cleanup take letter then invite; cleanup also takes the path lock
  -- before enqueuing Storage deletion.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-claim:' || p_letter_id, 0)
  );

  select l.* into v_letter
  from public.letters l where l.id = p_letter_id for update;
  v_now := pg_catalog.clock_timestamp();

  if found then
    if v_letter.sender_id is distinct from v_sender_id
      or v_letter.status is distinct from 'claim_pending'
      or v_letter.recipient_id is not null
      or v_letter.subject is distinct from p_subject
      or v_letter.content is distinct from p_content
      or v_letter.delivery_mode is distinct from 'instant'
      or v_letter.payload_kind is distinct from p_payload_kind
      or v_letter.media_path is distinct from p_media_path
      or v_letter.media_mime_type is distinct from p_media_mime_type
      or v_letter.media_size_bytes is distinct from p_media_size_bytes
      or v_letter.media_claim_expires_at is null
      or v_letter.media_claim_expires_at <= v_now then
      raise exception using errcode = '42501', message = 'This Drop cannot be issued as an invite.';
    end if;

    select i.* into v_invite
    from private.drop_claim_invites i
    where i.letter_id = p_letter_id and i.replaced_at is null
    for update;
    if not found or v_invite.sender_id is distinct from v_sender_id
      or v_invite.claimed_at is not null or v_invite.revoked_at is not null then
      raise exception using errcode = '42501', message = 'This Drop invite is no longer available.';
    end if;

    if v_invite.token_hash is distinct from v_token_hash then
      if exists (select 1 from private.drop_claim_invites i where i.token_hash = v_token_hash) then
        raise exception using errcode = '42501', message = 'This Drop invite capability cannot be reused.';
      end if;
      update private.drop_claim_invites i set replaced_at = v_now where i.token_hash = v_invite.token_hash;
      insert into private.drop_claim_invites (token_hash, letter_id, sender_id, expires_at, created_at)
    values (v_token_hash, p_letter_id, v_sender_id,
        least(v_now + interval '7 days', v_letter.media_claim_expires_at), v_now);
    end if;
    return p_letter_id;
  end if;

  if exists (select 1 from private.drop_claim_invites i where i.token_hash = v_token_hash) then
    raise exception using errcode = '42501', message = 'This Drop invite capability cannot be reused.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-media-path:' || p_media_path, 0)
  );

  -- An earlier ambiguous issue attempt may have queued this exact finalized
  -- path for delayed cleanup. The same advisory lock serializes queueing and
  -- issuing: cancel only a still-pending, unleased orphan job before linking
  -- the path. Once a worker leases it, reuse is refused to prevent deletion
  -- racing a new link.
  select j.id,
    j.letter_id = p_letter_id
      and j.sender_id = v_sender_id
      and j.lease_token is null
  into v_cleanup_id, v_cleanup_cancelable
  from private.drop_media_cleanup_jobs j
  where j.media_path = p_media_path
  for update;
  if found then
    if v_cleanup_cancelable then
      delete from private.drop_media_cleanup_jobs j where j.id = v_cleanup_id;
    else
      raise exception using errcode = '42501', message = 'This photo/GIF is already being cleaned up.';
    end if;
  end if;

  v_media_expires_at := v_now + interval '30 days';
  insert into public.letters (
    id, sender_id, sender_display_name, subject, content, status, delivery_mode,
    payload_kind, media_path, media_mime_type, media_size_bytes,
    media_claim_expires_at, dispatched_at, created_at, updated_at
  ) values (
    p_letter_id, v_sender_id, v_sender_display_name, p_subject, p_content,
    'claim_pending', 'instant', p_payload_kind, p_media_path, p_media_mime_type,
    p_media_size_bytes, v_media_expires_at, v_now, v_now, v_now
  );

  insert into private.drop_claim_invites (token_hash, letter_id, sender_id, expires_at, created_at)
  values (v_token_hash, p_letter_id, v_sender_id,
    least(v_now + interval '7 days', v_media_expires_at), v_now);
  return p_letter_id;
end;
$$;

revoke all on function public.issue_drop_media_claim_invite(text, text, text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.issue_drop_media_claim_invite(text, text, text, text, text, text, integer, text) to authenticated;

-- Keep text reissue behavior intact, and allow this same authenticated RPC to
-- rotate a media invite only while its original 30-day cap remains in force.
create or replace function public.reissue_drop_claim_invite(p_letter_id text, p_token text)
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
  if p_letter_id is null or p_letter_id = '' or p_token is null or p_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'The Drop invite request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-claim:' || p_letter_id, 0)
  );
  select l.* into v_letter from public.letters l where l.id = p_letter_id for update;
  if not found or v_letter.sender_id is distinct from v_sender_id
    or v_letter.status is distinct from 'claim_pending'
    or v_letter.recipient_id is not null or v_letter.delivery_mode is distinct from 'instant' then
    raise exception using errcode = '42501', message = 'This Drop cannot be reissued as an invite.';
  end if;

  select i.* into v_invite
  from private.drop_claim_invites i
  where i.letter_id = p_letter_id and i.replaced_at is null
  for update;
  if not found or v_invite.sender_id is distinct from v_sender_id
    or v_invite.claimed_at is not null or v_invite.revoked_at is not null then
    raise exception using errcode = '42501', message = 'This Drop invite is no longer available.';
  end if;

  if v_letter.payload_kind = 'text'
    and v_letter.media_path is null and v_letter.media_mime_type is null and v_letter.media_size_bytes is null
    and v_letter.media_claim_expires_at is null then
    return public.issue_drop_claim_invite(p_letter_id, v_letter.subject, v_letter.content, p_token);
  end if;

  if v_letter.payload_kind in ('image', 'gif')
    and v_letter.media_claim_expires_at > pg_catalog.clock_timestamp()
    and private.drop_claim_media_object_matches(
      v_letter.sender_id, v_letter.id, v_letter.payload_kind,
      v_letter.media_path, v_letter.media_mime_type, v_letter.media_size_bytes
    ) then
    return public.issue_drop_media_claim_invite(
      p_letter_id, v_letter.subject, v_letter.content, v_letter.payload_kind,
      v_letter.media_path, v_letter.media_mime_type, v_letter.media_size_bytes, p_token
    );
  end if;

  raise exception using errcode = '42501', message = 'This Drop cannot be reissued as an invite.';
end;
$$;

revoke all on function public.reissue_drop_claim_invite(text, text) from public, anon, authenticated;
grant execute on function public.reissue_drop_claim_invite(text, text) to authenticated;

-- Explicit claim still locks the letter before the invite. The first claim is
-- rejected after either the current link expiry or immutable media expiry.
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
  select p.username, p.display_name into v_recipient_username, v_recipient_display_name
  from public.profiles p where p.id = v_recipient_id;
  if not found then
    raise exception using errcode = '42501', message = 'Create a Drop profile before claiming this invite.';
  end if;
  if p_token is null or p_token !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;
  v_token_hash := private.hash_drop_claim_token(p_token);

  select i.letter_id into v_letter_id from private.drop_claim_invites i where i.token_hash = v_token_hash;
  if not found then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;
  select l.* into v_letter from public.letters l where l.id = v_letter_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;
  select i.* into v_invite
  from private.drop_claim_invites i
  where i.letter_id = v_letter_id and i.token_hash = v_token_hash
  for update;
  if not found or v_invite.sender_id is distinct from v_letter.sender_id
    or v_invite.revoked_at is not null or v_invite.replaced_at is not null then
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
      and (
        (v_letter.payload_kind = 'text' and v_letter.media_path is null
          and v_letter.media_mime_type is null and v_letter.media_size_bytes is null
          and v_letter.media_claim_expires_at is null)
        or (v_letter.payload_kind in ('image', 'gif')
          and v_letter.media_claim_expires_at is not null
          and private.drop_media_final_path_is_valid(v_letter.sender_id, v_letter.id, v_letter.media_path)
          and v_letter.media_size_bytes between 1 and 8388608
          and ((v_letter.payload_kind = 'gif' and v_letter.media_mime_type = 'image/gif')
            or (v_letter.payload_kind = 'image' and v_letter.media_mime_type in ('image/jpeg', 'image/png', 'image/webp'))))
      ) then
      return v_letter_id;
    end if;
    raise exception using errcode = '42501', message = 'This Drop invite has already been claimed.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_invite.expires_at <= v_now then
    raise exception using errcode = '42501', message = 'This Drop invite is invalid or expired.';
  end if;
  if v_letter.status is distinct from 'claim_pending'
    or v_letter.recipient_id is not null or v_letter.delivery_mode is distinct from 'instant'
    or not (
      (v_letter.payload_kind = 'text' and v_letter.media_path is null
        and v_letter.media_mime_type is null and v_letter.media_size_bytes is null
        and v_letter.media_claim_expires_at is null)
      or (v_letter.payload_kind in ('image', 'gif')
        and v_letter.media_claim_expires_at is not null
        and v_letter.media_claim_expires_at > v_now
        and private.drop_claim_media_object_matches(
          v_letter.sender_id, v_letter.id, v_letter.payload_kind,
          v_letter.media_path, v_letter.media_mime_type, v_letter.media_size_bytes
        ))
    ) then
    raise exception using errcode = '42501', message = 'This Drop invite is no longer available.';
  end if;

  update public.letters l
  set recipient_id = v_recipient_id,
      recipient_username = v_recipient_username,
      recipient_name = v_recipient_display_name,
      status = 'delivered',
      delivered_at = v_now,
      updated_at = v_now
  where l.id = v_letter_id;
  update private.drop_claim_invites i
  set claimed_by = v_recipient_id, claimed_at = v_now
  where i.letter_id = v_letter_id and i.token_hash = v_token_hash;
  return v_letter_id;
end;
$$;

revoke all on function public.claim_drop_invite(text) from public, anon, authenticated;
grant execute on function public.claim_drop_invite(text) to authenticated;

-- Keep the restore-status RPC sender-scoped and ID-only while including the
-- explicitly claimed media kinds.
create or replace function public.get_sender_claimed_drop_ids()
returns table(letter_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.letter_id
  from private.drop_claim_invites i
  join public.letters l on l.id = i.letter_id
  where i.sender_id = (select auth.uid())
    and l.sender_id = (select auth.uid())
    and i.claimed_by is not null and i.claimed_at is not null
    and i.revoked_at is null and i.replaced_at is null
    and l.status = 'delivered' and l.delivery_mode = 'instant'
    and l.recipient_id = i.claimed_by
    and (
      (l.payload_kind = 'text' and l.media_path is null
        and l.media_mime_type is null and l.media_size_bytes is null
        and l.media_claim_expires_at is null)
      or (l.payload_kind in ('image', 'gif')
        and l.media_path is not null and l.media_mime_type is not null
        and l.media_size_bytes between 1 and 8388608
        and l.media_claim_expires_at is not null)
    );
$$;

revoke all on function public.get_sender_claimed_drop_ids() from public, anon, authenticated;
grant execute on function public.get_sender_claimed_drop_ids() to authenticated;

-- This table has no FK to letters: deletion of the app row must not discard
-- a pending Storage deletion job. The path is retained as a tombstone against
-- reusing a finalized object while a cleanup job exists.
create table if not exists private.drop_media_cleanup_jobs (
  id bigint generated always as identity primary key,
  letter_id text not null,
  sender_id uuid not null,
  media_path text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  last_error_code text,
  completed_at timestamptz,
  constraint drop_media_cleanup_jobs_media_path_key unique (media_path),
  check ((lease_token is null) = (lease_until is null)),
  check (completed_at is null or lease_token is null),
  check (last_error_code is null or last_error_code in ('storage_remove_failed', 'invalid_path'))
);

create index if not exists drop_media_cleanup_jobs_due_idx
  on private.drop_media_cleanup_jobs (available_at, id)
  where completed_at is null;

revoke all on table private.drop_media_cleanup_jobs from public, anon, authenticated;
alter table private.drop_media_cleanup_jobs enable row level security;

create or replace function private.reject_drop_media_cleanup_path_reuse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.media_path is not null then
    -- Ordinary syncDropToBackend writes do not take the draft lock. Serialize
    -- every link against queueing/leasing by this object path instead.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-media-path:' || new.media_path, 0)
    );
    if exists (
      select 1 from private.drop_media_cleanup_jobs j where j.media_path = new.media_path
    ) then
      raise exception using errcode = '23505', message = 'This Drop media object is already scheduled for cleanup.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.reject_drop_media_cleanup_path_reuse() from public, anon, authenticated;
drop trigger if exists letters_reject_drop_media_cleanup_path_reuse on public.letters;
create trigger letters_reject_drop_media_cleanup_path_reuse
before insert or update of media_path on public.letters
for each row execute function private.reject_drop_media_cleanup_path_reuse();

-- A finalized object can exist without a linked letter when the client loses
-- the finalizer/issue response or receives a permanent issue error. This
-- authenticated RPC derives and validates the metadata from Storage, and
-- serializes by draft row then object path. If issue won, the linked row makes
-- this a no-op; if queueing won, a same-path issue retry may remove the
-- still-unleased tombstone before linking the object.
create or replace function public.queue_unlinked_drop_media_cleanup_job(
  p_letter_id text,
  p_payload_kind text,
  p_media_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid := (select auth.uid());
  v_letter public.letters%rowtype;
  v_has_letter boolean := false;
  v_job_id bigint;
  v_job_status text;
  v_media_mime_type text;
  v_media_size_text text;
  v_media_size_bytes integer;
  v_metadata jsonb;
begin
  if v_sender_id is null then
    raise exception using errcode = '42501', message = 'Sign in as the Drop sender to clean up this photo/GIF.';
  end if;
  if p_letter_id is null or p_letter_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
    or p_payload_kind is null or p_payload_kind not in ('image', 'gif')
    or not private.drop_media_final_path_is_valid(v_sender_id, p_letter_id, p_media_path) then
    raise exception using errcode = '22023', message = 'The finalized Drop media cleanup request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-claim:' || p_letter_id, 0)
  );

  select l.* into v_letter
  from public.letters l where l.id = p_letter_id for update;
  v_has_letter := found;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-media-path:' || p_media_path, 0)
  );

  if v_has_letter and v_letter.sender_id = v_sender_id and v_letter.media_path = p_media_path then
    return 'linked';
  end if;
  if exists (select 1 from public.letters l where l.media_path = p_media_path) then
    return 'linked';
  end if;

  select j.id,
    case
      when j.lease_token is not null then 'cleaning'
      else 'queued'
    end
  into v_job_id, v_job_status
  from private.drop_media_cleanup_jobs j
  where j.media_path = p_media_path
  for update;
  if found then
    if v_job_status = 'cleaning' then
      return 'cleaning';
    end if;
    if v_job_status = 'queued' and exists (
      select 1 from private.drop_media_cleanup_jobs j
      where j.id = v_job_id and j.completed_at is not null
    ) then
      -- A completed tombstone can only be reopened after a fresh matching
      -- object has been uploaded to this path and revalidated.
      select o.metadata into v_metadata
      from storage.objects o
      where o.bucket_id = 'drop-media' and o.name = p_media_path;
      if not found or v_metadata is null then
        return 'cleaning';
      end if;
      v_media_mime_type := v_metadata->>'mimetype';
      v_media_size_text := v_metadata->>'size';
      if v_media_size_text is null or v_media_size_text !~ '^[0-9]+$'
        or v_media_size_text::numeric < 1 or v_media_size_text::numeric > 8388608 then
        return 'cleaning';
      end if;
      v_media_size_bytes := v_media_size_text::integer;
      if not private.drop_claim_media_object_matches(
        v_sender_id, p_letter_id, p_payload_kind, p_media_path, v_media_mime_type, v_media_size_bytes
      ) then
        return 'cleaning';
      end if;
      update private.drop_media_cleanup_jobs j
      set completed_at = null,
          available_at = pg_catalog.clock_timestamp() + interval '24 hours',
          last_error_code = null
      where j.id = v_job_id and j.lease_token is null;
    end if;
    return v_job_status;
  end if;

  select o.metadata into v_metadata
  from storage.objects o
  where o.bucket_id = 'drop-media' and o.name = p_media_path;
  if not found or v_metadata is null then
    raise exception using errcode = '22023', message = 'The finalized Drop media cleanup request is invalid.';
  end if;
  v_media_mime_type := v_metadata->>'mimetype';
  v_media_size_text := v_metadata->>'size';
  if v_media_size_text is null or v_media_size_text !~ '^[0-9]+$'
    or v_media_size_text::numeric < 1 or v_media_size_text::numeric > 8388608 then
    raise exception using errcode = '22023', message = 'The finalized Drop media cleanup request is invalid.';
  end if;
  v_media_size_bytes := v_media_size_text::integer;
  if not private.drop_claim_media_object_matches(
    v_sender_id, p_letter_id, p_payload_kind, p_media_path, v_media_mime_type, v_media_size_bytes
  ) then
    raise exception using errcode = '22023', message = 'The finalized Drop media cleanup request is invalid.';
  end if;

  insert into private.drop_media_cleanup_jobs (
    letter_id, sender_id, media_path, available_at
  ) values (
    p_letter_id, v_sender_id, p_media_path, pg_catalog.clock_timestamp() + interval '24 hours'
  ) on conflict on constraint drop_media_cleanup_jobs_media_path_key do nothing;

  select j.id,
    case
      when j.lease_token is not null then 'cleaning'
      else 'queued'
    end
  into v_job_id, v_job_status
  from private.drop_media_cleanup_jobs j
  where j.media_path = p_media_path
  for update;
  return coalesce(v_job_status, 'queued');
end;
$$;

revoke all on function public.queue_unlinked_drop_media_cleanup_job(text, text, text) from public, anon, authenticated;
grant execute on function public.queue_unlinked_drop_media_cleanup_job(text, text, text) to authenticated;

create or replace function public.lease_expired_drop_media_cleanup_jobs(p_limit integer default 25)
returns table(job_id bigint, lease_token uuid, letter_id text, sender_id uuid, media_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_letter public.letters%rowtype;
  v_invite private.drop_claim_invites%rowtype;
  v_now timestamptz;
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception using errcode = '22023', message = 'The cleanup batch size is invalid.';
  end if;
  v_now := pg_catalog.clock_timestamp();

  -- Do not start with a locked invite. claim_drop_invite and this worker both
  -- acquire the letter row first, then the current invite row. This transaction
  -- revokes the capability and creates its job atomically before Storage API
  -- deletion can happen in the Edge Function.
  for v_candidate in
    select l.id
    from public.letters l
    where l.status = 'claim_pending' and l.recipient_id is null
      and l.delivery_mode = 'instant' and l.payload_kind in ('image', 'gif')
      and l.media_claim_expires_at <= v_now
    order by l.media_claim_expires_at, l.id
    limit p_limit
  loop
    select l.* into v_letter
    from public.letters l where l.id = v_candidate.id
    for update skip locked;
    if not found then continue; end if;

    if v_letter.status <> 'claim_pending' or v_letter.recipient_id is not null
      or v_letter.delivery_mode <> 'instant' or v_letter.payload_kind not in ('image', 'gif')
      or v_letter.media_claim_expires_at is null or v_letter.media_claim_expires_at > v_now
      or not private.drop_media_final_path_is_valid(v_letter.sender_id, v_letter.id, v_letter.media_path) then
      continue;
    end if;

    select i.* into v_invite
    from private.drop_claim_invites i
    where i.letter_id = v_letter.id and i.replaced_at is null
    order by i.created_at desc
    limit 1
    for update;
    if found then
      if v_invite.claimed_at is not null then continue; end if;
      if v_invite.revoked_at is null then
        update private.drop_claim_invites i
        set revoked_at = v_now
        where i.token_hash = v_invite.token_hash and i.claimed_at is null and i.replaced_at is null;
      end if;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-media-path:' || v_letter.media_path, 0)
    );

    -- Make newly enqueued expired rows eligible in this same worker call;
    -- using the table's clock_timestamp() default would be slightly later
    -- than v_now and defer physical deletion until the next hourly run.
    insert into private.drop_media_cleanup_jobs (letter_id, sender_id, media_path, available_at)
    values (v_letter.id, v_letter.sender_id, v_letter.media_path, v_now)
    on conflict on constraint drop_media_cleanup_jobs_media_path_key do nothing;
  end loop;

  return query
  with due as (
    select j.id
    from private.drop_media_cleanup_jobs j
    where j.completed_at is null
      and j.available_at <= v_now
      and (j.lease_until is null or j.lease_until <= v_now)
    order by j.available_at, j.id
    limit p_limit
    for update skip locked
  ), leased as (
    update private.drop_media_cleanup_jobs j
    set lease_token = pg_catalog.gen_random_uuid(),
        lease_until = v_now + interval '5 minutes',
        attempts = j.attempts + 1
    from due
    where j.id = due.id
    returning j.id, j.lease_token, j.letter_id, j.sender_id, j.media_path
  )
  select leased.id, leased.lease_token, leased.letter_id, leased.sender_id, leased.media_path
  from leased;
end;
$$;

create or replace function public.finish_expired_drop_media_cleanup_job(
  p_job_id bigint,
  p_lease_token uuid,
  p_removed boolean,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_job private.drop_media_cleanup_jobs%rowtype;
  v_letter public.letters%rowtype;
  v_invite private.drop_claim_invites%rowtype;
  v_has_letter boolean := false;
  v_has_invite boolean := false;
begin
  if p_job_id is null or p_lease_token is null or p_removed is null
    or (not p_removed and (p_error_code is null or p_error_code not in ('storage_remove_failed', 'invalid_path'))) then
    raise exception using errcode = '22023', message = 'The cleanup result is invalid.';
  end if;

  if p_removed then
    -- Read the job without locking it, then acquire letter -> invite -> job.
    -- The lease RPC uses the same order while selecting expired rows, so a
    -- stale worker cannot deadlock with a new lease while claiming deletion.
    select j.* into v_job from private.drop_media_cleanup_jobs j where j.id = p_job_id;
    if not found then return false; end if;

    select l.* into v_letter
    from public.letters l where l.id = v_job.letter_id
    for update;
    v_has_letter := found;
    if v_has_letter then
      select i.* into v_invite
      from private.drop_claim_invites i
      where i.letter_id = v_job.letter_id and i.replaced_at is null
      order by i.created_at desc
      limit 1
      for update;
      v_has_invite := found;
    end if;

    select j.* into v_job
    from private.drop_media_cleanup_jobs j
    where j.id = p_job_id
    for update;
    if not found or v_job.lease_token is distinct from p_lease_token or v_job.completed_at is not null then
      return false;
    end if;

    if v_has_letter
      and v_letter.sender_id = v_job.sender_id
      and v_letter.media_path = v_job.media_path
      and v_letter.status = 'claim_pending'
      and v_letter.recipient_id is null
      and v_letter.delivery_mode = 'instant'
      and v_letter.payload_kind in ('image', 'gif')
      and v_letter.media_claim_expires_at is not null
      and v_letter.media_claim_expires_at <= v_now
      and (not v_has_invite or v_invite.claimed_at is null) then
      if v_has_invite and v_invite.revoked_at is null then
        update private.drop_claim_invites i
        set revoked_at = v_now
        where i.token_hash = v_invite.token_hash and i.claimed_at is null;
      end if;
      delete from public.letters l where l.id = v_job.letter_id;
    end if;

    update private.drop_media_cleanup_jobs j
    set completed_at = v_now, lease_token = null, lease_until = null, last_error_code = null
    where j.id = p_job_id and j.lease_token = p_lease_token and j.completed_at is null;
  else
    update private.drop_media_cleanup_jobs j
    set available_at = v_now + interval '1 hour',
        lease_token = null,
        lease_until = null,
        last_error_code = p_error_code
    where j.id = p_job_id and j.lease_token = p_lease_token and j.completed_at is null;
  end if;
  return found;
end;
$$;

revoke all on function public.lease_expired_drop_media_cleanup_jobs(integer) from public, anon, authenticated;
revoke all on function public.finish_expired_drop_media_cleanup_job(bigint, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.lease_expired_drop_media_cleanup_jobs(integer) to service_role;
grant execute on function public.finish_expired_drop_media_cleanup_job(bigint, uuid, boolean, text) to service_role;

-- The function uses the Storage API for deletion; it never writes storage.objects.
-- Deploy with `supabase functions deploy cleanup-expired-drop-media` and set
-- DROP_MEDIA_CLEANUP_SECRET in the Edge Function environment. Before applying
-- this migration, store these three Vault secrets:
--   drop_media_cleanup_project_url = https://<project-ref>.supabase.co
--   drop_media_cleanup_anon_key = the project's publishable/anon API key
--   drop_media_cleanup_secret = the same high-entropy value as DROP_MEDIA_CLEANUP_SECRET
-- On Supabase Free, pg_cron/pg_net can invoke the function hourly; a paused Free
-- project stops scheduled work. The 30-day claim/RLS gate still blocks new
-- claims and reads when the database is active, but physical deletion is
-- eventual and may be delayed by pause, worker/API failures, or Storage outages.
create or replace function private.schedule_drop_media_cleanup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secrets_ready boolean;
  v_job_id bigint;
  v_command text := $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'drop_media_cleanup_project_url')
        || '/functions/v1/cleanup-expired-drop-media',
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'drop_media_cleanup_anon_key'),
        'x-drop-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'drop_media_cleanup_secret')
      ),
      body := '{"limit":25}'::jsonb
    );
  $job$;
begin
  if pg_catalog.to_regnamespace('cron') is null
    or pg_catalog.to_regnamespace('net') is null
    or pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    return false;
  end if;

  execute $query$
    select count(distinct name) = 3
      and coalesce(bool_and(pg_catalog.length(pg_catalog.btrim(decrypted_secret)) > 0), false)
      and max(case when name = 'drop_media_cleanup_secret'
        then pg_catalog.length(decrypted_secret) else 0 end) >= 32
    from vault.decrypted_secrets where name = any($1)
  $query$
    into v_secrets_ready
    using array['drop_media_cleanup_project_url', 'drop_media_cleanup_anon_key', 'drop_media_cleanup_secret'];
  if not coalesce(v_secrets_ready, false) then return false; end if;

  execute 'select jobid from cron.job where jobname = $1 order by jobid limit 1'
    into v_job_id using 'drop-expired-drop-media-hourly';
  if v_job_id is not null then
    execute 'select cron.unschedule($1)' using v_job_id;
  end if;
  execute 'select cron.schedule($1, $2, $3)'
    using 'drop-expired-drop-media-hourly', '17 * * * *', v_command;
  return true;
end;
$$;

revoke all on function private.schedule_drop_media_cleanup() from public, anon, authenticated, service_role;

do $$
begin
  if private.schedule_drop_media_cleanup() then
    raise notice 'Scheduled hourly Drop media cleanup.';
  else
    raise notice 'Drop media cleanup was not scheduled. Enable pg_cron and pg_net, create the three documented Vault secrets, then run select private.schedule_drop_media_cleanup() as the database owner.';
  end if;
exception when others then
  raise notice 'Drop media cleanup was not scheduled (%). Configure pg_cron/pg_net and Vault, then run select private.schedule_drop_media_cleanup() as the database owner.', sqlstate;
end;
$$;

-- Before invoking the private scheduler manually after Vault is configured,
-- deploy the Edge Function with [functions.cleanup-expired-drop-media]
-- verify_jwt = false; it validates the private x-drop-cleanup-secret header.
comment on table private.drop_media_cleanup_jobs is
  'Private retry queue for expired, unclaimed Drop media. The Edge Function removes objects through the Supabase Storage API; never delete storage.objects rows with SQL.';
comment on column public.letters.media_claim_expires_at is
  'Immutable 30-day hard deadline for an unclaimed photo/GIF claim invite, measured from initial issue. Reissue does not change it.';

drop policy if exists "Drop participants can read media" on storage.objects;
create policy "Drop participants can read media" on storage.objects for select using (
  bucket_id = 'drop-media' and exists (
    select 1 from public.letters l
    where l.media_path = name
      and pg_catalog.split_part(name, '/', 1) = l.sender_id::text
      and (
        (
          l.recipient_id = auth.uid()
          and l.status is distinct from 'dispatched'
        )
        or (
          l.sender_id = auth.uid()
          and (
            l.recipient_id is not null
            or l.media_claim_expires_at is null
            or l.media_claim_expires_at > pg_catalog.clock_timestamp()
          )
        )
      )
  )
);

notify pgrst, 'reload schema';
