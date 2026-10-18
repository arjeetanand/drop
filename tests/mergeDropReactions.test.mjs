import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDropReactions } from '../lib/mergeDropReactions.ts';

test('attaches participant-visible reactions to matching drops only', () => {
  const letters = [
    { id: 'sent-1', subject: 'A surprise' },
    { id: 'received-1', subject: 'A note' },
  ];
  const merged = mergeDropReactions(letters, [{ letter_id: 'sent-1', emoji: '🫶' }]);

  assert.deepEqual(merged, [
    { id: 'sent-1', subject: 'A surprise', reaction: '🫶' },
    { id: 'received-1', subject: 'A note' },
  ]);
  assert.equal(letters[0].reaction, undefined);
});
