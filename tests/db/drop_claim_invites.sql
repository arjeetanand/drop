\set ON_ERROR_STOP on

begin;

create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema realtime;
create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  event text not null,
  payload jsonb not null,
  is_private boolean not null
);
create function realtime.send(payload jsonb, event text, topic text, is_private boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into realtime.messages (topic, event, payload, is_private)
  values ($3, $2, $1, $4)
$$;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null,
  file_size_limit bigint not null,
  allowed_mime_types text[] not null
);
create table storage.objects (
  bucket_id text not null,
  name text not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key (bucket_id, name)
);
alter table storage.objects enable row level security;

\ir ../../supabase/migrations/20260823000000_dear_exe.sql
\ir ../../supabase/migrations/20261018000000_drop_media_reactions.sql
\ir ../../supabase/migrations/20261018000200_restrict_sent_letter_mutation.sql
\ir ../../supabase/migrations/20261018000300_z_preserve_sent_drop_integrity.sql
\ir ../../supabase/migrations/20261018000400_zz_validated_drop_media.sql
\ir ../../supabase/migrations/20261019000000_enforce_drop_payload_media_consistency.sql
\ir ../../supabase/migrations/20261023120000_drop_claim_invites.sql
\ir ../../supabase/migrations/20261023130000_drop_claimed_sender_broadcast.sql
\ir ../../supabase/migrations/20261023140000_sender_claimed_drop_status.sql
\ir ../../supabase/migrations/20261023150000_private_media_claim_invites.sql

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');
insert into public.profiles (id, username, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'alice', 'Alice'),
  ('22222222-2222-4222-8222-222222222222', 'bobby', 'Bobby'),
  ('33333333-3333-4333-8333-333333333333', 'other', 'Other');

grant usage on schema auth, public, storage to anon, authenticated;
grant usage on schema public to service_role;
grant execute on function auth.uid() to anon, authenticated;
grant select on public.profiles, public.letters, public.letter_events, public.letter_reactions to anon, authenticated;
grant insert, update, delete on public.letters, public.letter_events, public.letter_reactions to authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

select set_config('test.sender', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.recipient', '22222222-2222-4222-8222-222222222222', true);
select set_config('test.other', '33333333-3333-4333-8333-333333333333', true);
select set_config('test.unprofiled', '44444444-4444-4444-8444-444444444444', true);
select set_config('test.token_a', pg_catalog.repeat('a', 64), true);
select set_config('test.token_b', pg_catalog.repeat('b', 64), true);
select set_config('test.token_c', pg_catalog.repeat('c', 64), true);
select set_config('test.token_d', pg_catalog.repeat('d', 64), true);
select set_config('test.token_e', pg_catalog.repeat('e', 64), true);
select set_config('test.token_f', pg_catalog.repeat('f', 64), true);
select set_config('test.token_g', pg_catalog.repeat('1', 64), true);
select set_config('test.token_h', pg_catalog.repeat('2', 64), true);
select set_config('test.token_i', pg_catalog.repeat('3', 64), true);
select set_config('test.token_j', pg_catalog.repeat('4', 64), true);
select set_config('test.token_k', pg_catalog.repeat('5', 64), true);
select set_config('test.token_l', pg_catalog.repeat('6', 64), true);
select set_config('test.token_m', pg_catalog.repeat('7', 64), true);
select set_config('test.token_n', pg_catalog.repeat('8', 64), true);
select set_config('test.token_o', pg_catalog.repeat('9', 64), true);
select set_config('test.token_p', pg_catalog.repeat('0', 64), true);
select set_config(
  'test.token_q', pg_catalog.md5('drop-media-orphan') || pg_catalog.md5('drop-media-orphan-2'), true
);

-- Supabase scheduling/secret stubs are intentionally empty until the media
-- fixture setup below, so the migration cannot silently appear scheduled.
create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null,
  schedule text not null,
  command text not null,
  active boolean not null default true
);
create function cron.schedule(text, text, text) returns bigint
language plpgsql as $$
declare v_jobid bigint;
begin
  insert into cron.job (jobname, schedule, command, active) values ($1, $2, $3, true) returning jobid into v_jobid;
  return v_jobid;
end;
$$;
create function cron.unschedule(bigint) returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobid = $1;
  return found;
end;
$$;
create schema net;
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text not null);

