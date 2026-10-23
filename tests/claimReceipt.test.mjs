import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSentReceiptPath,
  getClaimReceiptCopy,
  getClaimReceiptStatusLabel,
  mergeClaimReceiptStatus,
  mergeScopedClaimReceiptStatus,
  resolveSenderClaimReceiptResult,
  resolveClaimShareOutcome,
  resolveRequestedReceiptDraft,
} from '../lib/claimReceipt.ts';

function queryKeys(path) {
  return [...new URL(path, 'https://drop.test').searchParams.keys()].sort();
}

test('builds claim receipt paths with only typed display flags', () => {
  for (const shareOutcome of ['shared', 'copied']) {
    const path = buildSentReceiptPath({ kind: 'claim', letterId: 'drop-123', shareOutcome });
    const params = new URL(path, 'https://drop.test').searchParams;

    assert.deepEqual(Object.fromEntries(params), {
      letter: 'drop-123',
      sync: 'cloud',
      mode: 'instant',
      claim: '1',
      share: shareOutcome,
    });
    assert.deepEqual(queryKeys(path), ['claim', 'letter', 'mode', 'share', 'sync']);
    assert.equal(params.has('token'), false);
    assert.equal(params.has('content'), false);
  }
});

test('builds delivery receipt paths for both supported modes without claim/share flags', () => {
  for (const mode of ['instant', 'relay']) {
    const path = buildSentReceiptPath({ kind: 'delivery', letterId: 'drop-456', mode });
    const params = new URL(path, 'https://drop.test').searchParams;

    assert.deepEqual(Object.fromEntries(params), {
      letter: 'drop-456',
      sync: 'cloud',
      mode,
    });
    assert.deepEqual(queryKeys(path), ['letter', 'mode', 'sync']);
    assert.equal(params.has('claim'), false);
    assert.equal(params.has('share'), false);
  }
});

test('encodes a letter identifier as one query value', () => {
  const path = buildSentReceiptPath({
    kind: 'delivery',
    letterId: 'drop&mode=relay?extra=value',
    mode: 'instant',
  });
  const params = new URL(path, 'https://drop.test').searchParams;

  assert.equal(params.get('letter'), 'drop&mode=relay?extra=value');
  assert.deepEqual(queryKeys(path), ['letter', 'mode', 'sync']);
});

test('accepts exactly one recognized share query value', () => {
  assert.equal(resolveClaimShareOutcome(['shared']), 'shared');
  assert.equal(resolveClaimShareOutcome(['copied']), 'copied');
});

test('treats missing, invalid, or duplicated share query values as unknown', () => {
  for (const values of [[], ['unknown'], ['Shared'], ['shared', 'shared'], ['shared', 'copied']]) {
    assert.equal(resolveClaimShareOutcome(values), 'unknown');
  }
});

