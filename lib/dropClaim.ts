export const DROP_CLAIM_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function createDropClaimToken(cryptoProvider: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  if (!cryptoProvider?.getRandomValues) throw new Error('Secure random values are unavailable.');
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isDropClaimToken(value: unknown): value is string {
  return typeof value === 'string' && DROP_CLAIM_TOKEN_PATTERN.test(value);
}

export function resolveDropClaimInviteResult(response: {
  data: unknown;
  error?: unknown;
}): { ok: true; letterId: string } | { ok: false; error: string } {
  if (response.error) {
    const errorCode = typeof response.error === 'object'
      && response.error !== null
      && 'code' in response.error
      ? response.error.code
      : undefined;

    if (errorCode === '42501') {
      return {
        ok: false,
        error: 'This invite is expired, already claimed, or no longer available. Ask the sender to share a fresh link.',
      };
    }

    return {
      ok: false,
      error: 'We couldn’t verify this invite right now. Your invite link is still here—try again.',
    };
  }

  if (typeof response.data !== 'string' || !response.data.trim()) {
    return {
      ok: false,
      error: 'This invite is expired, already claimed, or no longer available. Ask the sender to share a fresh link.',
    };
  }

  return { ok: true, letterId: response.data };
}

export function buildDropClaimUrl(origin: string, token: string): string | null {
  if (!isDropClaimToken(token)) return null;
  try {
    const base = new URL(origin);
    if (!['http:', 'https:'].includes(base.protocol)) return null;
    const url = new URL('/claim', base.origin);
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  } catch {
    return null;
  }
}

export function readDropClaimTokenFromFragment(fragment: string): string | null {
  if (!fragment.startsWith('#')) return null;
  const params = new URLSearchParams(fragment.slice(1));
  if (params.size !== 1) return null;
  const token = params.get('token');
  return isDropClaimToken(token) ? token : null;
}

export function createDropClaimSharePayload(url: string) {
  return {
    title: 'A private drop is waiting on Drop',
    text: 'A friend left you a private drop on Drop. Open the link to claim it.',
    url,
  };
}
