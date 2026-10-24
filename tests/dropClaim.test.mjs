import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDropClaimUrl,
  createDropClaimSharePayload,
  createDropClaimToken,
  isDropClaimToken,
  readDropClaimTokenFromFragment,
  resolveDropClaimInviteResult,
} from '../lib/dropClaim.ts';

const token = 'a'.repeat(64);

test('creates a 256-bit lowercase hex claim token from secure random bytes', () => {
  const generated = createDropClaimToken({ getRandomValues(bytes) { bytes.fill(0xab); return bytes; } });
  assert.equal(generated, 'ab'.repeat(32));
  assert.equal(isDropClaimToken(generated), true);
  assert.equal(isDropClaimToken('a'.repeat(63)), false);
  assert.equal(isDropClaimToken('g'.repeat(64)), false);
});

test('keeps the claim token in the URL fragment and excludes it from query parameters', () => {
  const url = buildDropClaimUrl('https://drop.example/path?campaign=spring', token);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/claim');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, `#token=${token}`);
  assert.equal(readDropClaimTokenFromFragment(parsed.hash), token);
});

test('rejects malformed fragments, duplicate values, and tokens placed in the query', () => {
  assert.equal(readDropClaimTokenFromFragment(''), null);
  assert.equal(readDropClaimTokenFromFragment(`#token=${'b'.repeat(64)}&token=${'c'.repeat(64)}`), null);
  assert.equal(readDropClaimTokenFromFragment(`#token=${'x'.repeat(64)}`), null);
  assert.equal(buildDropClaimUrl('javascript:alert(1)', token), null);
  assert.equal(buildDropClaimUrl('https://drop.example', 'short'), null);
});

test('uses generic share copy with no message or recipient details', () => {
  const payload = createDropClaimSharePayload(`https://drop.example/claim#token=${token}`);
  assert.deepEqual(payload, {
    title: 'A private drop is waiting on Drop',
    text: 'A friend left you a private drop on Drop. Open the link to claim it.',
    url: `https://drop.example/claim#token=${token}`,
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret subject|private message|@recipient|caption|photo|gif/i);
});

test('maps SQLSTATE 42501 to generic unavailable copy without exposing error details or token', () => {
  const rawMessage = `permission denied for invite token ${token}`;
  const result = resolveDropClaimInviteResult({
    data: null,
    error: { code: '42501', message: rawMessage },
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'This invite is expired, already claimed, or no longer available. Ask the sender to share a fresh link.',
  });
  assert.equal(JSON.stringify(result).includes(rawMessage), false);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('keeps other RPC errors, unknown errors, and caught exceptions retryable', () => {
  const retryable = {
    ok: false,
    error: 'We couldn’t verify this invite right now. Your invite link is still here—try again.',
  };
  const errors = [
    { code: '08006', message: `service unavailable for ${token}` },
    { message: `unexpected failure for ${token}` },
    true,
  ];

  for (const error of errors) {
    const result = resolveDropClaimInviteResult({ data: null, error });
    assert.deepEqual(result, retryable);
    assert.equal(JSON.stringify(result).includes(token), false);
    if (typeof error === 'object' && error !== null && 'message' in error) {
      assert.equal(JSON.stringify(result).includes(error.message), false);
    }
  }
});

test('keeps empty or invalid successful claim results generic', () => {
  const genericUnavailable = {
    ok: false,
    error: 'This invite is expired, already claimed, or no longer available. Ask the sender to share a fresh link.',
  };

  for (const data of [null, undefined, '', '   ', 42, {}]) {
    assert.deepEqual(resolveDropClaimInviteResult({ data, error: null }), genericUnavailable);
  }
});

test('returns the letter ID for a successful claim result', () => {
  assert.deepEqual(resolveDropClaimInviteResult({ data: 'drop-123', error: null }), {
    ok: true,
    letterId: 'drop-123',
  });
});
