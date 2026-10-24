import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const envFile = await readFile(resolve(root, '.env.local'), 'utf8').catch(() => {
  throw new Error('Create .env.local from the local Supabase CLI output first.');
});
const localEnv = Object.fromEntries(envFile.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  return match ? [[match[1], match[2].replace(/^("|')(.*)\1$/, '$2')]] : [];
}));
const supabaseUrl = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = localEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('.env.local is missing a required local Supabase value.');
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(supabaseUrl).hostname)) {
  throw new Error('This smoke test only runs against a Supabase URL on this machine.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const createdUserIds = [];
const mediaPaths = new Set();
let app;
let appSpawnError;
let temporaryProject;

function client() {
  return createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function assertClaimDenied(result, message) {
  assert.equal(result.error?.code, '42501', `${message}: expected an authorization denial`);
  assert.ok(result.data == null, `${message}: a denied claim must not return a drop ID`);
}

async function issueUnknownHandleMediaClaim({ sender, appUrl, payloadKind, bytes }) {
  const letterId = `claim-${randomUUID()}`;
  const uploadId = randomUUID();
  const stagedPath = `${sender.id}/pending/${letterId}/${uploadId}`;
  const expectedMediaPath = `${sender.id}/${letterId}/${uploadId}`;
  const mimeType = payloadKind === 'gif' ? 'image/gif' : 'image/png';
  const content = `A private ${payloadKind} for the newly profiled claimant.`;
  const token = randomBytes(32).toString('hex');
  mediaPaths.add(stagedPath);
  mediaPaths.add(expectedMediaPath);

  const { error: uploadError } = await sender.client.storage.from('drop-media').upload(
    stagedPath,
    new Blob([bytes], { type: mimeType }),
    { contentType: mimeType, upsert: false },
  );
  assert.ifError(uploadError);

  const finalizeResponse = await fetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind }),
  });
  assert.equal(finalizeResponse.status, 200, `The unknown-handle ${payloadKind} should pass media finalization`);
  const media = await finalizeResponse.json();
  assert.equal(media.mediaPath, expectedMediaPath, 'Finalization should bind the media to its intended drop');
  assert.equal(media.mediaMimeType, mimeType);
  assert.ok(media.mediaSizeBytes > 0 && media.mediaSizeBytes <= 8 * 1024 * 1024);
  mediaPaths.add(media.mediaPath);

  const { data: issuedLetterId, error: issueError } = await sender.client.rpc('issue_drop_media_claim_invite', {
    p_letter_id: letterId,
    p_subject: `Unknown-handle ${payloadKind} smoke`,
    p_content: content,
    p_payload_kind: payloadKind,
    p_media_path: media.mediaPath,
    p_media_mime_type: media.mediaMimeType,
    p_media_size_bytes: media.mediaSizeBytes,
    p_token: token,
  });
  assert.ifError(issueError);
  assert.equal(issuedLetterId, letterId, `The sender should create a pending ${payloadKind} invite`);
  return { letterId, token, payloadKind, content, mediaPath: media.mediaPath, mediaSizeBytes: media.mediaSizeBytes };
}

async function assertMediaUnavailableToAccount(account, mediaDrop, phase) {
  const { data: privateDrop, error: privateDropError } = await account.client.from('letters')
    .select('id, content, media_path')
    .eq('id', mediaDrop.letterId)
    .maybeSingle();
  assert.ifError(privateDropError);
  assert.equal(privateDrop, null, `${phase}: the ${mediaDrop.payloadKind} drop is not readable`);
  const { data: media, error: mediaError } = await account.client.storage.from('drop-media').download(mediaDrop.mediaPath);
  assert.ok(mediaError && !media, `${phase}: the ${mediaDrop.payloadKind} cannot be downloaded`);
  const { data: signedUrl, error: signedUrlError } = await account.client.storage.from('drop-media').createSignedUrl(mediaDrop.mediaPath, 60);
  assert.ok(signedUrlError && !signedUrl, `${phase}: the ${mediaDrop.payloadKind} cannot produce a signed URL`);
}

async function assertTestPortFree(port) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject).listen(port, '127.0.0.1', resolveListen);
  }).catch((error) => {
    if (error?.code === 'EADDRINUSE') {
      throw new Error("Drop's local Supabase smoke test uses port " + port + " (main app port 4004). Stop its owner before retrying.");
    }
    throw error;
  });
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function createIsolatedProject() {
  temporaryProject = await mkdtemp(join(tmpdir(), 'drop-local-supabase-'));
  const projectRoot = join(temporaryProject, 'app');
  await cp(root, projectRoot, {
    recursive: true,
    filter(source) {
      const path = relative(root, source);
      if (!path) return true;
      const parts = path.split(sep);
      const name = parts.at(-1);
      return !parts.some((part) => ['.git', '.next', '.vercel', 'node_modules'].includes(part))
        && !(parts[0] === 'supabase' && parts[1] === '.temp')
        && !(name.startsWith('.env') && name !== '.env.example');
    },
  });
  await symlink(resolve(root, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  return projectRoot;
}

async function startApp(port) {
  const projectRoot = await createIsolatedProject();
  app = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: projectRoot,
    env: { ...process.env, ...localEnv, WATCHPACK_POLLING: 'true' },
    stdio: 'ignore',
  });
  app.on('error', (error) => { appSpawnError = error; });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (appSpawnError) throw new Error(`The local Next.js server could not start: ${appSpawnError.message}`);
    if (app.exitCode !== null) throw new Error('The local Next.js server exited before becoming ready.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return url;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('The local Next.js server did not become ready within 60 seconds.');
}

async function waitForAppExit(timeoutMs) {
  if (!app || appSpawnError || app.exitCode !== null || app.signalCode !== null) return true;
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      app.off('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    app.once('exit', onExit);
  });
}

