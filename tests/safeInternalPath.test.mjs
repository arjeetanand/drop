import assert from 'node:assert/strict';
import test from 'node:test';
import { safeInternalPath } from '../lib/safeInternalPath.ts';

test('keeps a valid same-origin return path and its query', () => {
  assert.equal(safeInternalPath('/compose?letter=draft-1', 'https://drop.test'), '/compose?letter=draft-1');
});

test('rejects external, protocol-relative, and backslash return paths', () => {
  assert.equal(safeInternalPath('https://evil.test', 'https://drop.test'), null);
  assert.equal(safeInternalPath('//evil.test', 'https://drop.test'), null);
  assert.equal(safeInternalPath('/\\evil.test', 'https://drop.test'), null);
});