-- Only authenticated users receive the public RPCs. The invite table and
-- digest helper remain unreachable directly, even with ordinary table grants.
do $$ begin
  if pg_catalog.has_function_privilege('anon', 'public.issue_drop_claim_invite(text,text,text,text)', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.issue_drop_claim_invite(text,text,text,text)', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.claim_drop_invite(text)', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.claim_drop_invite(text)', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.get_sender_claimed_drop_ids()', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.get_sender_claimed_drop_ids()', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.reissue_drop_claim_invite(text,text)', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.reissue_drop_claim_invite(text,text)', 'execute') then
    raise exception 'Drop invite RPC grants are not limited to authenticated users';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.issue_drop_media_claim_invite(text,text,text,text,text,text,integer,text)', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.issue_drop_media_claim_invite(text,text,text,text,text,text,integer,text)', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.queue_unlinked_drop_media_cleanup_job(text,text,text)', 'execute')
    or not pg_catalog.has_function_privilege('authenticated', 'public.queue_unlinked_drop_media_cleanup_job(text,text,text)', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.lease_expired_drop_media_cleanup_jobs(integer)', 'execute')
    or pg_catalog.has_function_privilege('authenticated', 'public.lease_expired_drop_media_cleanup_jobs(integer)', 'execute')
    or not pg_catalog.has_function_privilege('service_role', 'public.lease_expired_drop_media_cleanup_jobs(integer)', 'execute')
    or pg_catalog.has_function_privilege('anon', 'public.finish_expired_drop_media_cleanup_job(bigint,uuid,boolean,text)', 'execute')
    or pg_catalog.has_function_privilege('authenticated', 'public.finish_expired_drop_media_cleanup_job(bigint,uuid,boolean,text)', 'execute')
    or not pg_catalog.has_function_privilege('service_role', 'public.finish_expired_drop_media_cleanup_job(bigint,uuid,boolean,text)', 'execute') then
    raise exception 'Media invite and cleanup RPC grants are not restricted to their intended roles';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select set_config(
  'test.main_letter',
  public.issue_drop_claim_invite('claim-main', 'A thought for later', 'The private note.', current_setting('test.token_a')),
  true
);

do $$
declare
  v_result text;
begin
  v_result := public.issue_drop_claim_invite(
    'claim-main', 'A thought for later', 'The private note.', current_setting('test.token_a')
  );
  if v_result <> current_setting('test.main_letter') then
    raise exception 'an identical invite retry returned another letter ID';
  end if;

  begin
    perform public.issue_drop_claim_invite(
      'claim-main', 'Changed subject', 'The private note.', current_setting('test.token_b')
    );
    raise exception 'a conflicting letter ID was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.letters (id, sender_id, subject, content, status)
    values ('forged-pending', current_setting('test.sender')::uuid, 'Forged', 'Text', 'claim_pending');
    raise exception 'authenticated clients inserted claim_pending directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
declare
  v_invite private.drop_claim_invites%rowtype;
begin
  select i.* into v_invite
  from private.drop_claim_invites i
  where i.letter_id = current_setting('test.main_letter')
    and i.replaced_at is null;

  if v_invite.token_hash is null then
    raise exception 'invite issuance did not create a private claim capability';
  end if;
  if (select l.status from public.letters l where l.id = current_setting('test.main_letter')) is distinct from 'claim_pending'
    or (select l.recipient_id from public.letters l where l.id = current_setting('test.main_letter')) is not null
    or (select l.delivery_mode from public.letters l where l.id = current_setting('test.main_letter')) is distinct from 'instant'
    or (select l.payload_kind from public.letters l where l.id = current_setting('test.main_letter')) is distinct from 'text' then
    raise exception 'invite issuance did not create a pending instant text letter';
  end if;
  if v_invite.expires_at <= pg_catalog.clock_timestamp()
    or v_invite.expires_at > pg_catalog.clock_timestamp() + interval '7 days 1 minute'
    or pg_catalog.octet_length(v_invite.token_hash) <> 32
    or v_invite.token_hash = pg_catalog.convert_to(current_setting('test.token_a'), 'UTF8')
    or v_invite.token_hash <> private.hash_drop_claim_token(current_setting('test.token_a')) then
    raise exception 'invite did not store a 256-bit token SHA-256 digest with a seven-day expiry';
  end if;
  perform pg_catalog.set_config('test.initial_expiry', v_invite.expires_at::text, true);
end $$;

-- Add private child records as the database owner so the RLS checks prove
-- that none of their contents leak through a pending letter.
insert into public.letter_events (letter_id, event_key, status, note)
values ('claim-main', 'private-event', 'waiting', 'Event content must stay private.');
insert into public.letter_reactions (letter_id, recipient_id, emoji)
values ('claim-main', '22222222-2222-4222-8222-222222222222', '💜');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  if exists (select 1 from public.letters where id = current_setting('test.main_letter'))
    or exists (select 1 from public.letter_events where letter_id = current_setting('test.main_letter'))
    or exists (select 1 from public.letter_reactions where letter_id = current_setting('test.main_letter')) then
    raise exception 'anonymous users read a pending letter or its child content';
  end if;
  begin
    perform * from private.drop_claim_invites;
    raise exception 'anonymous users read private invite digests';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_drop_invite(current_setting('test.token_a'));
    raise exception 'anonymous users executed the claim RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reissue_drop_claim_invite(current_setting('test.main_letter'), current_setting('test.token_b'));
    raise exception 'anonymous users executed the reissue RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_sender_claimed_drop_ids();
    raise exception 'anonymous users executed the claimed status RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  begin
    perform public.claim_drop_invite(current_setting('test.token_a'));
    raise exception 'the sender claimed their own private invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  if exists (select 1 from public.letters where id = current_setting('test.main_letter'))
    or exists (select 1 from public.letter_events where letter_id = current_setting('test.main_letter'))
    or exists (select 1 from public.letter_reactions where letter_id = current_setting('test.main_letter')) then
    raise exception 'an unclaimed recipient read private letter or child content';
  end if;
  begin
    perform * from private.drop_claim_invites;
    raise exception 'authenticated users read private invite digests';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Replacing the token invalidates its predecessor. The same token remains
-- retry-safe without extending the existing expiry.
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select public.issue_drop_claim_invite(
  'claim-main', 'A thought for later', 'The private note.', current_setting('test.token_b')
);
reset role;
do $$
declare
  v_expiry timestamptz;
begin
  select i.expires_at into v_expiry
  from private.drop_claim_invites i
  where i.letter_id = current_setting('test.main_letter')
    and i.replaced_at is null;
  if v_expiry is null
    or v_expiry <= pg_catalog.clock_timestamp()
    or v_expiry > pg_catalog.clock_timestamp() + interval '7 days 1 minute'
    or (select i.token_hash from private.drop_claim_invites i
        where i.letter_id = current_setting('test.main_letter') and i.replaced_at is null)
      <> private.hash_drop_claim_token(current_setting('test.token_b')) then
    raise exception 'a different token did not rotate the active capability';
  end if;
  if (select count(*) from private.drop_claim_invites i
      where i.letter_id = current_setting('test.main_letter')
        and i.replaced_at is not null
        and i.token_hash = private.hash_drop_claim_token(current_setting('test.token_a'))) <> 1 then
    raise exception 'the replaced token digest was not retained as unusable history';
  end if;
  perform pg_catalog.set_config('test.rotated_expiry', v_expiry::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  if public.issue_drop_claim_invite(
    'claim-main', 'A thought for later', 'The private note.', current_setting('test.token_b')
  ) <> current_setting('test.main_letter') then
    raise exception 'a same-token retry returned another letter ID';
  end if;
end $$;
reset role;
do $$ begin
  if (select i.expires_at::text from private.drop_claim_invites i
      where i.letter_id = current_setting('test.main_letter') and i.replaced_at is null)
    <> current_setting('test.rotated_expiry') then
    raise exception 'a same-token retry unexpectedly extended the expiry';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  begin
    perform public.claim_drop_invite(current_setting('test.token_a'));
    raise exception 'a replaced token remained claimable';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config(
  'test.claimed_letter',
  public.claim_drop_invite(current_setting('test.token_b')),
  true
);
reset role;
do $$
begin
  if (select count(*) from realtime.messages where event = 'drop_received') <> 1 then
    raise exception 'an explicit claim did not emit exactly one sender signal';
  end if;
  if exists (
    select 1 from realtime.messages
    where event = 'drop_received'
      and (
        topic <> 'user:11111111-1111-4111-8111-111111111111:drop-inbox'
        or payload <> jsonb_build_object('drop_id', current_setting('test.main_letter'))
        or not is_private
      )
  ) then
    raise exception 'the claim signal was not a private ID-only message to the sender topic';
  end if;
end
$$;

-- A repeated claim is idempotent for its claimant even after the capability
-- expires. Expiry still blocks first-time claims and other-account replays.
update private.drop_claim_invites
set expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where letter_id = current_setting('test.main_letter')
  and token_hash = private.hash_drop_claim_token(current_setting('test.token_b'));

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$
declare
  v_result text;
begin
  v_result := public.claim_drop_invite(current_setting('test.token_b'));
  if v_result <> current_setting('test.claimed_letter') then
    raise exception 'same-account repeated claim after expiry was not idempotent';
  end if;
  if (select count(*) from public.letters where id = current_setting('test.main_letter')
      and recipient_id = current_setting('test.recipient')::uuid
      and status = 'delivered' and delivered_at is not null) <> 1
    or (select count(*) from public.letter_events where letter_id = current_setting('test.main_letter')) <> 1
    or (select count(*) from public.letter_reactions where letter_id = current_setting('test.main_letter')) <> 1 then
    raise exception 'claimed letter or child content was not released to its recipient';
  end if;
  begin
    perform public.issue_drop_claim_invite(
      'claim-main', 'A thought for later', 'The private note.', current_setting('test.token_c')
    );
    raise exception 'a claimed letter accepted a new invite';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reissue_drop_claim_invite('claim-main', current_setting('test.token_c'));
    raise exception 'a claimed letter accepted a reissued invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if (select count(*) from realtime.messages where event = 'drop_received') <> 1 then
    raise exception 'an idempotent same-account claim retry emitted a duplicate signal';
  end if;
end $$;
do $$ begin
  if (select i.expires_at from private.drop_claim_invites i
      where i.letter_id = current_setting('test.main_letter') and i.replaced_at is null)
    >= pg_catalog.clock_timestamp() then
    raise exception 'the post-claim retry fixture did not expire the capability';
  end if;
end $$;

insert into public.letters (
  id, sender_id, recipient_id, subject, content, status, delivery_mode, payload_kind, delivered_at
) values (
  'ordinary-delivered', current_setting('test.sender')::uuid,
  current_setting('test.recipient')::uuid, 'Direct note', 'Sent directly.',
  'delivered', 'instant', 'text', pg_catalog.now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.other'), true);
do $$ begin
  if exists (select 1 from public.letters where id = current_setting('test.main_letter'))
    or exists (select 1 from public.letter_events where letter_id = current_setting('test.main_letter'))
    or exists (select 1 from public.letter_reactions where letter_id = current_setting('test.main_letter')) then
    raise exception 'a different authenticated account read another user’s claimed content';
  end if;
  if exists (select 1 from public.get_sender_claimed_drop_ids()) then
    raise exception 'a different authenticated account read another sender’s claim status';
  end if;
  begin
    perform public.claim_drop_invite(current_setting('test.token_b'));
    raise exception 'a different account replayed a claimed invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A profile-less account cannot claim; an expired token cannot claim; an
-- expired capability can be explicitly rotated by its sender; revoked links
-- stay unusable even if the sender retries with a new token.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select public.issue_drop_claim_invite(
  'claim-expired', 'Later', 'Expires first.', current_setting('test.token_d')
);
select public.issue_drop_claim_invite(
  'claim-unprofiled', 'Later', 'Profile required.', current_setting('test.token_f')
);
select public.issue_drop_claim_invite(
  'claim-revoked', 'Later', 'Revoked capability.', current_setting('test.token_h')
);
select set_config(
  'test.whitespace_letter',
  public.issue_drop_claim_invite(
    'claim-whitespace', '  Original subject  ', '  Leading and trailing text  ', current_setting('test.token_i')
  ),
  true
);
do $$
declare
  v_result text;
begin
  v_result := public.reissue_drop_claim_invite(
    current_setting('test.whitespace_letter'), current_setting('test.token_j')
  );
  if v_result <> current_setting('test.whitespace_letter') then
    raise exception 'reissue RPC did not return its letter ID as text';
  end if;
end $$;
reset role;

do $$ begin
  if current_setting('test.whitespace_letter') <> 'claim-whitespace'
    or (select l.subject from public.letters l where l.id = current_setting('test.whitespace_letter'))
      is distinct from '  Original subject  '
    or (select l.content from public.letters l where l.id = current_setting('test.whitespace_letter'))
      is distinct from '  Leading and trailing text  '
    or (select i.token_hash from private.drop_claim_invites i
        where i.letter_id = current_setting('test.whitespace_letter') and i.replaced_at is null)
      is distinct from private.hash_drop_claim_token(current_setting('test.token_j'))
    or (select count(*) from private.drop_claim_invites i
        where i.letter_id = current_setting('test.whitespace_letter')
          and i.replaced_at is not null
          and i.token_hash = private.hash_drop_claim_token(current_setting('test.token_i'))) <> 1 then
    raise exception 'reissue did not preserve exact stored whitespace or rotate the capability';
  end if;
end $$;

update private.drop_claim_invites
set expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where letter_id = 'claim-expired';
update private.drop_claim_invites
set revoked_at = pg_catalog.clock_timestamp()
where letter_id = 'claim-revoked';

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.unprofiled'), true);
do $$ begin
  begin
    perform public.claim_drop_invite(current_setting('test.token_f'));
    raise exception 'an account without a Drop profile claimed an invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  begin
    perform public.claim_drop_invite(current_setting('test.token_d'));
    raise exception 'an expired invite was claimed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_drop_invite(current_setting('test.token_h'));
    raise exception 'a revoked invite was claimed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select public.reissue_drop_claim_invite(
  'claim-expired', current_setting('test.token_e')
);
reset role;
do $$
declare
  v_expiry timestamptz;
begin
  select i.expires_at into v_expiry
  from private.drop_claim_invites i
  where i.letter_id = 'claim-expired' and i.replaced_at is null;
  if v_expiry is null
    or v_expiry <= pg_catalog.clock_timestamp()
    or v_expiry > pg_catalog.clock_timestamp() + interval '7 days 1 minute'
    or (select i.token_hash from private.drop_claim_invites i
        where i.letter_id = 'claim-expired' and i.replaced_at is null)
      <> private.hash_drop_claim_token(current_setting('test.token_e')) then
    raise exception 'sender could not rotate an expired invite to a fresh capability';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  begin
    perform public.issue_drop_claim_invite(
      'claim-revoked', 'Later', 'Revoked capability.', current_setting('test.token_g')
    );
    raise exception 'sender replaced a revoked invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  if not exists (
    select 1 from public.get_sender_claimed_drop_ids()
    where letter_id = current_setting('test.main_letter')
  ) then
    raise exception 'sender could not restore the completed claim after token expiry';
  end if;
  if exists (
    select 1 from public.get_sender_claimed_drop_ids()
    where letter_id in ('ordinary-delivered', 'claim-expired', 'claim-revoked')
  ) or (select count(*) from public.get_sender_claimed_drop_ids()) <> 1 then
    raise exception 'claimed status included an ordinary send, pending/revoked invite, or unrelated row';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
select public.claim_drop_invite(current_setting('test.token_e'));
reset role;

-- Pre-existing non-invite IDs, malformed capabilities, and IDs owned by
-- another sender all fail closed.
insert into public.letters (id, sender_id, subject, content, status, delivery_mode, payload_kind)
values ('preexisting-pending', '11111111-1111-4111-8111-111111111111', 'Existing', 'Text', 'claim_pending', 'instant', 'text');
insert into public.letters (id, sender_id, recipient_id, subject, content, status, delivery_mode, payload_kind)
values ('other-sender-letter', '33333333-3333-4333-8333-333333333333', null, 'Other', 'Text', 'claim_pending', 'instant', 'text');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  begin
    perform public.issue_drop_claim_invite(
      'preexisting-pending', 'Existing', 'Text', current_setting('test.token_c')
    );
    raise exception 'an unissued pending row was adopted as an invite';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.issue_drop_claim_invite(
      'other-sender-letter', 'Other', 'Text', current_setting('test.token_c')
    );
    raise exception 'a sender issued another account’s letter ID';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.issue_drop_claim_invite(
      'reused-replaced-token', 'Later', 'Should not bind an old link elsewhere.', current_setting('test.token_a')
    );
    raise exception 'a replaced token was rebound to another letter';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.letters where id = 'reused-replaced-token') then
    raise exception 'a rejected token reuse left a letter without a capability';
  end if;
  begin
    perform public.issue_drop_claim_invite('bad-token', 'Subject', 'Text', 'not-a-256-bit-hex-token');
    raise exception 'a malformed capability was issued';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- Media claim invites bind only finalized, sender-owned Storage objects. The
-- private bucket stays unreadable to the invited account until explicit claim.
insert into storage.objects (bucket_id, name, metadata) values
  ('drop-media', '11111111-1111-4111-8111-111111111111/claim-media-image/550e8400-e29b-41d4-a716-446655440000', '{"mimetype":"image/png","size":"123"}'::jsonb),
  ('drop-media', '11111111-1111-4111-8111-111111111111/claim-media-gif/550e8400-e29b-41d4-a716-446655440001', '{"mimetype":"image/gif","size":"456"}'::jsonb),
  ('drop-media', '11111111-1111-4111-8111-111111111111/claim-media-expired/550e8400-e29b-41d4-a716-446655440002', '{"mimetype":"image/webp","size":"789"}'::jsonb),
  ('drop-media', '11111111-1111-4111-8111-111111111111/claim-media-bad-kind/550e8400-e29b-41d4-a716-446655440003', '{"mimetype":"image/png","size":"123"}'::jsonb),
  ('drop-media', '11111111-1111-4111-8111-111111111111/relay-media-control/550e8400-e29b-41d4-a716-446655440004', '{"mimetype":"image/png","size":"123"}'::jsonb),
  ('drop-media', '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005', '{"mimetype":"image/png","size":"123"}'::jsonb),
  ('drop-media', '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006', '{"mimetype":"image/png","size":"321"}'::jsonb);

-- Media issuance is disabled until the cron job and required secrets exist.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  begin
    perform public.issue_drop_media_claim_invite(
      'scheduler-not-ready', 'Photo', '', 'image',
      '11111111-1111-4111-8111-111111111111/scheduler-not-ready/550e8400-e29b-41d4-a716-446655440005',
      'image/png', 123, current_setting('test.token_q')
    );
    raise exception 'media issuance succeeded before cleanup was scheduled';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;
insert into vault.decrypted_secrets (name, decrypted_secret) values
  ('drop_media_cleanup_project_url', 'https://local-project.supabase.co'),
  ('drop_media_cleanup_anon_key', 'local-public-key'),
  ('drop_media_cleanup_secret', 'local-test-cleanup-secret-that-is-at-least-32-bytes');
select private.schedule_drop_media_cleanup();
do $$ begin
  if not exists (select 1 from cron.job
      where jobname = 'drop-expired-drop-media-hourly'
        and active and schedule = '17 * * * *'
        and command like '%cleanup-expired-drop-media%') then
    raise exception 'media test fixture did not install the expected hourly cleanup job';
  end if;
end $$;

-- A finalized object without a letter can be queued after an ambiguous RPC
-- response. The queue's path tombstone blocks ordinary sync inserts, while a
-- same-path claim issue can recover it only before a worker lease is active.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  if public.queue_unlinked_drop_media_cleanup_job(
      'claim-media-orphan', 'image',
      '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005'
    ) <> 'queued' then
    raise exception 'a valid unlinked object was not queued';
  end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from private.drop_media_cleanup_jobs j
      where j.letter_id = 'claim-media-orphan'
        and j.media_path = '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005'
        and j.completed_at is null and j.lease_token is null
        and j.available_at > pg_catalog.clock_timestamp()) then
    raise exception 'orphan cleanup job did not retain a delayed path tombstone';
  end if;
  begin
    insert into public.letters (
      id, sender_id, subject, content, status, payload_kind, media_path, media_mime_type, media_size_bytes
    ) values (
      'claim-media-orphan', current_setting('test.sender')::uuid,
      'Blocked duplicate link', '', 'delivered', 'image',
      '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005',
      'image/png', 123
    );
    raise exception 'an ordinary sync write linked an object with a cleanup tombstone';
  exception when unique_violation then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select public.issue_drop_media_claim_invite(
  'claim-media-orphan', 'Recovered photo', '', 'image',
  '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005',
  'image/png', 123, current_setting('test.token_q')
);
do $$ begin
  if public.queue_unlinked_drop_media_cleanup_job(
      'claim-media-orphan', 'image',
      '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005'
    ) <> 'linked' then
    raise exception 'cleanup queue did not recognize a committed letter path';
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from private.drop_media_cleanup_jobs j
      where j.media_path = '11111111-1111-4111-8111-111111111111/claim-media-orphan/550e8400-e29b-41d4-a716-446655440005') then
    raise exception 'same-path issue retry did not cancel a pending orphan tombstone';
  end if;
