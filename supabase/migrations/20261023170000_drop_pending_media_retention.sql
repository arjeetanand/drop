-- Abandoned pending uploads are temporary send-time objects. Draft content
-- remains in the user's local store; only valid, unlinked pending objects are
-- eligible for deletion after 30 days. Storage API inserts and cleanup serialize
-- per path so a key queued for deletion cannot race a same-key re-upload.

create table if not exists private.drop_pending_media_scan_state (
  id smallint primary key check (id = 1),
  last_created_at timestamptz,
  last_media_path text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((last_created_at is null) = (last_media_path is null))
);

insert into private.drop_pending_media_scan_state (id)
values (1)
on conflict (id) do nothing;

create table if not exists private.drop_pending_media_cleanup_jobs (
  media_path text primary key,
  sender_id uuid not null,
  draft_id text not null,
  object_created_at timestamptz not null,
  queued_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_attempt_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  removed_at timestamptz,
  constraint drop_pending_media_cleanup_jobs_path_shape check (
    media_path ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/pending/[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})?$'
    and pg_catalog.split_part(media_path, '/', 1) = sender_id::text
    and pg_catalog.split_part(media_path, '/', 3) = draft_id
  )
);

create index if not exists drop_pending_media_cleanup_jobs_retry_idx
  on private.drop_pending_media_cleanup_jobs (
    (coalesce(last_attempt_at, queued_at)), queued_at, media_path
  )
  where removed_at is null;

revoke all on table private.drop_pending_media_scan_state from public, anon, authenticated, service_role;
revoke all on table private.drop_pending_media_cleanup_jobs from public, anon, authenticated, service_role;
alter table private.drop_pending_media_scan_state enable row level security;
alter table private.drop_pending_media_cleanup_jobs enable row level security;

-- Storage's authenticated insert policy takes this same path lock before
-- inserting a pending object. A queued tombstone therefore cannot race a
-- same-key re-upload into deleting a newer object.
create or replace function private.drop_pending_media_path_is_uploadable(p_media_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_media_path is null
    or auth.uid() is null
    or pg_catalog.split_part(p_media_path, '/', 1) <> auth.uid()::text
    or p_media_path !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/pending/[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})?$' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('drop-pending-media-path:' || p_media_path, 0)
  );
  return not exists (
    select 1 from private.drop_pending_media_cleanup_jobs j
    where j.media_path = p_media_path
  );
end;
$$;

revoke all on function private.drop_pending_media_path_is_uploadable(text)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.drop_pending_media_path_is_uploadable(text)
  to authenticated;

