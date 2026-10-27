import { isDropClaimToken } from './dropClaim.ts';

export const DROP_CLAIM_HANDOFF_TTL_MS = 10 * 60 * 1000;

const HANDOFF_KEY_PREFIX = 'drop:claim-handoff:v1:';
type HandoffStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
type HandoffLifecycleTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export function isDropClaimHandoffId(value: string | null): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function canUseDropClaimSessionToken(
  requestedHandoffId: string | null,
  storedHandoffId: string | null,
  handoffParameterPresent: boolean,
): boolean {
  if (!handoffParameterPresent) return storedHandoffId === null;
  return isDropClaimHandoffId(requestedHandoffId) && storedHandoffId === requestedHandoffId;
}

export function dropClaimReturnPath(handoffId: string | null): string {
  return isDropClaimHandoffId(handoffId) ? `/claim?handoff=${encodeURIComponent(handoffId)}` : '/claim';
}

function storageKey(id: string) {
  return `${HANDOFF_KEY_PREFIX}${id}`;
}

function storedToken(value: string | null, now: number): string | null {
  if (!value || !Number.isFinite(now)) return null;
  try {
    const record: unknown = JSON.parse(value);
    if (!record || typeof record !== 'object') return null;
    const candidate = record as { token?: unknown; expiresAt?: unknown };
    if (!isDropClaimToken(candidate.token)) return null;
    if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) return null;
    if (candidate.expiresAt <= now || candidate.expiresAt > now + DROP_CLAIM_HANDOFF_TTL_MS) return null;
    return candidate.token;
  } catch {
    return null;
  }
}

export function pruneDropClaimHandoffs(storage: HandoffStorage, now = Date.now()) {
  if (!Number.isFinite(now)) return;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(HANDOFF_KEY_PREFIX)) continue;
      const id = key.slice(HANDOFF_KEY_PREFIX.length);
      if (!isDropClaimHandoffId(id) || !storedToken(storage.getItem(key), now)) storage.removeItem(key);
    }
  } catch {
    // Storage can be blocked. The caller can still keep the invite in memory or session storage.
  }
}

export function installDropClaimHandoffPruning(
  storage: HandoffStorage,
  lifecycle: HandoffLifecycleTarget,
  now: () => number = Date.now,
) {
  const prune = () => pruneDropClaimHandoffs(storage, now());
  prune();
  lifecycle.addEventListener('pageshow', prune);
  lifecycle.addEventListener('focus', prune);
  return () => {
    lifecycle.removeEventListener('pageshow', prune);
    lifecycle.removeEventListener('focus', prune);
  };
}

export function storeDropClaimHandoff(
  token: string,
  storage: HandoffStorage,
  now = Date.now(),
  createId: () => string = () => globalThis.crypto.randomUUID(),
): string | null {
  if (!isDropClaimToken(token) || !Number.isFinite(now)) return null;
  try {
    const id = createId();
    if (!isDropClaimHandoffId(id)) return null;
    pruneDropClaimHandoffs(storage, now);
    storage.setItem(storageKey(id), JSON.stringify({ token, expiresAt: now + DROP_CLAIM_HANDOFF_TTL_MS }));
    return id;
  } catch {
    return null;
  }
}

export function takeDropClaimHandoff(
  id: string | null,
  storage: HandoffStorage,
  now = Date.now(),
  persistInTab?: (token: string) => boolean,
): string | null {
  if (!isDropClaimHandoffId(id) || !Number.isFinite(now)) return null;
  try {
    pruneDropClaimHandoffs(storage, now);
    const key = storageKey(id);
    const raw = storage.getItem(key);
    const token = storedToken(raw, now);
    if (!token) {
      if (raw) storage.removeItem(key);
      return null;
    }
    let persisted = true;
    try { if (persistInTab) persisted = persistInTab(token); } catch { persisted = false; }
    if (persisted) {
      try { storage.removeItem(key); } catch { /* Keep the in-memory token usable if storage cleanup is blocked. */ }
    }
    return token;
  } catch {
    return null;
  }
}

export function clearDropClaimHandoff(id: string | null, storage: HandoffStorage) {
  if (!isDropClaimHandoffId(id)) return;
  try { storage.removeItem(storageKey(id)); } catch { /* The server-side claim is already complete. */ }
}
