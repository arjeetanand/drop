export function profileRoute(inviteContext: boolean, nextPath?: string | null) {
  const query = new URLSearchParams();
  if (inviteContext) query.set('invite', '1');
  if (nextPath) query.set('next', nextPath);
  const search = query.toString();
  return `/profile${search ? `?${search}` : ''}`;
}

export function authCallbackRoute(inviteContext: boolean) {
  return inviteContext ? '/auth/callback?invite=1' : '/auth/callback';
}

export function canEditInviteProfile(
  inviteContext: boolean,
  accountStatus: 'checking' | 'signed-out' | 'signed-in' | 'unavailable' | 'error',
  profileLookupFailed: boolean,
  identityUnverified: boolean,
) {
  return !inviteContext || (accountStatus === 'signed-in' && !profileLookupFailed && !identityUnverified);
}
