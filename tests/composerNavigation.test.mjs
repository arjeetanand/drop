import assert from 'node:assert/strict';
import test from 'node:test';
import { getComposerNavigationBlockReason, guardComposerNavigation } from '../lib/composerNavigation.ts';

const clearState = {
  deleting: false,
  sending: false,
  sharingInvite: false,
  shareImporting: false,
  attachmentSaving: false,
  unsavedAttachment: false,
};

test('blocks link navigation while a send is pending and announces why', () => {
  let prevented = false;
  let notice = '';
  const blocked = guardComposerNavigation({ preventDefault: () => { prevented = true; } }, {
    ...clearState,
    sending: true,
  }, (message) => { notice = message; });

  assert.equal(blocked, true);
  assert.equal(prevented, true);
  assert.equal(notice, 'Drop is finishing this step… Keep this screen open until the result appears.');
});

test('blocks link navigation while the native share flow is pending', () => {
  let prevented = false;
  let notice = '';
  const blocked = guardComposerNavigation({ preventDefault: () => { prevented = true; } }, {
    ...clearState,
    sharingInvite: true,
  }, (message) => { notice = message; });

  assert.equal(blocked, true);
  assert.equal(prevented, true);
  assert.equal(notice, 'Opening your share options… Keep Drop open until you return.');
});

test('allows link navigation once the send has settled', () => {
  let prevented = false;
  let notice = '';
  const blocked = guardComposerNavigation({ preventDefault: () => { prevented = true; } }, clearState, (message) => { notice = message; });

  assert.equal(blocked, false);
  assert.equal(prevented, false);
  assert.equal(notice, '');
});

test('preserves the existing in-progress guards and gives deletion priority', () => {
  assert.equal(getComposerNavigationBlockReason({ ...clearState, shareImporting: true }), 'share-importing');
  assert.equal(getComposerNavigationBlockReason({ ...clearState, attachmentSaving: true }), 'saving-attachment');
  assert.equal(getComposerNavigationBlockReason({ ...clearState, unsavedAttachment: true }), 'unsaved-attachment');
  assert.equal(getComposerNavigationBlockReason({ ...clearState, deleting: true, sending: true }), 'deleting');
});
