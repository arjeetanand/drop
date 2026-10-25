import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import {
  assertLocalSupabasePortsAreSafe,
  loadExpectedLocalSupabaseProjectId,
  loadLocalSupabaseValues,
  validateLocalSupabaseUrl,
} from './localSupabaseEndpointGuard.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in the process environment; this script does not read .env files.`);
  return value;
};

function assertLoopbackRequestUrl(input) {
  const rawUrl = input instanceof Request ? input.url : input;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The smoke test refused a request with an invalid URL.');
  }
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || !url.port) {
    throw new Error('The smoke test refused a request outside its explicit loopback service URL.');
  }
}

async function loopbackFetch(input, init = {}) {
  assertLoopbackRequestUrl(input);
  return fetch(input, { ...init, redirect: 'error' });
}

const localEnv = await loadLocalSupabaseValues({
  environment: {
    NEXT_PUBLIC_SUPABASE_URL: requiredEnv('DROP_SMOKE_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredEnv('DROP_SMOKE_SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: requiredEnv('DROP_SMOKE_SUPABASE_SERVICE_ROLE_KEY'),
  },
});
const localSupabaseUrl = validateLocalSupabaseUrl(localEnv.NEXT_PUBLIC_SUPABASE_URL);
const expectedProjectId = await loadExpectedLocalSupabaseProjectId({
  environment: {
    DROP_LOCAL_SUPABASE_EXPECTED_PROJECT_ID: requiredEnv('DROP_SMOKE_EXPECTED_PROJECT_ID'),
  },
  configFilePath: resolve(root, 'supabase/config.toml'),
});
await assertLocalSupabasePortsAreSafe({
  ports: [Number(localSupabaseUrl.port)],
  expectedProjectId,
});

const supabaseUrl = localSupabaseUrl.origin;
const anonKey = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = localEnv.SUPABASE_SERVICE_ROLE_KEY;
if (anonKey === serviceRoleKey) throw new Error('The local anon key and service-role key must be different values.');

const appPortRaw = process.env.DROP_SMOKE_APP_PORT?.trim() || '5004';
if (!/^\d{1,5}$/.test(appPortRaw)) throw new Error('DROP_SMOKE_APP_PORT must be a TCP port number.');
const appPort = Number(appPortRaw);
if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535 || appPort === Number(supabaseUrl.port)) {
  throw new Error('DROP_SMOKE_APP_PORT must be an available non-privileged port distinct from the Supabase port.');
}

const fixtures = {
  image: { path: resolve(root, 'public/demo-cat.png'), mimeType: 'image/png' },
  gif: { path: resolve(root, 'public/demo-cat.gif'), mimeType: 'image/gif' },
};
for (const fixture of Object.values(fixtures)) await access(fixture.path);
await access(resolve(root, 'node_modules/next/dist/bin/next'));

function ensureNoError(error, message) {
  if (error) {
    const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,32}$/.test(error.code) ? ` (${error.code})` : '';
    throw new Error(`${message}${code}`);
  }
}

function assertRpcDenied({ data, error }, message) {
  assert.ok(error, `${message}: expected an authorization error`);
  assert.equal(error.code, '42501', `${message}: expected SQLSTATE 42501`);
  assert.equal(data, null, `${message}: a denied claim must not return a drop ID`);
}

async function assertPortFree(port) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject).listen(port, '127.0.0.1', resolveListen);
  }).catch((error) => {
    if (error?.code === 'EADDRINUSE') throw new Error(`The local smoke app port ${port} is already in use.`);
    throw error;
  });
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function createIsolatedAppProject() {
  const temporaryProject = await mkdtemp(join(tmpdir(), 'drop-photo-gif-claim-smoke-'));
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
  return { temporaryProject, projectRoot };
}

let app;
let appSpawnError;
let temporaryProject;
const createdUserIds = [];
const createdLetterIds = new Set();
const createdStoragePaths = new Set();
const admin = createClient(supabaseUrl.href, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: loopbackFetch },
});

function client(key = anonKey) {
  return createClient(supabaseUrl.href, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: loopbackFetch },
  });
}

