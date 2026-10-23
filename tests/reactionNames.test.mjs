import assert from 'node:assert/strict';
import test from 'node:test';
import { getReactionName } from '../lib/reactionNames.ts';

test('gives each reaction a stable spoken name for assistive technology', () => {
  assert.deepEqual([
    getReactionName('💜'),
    getReactionName('🔥'),
    getReactionName('😂'),
    getReactionName('🥹'),
    getReactionName('🫶'),
  ], [
    'a purple heart',
    'fire',
    'a face with tears of joy',
    'a face holding back tears',
    'heart hands',
  ]);
});

test('uses a neutral spoken name for missing or unknown reactions', () => {
  assert.equal(getReactionName(), 'a reaction');
  assert.equal(getReactionName('👀'), 'a reaction');
});
