import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteLocalDraft, getLetterDraft, getLetterDraftById, getLettersWithDraft, restoreDeletedDraft, saveLetterDraft, setActiveLetterDraft, startNewLetter } from '../lib/letterStore.ts';
import { setLocalAccountId } from '../lib/localAccountScope.ts';

function useStorage(t, values = new Map(), failSetKey = null) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === failSetKey) {
        failSetKey = null;
        throw new Error('storage unavailable');
      }
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
  values.failNextSet = (key) => { failSetKey = key; };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  setLocalAccountId('account-one');
  t.after(() => {
    setLocalAccountId(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  return values;
}

test('deleting the active draft removes both history copies and keeps a usable replacement', (t) => {
  const values = useStorage(t);
  const target = saveLetterDraft({ id: 'draft-delete-me', content: 'Private note', payloadKind: 'image' });
  startNewLetter();
  const remaining = saveLetterDraft({ id: 'draft-keep-me', content: 'Keep this one' });
  startNewLetter();
  setActiveLetterDraft(target);

  const result = deleteLocalDraft(target.id);

  assert.equal(result.status, 'deleted');
  assert.notEqual(result.nextDraft.id, target.id);
  assert.equal(result.nextDraft.status, 'draft');
  assert.notEqual(getLetterDraft().id, target.id);
  assert.equal(getLetterDraftById(target.id), null);
  assert.equal(getLetterDraftById(remaining.id)?.content, remaining.content);
  assert.equal(getLettersWithDraft().some((letter) => letter.id === target.id), false);
  assert.equal(JSON.parse(values.get('dear-exe:letter-history:v1:account:account-one')).some((letter) => letter.id === target.id), false);
  assert.equal(restoreDeletedDraft(result.snapshot), true);
  assert.equal(getLetterDraft().id, target.id);
});

test('rejects sent, demo, and seeded sample items', (t) => {
  useStorage(t);
  const sent = saveLetterDraft({ id: 'draft-already-sent', status: 'delivered' });
  assert.equal(deleteLocalDraft(sent.id).status, 'not-deletable');
  assert.equal(getLetterDraft().id, sent.id);

  const demo = saveLetterDraft({ id: 'draft-local-demo', localDemo: true });
  assert.equal(deleteLocalDraft(demo.id).status, 'not-deletable');

  const seededSample = getLetterDraftById('4');
  assert.ok(seededSample);
  setActiveLetterDraft(seededSample);
  assert.equal(deleteLocalDraft(seededSample.id).status, 'not-deletable');
  assert.equal(getLetterDraft().id, seededSample.id);
});

test('deleting a draft in one account leaves a colliding draft in another account', (t) => {
  useStorage(t);
  const accountOne = saveLetterDraft({ id: 'draft-shared-id', content: 'Account one' });
  setLocalAccountId('account-two');
  saveLetterDraft({ id: 'draft-shared-id', content: 'Account two' });

  assert.equal(deleteLocalDraft('draft-shared-id').status, 'deleted');
  setLocalAccountId('account-one');
  assert.equal(getLetterDraftById(accountOne.id)?.content, 'Account one');
});

test('deleting the starter draft does not make its seeded copy reappear', (t) => {
  useStorage(t);
  const starter = saveLetterDraft({ content: 'My edited starter' });

  assert.equal(deleteLocalDraft(starter.id).status, 'deleted');
  assert.equal(getLetterDraftById(starter.id), null);
  assert.equal(getLettersWithDraft().some((letter) => letter.id === starter.id), false);
});

test('restores stored draft state if a localStorage write fails mid-delete', (t) => {
  const values = useStorage(t);
  const target = saveLetterDraft({ id: 'draft-keep-on-error', content: 'Still here' });
  startNewLetter();
  setActiveLetterDraft(target);
  values.failNextSet('dear-exe:letter-history:v1:account:account-one');

  assert.equal(deleteLocalDraft(target.id).status, 'storage-error');
  assert.equal(getLetterDraft().id, target.id);
  assert.equal(getLetterDraft().content, target.content);
  assert.equal(JSON.parse(values.get('dear-exe:active-letter:v1:account:account-one')).id, target.id);
});
