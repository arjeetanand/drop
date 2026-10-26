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

export function claimReturnAfterProfileSync(syncSucceeded: boolean, nextPath: string | null): string | null {
  if (!syncSucceeded) return null;
  const safePath = safeInternalPath(nextPath, 'https://drop.invalid');
  return isClaimReturnPath(safePath) ? safePath : null;
}

export function resolveAuthReturnPath(callbackPath: string | null, tabPath: string | null, origin: string): string | null {
  return safeInternalPath(callbackPath, origin) || safeInternalPath(tabPath, origin);
}

export function firstUseProfileSetupRoute(
  nextPath: string | null,
  inviteContext: boolean,
  profileStatus: 'missing' | 'found' | 'unavailable' | 'signed-out' | 'error',
  profileAccountId: string | null,
  signedInAccountId: string,
): string | null {
  const safeNextPath = safeInternalPath(nextPath, 'https://drop.invalid');
  if (profileStatus !== 'missing'
    || !signedInAccountId
    || profileAccountId !== signedInAccountId
    || safeNextPath?.split(/[?#]/, 1)[0] !== '/compose') return null;
  return profileRoute(inviteContext, safeNextPath);
}

export function canEditInviteProfile(
  inviteContext: boolean,
  accountStatus: 'checking' | 'signed-out' | 'signed-in' | 'unavailable' | 'error',
  profileLookupFailed: boolean,
  identityUnverified: boolean,
) {
  return !inviteContext || (accountStatus === 'signed-in' && !profileLookupFailed && !identityUnverified);
}
