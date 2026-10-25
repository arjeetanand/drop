import assert from 'node:assert/strict';
import test from 'node:test';
import { getDropMediaAccessibleName } from '../lib/dropMediaAccessibility.ts';

test('attached media has a meaningful accessible name for photos and GIFs', () => {
  assert.equal(getDropMediaAccessibleName('image'), 'Attached photo');
  assert.equal(getDropMediaAccessibleName('gif'), 'Attached GIF');
});
