import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCAL_SUPABASE_PORTS,
  assertLocalSupabasePortsAreSafe,
  createBrowserSmokeEnvironment,
  loadExpectedLocalSupabaseProjectId,
  loadLocalSupabaseValues,
  parseLocalSupabaseKongInspection,
  parseLocalSupabaseProjectId,
  parseLsofOwners,
  parsePowerShellOwners,
  resolveLocalSupabaseValues,
  validateLocalSupabaseUrl,
} from '../scripts/localSupabaseEndpointGuard.mjs';

test('parses synthetic lsof process records without exposing command arguments', () => {
  assert.deepEqual(parseLsofOwners('p120\ncssh\np120\ncssh\np121\nccom.docker.backend\n'), [
    { pid: '120', processName: 'ssh' },
    { pid: '121', processName: 'com.docker.backend' },
  ]);
  assert.throws(() => parseLsofOwners('p120\n'), /could not verify/i);
});

test('parses synthetic Windows listener owners', () => {
  assert.deepEqual(parsePowerShellOwners('120|ssh\r\n121|com.docker.backend\r\n'), [
    { pid: '120', processName: 'ssh' },
    { pid: '121', processName: 'com.docker.backend' },
  ]);
  assert.throws(() => parsePowerShellOwners('120|'), /could not verify/i);
});

test('checks only explicitly requested ports and requires exact container verification for known forwarders', async () => {
  const calls = [];
  await assertLocalSupabasePortsAreSafe({
    expectedProjectId: 'drop',
    inspectPort: (port) => { calls.push(port); return []; },
    inspectProjectContainer: (projectId, port) => projectId === 'drop' && port === 54321,
  });
  assert.deepEqual(calls, DEFAULT_LOCAL_SUPABASE_PORTS);

  calls.length = 0;
  await assertLocalSupabasePortsAreSafe({
    ports: [55321],
    expectedProjectId: 'drop-qa-isolated-20261025-q7m4',
    inspectPort: (port) => {
      calls.push(port);
      return [{ pid: '120', processName: 'ssh' }];
    },
    inspectProjectContainer: (projectId, port) => projectId === 'drop-qa-isolated-20261025-q7m4' && port === 55321,
  });
  assert.deepEqual(calls, [55321], 'An explicitly configured API port is checked without blocking unrelated default ports.');

  await assert.rejects(
    assertLocalSupabasePortsAreSafe({
      ports: [55321],
      expectedProjectId: 'drop-qa-isolated-20261025-q7m4',
      inspectPort: () => [{ pid: '321', processName: 'ssh' }],
      inspectProjectContainer: () => false,
    }),
    /no verified matching project container/i,
  );
  await assert.rejects(
    assertLocalSupabasePortsAreSafe({
      ports: [55321],
      inspectPort: () => [{ pid: '323', processName: 'SSH.EXE' }],
      inspectProjectContainer: () => true,
    }),
    /expected local Supabase project/i,
  );
  await assert.rejects(
    assertLocalSupabasePortsAreSafe({
      ports: [55321],
      expectedProjectId: 'drop-qa-isolated-20261025-q7m4',
      inspectPort: () => [{ pid: '322', processName: 'custom-forwarder' }],
      inspectProjectContainer: () => true,
    }),
    /unrecognized listener owner/i,
  );

  await assert.rejects(
    assertLocalSupabasePortsAreSafe({
      ports: [55321],
      expectedProjectId: 'drop-qa-isolated-20261025-q7m4',
      inspectPort: () => [],
      inspectProjectContainer: () => false,
    }),
    /no verified matching project container/i,
    'A missing lsof owner must still have a matching running project container before the API request can continue.',
  );
});

test('requires the exact running Supabase Kong project label and loopback host-port mapping', () => {
  const projectId = 'drop-qa-isolated-20261025-q7m4';
  const valid = `/supabase_kong_${projectId}|running|${projectId}|127.0.0.1,55321;`;
  assert.equal(parseLocalSupabaseKongInspection(valid, { expectedProjectId: projectId, port: 55321 }), true);
  for (const output of [
    `/supabase_kong_other|running|${projectId}|127.0.0.1,55321;`,
    `/supabase_kong_${projectId}|exited|${projectId}|127.0.0.1,55321;`,
    `/supabase_kong_${projectId}|running|other|127.0.0.1,55321;`,
    `/supabase_kong_${projectId}|running|${projectId}|0.0.0.0,55321;`,
    `/supabase_kong_${projectId}|running|${projectId}|127.0.0.1,55322;`,
    `/supabase_kong_${projectId}|running|${projectId}|`,
  ]) assert.equal(parseLocalSupabaseKongInspection(output, { expectedProjectId: projectId, port: 55321 }), false);
});