end $$;

-- A leased cleanup path cannot be reused. A completed job remains a tombstone
-- until a fresh matching object is re-finalized and issue atomically recovers it.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  if public.queue_unlinked_drop_media_cleanup_job(
      'claim-media-cleaning', 'image',
      '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006'
    ) <> 'queued' then
    raise exception 'the second valid orphan was not queued';
  end if;
end $$;
reset role;
update private.drop_media_cleanup_jobs
set available_at = pg_catalog.clock_timestamp()
where media_path = '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006';
set local role service_role;
select set_config('test.cleaning_job_id', lease.job_id::text, true),
  set_config('test.cleaning_lease_token', lease.lease_token::text, true)
from public.lease_expired_drop_media_cleanup_jobs(25) lease
where lease.letter_id = 'claim-media-cleaning';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  begin
    perform public.issue_drop_media_claim_invite(
      'claim-media-cleaning', 'Must stay tombstoned', '', 'image',
      '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006',
      'image/png', 321, current_setting('test.token_p')
    );
    raise exception 'issue reused a path after cleanup leased it';
  exception when insufficient_privilege then null;
  end;
  if public.queue_unlinked_drop_media_cleanup_job(
      'claim-media-cleaning', 'image',
      '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006'
    ) <> 'cleaning' then
    raise exception 'a leased orphan path did not report the cleanup-in-progress state';
  end if;
