import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllPages, fetchPagedMailbox } from '../lib/fetchAllPages.ts';
import { getLiveReactionUpdate } from '../lib/liveReactionState.ts';
import { mergeDropReactions } from '../lib/mergeDropReactions.ts';

test('reads every full page and stops after the final partial page', async () => {
  const ranges = [];
  const rows = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    if (from === 0) return Array.from({ length: 1000 }, (_, index) => index);
    return [1000];
  });

  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1), 1000);
});

test('stops and reports unavailable data after a page read fails', async () => {
  const ranges = [];
  const rows = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    return from === 0 ? Array.from({ length: 1000 }, (_, index) => index) : null;
  });

  assert.equal(rows, null);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test('loads reactions for mailbox rows beyond the first 1,000 in bounded batches', async () => {
  const ranges = [];
  const reactionBatches = [];
  const mailbox = await fetchPagedMailbox(
    async (from, to) => {
      ranges.push([from, to]);
      if (from === 0) return Array.from({ length: 1000 }, (_, index) => ({ id: 'drop-' + index }));
      return [{ id: 'drop-1000' }];
    },
    async (letterIds) => {
      reactionBatches.push(letterIds);
      return letterIds.includes('drop-1000')
        ? [{ letter_id: 'drop-1000', emoji: '🔥' }]
        : [];
    },
  );

  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(mailbox.letters.length, 1001);
  assert.equal(reactionBatches.length, 11);
  assert.ok(reactionBatches.every((batch) => batch.length <= 100));
  assert.deepEqual(reactionBatches.flat(), mailbox.letters.map((letter) => letter.id));
  assert.ok(reactionBatches.at(-1).includes('drop-1000'));
  assert.deepEqual(mailbox.reactions, [{ letter_id: 'drop-1000', emoji: '🔥' }]);
  assert.equal(mergeDropReactions(mailbox.letters, mailbox.reactions).at(-1).reaction, '🔥');
});

test('does not return a partial mailbox when a later letter page fails', async () => {
  let reactionReads = 0;
  const mailbox = await fetchPagedMailbox(
    async (from) => from === 0 ? Array.from({ length: 1000 }, (_, index) => ({ id: 'drop-' + index })) : null,
    async () => {
      reactionReads += 1;
      return [];
    },
  );

  assert.equal(mailbox, null);
  assert.equal(reactionReads, 0);
});

test('keeps mailbox letters available when a reaction batch fails without publishing a partial snapshot', async () => {
  const mailbox = await fetchPagedMailbox(
    async () => Array.from({ length: 101 }, (_, index) => ({ id: 'drop-' + index })),
    async (letterIds) => letterIds[0] === 'drop-100'
      ? null
      : [{ letter_id: letterIds[0], emoji: '🔥' }],
  );

  assert.equal(mailbox.letters.length, 101);
  assert.equal(mailbox.reactions, null);
});

test('recovery after a failed reaction read does not re-announce an old reaction', async () => {
  const drop = { id: 'old-drop', direction: 'sent', sample: false, status: 'delivered', subject: 'old-drop' };
  const oldReaction = { letter_id: drop.id, emoji: '💜', updated_at: '2026-10-20T12:00:00.000Z' };
  const readLetters = async () => [drop];
  const load = (readReactions) => fetchPagedMailbox(readLetters, readReactions);

  const initial = await load(async () => [oldReaction]);
  assert.ok(initial);
  assert.ok(initial.reactions);
  const initialUpdate = getLiveReactionUpdate(mergeDropReactions(initial.letters, initial.reactions), null);
  assert.deepEqual(initialUpdate.reactions, []);

  let previousReactionMap = initialUpdate.reactionMap;
  const unavailable = await load(async () => null);
  assert.ok(unavailable);
  assert.equal(unavailable.letters.length, 1);
  assert.equal(unavailable.reactions, null);

  const recovered = await load(async () => [oldReaction]);
  assert.ok(recovered);
  assert.ok(recovered.reactions);
  const recoveryUpdate = getLiveReactionUpdate(
    mergeDropReactions(recovered.letters, recovered.reactions),
    previousReactionMap,
  );
  assert.deepEqual(recoveryUpdate.reactions, []);
});

test('treats rejected letter pages and reaction batches as unavailable mailbox reads', async () => {
  const letterPageFailure = await fetchPagedMailbox(
    async (from) => {
      if (from === 0) return Array.from({ length: 1000 }, (_, index) => ({ id: 'drop-' + index }));
      throw new Error('later page unavailable');
    },
    async () => [],
  );
  const reactionFailure = await fetchPagedMailbox(
    async () => [{ id: 'drop-1' }],
    async () => { throw new Error('reaction read unavailable'); },
  );

  assert.equal(letterPageFailure, null);
  assert.deepEqual(reactionFailure.letters, [{ id: 'drop-1' }]);
  assert.equal(reactionFailure.reactions, null);
});
