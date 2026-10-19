import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveNavigationHref, usesPrivateShell } from '../lib/navigation.ts';

test('keeps private navigation available across the main workflows', () => {
  for (const pathname of ['/', '/mailbox', '/journey', '/profile', '/sent', '/compose', '/compose/preview', '/letter/123', '/relay', '/relay/scan']) {
    assert.equal(usesPrivateShell(pathname), true, pathname);
  }
  assert.equal(usesPrivateShell(null), true);
  assert.equal(usesPrivateShell('/u/alex'), false);
  assert.equal(usesPrivateShell('/relayer'), false);
});

test('marks the nearest primary tab active inside routed workflows', () => {
  assert.equal(getActiveNavigationHref('/compose/preview'), '/');
  assert.equal(getActiveNavigationHref('/letter/123'), null);
  assert.equal(getActiveNavigationHref('/sent'), '/mailbox');
  assert.equal(getActiveNavigationHref('/relay/scan'), '/journey');
  assert.equal(getActiveNavigationHref('/profile'), '/profile');
  assert.equal(getActiveNavigationHref('/auth/callback'), null);
  assert.equal(getActiveNavigationHref(null), null);
});
