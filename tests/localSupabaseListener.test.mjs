import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTrustedLocalSupabaseListener,
  inspectActiveDockerEndpoint,
  parseLsofListeners,
} from '../scripts/localSupabaseListener.mjs';

test('parses process names and ids from lsof field output', () => {
  assert.deepEqual(parseLsofListeners('p16815\ncssh\nf11\np42\ncdocker-proxy\nf9\n'), [
    { pid: '16815', command: 'ssh' },
    { pid: '42', command: 'docker-proxy' },
  ]);
});

test('rejects SSH listeners that are not Rancher Desktop local forwarders', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '16815', command: 'ssh' }],
    inspectCommand: () => 'ssh -L 54321:remote.example:54321 user@remote.example',
  }), /54321.*SSH.*16815/i);
});

test('rejects a remote SSH tunnel with Rancher markers in unrelated arguments', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '16815', command: 'ssh' }],
    inspectCommand: () => 'ssh -L 54321:remote.example:54321 -o ControlPath=/Users/test/Library/Application Support/rancher-desktop/lima/0/ssh.sock user@remote.example',
    dockerEndpoint: 'unix:///Users/test/.rd/docker.sock',
    inspectContainers: () => ['supabase_kong_drop'],
  }), /54321.*SSH.*16815/i);
});

test('rejects unrecognized listeners because locality cannot be established', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54324, {
    inspect: () => [{ pid: '991', command: 'node' }],
  }), /cannot verify.*54324.*node.*991/i);
});

test('allows a listener owned by Docker Desktop', () => {
  assert.doesNotThrow(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '51', command: 'com.docker.backend' }],
    dockerEndpoint: 'unix:///var/run/docker.sock',
    inspectContainers: () => ['supabase_kong_drop'],
  }));
});

test('allows Rancher Desktop SSH forwarding only with a local context and matching Supabase service', () => {
  assert.doesNotThrow(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '16815', command: 'ssh' }],
    inspectCommand: () => 'ssh: /Users/test/Library/Application Support/rancher-desktop/lima/0/ssh.sock [mux]',
    dockerEndpoint: 'unix:///Users/test/.rd/docker.sock',
    inspectContainers: () => ['supabase_kong_drop'],
  }));
  assert.doesNotThrow(() => assertTrustedLocalSupabaseListener(54324, {
    inspect: () => [{ pid: '16815', command: 'ssh' }],
    inspectCommand: () => 'ssh: /Users/test/Library/Application Support/rancher-desktop/lima/0/ssh.sock [mux]',
    dockerEndpoint: 'unix:///Users/test/.rd/docker.sock',
    inspectContainers: () => ['supabase_inbucket_drop'],
  }));
});

test('rejects a local runtime port with no matching Supabase container', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '51', command: 'com.docker.backend' }],
    dockerEndpoint: 'unix:///var/run/docker.sock',
    inspectContainers: () => ['some-other-container'],
  }), /could not verify.*Supabase service.*54321/i);
});

test('rejects another local Supabase project even when it publishes the same port', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '51', command: 'com.docker.backend' }],
    dockerEndpoint: 'unix:///var/run/docker.sock',
    inspectContainers: () => ['supabase_kong_another_project'],
  }), /could not verify.*Supabase service.*54321/i);
});

test('refuses trusted container listeners when Docker uses a remote context', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [{ pid: '51', command: 'com.docker.backend' }],
    dockerEndpoint: 'ssh://docker-host.example',
    inspectContainers: () => ['supabase_kong_drop'],
  }), /cannot verify.*local Docker context.*54321/i);
});

test('rejects conflicting Docker context and DOCKER_HOST endpoints', () => {
  assert.throws(() => inspectActiveDockerEndpoint({
    dockerContext: 'rancher-desktop',
    dockerHost: 'unix:///other/docker.sock',
    inspectContext: () => 'unix:///Users/test/.rd/docker.sock',
  }), /different endpoints/i);
});

test('refuses to continue when the port owner cannot be established', () => {
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => [],
  }), /could not verify.*54321/i);
  assert.throws(() => assertTrustedLocalSupabaseListener(54321, {
    inspect: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  }), /could not inspect.*54321/i);
});
