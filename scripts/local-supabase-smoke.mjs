import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
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
  const port = await availablePort();
  const appUrl = await startApp(port);
  const sender = await createTestAccount('sender');
  const recipient = await createTestAccount('recipient');
  const outsider = await createTestAccount('outsider');
  const profiles = [
    { id: sender.id, username: `send_${sender.id.slice(0, 8)}`, display_name: 'Smoke Sender', bio: '' },
    { id: recipient.id, username: `recv_${recipient.id.slice(0, 8)}`, display_name: 'Smoke Recipient', bio: '' },
    { id: outsider.id, username: `out_${outsider.id.slice(0, 8)}`, display_name: 'Smoke Outsider', bio: '' },
  ];
  for (const [index, account] of [sender, recipient, outsider].entries()) {
    const { error } = await account.client.from('profiles').upsert(profiles[index]);
    assert.ifError(error);
  }

  const { data: recipientLookup, error: recipientLookupError } = await sender.client.from('profiles')
    .select('id, username, display_name')
    .eq('username', profiles[1].username)
    .maybeSingle();
  assert.ifError(recipientLookupError);
  assert.deepEqual(recipientLookup, {
    id: recipient.id,
    username: profiles[1].username,
    display_name: profiles[1].display_name,
  }, 'A handle lookup should return only the target account identity needed for confirmation');
  const { data: missingRecipient, error: missingRecipientError } = await sender.client.from('profiles')
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
  const media = await finalizeResponse.json();
  assert.equal(media.mediaPath, `${sender.id}/${mediaDropId}/${uploadId}`);
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
    content: '',
    teaser: [],
    status: 'delivered',
    dispatched_at: sentAt,
    delivered_at: sentAt,
    payload_kind: 'gif',
    delivery_mode: 'instant',
    media_path: media.mediaPath,
    media_mime_type: media.mediaMimeType,
    media_size_bytes: media.mediaSizeBytes,
  });
  assert.ifError(mediaInsertError);

  const { error: retryStageError } = await sender.client.storage.from('drop-media').upload(stagedPath, new Blob([gifBytes], { type: 'image/gif' }), {
    contentType: 'image/gif',
    upsert: false,
  });
  assert.ifError(retryStageError);
  const retryFinalizeResponse = await fetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind: 'gif' }),
  });
  assert.equal(retryFinalizeResponse.status, 200, 'An exact retry should reuse the linked GIF');
  assert.deepEqual(await retryFinalizeResponse.json(), media, 'An exact retry should return the original media path and metadata');
  const { data: retryStagedObjects, error: retryStagedLookupError } = await admin.storage.from('drop-media').list(`${sender.id}/pending/${mediaDropId}`, { search: uploadId });
  assert.ifError(retryStagedLookupError);
  assert.equal(retryStagedObjects?.length, 0, 'An exact retry should remove the duplicate staging object');

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

  console.log('PASS: three disposable local accounts authenticate and create profiles.');
  console.log('PASS: sender and recipient read the drop; an unrelated account cannot read or edit it.');
  console.log('PASS: the recipient reacts; the sender sees the reaction; unrelated reaction access is denied.');
  console.log('PASS: the local finalize route validates a GIF, safely reuses an exact retry, and keeps media limited to participants.');
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
