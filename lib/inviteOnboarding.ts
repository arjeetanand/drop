import { safeInternalPath } from './safeInternalPath.ts';

export function profileRoute(inviteContext: boolean, nextPath?: string | null) {
  const query = new URLSearchParams();
  if (inviteContext) query.set('invite', '1');
  if (nextPath) query.set('next', nextPath);
  const search = query.toString();
  return `/profile${search ? `?${search}` : ''}`;
}

export function authCallbackRoute(inviteContext: boolean, nextPath?: string | null) {
  const query = new URLSearchParams();
  if (inviteContext) query.set('invite', '1');
  const safeNextPath = safeInternalPath(nextPath ?? null, 'https://drop.invalid');
  if (safeNextPath) query.set('next', safeNextPath);
  const search = query.toString();
  return `/auth/callback${search ? `?${search}` : ''}`;
}

export function isClaimReturnPath(path: string | null): boolean {
  return path?.split(/[?#]/, 1)[0] === '/claim';
}

export function resolveAuthReturnPath(callbackPath: string | null, tabPath: string | null, origin: string): string | null {
  return safeInternalPath(callbackPath, origin) || safeInternalPath(tabPath, origin);
}

export function canEditInviteProfile(
  inviteContext: boolean,
  accountStatus: 'checking' | 'signed-out' | 'signed-in' | 'unavailable' | 'error',
  profileLookupFailed: boolean,
  identityUnverified: boolean,
) {
  return !inviteContext || (accountStatus === 'signed-in' && !profileLookupFailed && !identityUnverified);
}