test('uses careful outcome copy for native sharing, clipboard copy, and unknown state', () => {
  const shared = getClaimReceiptCopy('shared');
  assert.deepEqual(Object.keys(shared).sort(), ['body', 'eyebrow', 'heading']);
  assert.match(shared.body, /cannot confirm|can’t confirm|does not confirm|doesn't confirm/i);
  assert.match(shared.body, /reached|delivered|received/i);
  assert.match(shared.body, /opened/i);

  const copied = getClaimReceiptCopy('copied');
  assert.match(copied.body, /paste/i);
  assert.match(copied.body, /chat/i);

  const unknown = getClaimReceiptCopy('unknown');
  assert.match(unknown.body, /couldn’t confirm|could not confirm|can’t confirm|can't confirm/i);
  assert.doesNotMatch(unknown.body, /shared successfully|copied successfully/i);
});

test('merges remote claim status without regressing a known claim', () => {
  assert.equal(mergeClaimReceiptStatus('checking', true), 'claimed');
  assert.equal(mergeClaimReceiptStatus('waiting', true), 'claimed');
  assert.equal(mergeClaimReceiptStatus('unavailable', true), 'claimed');
  assert.equal(mergeClaimReceiptStatus('claimed', true), 'claimed');
  assert.equal(mergeClaimReceiptStatus('checking', false), 'waiting');
  assert.equal(mergeClaimReceiptStatus('unavailable', false), 'waiting');
  assert.equal(mergeClaimReceiptStatus('waiting', false), 'waiting');
  assert.equal(mergeClaimReceiptStatus('claimed', false), 'claimed');
});

test('preserves known waiting/claimed state on null and otherwise reports unavailable', () => {
  assert.equal(mergeClaimReceiptStatus('waiting', null), 'waiting');
  assert.equal(mergeClaimReceiptStatus('claimed', null), 'claimed');
  assert.equal(mergeClaimReceiptStatus('checking', null), 'unavailable');
  assert.equal(mergeClaimReceiptStatus('unavailable', null), 'unavailable');
});

test('does not carry a claimed state across receipt or account changes', () => {
  const claimedByAccountA = { letterId: 'drop-1', accountId: 'account-a', status: 'claimed' };

  assert.deepEqual(mergeScopedClaimReceiptStatus(claimedByAccountA, 'drop-1', 'account-a', null), claimedByAccountA);
  assert.deepEqual(
    mergeScopedClaimReceiptStatus(claimedByAccountA, 'drop-2', 'account-a', null),
    { letterId: 'drop-2', accountId: 'account-a', status: 'unavailable' },
  );
  assert.deepEqual(
    mergeScopedClaimReceiptStatus(claimedByAccountA, 'drop-1', 'account-b', false),
    { letterId: 'drop-1', accountId: 'account-b', status: 'waiting' },
  );
});

test('provides a status label for every receipt state', () => {
  assert.equal(getClaimReceiptStatusLabel('checking'), 'Checking claim status…');
  assert.equal(getClaimReceiptStatusLabel('waiting'), 'Waiting to be claimed');
  assert.equal(getClaimReceiptStatusLabel('claimed'), 'Claimed');
  assert.equal(getClaimReceiptStatusLabel('unavailable'), 'Claim status unavailable');
});

test('reports waiting only for an owned, pending instant claim row', () => {
  const row = {
    id: 'drop-123',
    status: 'claim_pending',
    recipient_id: null,
    delivery_mode: 'instant',
    payload_kind: 'image',
  };

  assert.equal(resolveSenderClaimReceiptResult(row, null), false);
  assert.equal(resolveSenderClaimReceiptResult({ ...row, recipient_id: 'recipient-1' }, null), null);
  assert.equal(resolveSenderClaimReceiptResult({ ...row, status: 'draft' }, null), null);
  assert.equal(resolveSenderClaimReceiptResult({ ...row, delivery_mode: 'relay' }, null), null);
  assert.equal(resolveSenderClaimReceiptResult({ ...row, payload_kind: 'other' }, null), null);
  assert.equal(resolveSenderClaimReceiptResult(null, null), null);
});

test('reports claimed only when the sender claim RPC confirms a delivered drop', () => {
  const row = {
    id: 'drop-123',
    status: 'delivered',
    recipient_id: 'recipient-1',
    delivery_mode: 'instant',
    payload_kind: 'gif',
  };

  assert.equal(resolveSenderClaimReceiptResult(row, ['drop-123']), true);
  assert.equal(resolveSenderClaimReceiptResult(row, []), null);
  assert.equal(resolveSenderClaimReceiptResult(row, null), null);
  assert.equal(resolveSenderClaimReceiptResult({ ...row, recipient_id: null }, ['drop-123']), null);
});

test('does not substitute the latest draft when an explicit receipt ID is missing', () => {
  const latest = { id: 'another-drop' };
  const findById = (id) => id === 'saved-drop' ? { id } : null;
  const getLatest = () => latest;

  assert.equal(resolveRequestedReceiptDraft('missing-drop', findById, getLatest), null);
  assert.deepEqual(resolveRequestedReceiptDraft('saved-drop', findById, getLatest), { id: 'saved-drop' });
  assert.equal(resolveRequestedReceiptDraft(null, findById, getLatest), latest);
});
