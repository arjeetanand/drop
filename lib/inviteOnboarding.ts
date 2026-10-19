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
