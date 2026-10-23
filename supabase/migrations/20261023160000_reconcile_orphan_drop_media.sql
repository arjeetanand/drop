-- Recover finalized private objects that the sender could not enqueue after
-- both issue/cleanup attempts failed. The hourly worker scans a small indexed
-- page and retains a cursor so a large bucket is not rescanned every run.
-- Objects without a linked drop are retained for 30 days from Storage upload.

create table if not exists private.drop_media_cleanup_scan_state (
  id smallint primary key check (id = 1),
  last_created_at timestamptz,
  last_media_path text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((last_created_at is null) = (last_media_path is null))
);

insert into private.drop_media_cleanup_scan_state (id)
values (1)
on conflict (id) do nothing;

revoke all on table private.drop_media_cleanup_scan_state from public, anon, authenticated, service_role;
alter table private.drop_media_cleanup_scan_state enable row level security;

-- Keep each hourly scan to an ordered page of old drop-media metadata.
create index if not exists drop_media_cleanup_created_at_name_idx
  on storage.objects (created_at, name)
  where bucket_id = 'drop-media' and created_at is not null and name is not null;

comment on index storage.drop_media_cleanup_created_at_name_idx is
  'Supports the bounded age-ordered reconciliation scan for Drop private media.';

create or replace function public.reconcile_orphan_drop_media_cleanup_jobs(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan private.drop_media_cleanup_scan_state%rowtype;
  v_objects refcursor;
  v_candidate record;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cutoff timestamptz;
  v_sender_id uuid;
  v_letter_id text;
  v_metadata jsonb;
  v_payload_kind text;
  v_media_size_text text;
  v_media_size_bytes integer;
  v_scanned integer := 0;
  v_queued integer := 0;
  v_inserted integer := 0;
  v_object_created_at timestamptz;
  v_last_created_at timestamptz;
  v_last_media_path text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception using errcode = '22023', message = 'The cleanup batch size is invalid.';
  end if;

  -- Serialize cursor movement, then use the same claim -> media-path lock
  -- order as issue and cleanup queue operations for each candidate.
  if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-media-orphan-reconciliation', 0)
    ) then
    return 0;
  end if;

  select s.* into v_scan
  from private.drop_media_cleanup_scan_state s
  where s.id = 1
  for update;
  if not found then
    insert into private.drop_media_cleanup_scan_state (id) values (1)
    on conflict (id) do nothing;
    select s.* into v_scan
    from private.drop_media_cleanup_scan_state s
    where s.id = 1
    for update;
  end if;

  v_cutoff := v_now - interval '30 days';

  if v_scan.last_created_at is null then
    open v_objects for
      select o.created_at, o.name
      from storage.objects o
      where o.bucket_id = 'drop-media'
        and o.created_at is not null
        and o.name is not null
        and o.created_at <= v_cutoff
      order by o.created_at, o.name
      limit p_limit;
  else
    open v_objects for
      select o.created_at, o.name
      from storage.objects o
      where o.bucket_id = 'drop-media'
        and o.created_at is not null
        and o.name is not null
        and o.created_at <= v_cutoff
        and (o.created_at, o.name) > (v_scan.last_created_at, v_scan.last_media_path)
      order by o.created_at, o.name
      limit p_limit;
  end if;

  loop
    fetch v_objects into v_candidate;
    exit when not found;
    v_scanned := v_scanned + 1;
    v_last_created_at := v_candidate.created_at;
    v_last_media_path := v_candidate.name;

    -- Match only the finalized <sender>/<drop-id>/<upload-uuid> layout.
    -- Pending uploads use a separate four-segment path and are not eligible.
    if v_candidate.name !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$' then
      continue;
    end if;

    v_sender_id := pg_catalog.split_part(v_candidate.name, '/', 1)::uuid;
    v_letter_id := pg_catalog.split_part(v_candidate.name, '/', 2);
    if not private.drop_media_final_path_is_valid(v_sender_id, v_letter_id, v_candidate.name) then
      continue;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-claim:' || v_letter_id, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('drop-media-path:' || v_candidate.name, 0)
    );

    -- Recheck all eligibility after acquiring the path lock. A same-path issue
    -- or normal letter insert that won the lock must never be cleaned up.
    select o.created_at, o.metadata into v_object_created_at, v_metadata
    from storage.objects o
    where o.bucket_id = 'drop-media' and o.name = v_candidate.name;
    if not found or v_object_created_at is null or v_object_created_at > v_cutoff
      or v_metadata is null
      or exists (select 1 from public.letters l where l.media_path = v_candidate.name)
      or exists (select 1 from private.drop_media_cleanup_jobs j where j.media_path = v_candidate.name) then
      continue;
    end if;

    v_payload_kind := case
      when v_metadata->>'mimetype' = 'image/gif' then 'gif'
      when v_metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp') then 'image'
      else null
    end;
    v_media_size_text := v_metadata->>'size';
    if v_payload_kind is null or v_media_size_text is null
      or v_media_size_text !~ '^[0-9]{1,8}$' then
      continue;
    end if;

    v_media_size_bytes := v_media_size_text::integer;
    if v_media_size_bytes < 1 or v_media_size_bytes > 8388608
      or not private.drop_claim_media_object_matches(
        v_sender_id, v_letter_id, v_payload_kind, v_candidate.name,
        v_metadata->>'mimetype', v_media_size_bytes
      ) then
      continue;
    end if;

    insert into private.drop_media_cleanup_jobs (
      letter_id, sender_id, media_path, available_at
    ) values (
      v_letter_id, v_sender_id, v_candidate.name, v_now
    ) on conflict on constraint drop_media_cleanup_jobs_media_path_key do nothing;

    get diagnostics v_inserted = row_count;
    v_queued := v_queued + v_inserted;
  end loop;
  close v_objects;

  if v_scanned = 0 then
    -- Start a new pass on the next invocation. Newly aged objects have
    -- timestamps later than the prior cursor and are still encountered as the
    -- cursor advances through the old-object index.
    if v_scan.last_created_at is not null then
      update private.drop_media_cleanup_scan_state
      set last_created_at = null,
          last_media_path = null,
          updated_at = v_now
      where id = 1;
    end if;
    return 0;
  end if;

  update private.drop_media_cleanup_scan_state
  set last_created_at = v_last_created_at,
      last_media_path = v_last_media_path,
      updated_at = v_now
  where id = 1;

  return v_queued;
end;
$$;

revoke all on function public.reconcile_orphan_drop_media_cleanup_jobs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_orphan_drop_media_cleanup_jobs(integer)
  to service_role;

comment on function public.reconcile_orphan_drop_media_cleanup_jobs(integer) is
  'Queues at most 25 validated, unlinked drop-media objects older than 30 days for Storage API removal. Service-role worker only.';

notify pgrst, 'reload schema';
