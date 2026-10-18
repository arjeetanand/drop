import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentLocalAccount, localAccountRecordId, localAccountStorageKey, setLocalAccountId } from '../lib/localAccountScope.ts';

test('keeps legacy guest keys intact and gives each account a stable local namespace', () => {
  setLocalAccountId(null);
  assert.equal(isCurrentLocalAccount(null), true);
  assert.equal(localAccountStorageKey('drafts'), 'drafts');
  assert.equal(localAccountRecordId('draft-1'), 'draft-1');
  setLocalAccountId('user/one');
  assert.equal(isCurrentLocalAccount('user/one'), true);
  assert.equal(isCurrentLocalAccount('user-two'), false);
  assert.equal(localAccountStorageKey('drafts'), 'drafts:account:user%2Fone');
  assert.equal(localAccountRecordId('draft-1'), 'account:user%2Fone:draft-1');
  setLocalAccountId('user-two');
  assert.equal(localAccountStorageKey('drafts'), 'drafts:account:user-two');
  assert.equal(localAccountStorageKey('active-carry', 'user/one'), 'active-carry:account:user%2Fone');
  assert.equal(localAccountStorageKey('active-carry'), 'active-carry:account:user-two');
  setLocalAccountId(null);
});
