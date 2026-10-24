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

/** Read bearer capabilities only from URL fragments, never request queries. */
export function resolveRelayToken(hash: string): string {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  return new URLSearchParams(fragment).get('token') ?? '';
}

/** Remove a rejected legacy bearer query from the visible URL. */
export function stripRelayTokenQuery(url: URL): URL {
  const safeUrl = new URL(url.href);
  safeUrl.searchParams.delete('token');
  return safeUrl;
}
