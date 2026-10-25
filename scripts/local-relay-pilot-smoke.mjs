import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  assertLocalSupabasePortsAreSafe,
  loadExpectedLocalSupabaseProjectId,
  loadLocalSupabaseValues,
  validateLocalSupabaseUrl,
} from './localSupabaseEndpointGuard.mjs';

const root = process.cwd();
const supabaseValues = await loadLocalSupabaseValues({ envFilePath: resolve(root, '.env.local') });
const localUrl = validateLocalSupabaseUrl(supabaseValues.NEXT_PUBLIC_SUPABASE_URL);
const projectId = await loadExpectedLocalSupabaseProjectId({
  configFilePath: resolve(root, 'supabase/config.toml'),
});
await assertLocalSupabasePortsAreSafe({ ports: [Number(localUrl.port)], expectedProjectId: projectId });

const supabaseUrl = localUrl.origin;
const anonKey = supabaseValues.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(supabaseUrl, supabaseValues.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const createdUserIds = [];
let dropId = null;

function client() {
  return createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function rpcRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function createAccount(label) {
  const email = `drop-relay-pilot-${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(createError);
  assert.ok(created.user?.id, `Auth should create the ${label} disposable account`);
  createdUserIds.push(created.user.id);

  const accountClient = client();
  const { data: session, error: signInError } = await accountClient.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);
  assert.equal(session.user?.id, created.user.id, `The ${label} account should sign in as its own user`);
  return { client: accountClient, id: created.user.id };
}

function assertDenied(result, message) {
  assert.equal(result.error?.code, '42501', `${message}: the operation should be denied`);
  assert.equal(result.data, null, `${message}: a denied operation must not return data`);
}

try {
  const sender = await createAccount('sender');
  const recipient = await createAccount('recipient');
  const carrierAccount = await createAccount('carrier');
  const outsider = await createAccount('outsider');
  const accounts = [
    { account: sender, usernamePrefix: 'relay_sender', displayName: 'Relay Smoke Sender' },
    { account: recipient, usernamePrefix: 'relay_recipient', displayName: 'Relay Smoke Recipient' },
    { account: carrierAccount, usernamePrefix: 'relay_carrier', displayName: 'Relay Smoke Carrier' },
    { account: outsider, usernamePrefix: 'relay_outsider', displayName: 'Relay Smoke Outsider' },
  ];
  const usernames = new Map();
  for (const { account, usernamePrefix, displayName } of accounts) {
    const username = `${usernamePrefix}_${account.id.slice(0, 8)}`;
    const { error } = await account.client.from('profiles').insert({
      id: account.id,
      username,
      display_name: displayName,
      bio: '',
    });
    assert.ifError(error);
    usernames.set(account.id, username);
  }

  dropId = `relay-pilot-${randomUUID()}`;
  const sentAt = new Date().toISOString();
  const privateContent = `Relay pilot private text ${randomUUID()}`;
  const { error: sendError } = await sender.client.from('letters').insert({
    id: dropId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    sender_display_name: 'Relay Smoke Sender',
    recipient_username: usernames.get(recipient.id),
    recipient_name: 'Relay Smoke Recipient',
    subject: 'Local relay pilot smoke',
    content: privateContent,
    teaser: [privateContent],
    status: 'dispatched',
    seal_id: 'relay-pilot-seal',
    dispatched_at: sentAt,
    payload_kind: 'text',
    delivery_mode: 'relay',
  });
  assert.ifError(sendError);
  const { error: privateEventError } = await admin.from('letter_events').insert({
    letter_id: dropId,
    event_key: 'relay-pilot-private-event',
    status: 'hidden',
    note: 'Sender-only relay event.',
  });
  assert.ifError(privateEventError);

  const { data: issuedRows, error: issueError } = await sender.client.rpc('issue_relay_handoff_token', {
    p_letter_id: dropId,
  });
  assert.ifError(issueError);
  const issuedPass = rpcRow(issuedRows);
  assert.ok(issuedPass?.token && Number.isFinite(Date.parse(issuedPass.expires_at)));
  assert.ok(Date.parse(issuedPass.expires_at) > Date.now(), 'The sender pass should still be usable');
  assert.ok(Date.parse(issuedPass.expires_at) <= Date.now() + 11 * 60 * 1000, 'The sender pass should remain short-lived');

  const anonymousCarrier = client();
  const requestId = randomUUID();
  const handoffInput = {
    p_token: issuedPass.token,
    p_request_id: requestId,
    p_carrier_name: 'Pilot Carrier',
    p_neighborhood: 'Bandra West',
    p_note: 'Passed the sealed drop along.',
  };
  const { data: acceptedRows, error: acceptError } = await anonymousCarrier.rpc('accept_relay_handoff_token', handoffInput);
  assert.ifError(acceptError);
  const accepted = rpcRow(acceptedRows);
  assert.equal(accepted?.letter_id, dropId);
  assert.ok(accepted?.handoff_id && accepted?.successor_token);
  assert.ok(Number.isFinite(Date.parse(accepted.successor_expires_at)));
  assert.deepEqual(Object.keys(accepted).sort(), [
    'handoff_id', 'letter_id', 'successor_expires_at', 'successor_token',
  ].sort(), 'The carrier acceptance result should expose only its next capability and handoff identity');

  const { data: retryRows, error: retryError } = await anonymousCarrier.rpc('accept_relay_handoff_token', handoffInput);
  assert.ifError(retryError);
  const retriedAcceptance = rpcRow(retryRows);
  assert.ok(
    retriedAcceptance?.handoff_id === accepted.handoff_id
      && retriedAcceptance.letter_id === accepted.letter_id
      && retriedAcceptance.successor_token === accepted.successor_token
      && retriedAcceptance.successor_expires_at === accepted.successor_expires_at,
    'The same request ID and payload should recover the original handoff without creating another capability',
  );
  const { data: changedRetry, error: changedRetryError } = await anonymousCarrier.rpc('accept_relay_handoff_token', {
    ...handoffInput,
    p_note: 'Changed request payload.',
  });
  assertDenied({ data: changedRetry, error: changedRetryError }, 'A consumed pass must reject a changed replay');
  const { data: replayedWithNewId, error: replayedWithNewIdError } = await anonymousCarrier.rpc('accept_relay_handoff_token', {
    ...handoffInput,
    p_request_id: randomUUID(),
  });
  assertDenied({ data: replayedWithNewId, error: replayedWithNewIdError }, 'A consumed pass must reject a second request ID');

  const { data: carrierRoute, error: carrierRouteError } = await anonymousCarrier.rpc('get_carrier_relay_route', {
    p_carrier_token: accepted.successor_token,
  });
  assert.ifError(carrierRouteError);
  assert.equal(carrierRoute?.length, 1);
  assert.deepEqual(Object.keys(carrierRoute[0]).sort(), [
    'carrier_name', 'carrier_note', 'created_at', 'handoff_id', 'neighborhood',
  ].sort(), 'The active carrier route should omit drop content, media, and coordinates');
  assert.equal(carrierRoute[0].carrier_name, 'Pilot Carrier');
  assert.equal(carrierRoute[0].neighborhood, 'Bandra West');
  assert.equal(carrierRoute[0].carrier_note, 'Passed the sealed drop along.');

  const { data: handoffs, error: handoffsError } = await sender.client.from('relay_handoffs')
    .select('id, carrier_name')
    .eq('letter_id', dropId);
  assert.ifError(handoffsError);
  assert.equal(handoffs?.length, 1, 'An identical retry must not create another handoff');

  const { data: recipientRoute, error: recipientRouteError } = await recipient.client.rpc('get_recipient_relay_drops');
  assert.ifError(recipientRouteError);
  assert.equal(recipientRoute?.length, 1, 'The recipient should see one in-transit relay');
  const summary = recipientRoute[0];
  assert.deepEqual(Object.keys(summary).sort(), [
    'created_at', 'dispatched_at', 'handoff_count', 'id', 'latest_carrier',
    'latest_handoff_at', 'latest_neighborhood', 'latest_note', 'sender_display_name',
  ].sort(), 'The recipient route card should omit the subject and private body');
  assert.equal(summary.id, dropId);
  assert.equal(summary.handoff_count, 1);
  assert.equal(summary.latest_carrier, 'Pilot Carrier');
  assert.equal(summary.latest_neighborhood, 'Bandra West');
  assert.equal(summary.latest_note, 'Passed the sealed drop along.');

  const { data: lockedDrop, error: lockedDropError } = await recipient.client.from('letters')
    .select('id, subject, content, status')
    .eq('id', dropId)
    .maybeSingle();
  assert.ifError(lockedDropError);
  assert.equal(lockedDrop, null, 'The recipient should not read a dispatched relay before collection');

  const { data: recipientHandoffs, error: recipientHandoffsError } = await recipient.client.from('relay_handoffs')
    .select('note, handoff_lat, handoff_lng, accepted_lat, accepted_lng')
    .eq('letter_id', dropId);
  assert.ifError(recipientHandoffsError);
  assert.deepEqual(recipientHandoffs, [], 'The recipient should receive the safe route summary, not raw handoff rows');
  const { data: recipientEvents, error: recipientEventsError } = await recipient.client.from('letter_events')
    .select('note')
    .eq('letter_id', dropId);
  assert.ifError(recipientEventsError);
  assert.deepEqual(recipientEvents, [], 'The recipient should not read the sender event before collection');

  const { data: senderRoute, error: senderRouteError } = await sender.client.rpc('get_recipient_relay_drops');
  assert.ifError(senderRouteError);
  assert.deepEqual(senderRoute, [], 'The recipient route summary should be scoped to the recipient');
  const { data: outsiderRoute, error: outsiderRouteError } = await outsider.client.rpc('get_recipient_relay_drops');
  assert.ifError(outsiderRouteError);
  assert.deepEqual(outsiderRoute, [], 'An unrelated account should not see the recipient route summary');
  const { data: carrierLetter, error: carrierLetterError } = await carrierAccount.client.from('letters')
    .select('id, content')
    .eq('id', dropId);
  assert.ifError(carrierLetterError);
  assert.deepEqual(carrierLetter, [], 'The carrier capability must not grant access to the drop body');

  const { data: carrierCollection, error: carrierCollectionError } = await carrierAccount.client.rpc('collect_relay_drop', {
    p_letter_id: dropId,
  });
  assertDenied({ data: carrierCollection, error: carrierCollectionError }, 'A carrier account must not collect for the recipient');
  const { data: senderCollection, error: senderCollectionError } = await sender.client.rpc('collect_relay_drop', {
    p_letter_id: dropId,
  });
  assertDenied({ data: senderCollection, error: senderCollectionError }, 'The sender must not collect their own relay');
  const { data: outsiderCollection, error: outsiderCollectionError } = await outsider.client.rpc('collect_relay_drop', {
    p_letter_id: dropId,
  });
  assertDenied({ data: outsiderCollection, error: outsiderCollectionError }, 'An unrelated account must not collect the relay');

  const { data: collectedRows, error: collectError } = await recipient.client.rpc('collect_relay_drop', {
    p_letter_id: dropId,
  });
  assert.ifError(collectError);
  const collection = rpcRow(collectedRows);
  assert.equal(collection?.drop_id, dropId);
  assert.ok(Number.isFinite(Date.parse(collection?.delivered_at)));
  assert.deepEqual(Object.keys(collection).sort(), ['delivered_at', 'drop_id']);
  const { data: repeatedCollectionRows, error: repeatedCollectError } = await recipient.client.rpc('collect_relay_drop', {
    p_letter_id: dropId,
  });
  assert.ifError(repeatedCollectError);
  assert.deepEqual(rpcRow(repeatedCollectionRows), collection, 'Repeating collection should preserve its original receipt');

  const { data: deliveredDrop, error: deliveredDropError } = await recipient.client.from('letters')
    .select('id, subject, content, status, delivery_mode')
    .eq('id', dropId)
    .maybeSingle();
  assert.ifError(deliveredDropError);
  assert.deepEqual(deliveredDrop, {
    id: dropId,
    subject: 'Local relay pilot smoke',
    content: privateContent,
    status: 'delivered',
    delivery_mode: 'relay',
  }, 'Collection should release the drop only to its intended recipient');
  const { data: senderDrop, error: senderDropError } = await sender.client.from('letters')
    .select('id, content, status, delivery_mode')
    .eq('id', dropId)
    .maybeSingle();
  assert.ifError(senderDropError);
  assert.equal(senderDrop?.content, privateContent, 'The sender should retain access after collection');
  const { data: outsiderDrop, error: outsiderDropError } = await outsider.client.from('letters')
    .select('id')
    .eq('id', dropId);
  assert.ifError(outsiderDropError);
  assert.deepEqual(outsiderDrop, [], 'An unrelated account should remain unable to read the drop after collection');

  const { data: noLongerInTransit, error: noLongerInTransitError } = await recipient.client.rpc('get_recipient_relay_drops');
  assert.ifError(noLongerInTransitError);
  assert.deepEqual(noLongerInTransit, [], 'A collected relay should leave the in-transit route');
  const { data: expiredCarrierRoute, error: expiredCarrierRouteError } = await anonymousCarrier.rpc('get_carrier_relay_route', {
    p_carrier_token: accepted.successor_token,
  });
  assert.ifError(expiredCarrierRouteError);
  assert.deepEqual(expiredCarrierRoute, [], 'The carrier route should close when the recipient collects the relay');

  console.log('PASS: a sender dispatched a text relay and issued a short-lived handoff capability.');
  console.log('PASS: a carrier accepted once, recovered the exact request safely, and could not replay changed inputs.');
  console.log('PASS: recipient route details remained sealed from message content until explicit, repeat-safe collection.');
  console.log('PASS: sender, carrier, outsider, and recipient access matched relay collection and privacy rules.');
} finally {
  let cleanupFailed = false;
  if (dropId) {
    try {
      const { error } = await admin.from('letters').delete().eq('id', dropId);
      if (error) cleanupFailed = true;
      const { data: remainingLetter, error: letterCheckError } = await admin.from('letters')
        .select('id')
        .eq('id', dropId)
        .maybeSingle();
      if (letterCheckError || remainingLetter) cleanupFailed = true;
      const { data: remainingEvents, error: eventCheckError } = await admin.from('letter_events')
        .select('id')
        .eq('letter_id', dropId)
        .limit(1);
      if (eventCheckError || remainingEvents?.length) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  for (const userId of createdUserIds) {
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupFailed = true;
      const { data: remainingUser, error: userCheckError } = await admin.auth.admin.getUserById(userId);
      if (userCheckError) {
        if (userCheckError.status !== 404 || userCheckError.code !== 'user_not_found') cleanupFailed = true;
      } else if (remainingUser?.user) {
        cleanupFailed = true;
      }
      const { data: remainingProfile, error: profileCheckError } = await admin.from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (profileCheckError || remainingProfile) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    console.error('Cleanup could not remove every disposable relay smoke row or account.');
    process.exitCode = 1;
  } else {
    console.log('PASS: the disposable drop, event, profiles, and accounts were removed.');
  }
}