async function startApp() {
  await assertPortFree(appPort);
  const isolated = await createIsolatedAppProject();
  temporaryProject = isolated.temporaryProject;
  const env = Object.fromEntries(Object.entries({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    WATCHPACK_POLLING: 'true',
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl.href,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0));
  app = spawn(process.execPath, [
    resolve(root, 'node_modules/next/dist/bin/next'),
    'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(appPort),
  ], {
    cwd: isolated.projectRoot,
    env,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  app.on('error', (error) => { appSpawnError = error; });
  const appUrl = `http://127.0.0.1:${appPort}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (appSpawnError) throw new Error('The isolated local Next.js smoke app could not start.');
    if (app.exitCode !== null) throw new Error('The isolated local Next.js smoke app exited before becoming ready.');
    try {
      const response = await loopbackFetch(`${appUrl}/api/drop-media/finalize`, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return appUrl;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('The isolated local Next.js smoke app did not become ready within 60 seconds.');
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

function signalOwnedApp(signal) {
  if (!app) return;
  try {
    if (process.platform !== 'win32' && app.pid) process.kill(-app.pid, signal);
    else if (app.exitCode === null && app.signalCode === null) app.kill(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function appProcessGroupAlive() {
  if (process.platform === 'win32' || !app?.pid) return app?.exitCode === null && app?.signalCode === null;
  try {
    process.kill(-app.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function stopApp() {
  if (!app || appSpawnError) return true;
  try {
    signalOwnedApp('SIGTERM');
    const rootStopped = await waitForAppExit(5000);
    let groupStopped = !appProcessGroupAlive();
    for (let attempt = 0; !groupStopped && attempt < 50; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      groupStopped = !appProcessGroupAlive();
    }
    if (!rootStopped || !groupStopped) {
      signalOwnedApp('SIGKILL');
      if (!await waitForAppExit(1000)) return false;
      if (appProcessGroupAlive()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function createTestAccount(label) {
  const email = `drop-media-smoke-${label}-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  ensureNoError(error, `Could not create the disposable ${label} account`);
  const id = data.user?.id;
  if (!id) throw new Error(`The disposable ${label} account has no auth ID.`);
  createdUserIds.push(id);
  const account = client();
  const { data: sessionData, error: signInError } = await account.auth.signInWithPassword({ email, password });
  ensureNoError(signInError, `Could not sign in the disposable ${label} account`);
  if (sessionData.user?.id !== id || !sessionData.session?.access_token) {
    throw new Error(`The disposable ${label} account did not receive an authenticated session.`);
  }
  return { client: account, id, token: sessionData.session.access_token };
}

async function upsertProfile(account, displayName, username) {
  const { error } = await account.client.from('profiles').upsert({
    id: account.id,
    username,
    display_name: displayName,
    bio: '',
  });
  ensureNoError(error, `Could not create the disposable ${displayName} profile`);
}

async function assertMediaUnavailable(account, mediaDrop, phase) {
  const { data: row, error: rowError } = await account.client.from('letters')
    .select('id, content, media_path')
    .eq('id', mediaDrop.letterId)
    .maybeSingle();
  ensureNoError(rowError, `${phase}: the private row lookup failed`);
  assert.equal(row, null, `${phase}: the ${mediaDrop.payloadKind} row must remain private`);

  const { data: downloaded, error: downloadError } = await account.client.storage.from('drop-media').download(mediaDrop.mediaPath);
  assert.ok(downloadError && !downloaded, `${phase}: the ${mediaDrop.payloadKind} must not download`);
  const { data: signed, error: signedError } = await account.client.storage.from('drop-media').createSignedUrl(mediaDrop.mediaPath, 60);
  assert.ok(signedError && !signed, `${phase}: the ${mediaDrop.payloadKind} must not produce a signed URL`);
}

async function issueUnknownHandleMedia({ sender, appUrl, payloadKind, bytes, mimeType }) {
  const letterId = `smoke-${randomUUID()}`;
  const uploadId = randomUUID();
  const attemptId = randomUUID();
  const stagedPath = `${sender.id}/pending/${letterId}/${uploadId}/${attemptId}`;
  const expectedMediaPath = `${sender.id}/${letterId}/${uploadId}`;
  const token = randomBytes(32).toString('hex');
  const content = `Disposable local ${payloadKind} claim smoke.`;
  createdLetterIds.add(letterId);
  createdStoragePaths.add(stagedPath);
  createdStoragePaths.add(expectedMediaPath);

  const { error: uploadError } = await sender.client.storage.from('drop-media').upload(
    stagedPath,
    new Blob([bytes], { type: mimeType }),
    { contentType: mimeType, upsert: false },
  );
  ensureNoError(uploadError, `Could not upload the disposable ${payloadKind} fixture`);

  const response = await loopbackFetch(`${appUrl}/api/drop-media/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stagedPath, payloadKind }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `The real finalize route should accept the ${payloadKind} fixture`);
  const finalized = await response.json();
  assert.equal(finalized.mediaPath, expectedMediaPath, 'Finalization must bind media to this drop and owner');
  assert.equal(finalized.mediaMimeType, mimeType, 'Finalization must preserve the fixture MIME type');
  assert.equal(finalized.mediaSizeBytes, bytes.length, 'Finalization must report the exact validated byte length');

  const { data: stagedAfterFinalize, error: stagedAfterFinalizeError } = await admin.storage.from('drop-media').download(stagedPath);
  assert.ok(stagedAfterFinalizeError && !stagedAfterFinalize, 'The finalize route should remove the staged upload');

  const { data: issuedId, error: issueError } = await sender.client.rpc('issue_drop_media_claim_invite', {
    p_letter_id: letterId,
    p_subject: `Local ${payloadKind} claim smoke`,
    p_content: content,
    p_payload_kind: payloadKind,
    p_media_path: finalized.mediaPath,
    p_media_mime_type: finalized.mediaMimeType,
    p_media_size_bytes: finalized.mediaSizeBytes,
    p_token: token,
  });
  ensureNoError(issueError, `Could not issue the disposable ${payloadKind} claim`);
  assert.equal(issuedId, letterId, `The sender should issue the ${payloadKind} invite`);

  return {
    letterId,
    token,
    payloadKind,
    content,
    mediaPath: finalized.mediaPath,
    mimeType,
    mediaSizeBytes: finalized.mediaSizeBytes,
    bytes,
  };
}

async function assertPendingSenderStatus(sender, mediaDrop) {
  const { data, error } = await sender.client.from('letters')
    .select('id, content, recipient_id, status, delivery_mode, payload_kind, media_path')
    .eq('id', mediaDrop.letterId)
    .maybeSingle();
  ensureNoError(error, `The sender could not read pending ${mediaDrop.payloadKind} status`);
  assert.deepEqual(data, {
    id: mediaDrop.letterId,
    content: mediaDrop.content,
    recipient_id: null,
    status: 'claim_pending',
    delivery_mode: 'instant',
    payload_kind: mediaDrop.payloadKind,
    media_path: mediaDrop.mediaPath,
  }, `The sender should see the ${mediaDrop.payloadKind} waiting for a claim`);
}

async function assertClaimedDropAccess(account, expected, claimant) {
  const { data: row, error: rowError } = await account.client.from('letters')
    .select('id, content, recipient_id, status, delivery_mode, payload_kind, media_path')
    .eq('id', expected.letterId)
    .maybeSingle();
  ensureNoError(rowError, `The ${expected.payloadKind} participant row lookup failed`);
  assert.deepEqual(row, {
    id: expected.letterId,
    content: expected.content,
    recipient_id: claimant.id,
    status: 'delivered',
    delivery_mode: 'instant',
    payload_kind: expected.payloadKind,
    media_path: expected.mediaPath,
  }, `The sender and claimant should read the delivered ${expected.payloadKind}`);

  const { data: media, error: mediaError } = await account.client.storage.from('drop-media').download(expected.mediaPath);
  ensureNoError(mediaError, `The ${expected.payloadKind} participant download failed`);
  assert.ok(media, `The sender and claimant should download the ${expected.payloadKind}`);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), expected.bytes, `The retrieved ${expected.payloadKind} must match the repository fixture`);

  const { data: signed, error: signedError } = await account.client.storage.from('drop-media').createSignedUrl(expected.mediaPath, 60);
  ensureNoError(signedError, `The ${expected.payloadKind} participant could not create a short-lived URL`);
  assert.ok(signed?.signedUrl, `The ${expected.payloadKind} participant should receive a short-lived media URL`);
}

async function run() {
  const imageBytes = await readFile(fixtures.image.path);
  const gifBytes = await readFile(fixtures.gif.path);
  const appUrl = await startApp();
  const sender = await createTestAccount('sender');
  const claimant = await createTestAccount('claimant');
  const outsider = await createTestAccount('outsider');

  const senderUsername = `send_${randomBytes(5).toString('hex')}`;
  const outsiderUsername = `out_${randomBytes(5).toString('hex')}`;
  const claimantUsername = `claim_${randomBytes(5).toString('hex')}`;
  await upsertProfile(sender, 'Smoke Sender', senderUsername);
  await upsertProfile(outsider, 'Smoke Outsider', outsiderUsername);

  const { data: unknownHandleBeforeSend, error: unknownHandleBeforeSendError } = await sender.client.from('public_profiles')
    .select('id, username, display_name')
    .eq('username', claimantUsername)
    .maybeSingle();
  ensureNoError(unknownHandleBeforeSendError, 'The sender could not verify the unknown handle');
  assert.equal(unknownHandleBeforeSend, null, 'The recipient handle must not exist when the invite is issued');

  const drops = [
    await issueUnknownHandleMedia({ sender, appUrl, payloadKind: 'image', bytes: imageBytes, mimeType: fixtures.image.mimeType }),
    await issueUnknownHandleMedia({ sender, appUrl, payloadKind: 'gif', bytes: gifBytes, mimeType: fixtures.gif.mimeType }),
  ];

  for (const mediaDrop of drops) {
    await assertMediaUnavailable(claimant, mediaDrop, 'Before recipient profile setup');
    const { data: earlyClaim, error: earlyClaimError } = await claimant.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    assertRpcDenied({ data: earlyClaim, error: earlyClaimError }, `An unprofiled account cannot claim the ${mediaDrop.payloadKind}`);
    await assertPendingSenderStatus(sender, mediaDrop);
  }

  await upsertProfile(claimant, 'Smoke Claimant', claimantUsername);
  const { data: recipientHandle, error: recipientHandleError } = await sender.client.from('public_profiles')
    .select('id, username, display_name')
    .eq('username', claimantUsername)
    .maybeSingle();
  ensureNoError(recipientHandleError, 'The sender could not resolve the newly created recipient handle');
  assert.deepEqual(recipientHandle, {
    id: claimant.id,
    username: claimantUsername,
    display_name: 'Smoke Claimant',
  }, 'The sender should resolve only the recipient identity needed for confirmation');

  for (const mediaDrop of drops) {
    await assertMediaUnavailable(claimant, mediaDrop, 'After profile setup but before explicit claim');
    const { data: claimedId, error: claimError } = await claimant.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    ensureNoError(claimError, `The profiled recipient could not explicitly claim the ${mediaDrop.payloadKind}`);
    assert.equal(claimedId, mediaDrop.letterId, `The recipient should claim the ${mediaDrop.payloadKind}`);

    const { data: sameRecipientRetry, error: retryError } = await claimant.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    ensureNoError(retryError, `The ${mediaDrop.payloadKind} claimant retry should be idempotent for the same recipient`);
    assert.equal(sameRecipientRetry, mediaDrop.letterId, 'A same-recipient retry should return the original drop');

    await assertClaimedDropAccess(sender, mediaDrop, claimant);
    await assertClaimedDropAccess(claimant, mediaDrop, claimant);

    const { data: senderClaimedIds, error: senderClaimedIdsError } = await sender.client.rpc('get_sender_claimed_drop_ids');
    ensureNoError(senderClaimedIdsError, 'The sender claim-status lookup failed');
    assert.ok(senderClaimedIds?.some((entry) => entry.letter_id === mediaDrop.letterId), 'The sender status RPC should include the claimed drop');

    const { data: outsiderRow, error: outsiderRowError } = await outsider.client.from('letters')
      .select('id, content, media_path')
      .eq('id', mediaDrop.letterId)
      .maybeSingle();
    ensureNoError(outsiderRowError, 'The outsider row lookup failed');
    assert.equal(outsiderRow, null, `An outsider cannot read the claimed ${mediaDrop.payloadKind} row`);
    const { data: outsiderMedia, error: outsiderMediaError } = await outsider.client.storage.from('drop-media').download(mediaDrop.mediaPath);
    assert.ok(outsiderMediaError && !outsiderMedia, `An outsider cannot download the claimed ${mediaDrop.payloadKind}`);
    const { data: outsiderSignedUrl, error: outsiderSignedUrlError } = await outsider.client.storage.from('drop-media').createSignedUrl(mediaDrop.mediaPath, 60);
    assert.ok(outsiderSignedUrlError && !outsiderSignedUrl, `An outsider cannot produce a signed URL for the ${mediaDrop.payloadKind}`);
    const { data: outsiderReplay, error: outsiderReplayError } = await outsider.client.rpc('claim_drop_invite', { p_token: mediaDrop.token });
    assertRpcDenied({ data: outsiderReplay, error: outsiderReplayError }, `An outsider cannot replay the claimed ${mediaDrop.payloadKind} link`);
  }

  console.log('PASS: the real finalize endpoint validated repository PNG and GIF fixtures for an unknown-handle claim.');
  console.log('PASS: unclaimed rows and storage stay private before and after profile setup; the recipient explicitly claims both drops.');
  console.log('PASS: sender and recipient can read claimed media, sender status updates, and outsider access and replay are denied.');
}

async function cleanup() {
  let cleanupFailed = false;
  const appStopped = await stopApp();
  for (const path of createdStoragePaths) {
    try {
      const { error } = await admin.storage.from('drop-media').remove([path]);
      if (error && !/not found|does not exist/i.test(error.message)) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (createdLetterIds.size) {
    try {
      const { error } = await admin.from('letters').delete().in('id', [...createdLetterIds]);
      if (error) cleanupFailed = true;
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
    console.error('Cleanup could not remove every disposable account, row, object, or temporary app directory.');
    process.exitCode = 1;
  }
}

try {
  await run();
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL: ${error instanceof Error ? error.message : 'The local photo/GIF claim smoke failed.'}`);
} finally {
  await cleanup();
}
