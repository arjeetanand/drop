\set ON_ERROR_STOP on

begin;

create role anon;
create role authenticated;
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
