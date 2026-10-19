import assert from 'node:assert/strict';
import test from 'node:test';
import { isDropPayloadKindCompatibleWithMedia, isDropRecipientConfirmed, MAX_DROP_MEDIA_BYTES, normalizeDropRecipient, validateDropMedia } from '../lib/dropValidation.ts';

test('accepts supported image types within the upload limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.equal(validateDropMedia({ type, size: MAX_DROP_MEDIA_BYTES }), null);
  }
});

test('normalizes valid recipient handles and rejects display names', () => {
  assert.equal(normalizeDropRecipient(' @Sunny.Stories '), 'sunny.stories');
  assert.equal(normalizeDropRecipient('Eleanor Hartwell'), null);
  assert.equal(normalizeDropRecipient('@x'), null);
});

test('only confirms the same account for the currently normalized handle', () => {
  const confirmation = { id: 'user-1', username: 'sunny.stories' };
  assert.equal(isDropRecipientConfirmed(confirmation, ' @Sunny.Stories '), true);
  assert.equal(isDropRecipientConfirmed(confirmation, '@other.person'), false);
  assert.equal(isDropRecipientConfirmed(confirmation, 'invalid name'), false);
  assert.equal(isDropRecipientConfirmed(null, '@sunny.stories'), false);
});

test('keeps the payload kind aligned with a saved attachment', () => {
  assert.equal(isDropPayloadKindCompatibleWithMedia('image', { type: 'image/png' }), true);
  assert.equal(isDropPayloadKindCompatibleWithMedia('gif', { type: 'image/gif' }), true);
  assert.equal(isDropPayloadKindCompatibleWithMedia('text', { type: 'image/png' }), false);
  assert.equal(isDropPayloadKindCompatibleWithMedia('gif', { type: 'image/png' }), false);
  assert.equal(isDropPayloadKindCompatibleWithMedia('image', { type: 'image/gif' }), false);
  for (const kind of ['text', 'image', 'gif']) {
    assert.equal(isDropPayloadKindCompatibleWithMedia(kind, null), true);
  }
});

test('rejects missing, unsafe, empty, and oversized files', () => {
  assert.match(validateDropMedia(null) ?? '', /Choose/);
  assert.match(validateDropMedia({ type: 'image/svg+xml', size: 100 }) ?? '', /JPG/);
  assert.match(validateDropMedia({ type: 'image/png', size: 0 }) ?? '', /8 MB/);
  assert.match(validateDropMedia({ type: 'image/png', size: MAX_DROP_MEDIA_BYTES + 1 }) ?? '', /8 MB/);
});
