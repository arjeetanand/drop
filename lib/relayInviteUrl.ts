export interface RelayScanInvite {
  token: string;
  letterId: string;
  destination: string;
}

/** Put the bearer capability in the fragment so it is not part of the HTTP request URL. */
export function buildRelayScanUrl(origin: string, invite: RelayScanInvite): string {
  const url = new URL('/relay/scan', origin);
  url.searchParams.set('letter', invite.letterId);
  url.searchParams.set('dest', invite.destination);
  url.hash = new URLSearchParams({ token: invite.token }).toString();
  return url.toString();
}

/** Read new fragment links while retaining short-lived compatibility with issued query links. */
export function resolveRelayToken(queryToken: string | null, hash: string): string {
  if (queryToken) return queryToken;
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(fragment).get('token') ?? '';
}
