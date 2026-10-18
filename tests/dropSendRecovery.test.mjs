import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesStoredDropMetadata, sameMediaBytes } from '../lib/dropSendRecovery.ts';

const textIntent = {
  senderId: 'sender-1',
  recipientUsername: 'sunny.stories',
  subject: 'For your Tuesday',
  content: 'A tiny surprise.',
  sealId: 'fern',
  payloadKind: 'text',
  deliveryMode: 'instant',
  mediaMimeType: null,
  mediaSizeBytes: null,
  status: 'delivered',
};

const storedText = {
  ...textIntent,
  content: textIntent.content,
  mediaPath: null,
  dispatchedAt: '2026-10-18T12:00:00.000Z',
};

test('recognizes an exact saved text drop and rejects changed sends', () => {
  assert.equal(matchesStoredDropMetadata(storedText, textIntent), true);
  assert.equal(matchesStoredDropMetadata(storedText, { ...textIntent, content: 'Different words.' }), false);
  assert.equal(matchesStoredDropMetadata({ ...storedText, senderId: 'other-sender' }, textIntent), false);
  assert.equal(matchesStoredDropMetadata({ ...storedText, dispatchedAt: null }, textIntent), false);
  assert.equal(matchesStoredDropMetadata(storedText, { ...textIntent, recipientUsername: 'different.friend' }), false);
  assert.equal(matchesStoredDropMetadata(storedText, { ...textIntent, sealId: 'heart' }), false);
  assert.equal(matchesStoredDropMetadata(storedText, { ...textIntent, deliveryMode: 'relay', status: 'dispatched' }), false);
});

test('requires matching media metadata and bytes before recovering a media drop', () => {
  const mediaIntent = { ...textIntent, payloadKind: 'image', mediaMimeType: 'image/png', mediaSizeBytes: 3 };
  const storedMedia = { ...storedText, ...mediaIntent, mediaPath: 'sender-1/draft/media' };
  assert.equal(matchesStoredDropMetadata(storedMedia, mediaIntent), true);
  assert.equal(matchesStoredDropMetadata(storedMedia, { ...mediaIntent, mediaSizeBytes: 4 }), false);
  assert.equal(matchesStoredDropMetadata({ ...storedMedia, mediaPath: null }, mediaIntent), false);
});

test('compares binary media exactly, including same-length files', () => {
  assert.equal(sameMediaBytes(Uint8Array.from([1, 2, 3]).buffer, Uint8Array.from([1, 2, 3]).buffer), true);
  assert.equal(sameMediaBytes(Uint8Array.from([1, 2, 3]).buffer, Uint8Array.from([1, 2, 4]).buffer), false);
  assert.equal(sameMediaBytes(Uint8Array.from([1, 2]).buffer, Uint8Array.from([1, 2, 3]).buffer), false);
});