drop policy if exists "Drop owners can stage their media" on storage.objects;
create policy "Drop owners can stage their media" on storage.objects for insert with check (
  bucket_id = 'drop-media'
  and pg_catalog.split_part(name, '/', 1) = auth.uid()::text
  and pg_catalog.split_part(name, '/', 2) = 'pending'
  and pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) in (4, 5)
  and pg_catalog.split_part(name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$'
  and pg_catalog.split_part(name, '/', 4) ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
  and (pg_catalog.array_length(pg_catalog.string_to_array(name, '/'), 1) = 4
    or pg_catalog.split_part(name, '/', 5) ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$')
  and private.drop_pending_media_path_is_uploadable(name)
);

create or replace function public.scan_expired_drop_staged_media(p_limit integer default 25)
returns table(sender_id uuid, draft_id text, media_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan private.drop_pending_media_scan_state%rowtype;
  v_objects refcursor;
  v_candidate record;
  v_cutoff timestamptz := pg_catalog.clock_timestamp() - interval '30 days';
  v_scanned integer := 0;
  v_last_created_at timestamptz;
  v_last_media_path text;
  v_current_created_at timestamptz;
  v_path_pattern constant text := '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/pending/[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})?$';
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception using errcode = '22023', message = 'The cleanup batch size is invalid.';
  end if;

  -- A completed job reserves the path briefly so a slow concurrent Storage
  -- removal cannot delete an object re-created immediately after confirmation.
  delete from private.drop_pending_media_cleanup_jobs j
  where j.removed_at <= pg_catalog.clock_timestamp() - interval '24 hours';

  if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-media-pending-reconciliation', 0)
    ) then
    return query
      select j.sender_id, j.draft_id, j.media_path
      from private.drop_pending_media_cleanup_jobs j
      where j.removed_at is null
      order by coalesce(j.last_attempt_at, j.queued_at), j.queued_at, j.media_path
      limit p_limit;
    return;
  end if;

  select s.* into v_scan
  from private.drop_pending_media_scan_state s
  where s.id = 1
  for update;
  if not found then
    insert into private.drop_pending_media_scan_state (id) values (1)
    on conflict (id) do nothing;
    select s.* into v_scan
    from private.drop_pending_media_scan_state s
    where s.id = 1
    for update;
  end if;

  if v_scan.last_created_at is null then
    open v_objects for
      select o.created_at, o.name
      from storage.objects o
      where o.bucket_id = 'drop-media'
        and o.created_at is not null
        and o.created_at <= v_cutoff
        and o.name ~ v_path_pattern
        and not exists (select 1 from public.letters l where l.media_path = o.name)
        and not exists (select 1 from private.drop_media_cleanup_jobs j where j.media_path = o.name)
      order by o.created_at, o.name
      limit p_limit;
  else
    open v_objects for
      select o.created_at, o.name
      from storage.objects o
      where o.bucket_id = 'drop-media'
        and o.created_at is not null
        and o.created_at <= v_cutoff
        and o.name ~ v_path_pattern
        and (o.created_at, o.name) > (v_scan.last_created_at, v_scan.last_media_path)
        and not exists (select 1 from public.letters l where l.media_path = o.name)
        and not exists (select 1 from private.drop_media_cleanup_jobs j where j.media_path = o.name)
      order by o.created_at, o.name
      limit p_limit;
  end if;

  loop
    fetch v_objects into v_candidate;
    exit when not found;
    v_scanned := v_scanned + 1;
    v_last_created_at := v_candidate.created_at;
    v_last_media_path := v_candidate.name;

    if v_candidate.name !~ v_path_pattern then continue; end if;

    -- The upload RLS policy takes the same path lock. Re-read age, references,
    -- and existing jobs after the lock so a re-upload that won the lock first
    -- is treated as a fresh object and never queued from a stale cursor row.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-pending-media-path:' || v_candidate.name, 0)
    );
    select o.created_at into v_current_created_at
    from storage.objects o
    where o.bucket_id = 'drop-media' and o.name = v_candidate.name;
    if not found or v_current_created_at is null or v_current_created_at > v_cutoff
      or exists (select 1 from public.letters l where l.media_path = v_candidate.name)
      or exists (select 1 from private.drop_media_cleanup_jobs j where j.media_path = v_candidate.name)
      or exists (select 1 from private.drop_pending_media_cleanup_jobs j where j.media_path = v_candidate.name) then
      continue;
    end if;

    sender_id := pg_catalog.split_part(v_candidate.name, '/', 1)::uuid;
    draft_id := pg_catalog.split_part(v_candidate.name, '/', 3);
    media_path := v_candidate.name;
    insert into private.drop_pending_media_cleanup_jobs (
      media_path, sender_id, draft_id, object_created_at
    ) values (
      media_path, sender_id, draft_id, v_current_created_at
    ) on conflict do nothing;
  end loop;
  close v_objects;

  if v_scanned = 0 then
    if v_scan.last_created_at is not null then
      update private.drop_pending_media_scan_state
      set last_created_at = null,
          last_media_path = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = 1;
    end if;
  else
    update private.drop_pending_media_scan_state
    set last_created_at = v_last_created_at,
        last_media_path = v_last_media_path,
        updated_at = pg_catalog.clock_timestamp()
    where id = 1;
  end if;

  return query
    select j.sender_id, j.draft_id, j.media_path
    from private.drop_pending_media_cleanup_jobs j
    where j.removed_at is null
    order by coalesce(j.last_attempt_at, j.queued_at), j.queued_at, j.media_path
    limit p_limit;
end;
$$;

revoke all on function public.scan_expired_drop_staged_media(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.scan_expired_drop_staged_media(integer)
  to service_role;

create or replace function public.finish_expired_drop_staged_media_cleanup(
  p_media_path text,
  p_removed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_media_path is null or p_media_path !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/pending/[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12})?$'
    or p_removed is null then
    raise exception using errcode = '22023', message = 'The staging cleanup result is invalid.';
  end if;

  update private.drop_pending_media_cleanup_jobs
  set last_attempt_at = pg_catalog.clock_timestamp(),
      attempts = attempts + 1,
      removed_at = case when p_removed then pg_catalog.clock_timestamp() else null end
  where media_path = p_media_path and removed_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    return true;
  end if;
  -- Concurrent workers can finish the same candidate. Treat a prior
  -- successful completion as success without extending its tombstone window.
  return exists (
    select 1 from private.drop_pending_media_cleanup_jobs j
    where j.media_path = p_media_path and j.removed_at is not null
  );
end;
$$;

revoke all on function public.finish_expired_drop_staged_media_cleanup(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_expired_drop_staged_media_cleanup(text, boolean)
  to service_role;

comment on function public.scan_expired_drop_staged_media(integer) is
  'Queues at most 25 valid, unlinked pending Drop media paths older than 30 days and returns retryable Storage API cleanup candidates. Service-role worker only.';
comment on table private.drop_pending_media_cleanup_jobs is
  'Private retry queue for abandoned Drop staging media. Queued paths are blocked from re-upload until Storage confirms removal; completed paths remain reserved for 24 hours to prevent stale concurrent removals.';

notify pgrst, 'reload schema';
