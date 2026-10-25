import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../scripts/local-photo-gif-claim-smoke.mjs', import.meta.url));
const explicitSmokeEnv = {
  DROP_SMOKE_SUPABASE_URL: 'http://127.0.0.1:55321',
  DROP_SMOKE_SUPABASE_ANON_KEY: 'smoke-anon-test-key',
  DROP_SMOKE_SUPABASE_SERVICE_ROLE_KEY: 'smoke-service-role-test-key',
  DROP_SMOKE_EXPECTED_PROJECT_ID: 'drop-smoke-guard-test',
  DROP_SMOKE_APP_PORT: '55504',
};

function runSmoke(environment) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || tmpdir(),
      TMPDIR: process.env.TMPDIR || tmpdir(),
      ...environment,
    },
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
}

test('local photo/GIF smoke requires dedicated process environment values', () => {
  const result = runSmoke({});

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set DROP_SMOKE_SUPABASE_URL in the process environment/);
});

test('local photo/GIF smoke rejects non-loopback URLs before starting the app or contacting Supabase', () => {
  const result = runSmoke({
    ...explicitSmokeEnv,
    DROP_SMOKE_SUPABASE_URL: 'https://supabase.example.test:55321',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /configured Supabase URL must be a local HTTP origin/i);
  assert.doesNotMatch(result.stderr, /smoke-service-role-test-key|smoke-anon-test-key/);
});

test('local photo/GIF smoke stops at listener ownership verification before creating a client', async () => {
  const emptyPath = await mkdtemp(join(tmpdir(), 'drop-photo-gif-claim-empty-path-'));
  try {
    const result = runSmoke({ ...explicitSmokeEnv, PATH: emptyPath });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not verify listener owners for local Supabase port 55321/);
    assert.doesNotMatch(result.stderr, /smoke-service-role-test-key|smoke-anon-test-key/);
  } finally {
    await rm(emptyPath, { recursive: true, force: true });
  }
});
