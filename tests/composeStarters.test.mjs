import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPOSE_STARTERS, getComposeStarterValue } from '../lib/composeStarters.ts';

test('provides a small set of one-to-one starters for each compose format', () => {
  for (const kind of ['text', 'image', 'gif']) {
    assert.equal(COMPOSE_STARTERS[kind].length, 3);
    assert.ok(COMPOSE_STARTERS[kind].every((starter) => starter.trim().length > 0));
  }
});

test('a starter fills only an empty or whitespace-only note', () => {
  const starter = COMPOSE_STARTERS.text[0];

  assert.equal(getComposeStarterValue('', starter), starter);
  assert.equal(getComposeStarterValue('  \n  ', starter), starter);
});

test('a starter never replaces existing text', () => {
  const existingText = '  Already wrote a personal note.  ';

  assert.equal(getComposeStarterValue(existingText, COMPOSE_STARTERS.gif[0]), existingText);
});
