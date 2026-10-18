import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DROP_MEDIA_BYTES, normalizeDropRecipient, validateDropMedia } from '../lib/dropValidation.ts';

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

test('rejects missing, unsafe, empty, and oversized files', () => {
  assert.match(validateDropMedia(null) ?? '', /Choose/);
  assert.match(validateDropMedia({ type: 'image/svg+xml', size: 100 }) ?? '', /JPG/);
  assert.match(validateDropMedia({ type: 'image/png', size: 0 }) ?? '', /8 MB/);
  assert.match(validateDropMedia({ type: 'image/png', size: MAX_DROP_MEDIA_BYTES + 1 }) ?? '', /8 MB/);
});
