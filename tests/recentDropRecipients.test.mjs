import assert from 'node:assert/strict';
import test from 'node:test';
import { uniqueRecentDropRecipients } from '../lib/recentDropRecipients.ts';

test('keeps newest unique valid recipients, uses names when available, and caps the list at five', () => {
  const recipients = uniqueRecentDropRecipients([
    { recipient_username: 'Mina.Vale', recipient_name: 'Mina Vale' },
    { recipient_username: 'bad handle', recipient_name: 'Invalid' },
    { recipient_username: null, recipient_name: 'Missing handle' },
    { recipient_username: 'jo-park', recipient_name: '' },
    { recipient_username: 'mina.vale', recipient_name: 'Old Mina Name' },
    { recipient_username: 'eli_rose', recipient_name: 'Eli Rose' },
    { recipient_username: 'noah.t', recipient_name: 'Noah T' },
    { recipient_username: 'mara-lee', recipient_name: 'Mara Lee' },
    { recipient_username: 'last.person', recipient_name: 'Last Person' },
  ]);

  assert.deepEqual(recipients, [
    { username: 'mina.vale', displayName: 'Mina Vale' },
    { username: 'jo-park', displayName: 'jo-park' },
    { username: 'eli_rose', displayName: 'Eli Rose' },
    { username: 'noah.t', displayName: 'Noah T' },
    { username: 'mara-lee', displayName: 'Mara Lee' },
  ]);
});