end $$;
reset role;
set local role service_role;
select public.finish_expired_drop_media_cleanup_job(
  current_setting('test.cleaning_job_id')::bigint,
  current_setting('test.cleaning_lease_token')::uuid,
  true,
  null
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select public.issue_drop_media_claim_invite(
  'claim-media-cleaning', 'Recovered completed cleanup', '', 'image',
  '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006',
  'image/png', 321, current_setting('test.token_p')
);
reset role;
do $$ begin
  if exists (select 1 from private.drop_media_cleanup_jobs j
      where j.media_path = '11111111-1111-4111-8111-111111111111/claim-media-cleaning/550e8400-e29b-41d4-a716-446655440006')
    or not exists (select 1 from public.letters l where l.id = 'claim-media-cleaning' and l.media_path is not null) then
    raise exception 'a re-finalized object could not recover a completed cleanup tombstone';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select set_config(
  'test.media_image_letter',
  public.issue_drop_media_claim_invite(
    'claim-media-image', 'Photo for you', 'A sealed photo.', 'image',
    '11111111-1111-4111-8111-111111111111/claim-media-image/550e8400-e29b-41d4-a716-446655440000',
    'image/png', 123, current_setting('test.token_k')
  ),
  true
);
reset role;
do $$
declare
  v_expiry timestamptz;
  v_cap timestamptz;
begin
  select i.expires_at into v_expiry
  from private.drop_claim_invites i
  where i.letter_id = current_setting('test.media_image_letter') and i.replaced_at is null;
  select l.media_claim_expires_at into v_cap
  from public.letters l where l.id = current_setting('test.media_image_letter');
  if v_expiry is null or v_expiry <= pg_catalog.clock_timestamp()
    or v_expiry > pg_catalog.clock_timestamp() + interval '7 days 1 minute'
    or v_cap <= pg_catalog.clock_timestamp() + interval '29 days 23 hours'
    or v_cap > pg_catalog.clock_timestamp() + interval '30 days 1 minute'
    or v_expiry > v_cap then
    raise exception 'media invite did not receive a seven-day link expiry capped by an immutable 30-day deadline';
  end if;
  perform pg_catalog.set_config('test.media_initial_expiry', v_expiry::text, true);
  perform pg_catalog.set_config('test.media_initial_cap', v_cap::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  begin
    perform public.issue_drop_media_claim_invite(
      'claim-media-bad-kind', 'Bad kind', '', 'gif',
      '11111111-1111-4111-8111-111111111111/claim-media-bad-kind/550e8400-e29b-41d4-a716-446655440003',
      'image/gif', 123, current_setting('test.token_m')
    );
    raise exception 'a GIF invite accepted PNG object metadata';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.issue_drop_media_claim_invite(
      'claim-media-bad-kind', 'Bad owner', '', 'image',
      '33333333-3333-4333-8333-333333333333/claim-media-bad-kind/550e8400-e29b-41d4-a716-446655440003',
      'image/png', 123, current_setting('test.token_m')
    );
    raise exception 'a sender issued media owned by another account';
  exception when invalid_parameter_value or insufficient_privilege then null;
  end;
  begin
    perform public.issue_drop_media_claim_invite(
      'claim-media-bad-kind', 'Bad path', '', 'image',
      '11111111-1111-4111-8111-111111111111/another-letter/550e8400-e29b-41d4-a716-446655440003',
      'image/png', 123, current_setting('test.token_m')
    );
    raise exception 'a finalized media path for a different letter was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- A same-token retry is idempotent and does not extend either expiry. A new
-- token replaces the previous link but remains capped by the original date.
select public.issue_drop_media_claim_invite(
  'claim-media-image', 'Photo for you', 'A sealed photo.', 'image',
  '11111111-1111-4111-8111-111111111111/claim-media-image/550e8400-e29b-41d4-a716-446655440000',
  'image/png', 123, current_setting('test.token_k')
);
reset role;
do $$ begin
  if (select i.expires_at::text from private.drop_claim_invites i
      where i.letter_id = current_setting('test.media_image_letter') and i.replaced_at is null)
      <> current_setting('test.media_initial_expiry')
    or (select l.media_claim_expires_at::text from public.letters l
        where l.id = current_setting('test.media_image_letter')) <> current_setting('test.media_initial_cap') then
    raise exception 'a same-token media retry extended an invite or the hard retention cap';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select public.reissue_drop_claim_invite(current_setting('test.media_image_letter'), current_setting('test.token_l'));
reset role;
do $$ begin
  if (select i.token_hash from private.drop_claim_invites i
      where i.letter_id = current_setting('test.media_image_letter') and i.replaced_at is null)
      <> private.hash_drop_claim_token(current_setting('test.token_l'))
    or (select i.expires_at from private.drop_claim_invites i
        where i.letter_id = current_setting('test.media_image_letter') and i.replaced_at is null)
      > (current_setting('test.media_initial_cap'))::timestamptz
    or exists (select 1 from private.drop_claim_invites i
        where i.letter_id = current_setting('test.media_image_letter')
          and i.token_hash = private.hash_drop_claim_token(current_setting('test.token_k'))
          and i.replaced_at is null) then
    raise exception 'media reissue did not rotate the token within the original hard cap';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  if exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/claim-media-image/550e8400-e29b-41d4-a716-446655440000') then
    raise exception 'the invited account read media before claiming it';
  end if;
  begin
    perform public.claim_drop_invite(current_setting('test.token_k'));
    raise exception 'the replaced media invite token remained claimable';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.claim_drop_invite(current_setting('test.token_l'));
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  if not exists (
    select 1 from public.get_sender_claimed_drop_ids()
    where letter_id = current_setting('test.media_image_letter')
  ) then raise exception 'sender claim status omitted an explicitly claimed photo'; end if;
  begin
    perform public.reissue_drop_claim_invite(current_setting('test.media_image_letter'), current_setting('test.token_m'));
    raise exception 'a claimed photo accepted a fresh invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  if not exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/claim-media-image/550e8400-e29b-41d4-a716-446655440000') then
    raise exception 'the claimant could not read the photo after explicit claim';
  end if;
  if public.claim_drop_invite(current_setting('test.token_l')) <> current_setting('test.media_image_letter') then
    raise exception 'same-account media claim retry was not idempotent';
  end if;
end $$;
reset role;

-- GIFs use the matching image/gif object metadata and keep the same 30-day cap.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select set_config(
  'test.media_gif_letter',
  public.issue_drop_media_claim_invite(
    'claim-media-gif', 'GIF for you', '', 'gif',
    '11111111-1111-4111-8111-111111111111/claim-media-gif/550e8400-e29b-41d4-a716-446655440001',
    'image/gif', 456, current_setting('test.token_m')
  ),
  true
);
reset role;
do $$ begin
  if (select l.media_claim_expires_at from public.letters l where l.id = current_setting('test.media_gif_letter'))
      <= pg_catalog.clock_timestamp()
    or (select l.payload_kind from public.letters l where l.id = current_setting('test.media_gif_letter')) <> 'gif' then
    raise exception 'a valid GIF claim invite was not created';
  end if;
end $$;

-- Force the expiry forward in this rollback-only fixture. The worker leases
-- after 30 days, revokes the current token atomically, and its finish RPC only
-- removes the still-unclaimed row after the Storage API reports success.
insert into public.letters (
  id, sender_id, recipient_id, subject, content, status, delivery_mode, payload_kind,
  media_path, media_mime_type, media_size_bytes, dispatched_at
) values (
  'relay-media-control', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  'Relay photo', 'Sealed', 'dispatched', 'relay', 'image',
  '11111111-1111-4111-8111-111111111111/relay-media-control/550e8400-e29b-41d4-a716-446655440004',
  'image/png', 123, pg_catalog.now()
);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  if exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/relay-media-control/550e8400-e29b-41d4-a716-446655440004') then
    raise exception 'relay media became readable before recipient collection';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
select set_config(
  'test.expired_media_letter',
  public.issue_drop_media_claim_invite(
    'claim-media-expired', 'Expired photo', '', 'image',
    '11111111-1111-4111-8111-111111111111/claim-media-expired/550e8400-e29b-41d4-a716-446655440002',
    'image/webp', 789, current_setting('test.token_n')
  ),
  true
);
reset role;
alter table public.letters disable trigger letters_keep_drop_media_claim_expiry_immutable;
update public.letters set media_claim_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = current_setting('test.expired_media_letter');
alter table public.letters enable trigger letters_keep_drop_media_claim_expiry_immutable;
update private.drop_claim_invites set expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where letter_id = current_setting('test.expired_media_letter') and replaced_at is null;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.sender'), true);
do $$ begin
  if exists (select 1 from storage.objects where name = '11111111-1111-4111-8111-111111111111/claim-media-expired/550e8400-e29b-41d4-a716-446655440002') then
    raise exception 'sender read an expired, unclaimed media object';
  end if;
  begin
    perform public.reissue_drop_claim_invite(current_setting('test.expired_media_letter'), current_setting('test.token_o'));
    raise exception 'an expired media invite was reissued past its hard cap';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.recipient'), true);
do $$ begin
  begin
    perform public.claim_drop_invite(current_setting('test.token_n'));
    raise exception 'an expired media invite was claimed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role service_role;
select set_config(
  'test.cleanup_job_id', lease.job_id::text, true
), set_config(
  'test.cleanup_lease_token', lease.lease_token::text, true
)
from public.lease_expired_drop_media_cleanup_jobs(25) lease
where lease.letter_id = current_setting('test.expired_media_letter');
reset role;
do $$ begin
  if current_setting('test.cleanup_job_id', true) is null
    or not exists (select 1 from private.drop_claim_invites i
      where i.letter_id = current_setting('test.expired_media_letter') and i.revoked_at is not null) then
    raise exception 'cleanup did not atomically lease the expired path and revoke its capability';
  end if;
end $$;
set local role service_role;
do $$ begin
  begin
    perform public.finish_expired_drop_media_cleanup_job(
      current_setting('test.cleanup_job_id')::bigint,
      current_setting('test.cleanup_lease_token')::uuid,
      false,
      null
    );
    raise exception 'cleanup accepted a failed removal without an error code';
  exception when invalid_parameter_value then null;
  end;
end $$;
select public.finish_expired_drop_media_cleanup_job(
  current_setting('test.cleanup_job_id')::bigint,
  current_setting('test.cleanup_lease_token')::uuid,
  false,
  'storage_remove_failed'
);
reset role;
do $$ begin
  if not exists (select 1 from private.drop_media_cleanup_jobs j
      where j.id = current_setting('test.cleanup_job_id')::bigint
        and j.lease_token is null and j.lease_until is null
        and j.last_error_code = 'storage_remove_failed'
        and j.available_at > pg_catalog.clock_timestamp()
        and j.available_at <= pg_catalog.clock_timestamp() + interval '1 hour 1 minute') then
    raise exception 'Storage API failure did not schedule a retry and release the lease';
  end if;
end $$;
update private.drop_media_cleanup_jobs
set available_at = pg_catalog.clock_timestamp()
where id = current_setting('test.cleanup_job_id')::bigint;
set local role service_role;
select set_config(
  'test.cleanup_lease_token', lease.lease_token::text, true
)
from public.lease_expired_drop_media_cleanup_jobs(25) lease
where lease.job_id = current_setting('test.cleanup_job_id')::bigint;
do $$ begin
  if current_setting('test.cleanup_lease_token', true) is null then
    raise exception 'a previously failed Storage cleanup job was not leased again';
  end if;
end $$;
select public.finish_expired_drop_media_cleanup_job(
  current_setting('test.cleanup_job_id')::bigint,
  current_setting('test.cleanup_lease_token')::uuid,
  true,
  null
);
-- Model a successful Storage remove whose finish response was lost. Replaying
-- the same lease token must not revive or mutate the completed job.
do $$ begin
  if public.finish_expired_drop_media_cleanup_job(
      current_setting('test.cleanup_job_id')::bigint,
      current_setting('test.cleanup_lease_token')::uuid,
      true,
      null
    ) then
    raise exception 'an ambiguous finish retry reported the completed cleanup as unfinished';
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.letters where id = current_setting('test.expired_media_letter'))
    or not exists (select 1 from private.drop_media_cleanup_jobs j
      where j.id = current_setting('test.cleanup_job_id')::bigint and j.completed_at is not null) then
    raise exception 'successful cleanup did not delete the expired unclaimed letter and finish its job';
  end if;