async function createTestAccount(label) {
  const email = `drop-smoke-${label}-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(error);
  assert.ok(data.user?.id, `Auth should create the ${label} test account`);
  createdUserIds.push(data.user.id);
  const account = client();
  const { data: sessionData, error: signInError } = await account.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);
  assert.ok(sessionData.user?.id && sessionData.session?.access_token, `The ${label} account should sign in`);
  return { client: account, id: sessionData.user.id, token: sessionData.session.access_token };
}

try {
  const port = await assertTestPortFree(5004);
  const appUrl = await startApp(port);
  const sender = await createTestAccount('sender');
  const recipient = await createTestAccount('recipient');
  const outsider = await createTestAccount('outsider');
  const carrier = await createTestAccount('carrier');
  const claimant = await createTestAccount('claimant');
  const profiles = [
    { id: sender.id, username: `send_${sender.id.slice(0, 8)}`, display_name: 'Smoke Sender', bio: '' },
    { id: recipient.id, username: `recv_${recipient.id.slice(0, 8)}`, display_name: 'Smoke Recipient', bio: '' },
    { id: outsider.id, username: `out_${outsider.id.slice(0, 8)}`, display_name: 'Smoke Outsider', bio: '' },
    { id: carrier.id, username: `carry_${carrier.id.slice(0, 8)}`, display_name: 'Smoke Carrier', bio: '' },
  ];
  for (const [index, account] of [sender, recipient, outsider, carrier].entries()) {
    const { error } = await account.client.from('profiles').upsert(profiles[index]);
    assert.ifError(error);
  }

  const anonymous = client();
  const { data: anonymousProfile, error: anonymousProfileError } = await anonymous.from('public_profiles')
    .select('username, display_name, bio')
    .eq('username', profiles[0].username)
    .maybeSingle();
  assert.ifError(anonymousProfileError);
  assert.deepEqual(anonymousProfile, {
    username: profiles[0].username,
    display_name: profiles[0].display_name,
    bio: profiles[0].bio,
  }, 'Anonymous profile reads should include only public profile fields');
  const { error: anonymousBaseProfileError } = await anonymous.from('profiles').select('*').eq('username', profiles[0].username).maybeSingle();
  assert.ok(anonymousBaseProfileError, 'Anonymous clients must not read the private profile table');
  const { error: anonymousWideProfileError } = await anonymous.from('public_profiles').select('*').eq('username', profiles[0].username).maybeSingle();
  assert.ok(anonymousWideProfileError, 'Anonymous clients must not select the account ID from the public profile view');
  const { data: senderPrivateProfiles, error: senderPrivateProfilesError } = await sender.client.from('profiles').select('*');
  assert.ifError(senderPrivateProfilesError);
  assert.deepEqual(senderPrivateProfiles?.map((profile) => profile.id), [sender.id], 'Authenticated base profile reads should be limited to the signed-in account');

  const { data: recipientLookup, error: recipientLookupError } = await sender.client.from('public_profiles')
    .select('id, username, display_name')
    .eq('username', profiles[1].username)
    .maybeSingle();
  assert.ifError(recipientLookupError);
  assert.deepEqual(recipientLookup, {
    id: recipient.id,
    username: profiles[1].username,
    display_name: profiles[1].display_name,
  }, 'A handle lookup should return only the target account identity needed for confirmation');
  const { data: missingRecipient, error: missingRecipientError } = await sender.client.from('public_profiles')
    .select('id, username, display_name')
    .eq('username', 'unknown.drop.handle')
    .maybeSingle();
  assert.ifError(missingRecipientError);
  assert.equal(missingRecipient, null, 'A missing handle should be distinguishable from a query failure');

  const { error: takenHandleError } = await sender.client.from('profiles')
    .update({ username: profiles[1].username })
    .eq('id', sender.id);
  assert.equal(takenHandleError?.code, '23505', 'A profile cannot claim another account’s handle');
  const { data: senderAfterConflict, error: senderAfterConflictError } = await sender.client.from('profiles')
    .select('username, display_name, bio')
    .eq('id', sender.id)
    .maybeSingle();
  assert.ifError(senderAfterConflictError);
  assert.deepEqual(senderAfterConflict, {
    username: profiles[0].username,
    display_name: profiles[0].display_name,
    bio: profiles[0].bio,
  }, 'A rejected handle update must leave the sender profile unchanged');
  const { data: recipientAfterConflict, error: recipientAfterConflictError } = await recipient.client.from('profiles')
    .select('username, display_name, bio')
    .eq('id', recipient.id)
    .maybeSingle();
  assert.ifError(recipientAfterConflictError);
  assert.deepEqual(recipientAfterConflict, {
    username: profiles[1].username,
    display_name: profiles[1].display_name,
    bio: profiles[1].bio,
  }, 'A rejected handle update must not modify the handle owner');

  const { error: duplicateSenderError } = await sender.client.from('profiles').insert({
    id: sender.id,
    username: 'another.sender.handle',
    display_name: 'Overwritten sender',
    bio: 'This insert must fail.',
  });
  assert.equal(duplicateSenderError?.code, '23505', 'First-use inserts cannot overwrite a profile created concurrently');
  const { data: senderAfterDuplicateInsert, error: senderAfterDuplicateInsertError } = await sender.client.from('profiles')
    .select('username, display_name, bio')
    .eq('id', sender.id)
    .maybeSingle();
  assert.ifError(senderAfterDuplicateInsertError);
  assert.deepEqual(senderAfterDuplicateInsert, {
    username: profiles[0].username,
    display_name: profiles[0].display_name,
    bio: profiles[0].bio,
  }, 'A concurrent first-use insert must leave the current profile unchanged');

  const { data: staleProfileUpdate, error: staleProfileUpdateError } = await sender.client.from('profiles')
    .update({ bio: 'This stale update must not apply.' })
    .eq('id', sender.id)
    .eq('username', 'stale.sender.handle')
    .eq('display_name', profiles[0].display_name)
    .eq('bio', profiles[0].bio)
    .select('id')
    .maybeSingle();
  assert.ifError(staleProfileUpdateError);
  assert.equal(staleProfileUpdate, null, 'A stale profile baseline must not update a newer account profile');
  const { data: currentProfileUpdate, error: currentProfileUpdateError } = await sender.client.from('profiles')
    .update({ bio: 'Conditional update verified.' })
    .eq('id', sender.id)
    .eq('username', profiles[0].username)
    .eq('display_name', profiles[0].display_name)
    .eq('bio', profiles[0].bio)
    .select('id')
    .maybeSingle();
  assert.ifError(currentProfileUpdateError);
  assert.equal(currentProfileUpdate?.id, sender.id, 'A profile update with the current baseline should succeed');
  const { data: restoredProfileUpdate, error: restoredProfileUpdateError } = await sender.client.from('profiles')
    .update({ bio: profiles[0].bio })
    .eq('id', sender.id)
    .eq('username', profiles[0].username)
    .eq('display_name', profiles[0].display_name)
    .eq('bio', 'Conditional update verified.')
    .select('id')
    .maybeSingle();
  assert.ifError(restoredProfileUpdateError);
  assert.equal(restoredProfileUpdate?.id, sender.id, 'The temporary conditional update should be restored');

  const unknownRecipientHandle = `claim_${claimant.id.slice(0, 8)}`;
  const { data: unknownRecipientLookup, error: unknownRecipientLookupError } = await sender.client.from('public_profiles')
    .select('id, username, display_name')
    .eq('username', unknownRecipientHandle)
    .maybeSingle();
  assert.ifError(unknownRecipientLookupError);
  assert.equal(unknownRecipientLookup, null, 'The claimant must be unknown when the sender creates the invite');

  const claimDropId = `claim-${randomUUID()}`;
  const firstClaimToken = randomBytes(32).toString('hex');
  const replacementClaimToken = randomBytes(32).toString('hex');
  const claimContent = 'Only the newly profiled claimant should receive this private note.';
  const { data: issuedClaimDropId, error: issueClaimError } = await sender.client.rpc('issue_drop_claim_invite', {
    p_letter_id: claimDropId,
    p_subject: 'Unknown handle claim smoke',
    p_content: claimContent,
    p_token: firstClaimToken,
  });
  assert.ifError(issueClaimError);
  assert.equal(issuedClaimDropId, claimDropId, 'The sender should create a pending invite for the unknown handle');

  const unknownHandleMedia = [];
  for (const payloadKind of ['image', 'gif']) {
    const bytes = await readFile(resolve(root, payloadKind === 'gif' ? 'public/demo-cat.gif' : 'public/demo-cat.png'));
    unknownHandleMedia.push(await issueUnknownHandleMediaClaim({ sender, appUrl, payloadKind, bytes }));
  }

  const { data: unclaimedDrop, error: unclaimedDropError } = await claimant.client.from('letters')
    .select('id, content')
    .eq('id', claimDropId)
    .maybeSingle();
  assert.ifError(unclaimedDropError);
  assert.equal(unclaimedDrop, null, 'The unprofiled claimant cannot read a pending drop');

  for (const mediaDrop of unknownHandleMedia) {
    await assertMediaUnavailableToAccount(claimant, mediaDrop, 'Before profile setup');
    const { data: earlyClaim, error: earlyClaimError } = await claimant.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    assertClaimDenied({ data: earlyClaim, error: earlyClaimError }, `An account without a Drop profile cannot claim the ${mediaDrop.payloadKind}`);

    const { data: senderPendingMediaDrop, error: senderPendingMediaDropError } = await sender.client.from('letters')
      .select('id, content, recipient_id, status, delivery_mode, payload_kind, media_path')
      .eq('id', mediaDrop.letterId)
      .maybeSingle();
    assert.ifError(senderPendingMediaDropError);
    assert.deepEqual(senderPendingMediaDrop, {
      id: mediaDrop.letterId,
      content: mediaDrop.content,
      recipient_id: null,
      status: 'claim_pending',
      delivery_mode: 'instant',
      payload_kind: mediaDrop.payloadKind,
      media_path: mediaDrop.mediaPath,
    }, `The sender can confirm only their pending ${mediaDrop.payloadKind} drop`);
  }

  const { data: unprofiledClaim, error: unprofiledClaimError } = await claimant.client.rpc('claim_drop_invite', { p_token: firstClaimToken });
  assertClaimDenied({ data: unprofiledClaim, error: unprofiledClaimError }, 'An account without a Drop profile cannot claim an invite');
  const { data: senderSelfClaim, error: senderSelfClaimError } = await sender.client.rpc('claim_drop_invite', { p_token: firstClaimToken });
  assertClaimDenied({ data: senderSelfClaim, error: senderSelfClaimError }, 'The sender cannot claim their own invite');

  const claimantProfile = {
    id: claimant.id,
    username: unknownRecipientHandle,
    display_name: 'Smoke Claimant',
    bio: '',
  };
  const { error: claimantProfileError } = await claimant.client.from('profiles').upsert(claimantProfile);
  assert.ifError(claimantProfileError);
  const { data: profiledRecipientLookup, error: profiledRecipientLookupError } = await sender.client.from('public_profiles')
    .select('id, username, display_name')
    .eq('username', unknownRecipientHandle)
    .maybeSingle();
  assert.ifError(profiledRecipientLookupError);
  assert.deepEqual(profiledRecipientLookup, {
    id: claimant.id,
    username: unknownRecipientHandle,
    display_name: 'Smoke Claimant',
  }, 'The sender can confirm only the public identity needed after profile setup');

  for (const mediaDrop of unknownHandleMedia) {
    await assertMediaUnavailableToAccount(claimant, mediaDrop, 'After profile setup, before explicit claim');
    const { data: claimedMediaDropId, error: claimMediaError } = await claimant.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    assert.ifError(claimMediaError);
    assert.equal(claimedMediaDropId, mediaDrop.letterId, `The profiled claimant should explicitly claim the ${mediaDrop.payloadKind}`);
    const { data: retriedMediaDropId, error: retryMediaClaimError } = await claimant.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    assert.ifError(retryMediaClaimError);
    assert.equal(retriedMediaDropId, mediaDrop.letterId, `The claimant can safely retry the ${mediaDrop.payloadKind} claim`);

    for (const account of [sender, claimant]) {
      const { data: claimedMediaDrop, error: claimedMediaDropError } = await account.client.from('letters')
        .select('id, content, recipient_id, status, delivery_mode, payload_kind, media_path')
        .eq('id', mediaDrop.letterId)
        .maybeSingle();
      assert.ifError(claimedMediaDropError);
      assert.deepEqual(claimedMediaDrop, {
        id: mediaDrop.letterId,
        content: mediaDrop.content,
        recipient_id: claimant.id,
        status: 'delivered',
        delivery_mode: 'instant',
        payload_kind: mediaDrop.payloadKind,
        media_path: mediaDrop.mediaPath,
      }, `The sender and claimant can read the delivered ${mediaDrop.payloadKind} drop`);
      const { data: retrievedMedia, error: retrieveMediaError } = await account.client.storage.from('drop-media').download(mediaDrop.mediaPath);
      assert.ifError(retrieveMediaError);
      assert.equal(retrievedMedia?.size, mediaDrop.mediaSizeBytes, `The sender and claimant can retrieve the ${mediaDrop.payloadKind}`);
    }

    const { data: outsiderMediaDrop, error: outsiderMediaDropError } = await outsider.client.from('letters')
      .select('id')
      .eq('id', mediaDrop.letterId);
    assert.ifError(outsiderMediaDropError);
    assert.deepEqual(outsiderMediaDrop, [], `An unrelated account cannot read the claimed ${mediaDrop.payloadKind} drop`);
    const { data: outsiderMedia, error: outsiderMediaError } = await outsider.client.storage.from('drop-media').download(mediaDrop.mediaPath);
    assert.ok(outsiderMediaError && !outsiderMedia, `An unrelated account cannot download the ${mediaDrop.payloadKind}`);
    const { data: outsiderSignedUrl, error: outsiderSignedUrlError } = await outsider.client.storage.from('drop-media').createSignedUrl(mediaDrop.mediaPath, 60);
    assert.ok(outsiderSignedUrlError && !outsiderSignedUrl, `An unrelated account cannot create a URL for the ${mediaDrop.payloadKind}`);
  }

  const { data: reissuedClaimDropId, error: reissueClaimError } = await sender.client.rpc('reissue_drop_claim_invite', {
    p_letter_id: claimDropId,
    p_token: replacementClaimToken,
  });
  assert.ifError(reissueClaimError);
  assert.equal(reissuedClaimDropId, claimDropId, 'The sender should be able to rotate the pending invite');
  const { data: replacedTokenClaim, error: replacedTokenClaimError } = await claimant.client.rpc('claim_drop_invite', { p_token: firstClaimToken });
  assertClaimDenied({ data: replacedTokenClaim, error: replacedTokenClaimError }, 'A replaced link cannot claim the drop');

  const invalidClaimToken = randomBytes(32).toString('hex');
  const { data: outsiderClaim, error: outsiderClaimError } = await outsider.client.rpc('claim_drop_invite', { p_token: invalidClaimToken });
  assertClaimDenied({ data: outsiderClaim, error: outsiderClaimError }, 'A caller without the bearer token cannot claim the invite');
  const { data: claimedDropId, error: claimDropError } = await claimant.client.rpc('claim_drop_invite', { p_token: replacementClaimToken });
  assert.ifError(claimDropError);
  assert.equal(claimedDropId, claimDropId, 'The newly profiled claimant should explicitly claim the drop');
  const { data: retriedClaimDropId, error: retriedClaimError } = await claimant.client.rpc('claim_drop_invite', { p_token: replacementClaimToken });
  assert.ifError(retriedClaimError);
  assert.equal(retriedClaimDropId, claimDropId, 'The same claimant can safely retry an ambiguous claim response');
  const { data: replayedClaim, error: replayedClaimError } = await outsider.client.rpc('claim_drop_invite', { p_token: replacementClaimToken });
  assertClaimDenied({ data: replayedClaim, error: replayedClaimError }, 'A second account cannot replay a claimed invite');

  for (const account of [sender, claimant]) {
    const { data, error } = await account.client.from('letters')
      .select('id, content, recipient_id, status, delivery_mode, payload_kind')
      .eq('id', claimDropId)
      .maybeSingle();
    assert.ifError(error);
    assert.deepEqual(data, {
      id: claimDropId,
      content: claimContent,
      recipient_id: claimant.id,
      status: 'delivered',
      delivery_mode: 'instant',
      payload_kind: 'text',
    }, 'Only the sender and intended claimant should read the delivered drop');
  }
  const { data: outsiderClaimDrop, error: outsiderClaimDropError } = await outsider.client.from('letters')
    .select('id')
    .eq('id', claimDropId);
  assert.ifError(outsiderClaimDropError);
  assert.deepEqual(outsiderClaimDrop, [], 'An unrelated account cannot read a claimed drop');
  const { data: senderClaimedIds, error: senderClaimedIdsError } = await sender.client.rpc('get_sender_claimed_drop_ids');
  assert.ifError(senderClaimedIdsError);
  assert.ok(senderClaimedIds?.some((row) => row.letter_id === claimDropId), 'The sender can restore the durable claimed status');
  for (const mediaDrop of unknownHandleMedia) {
    assert.ok(senderClaimedIds?.some((row) => row.letter_id === mediaDrop.letterId), `The sender can restore the claimed ${mediaDrop.payloadKind} status`);
  }

  const { error: claimantReactionError } = await claimant.client.from('letter_reactions').upsert({
    letter_id: claimDropId,
    recipient_id: claimant.id,
    emoji: '🫶',
  }, { onConflict: 'letter_id' });
  assert.ifError(claimantReactionError);
  const { data: senderClaimReaction, error: senderClaimReactionError } = await sender.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', claimDropId)
    .maybeSingle();
  assert.ifError(senderClaimReactionError);
  assert.equal(senderClaimReaction?.emoji, '🫶', 'The sender should see the claimant reaction after the drop is claimed');

  const textDropId = randomUUID();
  const sentAt = new Date().toISOString();
  const { error: textInsertError } = await sender.client.from('letters').insert({
    id: textDropId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    sender_display_name: 'Smoke Sender',
    recipient_username: profiles[1].username,
    recipient_name: 'Smoke Recipient',
    subject: 'Local smoke test',
    content: 'Only the sender and recipient should see this.',
    teaser: ['Only the sender and recipient should see this.'],
    status: 'delivered',
    seal_id: 'cobalt',
    dispatched_at: sentAt,
    delivered_at: sentAt,
    payload_kind: 'text',
    delivery_mode: 'instant',
  });
  assert.ifError(textInsertError);

  const { data: senderProfileJoin, error: senderProfileJoinError } = await recipient.client.from('letters')
    .select('sender_profile:public_profiles!letters_sender_id_fkey(username)')
    .eq('id', textDropId)
    .maybeSingle();
  assert.ifError(senderProfileJoinError);
  assert.deepEqual(senderProfileJoin?.sender_profile, { username: profiles[0].username }, 'Mailbox sender handles should still resolve through the public profile view');

  const { data: recentDropRows, error: recentDropRowsError } = await sender.client.from('letters')
    .select('recipient_username, recipient_name')
    .eq('sender_id', sender.id)
    .in('status', ['dispatched', 'delivered'])
    .order('dispatched_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(100);
  assert.ifError(recentDropRowsError);
  const recentRecipientHandles = [...new Set(recentDropRows.map(({ recipient_username }) => recipient_username))].sort();
  assert.deepEqual(recentRecipientHandles, [profiles[1].username, unknownRecipientHandle].sort(), 'The recent-recipient query should return recipients from all of the sender’s claimed and directly addressed drops');
  assert.equal(recentDropRows.filter(({ recipient_username }) => recipient_username === profiles[1].username).length, 1);
  assert.equal(recentDropRows.filter(({ recipient_username }) => recipient_username === unknownRecipientHandle).length, unknownHandleMedia.length + 1, 'Each claimed text or media invite should contribute the profiled claimant to the raw recent-recipient rows');

  for (const account of [sender, recipient]) {
    const { data, error } = await account.client.from('letters').select('id, content').eq('id', textDropId).maybeSingle();
    assert.ifError(error);
    assert.equal(data?.content, 'Only the sender and recipient should see this.');
  }
  const { data: outsiderDrop, error: outsiderReadError } = await outsider.client.from('letters').select('id').eq('id', textDropId);
  assert.ifError(outsiderReadError);
  assert.deepEqual(outsiderDrop, [], 'Unrelated accounts must not read a private drop');
  const { data: recipientEdit, error: recipientEditError } = await recipient.client.from('letters').update({ content: 'changed' }).eq('id', textDropId).select('id');
  assert.ifError(recipientEditError);
  assert.deepEqual(recipientEdit, [], 'Recipients must not edit a sent drop');

  const { error: reactionError } = await recipient.client.from('letter_reactions').upsert({
    letter_id: textDropId,
    recipient_id: recipient.id,
    emoji: '🫶',
  }, { onConflict: 'letter_id' });
  assert.ifError(reactionError);
  const { data: senderReaction, error: senderReactionError } = await sender.client.from('letter_reactions').select('emoji').eq('letter_id', textDropId).maybeSingle();
  assert.ifError(senderReactionError);
  assert.equal(senderReaction?.emoji, '🫶', 'The sender should see the recipient reaction');
  const { data: outsiderReaction, error: outsiderReactionError } = await outsider.client.from('letter_reactions').select('emoji').eq('letter_id', textDropId);
  assert.ifError(outsiderReactionError);
  assert.deepEqual(outsiderReaction, [], 'Unrelated accounts must not read reactions');
  const { error: forbiddenReactionError } = await outsider.client.from('letter_reactions').insert({
    letter_id: textDropId,
    recipient_id: outsider.id,
    emoji: '🔥',
  });
  assert.ok(forbiddenReactionError, 'Unrelated accounts must not add reactions');

  const mediaDropId = randomUUID();
  const uploadId = randomUUID();
  const stagedPath = `${sender.id}/pending/${mediaDropId}/${uploadId}`;
  const finalPath = `${sender.id}/${mediaDropId}/${uploadId}`;
  mediaPaths.add(stagedPath);
  mediaPaths.add(finalPath);
  const gifBytes = await readFile(resolve(root, 'public/demo-cat.gif'));
  const { error: stageError } = await sender.client.storage.from('drop-media').upload(stagedPath, new Blob([gifBytes], { type: 'image/gif' }), {
    contentType: 'image/gif',
    upsert: false,
  });
  assert.ifError(stageError);

  const unauthenticatedResponse = await fetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind: 'gif' }),
  });
  assert.equal(unauthenticatedResponse.status, 401, 'Media finalization must require an account token');
  const wrongOwnerPath = `${outsider.id}/pending/${mediaDropId}/${uploadId}`;
  const wrongOwnerResponse = await fetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath: wrongOwnerPath, payloadKind: 'gif' }),
  });
  assert.equal(wrongOwnerResponse.status, 400, 'A sender must not finalize someone else’s staging path');
  const finalizeResponse = await fetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind: 'gif' }),
  });
  assert.equal(finalizeResponse.status, 200, 'The validated local GIF should be finalized');
  await finalizeResponse.arrayBuffer(); // Model a lost response before the drop row is linked.
  const { error: retryStageError } = await sender.client.storage.from('drop-media').upload(stagedPath, new Blob([gifBytes], { type: 'image/gif' }), {
    contentType: 'image/gif',
    upsert: false,
  });
  assert.ifError(retryStageError);
  const lostResponseRetry = await fetch(appUrl + '/api/drop-media/finalize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + sender.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind: 'gif' }),
  });
  assert.equal(lostResponseRetry.status, 200, 'A retry with the same upload ID should recover the unlinked final GIF');
  const media = await lostResponseRetry.json();
  assert.equal(media.mediaPath, finalPath, 'A retry should return the already-stored final path');
  assert.equal(media.mediaMimeType, 'image/gif');
  assert.ok(media.mediaSizeBytes > 0 && media.mediaSizeBytes <= 8 * 1024 * 1024);
  mediaPaths.add(media.mediaPath);
  const { data: stagedObjects, error: stagedLookupError } = await admin.storage.from('drop-media').list(`${sender.id}/pending/${mediaDropId}`, { search: uploadId });
  assert.ifError(stagedLookupError);
  assert.equal(stagedObjects?.length, 0, 'Finalization should remove the staging object');

  const { error: mediaInsertError } = await sender.client.from('letters').insert({
    id: mediaDropId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    sender_display_name: 'Smoke Sender',
    recipient_username: profiles[1].username,
    recipient_name: 'Smoke Recipient',
    subject: 'Local GIF smoke test',
    content: 'A private note for the recipient only.',
    teaser: ['A private note for the recipient only.'],
    status: 'dispatched',
    dispatched_at: sentAt,
    payload_kind: 'gif',
    delivery_mode: 'relay',
    media_path: media.mediaPath,
    media_mime_type: media.mediaMimeType,
    media_size_bytes: media.mediaSizeBytes,
  });
  assert.ifError(mediaInsertError);

  const { error: seedRelayEventError } = await admin.from('letter_events').insert({
    letter_id: mediaDropId,
    event_key: 'smoke-secret-event',
    status: 'hidden',
    note: 'Sender-only relay event.',
  });
  assert.ifError(seedRelayEventError);
  const { error: seedJourneyNoteError } = await admin.from('journey_notes').insert({
    letter_id: mediaDropId,
    author_id: sender.id,
    body: 'Sender-only journey note.',
  });
  assert.ifError(seedJourneyNoteError);

  const retryUploadId = randomUUID();
  const retryStagedPath = `${sender.id}/pending/${mediaDropId}/${retryUploadId}`;
  mediaPaths.add(retryStagedPath);
  const { error: linkedRetryStageError } = await sender.client.storage.from('drop-media').upload(retryStagedPath, new Blob([gifBytes], { type: 'image/gif' }), {
    contentType: 'image/gif',
    upsert: false,
  });
  assert.ifError(linkedRetryStageError);
  const retryFinalizeResponse = await fetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath: retryStagedPath, payloadKind: 'gif' }),
  });
  assert.equal(retryFinalizeResponse.status, 200, 'An exact retry with a fresh staging path should reuse the linked GIF');
  assert.deepEqual(await retryFinalizeResponse.json(), media, 'A fresh-path retry should return the original media path and metadata');
  const { data: retryStagedObjects, error: retryStagedLookupError } = await admin.storage.from('drop-media').list(`${sender.id}/pending/${mediaDropId}`, { search: retryUploadId });
  assert.ifError(retryStagedLookupError);
  assert.equal(retryStagedObjects?.length, 0, 'A fresh-path retry should remove its staging object');

  const { data: issuedRows, error: issueRelayError } = await sender.client.rpc('issue_relay_handoff_token', {
    p_letter_id: mediaDropId,
  });
  assert.ifError(issueRelayError);
  const issuedPass = Array.isArray(issuedRows) ? issuedRows[0] : issuedRows;
  assert.ok(issuedPass?.token && Number.isFinite(Date.parse(issuedPass.expires_at)), 'The sender should receive a short-lived pass for the dispatched relay GIF');

  const { data: acceptedRows, error: acceptRelayError } = await carrier.client.rpc('accept_relay_handoff_token', {
    p_token: issuedPass.token,
    p_request_id: randomUUID(),
    p_carrier_name: 'Smoke Carrier',
    p_neighborhood: 'Smoke Neighborhood',
    p_note: 'One handoff; the GIF stays sealed.',
  });
  assert.ifError(acceptRelayError);
  const acceptedPass = Array.isArray(acceptedRows) ? acceptedRows[0] : acceptedRows;
  assert.equal(acceptedPass?.letter_id, mediaDropId, 'The carrier should accept the relay for this GIF drop');
  assert.ok(acceptedPass?.handoff_id && acceptedPass?.successor_token && Number.isFinite(Date.parse(acceptedPass.successor_expires_at)));
  assert.deepEqual(Object.keys(acceptedPass).sort(), ['handoff_id', 'letter_id', 'successor_expires_at', 'successor_token'].sort(), 'The acceptance result should contain only the handoff identity and next carrier capability');

  const { data: carrierRoute, error: carrierRouteError } = await carrier.client.rpc('get_carrier_relay_route', {
    p_carrier_token: acceptedPass.successor_token,
  });
  assert.ifError(carrierRouteError);
  assert.equal(carrierRoute?.length, 1, 'The new carrier should see exactly the accepted handoff in its route summary');
  assert.deepEqual(Object.keys(carrierRoute[0]).sort(), ['carrier_name', 'carrier_note', 'created_at', 'handoff_id', 'neighborhood'].sort(), 'The carrier route should expose only route summary fields');
  assert.equal(carrierRoute[0].carrier_name, 'Smoke Carrier');
  assert.equal(carrierRoute[0].neighborhood, 'Smoke Neighborhood');
  assert.equal(carrierRoute[0].carrier_note, 'One handoff; the GIF stays sealed.');

  const { data: carrierHandoffs, error: carrierHandoffsError } = await carrier.client.from('relay_handoffs')
    .select('carrier_name, neighborhood, note, handoff_lat, handoff_lng, accepted_lat, accepted_lng')
    .eq('letter_id', mediaDropId);
  assert.ifError(carrierHandoffsError);
  assert.deepEqual(carrierHandoffs, [], 'Carriers should receive route data only through the scoped route RPC');
  const { data: senderHandoffs, error: senderHandoffsError } = await sender.client.from('relay_handoffs')
    .select('id')
    .eq('letter_id', mediaDropId);
  assert.ifError(senderHandoffsError);
  assert.equal(senderHandoffs?.length, 1, 'The relay GIF should record exactly one handoff');

  const { data: recipientRelaySummaries, error: recipientRelaySummaryError } = await recipient.client.rpc('get_recipient_relay_drops');
  assert.ifError(recipientRelaySummaryError);
  assert.equal(recipientRelaySummaries?.length, 1, 'The recipient should see the in-transit relay in their safe route summary');
  const recipientRelaySummary = recipientRelaySummaries[0];
  assert.deepEqual(Object.keys(recipientRelaySummary).sort(), [
    'created_at', 'dispatched_at', 'handoff_count', 'id', 'latest_carrier', 'latest_handoff_at', 'latest_neighborhood', 'latest_note', 'sender_display_name',
  ].sort(), 'The recipient route summary should exclude subject, content, media, and coordinates');
  assert.equal(recipientRelaySummary.id, mediaDropId);
  assert.equal(recipientRelaySummary.handoff_count, 1);
  assert.equal(recipientRelaySummary.latest_carrier, 'Smoke Carrier');
  assert.equal(recipientRelaySummary.latest_neighborhood, 'Smoke Neighborhood');
  assert.equal(recipientRelaySummary.latest_note, 'One handoff; the GIF stays sealed.');
  const { data: recipientRelayHandoffs, error: recipientRelayHandoffError } = await recipient.client.from('relay_handoffs')
    .select('note, handoff_lat, handoff_lng, accepted_lat, accepted_lng')
    .eq('letter_id', mediaDropId);
  assert.ifError(recipientRelayHandoffError);
  assert.deepEqual(recipientRelayHandoffs, [], 'The recipient must not read raw handoff rows or coordinates before collection');
  const { data: recipientRelayEvents, error: recipientRelayEventError } = await recipient.client.from('letter_events')
    .select('note')
    .eq('letter_id', mediaDropId);
  assert.ifError(recipientRelayEventError);
  assert.deepEqual(recipientRelayEvents, [], 'The recipient must not read letter events before collection');
  const { data: recipientJourneyNotes, error: recipientJourneyNoteError } = await recipient.client.from('journey_notes')
    .select('body')
    .eq('letter_id', mediaDropId);
  assert.ifError(recipientJourneyNoteError);
  assert.deepEqual(recipientJourneyNotes, [], 'The recipient must not read the sender’s private journey notes before collection');
  const { data: senderRelaySummaries, error: senderRelaySummaryError } = await sender.client.rpc('get_recipient_relay_drops');
  assert.ifError(senderRelaySummaryError);
  assert.deepEqual(senderRelaySummaries, [], 'The recipient route summary should be scoped to the recipient account');
  const { data: carrierRelaySummaries, error: carrierRelaySummaryError } = await carrier.client.rpc('get_recipient_relay_drops');
  assert.ifError(carrierRelaySummaryError);
  assert.deepEqual(carrierRelaySummaries, [], 'A carrier must not read the recipient route summary');

  const { error: carrierCollectError } = await carrier.client.rpc('collect_relay_drop', { p_letter_id: mediaDropId });
  assert.ok(carrierCollectError, 'A carrier must not collect the relay for its recipient');
  const { error: senderCollectError } = await sender.client.rpc('collect_relay_drop', { p_letter_id: mediaDropId });
  assert.ok(senderCollectError, 'The sender must not collect the relay for its recipient');

  const { error: seedReactionError } = await admin.from('letter_reactions').insert({
    letter_id: mediaDropId,
    recipient_id: recipient.id,
    emoji: '💜',
  });
  assert.ifError(seedReactionError);

  const { data: lockedRecipientDrop, error: lockedRecipientDropError } = await recipient.client.from('letters')
    .select('id, subject, content, media_path, media_mime_type, media_size_bytes')
    .eq('id', mediaDropId)
    .maybeSingle();
  assert.ifError(lockedRecipientDropError);
  assert.equal(lockedRecipientDrop, null, 'The recipient must not read letter content or attachment metadata before collection');
  const { data: lockedRecipientMedia, error: lockedRecipientMediaError } = await recipient.client.storage.from('drop-media').download(media.mediaPath);
  assert.ok(lockedRecipientMediaError && !lockedRecipientMedia, 'The recipient must not download the GIF before collection');
  const { data: lockedRecipientSignedUrl, error: lockedRecipientSignedUrlError } = await recipient.client.storage.from('drop-media').createSignedUrl(media.mediaPath, 60);
  assert.ok(lockedRecipientSignedUrlError && !lockedRecipientSignedUrl, 'The recipient must not create a signed URL before collection');
  const { data: lockedRecipientReaction, error: lockedRecipientReactionError } = await recipient.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', mediaDropId)
    .maybeSingle();
  assert.ifError(lockedRecipientReactionError);
  assert.equal(lockedRecipientReaction, null, 'The recipient must not read a reaction before collection');
  const { data: earlyReactionUpdate, error: earlyReactionUpdateError } = await recipient.client.from('letter_reactions')
    .update({ emoji: '😂' })
    .eq('letter_id', mediaDropId)
    .select('emoji');
  assert.ok(earlyReactionUpdateError || earlyReactionUpdate?.length === 0, 'The recipient must not change a reaction before collection');
  const { data: unchangedSeedReaction, error: unchangedSeedReactionError } = await admin.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', mediaDropId)
    .maybeSingle();
  assert.ifError(unchangedSeedReactionError);
  assert.equal(unchangedSeedReaction?.emoji, '💜', 'A pre-collection reaction write must leave the reaction unchanged');
  const { error: removeSeedReactionError } = await admin.from('letter_reactions').delete().eq('letter_id', mediaDropId);
  assert.ifError(removeSeedReactionError);

  const { data: collectionRows, error: collectError } = await recipient.client.rpc('collect_relay_drop', { p_letter_id: mediaDropId });
  assert.ifError(collectError);
  const collection = Array.isArray(collectionRows) ? collectionRows[0] : collectionRows;
  assert.equal(collection?.drop_id, mediaDropId, 'The recipient should collect the relay GIF');
  assert.ok(collection?.delivered_at && Number.isFinite(Date.parse(collection.delivered_at)));
  assert.deepEqual(Object.keys(collection).sort(), ['delivered_at', 'drop_id'], 'Collection should return only the released drop ID and delivery time');
  const { data: repeatedCollectionRows, error: repeatedCollectError } = await recipient.client.rpc('collect_relay_drop', { p_letter_id: mediaDropId });
  assert.ifError(repeatedCollectError);
  const repeatedCollection = Array.isArray(repeatedCollectionRows) ? repeatedCollectionRows[0] : repeatedCollectionRows;
  assert.deepEqual(repeatedCollection, collection, 'Repeating collection should safely return the original delivery receipt');

  const { data: recipientRelayDrop, error: recipientRelayDropError } = await recipient.client.from('letters')
    .select('id, content, status, delivery_mode, payload_kind, media_path')
    .eq('id', mediaDropId)
    .maybeSingle();
  assert.ifError(recipientRelayDropError);
  assert.equal(recipientRelayDrop?.content, 'A private note for the recipient only.');
  assert.equal(recipientRelayDrop?.status, 'delivered');
  assert.equal(recipientRelayDrop?.delivery_mode, 'relay');
  assert.equal(recipientRelayDrop?.payload_kind, 'gif');
  assert.equal(recipientRelayDrop?.media_path, media.mediaPath);
  const { data: collectedRelaySummaries, error: collectedRelaySummaryError } = await recipient.client.rpc('get_recipient_relay_drops');
  assert.ifError(collectedRelaySummaryError);
  assert.deepEqual(collectedRelaySummaries, [], 'A collected relay should leave the in-transit summary');

  const { data: carrierDrop, error: carrierDropError } = await carrier.client.from('letters')
    .select('id, subject, content, media_path, media_mime_type, media_size_bytes')
    .eq('id', mediaDropId)
    .maybeSingle();
  assert.ifError(carrierDropError);
  assert.equal(carrierDrop, null, 'The carrier must not query the private letter or attachment metadata');
  const { data: carrierMedia, error: carrierMediaError } = await carrier.client.storage.from('drop-media').download(media.mediaPath);
  assert.ok(carrierMediaError && !carrierMedia, 'The carrier must not download the private GIF');
  const { data: carrierSignedUrl, error: carrierSignedUrlError } = await carrier.client.storage.from('drop-media').createSignedUrl(media.mediaPath, 60);
  assert.ok(carrierSignedUrlError && !carrierSignedUrl, 'The carrier must not create a signed URL for the private GIF');
  const { data: outsiderRelayDrop, error: outsiderRelayDropError } = await outsider.client.from('letters')
    .select('id, content, media_path')
    .eq('id', mediaDropId);
  assert.ifError(outsiderRelayDropError);
  assert.deepEqual(outsiderRelayDrop, [], 'An unrelated account must not read the relay GIF drop');

  for (const account of [sender, recipient]) {
    const { data, error } = await account.client.storage.from('drop-media').download(media.mediaPath);
    assert.ifError(error);
    assert.ok(data?.size > 0, 'The sender and recipient should retrieve the private GIF');
  }
  const { data: outsiderMedia, error: outsiderMediaError } = await outsider.client.storage.from('drop-media').download(media.mediaPath);
  assert.ok(outsiderMediaError && !outsiderMedia, 'An unrelated account must not retrieve the private GIF');
  const { data: recipientSignedUrl, error: signedUrlError } = await recipient.client.storage.from('drop-media').createSignedUrl(media.mediaPath, 60);
  assert.ifError(signedUrlError);
  assert.ok(recipientSignedUrl?.signedUrl, 'The recipient should be able to create a short-lived media URL');
  const { data: outsiderSignedUrl, error: outsiderSignedUrlError } = await outsider.client.storage.from('drop-media').createSignedUrl(media.mediaPath, 60);
  assert.ok(outsiderSignedUrlError && !outsiderSignedUrl, 'An unrelated account must not create a media URL');

  const { error: relayReactionError } = await recipient.client.from('letter_reactions').insert({
    letter_id: mediaDropId,
    recipient_id: recipient.id,
    emoji: '🔥',
  });
  assert.ifError(relayReactionError);
  const { data: recipientRelayReaction, error: recipientRelayReactionError } = await recipient.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', mediaDropId)
    .maybeSingle();
  assert.ifError(recipientRelayReactionError);
  assert.equal(recipientRelayReaction?.emoji, '🔥', 'The recipient should read the reaction after collection');
  const { data: carrierReaction, error: carrierReactionError } = await carrier.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', mediaDropId);
  assert.ifError(carrierReactionError);
  assert.deepEqual(carrierReaction, [], 'The carrier must not read the recipient reaction');
  const { data: senderRelayReaction, error: senderRelayReactionError } = await sender.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', mediaDropId)
    .maybeSingle();
  assert.ifError(senderRelayReactionError);
  assert.equal(senderRelayReaction?.emoji, '🔥', 'The sender should see the reaction on the relay GIF');
  const { data: outsiderRelayReaction, error: outsiderRelayReactionError } = await outsider.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', mediaDropId);
  assert.ifError(outsiderRelayReactionError);
  assert.deepEqual(outsiderRelayReaction, [], 'An unrelated account must not read the relay GIF reaction');
  const { error: forbiddenRelayReactionError } = await outsider.client.from('letter_reactions').insert({
    letter_id: mediaDropId,
    recipient_id: outsider.id,
    emoji: '😂',
  });
  assert.ok(forbiddenRelayReactionError, 'An unrelated account must not react to the relay GIF');

  const legacyDropId = randomUUID();
  const legacyMediaPath = `${sender.id}/${legacyDropId}/${randomUUID()}`;
  mediaPaths.add(legacyMediaPath);
  const { error: legacyMediaUploadError } = await admin.storage.from('drop-media').upload(
    legacyMediaPath,
    new Blob([gifBytes], { type: 'image/gif' }),
    { contentType: 'image/gif', upsert: false },
  );
  assert.ifError(legacyMediaUploadError);
  const { error: legacyDropInsertError } = await admin.from('letters').insert({
    id: legacyDropId,
    sender_id: sender.id,
    recipient_id: recipient.id,
    sender_display_name: 'Smoke Sender',
    recipient_username: profiles[1].username,
    recipient_name: 'Smoke Recipient',
    subject: 'Legacy dispatched relay',
    content: 'A legacy relay stays sealed before collection.',
    teaser: ['A legacy relay stays sealed before collection.'],
    status: 'dispatched',
    dispatched_at: sentAt,
    payload_kind: 'gif',
    delivery_mode: 'instant',
    media_path: legacyMediaPath,
    media_mime_type: 'image/gif',
    media_size_bytes: gifBytes.length,
  });
  assert.ifError(legacyDropInsertError);
  const { error: legacyEventInsertError } = await admin.from('letter_events').insert({
    letter_id: legacyDropId,
    event_key: 'legacy-smoke-private-event',
    status: 'hidden',
    note: 'Legacy sender-only event.',
  });
  assert.ifError(legacyEventInsertError);
  const { error: legacyJourneyNoteInsertError } = await admin.from('journey_notes').insert({
    letter_id: legacyDropId,
    author_id: sender.id,
    body: 'Legacy sender-authored journey note.',
  });
  assert.ifError(legacyJourneyNoteInsertError);
  const { error: legacySeedReactionError } = await admin.from('letter_reactions').insert({
    letter_id: legacyDropId,
    recipient_id: recipient.id,
    emoji: '💜',
  });
  assert.ifError(legacySeedReactionError);

  const { data: legacyRelaySummaries, error: legacyRelaySummaryError } = await recipient.client.rpc('get_recipient_relay_drops');
  assert.ifError(legacyRelaySummaryError);
  assert.deepEqual(legacyRelaySummaries?.map((row) => row.id), [legacyDropId], 'Legacy dispatched rows must appear in the safe in-transit summary regardless of their old delivery mode');
  const { data: lockedLegacyDrop, error: lockedLegacyDropError } = await recipient.client.from('letters')
    .select('id, content, media_path')
    .eq('id', legacyDropId)
    .maybeSingle();
  assert.ifError(lockedLegacyDropError);
  assert.equal(lockedLegacyDrop, null, 'A legacy dispatched row must stay sealed before collection');
  const { data: lockedLegacyEvents, error: lockedLegacyEventsError } = await recipient.client.from('letter_events')
    .select('note')
    .eq('letter_id', legacyDropId);
  assert.ifError(lockedLegacyEventsError);
  assert.deepEqual(lockedLegacyEvents, [], 'A legacy dispatched row must not expose letter events before collection');
  const { data: lockedLegacyJourneyNotes, error: lockedLegacyJourneyNotesError } = await recipient.client.from('journey_notes')
    .select('body')
    .eq('letter_id', legacyDropId);
  assert.ifError(lockedLegacyJourneyNotesError);
  assert.deepEqual(lockedLegacyJourneyNotes, [], 'A legacy dispatched row must not expose sender journey notes before collection');
  const { data: lockedLegacyMedia, error: lockedLegacyMediaError } = await recipient.client.storage.from('drop-media').download(legacyMediaPath);
  assert.ok(lockedLegacyMediaError && !lockedLegacyMedia, 'A legacy dispatched attachment must stay sealed before collection');
  const { data: lockedLegacySignedUrl, error: lockedLegacySignedUrlError } = await recipient.client.storage.from('drop-media').createSignedUrl(legacyMediaPath, 60);
  assert.ok(lockedLegacySignedUrlError && !lockedLegacySignedUrl, 'A legacy dispatched attachment must not produce a signed URL before collection');
  const { data: lockedLegacyReaction, error: lockedLegacyReactionError } = await recipient.client.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', legacyDropId)
    .maybeSingle();
  assert.ifError(lockedLegacyReactionError);
  assert.equal(lockedLegacyReaction, null, 'A legacy dispatched reaction must stay hidden before collection');
  const { data: legacyReactionUpdate, error: legacyReactionUpdateError } = await recipient.client.from('letter_reactions')
    .update({ emoji: '😂' })
    .eq('letter_id', legacyDropId)
    .select('emoji');
  assert.ok(legacyReactionUpdateError || legacyReactionUpdate?.length === 0, 'A recipient must not change a legacy dispatched reaction before collection');
  const { data: legacyReactionUnchanged, error: legacyReactionUnchangedError } = await admin.from('letter_reactions')
    .select('emoji')
    .eq('letter_id', legacyDropId)
    .maybeSingle();
  assert.ifError(legacyReactionUnchangedError);
  assert.equal(legacyReactionUnchanged?.emoji, '💜', 'A rejected legacy reaction write must leave the stored reaction unchanged');

  const { data: legacyCollectionRows, error: legacyCollectionError } = await recipient.client.rpc('collect_relay_drop', { p_letter_id: legacyDropId });
  assert.ifError(legacyCollectionError);
  const legacyCollection = Array.isArray(legacyCollectionRows) ? legacyCollectionRows[0] : legacyCollectionRows;
  assert.equal(legacyCollection?.drop_id, legacyDropId, 'A recipient should be able to collect an old dispatched relay');
  const { data: collectedLegacyDrop, error: collectedLegacyDropError } = await recipient.client.from('letters')
    .select('id, content, status, delivery_mode, media_path')
    .eq('id', legacyDropId)
    .maybeSingle();
  assert.ifError(collectedLegacyDropError);
  assert.equal(collectedLegacyDrop?.content, 'A legacy relay stays sealed before collection.');
  assert.equal(collectedLegacyDrop?.status, 'delivered');
  assert.equal(collectedLegacyDrop?.delivery_mode, 'relay', 'Collection should normalize a legacy dispatched row for relay history and carrier functions');
  assert.equal(collectedLegacyDrop?.media_path, legacyMediaPath);

  console.log('PASS: five disposable local accounts authenticate; the claim recipient creates a profile after the unknown-handle invite.');
  console.log('PASS: unknown-handle text invites stay unreadable until claim, invalidate reissued links, reject sender/invalid-token/post-claim replay attempts, and restore sender status and reaction.');
  console.log('PASS: unknown-handle image and GIF invites remain unreadable and unclaimable before profile setup, then expose media only to the sender and explicit claimant.');
  console.log('PASS: sender and recipient read the drop; an unrelated account cannot read or edit it.');
  console.log('PASS: the recipient reacts; the sender sees the reaction; unrelated reaction access is denied.');
  console.log('PASS: the local finalize route validates a GIF, safely reuses an exact retry with a fresh staging path, and keeps media limited to participants.');
  console.log('PASS: relay-GIF handoff exposes route summaries only; recipient content, media, and reactions stay locked until repeat-safe collection; carriers and outsiders remain denied.');
  console.log('PASS: legacy dispatched rows remain sealed regardless of delivery mode, then normalize to relay when collected.');
} finally {
  let cleanupFailed = false;
  for (const path of mediaPaths) {
    try {
      const { error } = await admin.storage.from('drop-media').remove([path]);
      if (error && !/not found|does not exist/i.test(error.message)) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  for (const userId of createdUserIds) {
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (app && !appSpawnError && app.exitCode === null && app.signalCode === null) {
    try {
      app.kill('SIGTERM');
      if (!await waitForAppExit(5000)) {
        app.kill('SIGKILL');
        if (!await waitForAppExit(1000)) cleanupFailed = true;
      }
    } catch {
      cleanupFailed = true;
    }
  }
  const appStopped = !app || appSpawnError || app.exitCode !== null || app.signalCode !== null;
  if (temporaryProject && appStopped) {
    try {
      await rm(temporaryProject, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
  } else if (temporaryProject) {
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    console.error('Cleanup could not remove every disposable local test object or account.');
    process.exitCode = 1;
  }
}
