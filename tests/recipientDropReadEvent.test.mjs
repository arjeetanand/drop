import assert from 'node:assert/strict';
import test from 'node:test';
import { announceRecipientDropRead, isRecipientDropReadForAccount, subscribeToRecipientDropReads } from '../lib/recipientDropReadEvent.ts';

test('broadcasts only confirmed receipt details to same-browser subscribers', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  const received = [];

  try {
    const stop = subscribeToRecipientDropReads((detail) => received.push(detail));
    announceRecipientDropRead({ accountId: 'recipient-1', letterId: 'drop-1', readAt: '2026-10-25T10:00:00Z' });
    assert.deepEqual(received, [{ accountId: 'recipient-1', letterId: 'drop-1', readAt: '2026-10-25T10:00:00Z' }]);

    stop();
    announceRecipientDropRead({ accountId: 'recipient-1', letterId: 'drop-2', readAt: '2026-10-25T11:00:00Z' });
    assert.equal(received.length, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('account-scoped read receipts cannot cross account changes', () => {
  const detail = { accountId: 'recipient-1', letterId: 'drop-1', readAt: '2026-10-25T10:00:00Z' };

  assert.equal(isRecipientDropReadForAccount(detail, 'recipient-1'), true);
  assert.equal(isRecipientDropReadForAccount(detail, 'recipient-2'), false);
  assert.equal(isRecipientDropReadForAccount(detail, null), false);
  assert.equal(announceRecipientDropRead({ letterId: 'drop-2', readAt: '2026-10-25T11:00:00Z' }), undefined);
});