end $$;

-- A successful Storage deletion report must never delete a row that is already
-- claimed, even if a stale/duplicated cleanup job is presented.
alter table public.letters disable trigger letters_keep_drop_media_claim_expiry_immutable;
update public.letters set media_claim_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = current_setting('test.media_image_letter');
alter table public.letters enable trigger letters_keep_drop_media_claim_expiry_immutable;
set local role service_role;
do $$ begin
  if exists (
    select 1 from public.lease_expired_drop_media_cleanup_jobs(25) lease
    where lease.letter_id = current_setting('test.media_image_letter')
  ) then
    raise exception 'cleanup leased an already-claimed photo after its deadline';
  end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.letters where id = current_setting('test.media_image_letter')
      and recipient_id = current_setting('test.recipient')::uuid and status = 'delivered') then
    raise exception 'claim did not win over an expired media cleanup candidate';
  end if;
end $$;
insert into private.drop_media_cleanup_jobs (
  letter_id, sender_id, media_path, lease_token, lease_until, attempts
) values (
  current_setting('test.media_image_letter'), current_setting('test.sender')::uuid,
  '11111111-1111-4111-8111-111111111111/claim-media-image/550e8400-e29b-41d4-a716-446655440000',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_catalog.clock_timestamp() + interval '5 minutes', 1
);
select set_config('test.claimed_cleanup_job_id', currval(pg_catalog.pg_get_serial_sequence('private.drop_media_cleanup_jobs', 'id'))::text, true);
set local role service_role;
select public.finish_expired_drop_media_cleanup_job(
  current_setting('test.claimed_cleanup_job_id')::bigint,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true,
  null
);
reset role;
do $$ begin
  if not exists (select 1 from public.letters where id = current_setting('test.media_image_letter') and recipient_id = current_setting('test.recipient')::uuid)
    or not exists (select 1 from private.drop_media_cleanup_jobs j where j.id = current_setting('test.claimed_cleanup_job_id')::bigint and j.completed_at is not null) then
    raise exception 'cleanup removed an already-claimed media letter';
  end if;