test('loads an explicit expected project ID or falls back to the local Supabase config', async () => {
  const configFilePath = '/synthetic/supabase/config.toml';
  assert.equal(parseLocalSupabaseProjectId('project_id = "drop"\n'), 'drop');
  assert.equal(await loadExpectedLocalSupabaseProjectId({
    configFilePath,
    readConfigFile: async () => 'project_id = "drop"\n',
  }), 'drop');
  assert.equal(await loadExpectedLocalSupabaseProjectId({
    environment: { DROP_LOCAL_SUPABASE_EXPECTED_PROJECT_ID: 'drop-qa-isolated-20261025-q7m4' },
    configFilePath,
    readConfigFile: async () => { throw new Error('the config should not be read'); },
  }), 'drop-qa-isolated-20261025-q7m4');
  await assert.rejects(
    loadExpectedLocalSupabaseProjectId({
      environment: { DROP_LOCAL_SUPABASE_EXPECTED_PROJECT_ID: 'drop;docker ps' },
      configFilePath,
    }),
    /expected local Supabase project/i,
  );
  assert.throws(() => parseLocalSupabaseProjectId('project_id = "one"\nproject_id = "two"'), /expected local Supabase project/i);
});

test('fails closed when listener inspection cannot determine process ownership', async () => {
  await assert.rejects(
    assertLocalSupabasePortsAreSafe({ inspectPort: () => { throw new Error('private lsof stderr'); } }),
    (error) => /could not verify/i.test(error.message) && !/private lsof stderr/i.test(error.message),
  );
});

test('uses process environment overrides before .env.local fallbacks', () => {
  const resolved = resolveLocalSupabaseValues({
    environment: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_SERVICE_ROLE_KEY: 'env-secret',
    },
    envFileContents: [
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY="file-anon"',
      'SUPABASE_SERVICE_ROLE_KEY=file-secret',
    ].join('\n'),
  });
  assert.deepEqual(resolved, {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'file-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'env-secret',
  });
});

test('does not open .env.local when all three values are injected by the process', async () => {
  let fileRead = false;
  const values = await loadLocalSupabaseValues({
    environment: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-only',
      SUPABASE_SERVICE_ROLE_KEY: 'server-test-only',
    },
    envFilePath: '/not-read/.env.local',
    readEnvFile: async () => { fileRead = true; throw new Error('file access should not happen'); },
  });
  assert.equal(fileRead, false);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:55321');
  assert.equal(values.SUPABASE_SERVICE_ROLE_KEY, 'server-test-only');
});

test('builds a browser environment without passing Supabase secrets', () => {
  const browserEnv = createBrowserSmokeEnvironment({
    environment: {
      PATH: '/usr/bin',
      HOME: '/tmp/test-home',
      TMPDIR: '/tmp',
      LANG: 'en_US.UTF-8',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-only',
      SUPABASE_SERVICE_ROLE_KEY: 'server-test-only',
    },
    temporaryDirectory: '/tmp/drop-browser',
  });
  assert.equal(browserEnv.PATH, '/usr/bin');
  assert.equal(browserEnv.HOME, '/tmp/test-home');
  assert.equal(browserEnv.TMPDIR, '/tmp/drop-browser');
  assert.equal(browserEnv.LANG, 'en_US.UTF-8');
  assert.equal(browserEnv.NEXT_PUBLIC_SUPABASE_URL, undefined);
  assert.equal(browserEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, undefined);
  assert.equal(browserEnv.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test('validates local-only HTTP origins and supports an explicitly remapped API port', () => {
  assert.equal(validateLocalSupabaseUrl('http://127.0.0.1:55321').port, '55321');
  assert.equal(validateLocalSupabaseUrl('http://[::1]:55321/').hostname, '[::1]');
  for (const value of [
    'https://127.0.0.1:54321',
    'http://example.test:54321',
    'http://0.0.0.0:54321',
    'http://127.0.0.1',
    'http://user:secret@127.0.0.1:54321',
    'http://127.0.0.1:54321/path',
    'http://127.0.0.1:54321/?token=secret',
  ]) assert.throws(() => validateLocalSupabaseUrl(value), (error) => !error.message.includes('secret'));
});