end $$;

-- Relay collection still announces to both participants once. Ordinary
-- delivered-row updates and claim retries must not add duplicate signals.
insert into public.letters (
  id, sender_id, recipient_id, subject, content, status, delivery_mode,
  payload_kind, dispatched_at, delivered_at
) values (
  'relay-broadcast-control',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Relay control', 'Sealed', 'dispatched', 'relay', 'text', pg_catalog.now(), null
);
update public.letters
set status = 'delivered', delivered_at = pg_catalog.now()
where id = 'relay-broadcast-control';
update public.letters
set updated_at = pg_catalog.now()
where id = 'relay-broadcast-control';
do $$
begin
  if (select count(*) from realtime.messages where payload->>'drop_id' = 'relay-broadcast-control') <> 3
    or (select count(*) from realtime.messages where payload->>'drop_id' = 'relay-broadcast-control'
        and topic = 'user:22222222-2222-4222-8222-222222222222:drop-inbox') <> 2
    or (select count(*) from realtime.messages where payload->>'drop_id' = 'relay-broadcast-control'
        and topic = 'user:11111111-1111-4111-8111-111111111111:drop-inbox') <> 1
    or exists (
      select 1 from realtime.messages
      where payload->>'drop_id' = 'relay-broadcast-control'
        and (payload <> jsonb_build_object('drop_id', 'relay-broadcast-control') or not is_private)
    ) then
    raise exception 'relay collection no longer emits one recipient and one sender signal, or emitted duplicate data';
  end if;
  if (select count(*) from realtime.messages where event = 'drop_received'
      and payload->>'drop_id' = current_setting('test.main_letter')) <> 1 then
    raise exception 'a later row update repeated the completed claim signal';
  end if;
end
$$;

rollback;
