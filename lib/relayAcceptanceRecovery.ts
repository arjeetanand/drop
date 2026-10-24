const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRelayToken(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

export interface RelayAcceptanceAttempt {
  requestId: string;
  name: string;
  neighborhood: string;
  note: string;
  savedAt: number;
}

export interface RelayAcceptanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY_PREFIX = 'drop:relay-acceptance:v1:';
const MAX_ATTEMPT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function getRelayAcceptanceRecoveryKey(
  token: string,
  accountId: string | null,
): Promise<string | null> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') return null;

  try {
    const source = new TextEncoder().encode(`${accountId ?? 'anonymous'}\u0000${token}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${STORAGE_KEY_PREFIX}${fingerprint}`;
  } catch {
    return null;
  }
}

export function readRelayAcceptanceAttempt(
  storage: RelayAcceptanceStorage,
  key: string,
  now = Date.now(),
): RelayAcceptanceAttempt | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return null;
  }
  if (!serialized) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    removeInvalidAttempt(storage, key);
    return null;
  }

  if (!isRelayAcceptanceAttempt(value, now)) {
    removeInvalidAttempt(storage, key);
    return null;
  }

  return value;
}

export function saveRelayAcceptanceAttempt(
  storage: RelayAcceptanceStorage,
  key: string,
  attempt: RelayAcceptanceAttempt,
): boolean {
  if (!isRelayAcceptanceAttempt(attempt, Date.now())) return false;

  try {
    storage.setItem(key, JSON.stringify(attempt));
    return true;
  } catch {
    return false;
  }
}

export function clearRelayAcceptanceAttempt(storage: RelayAcceptanceStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // A completed retry can safely remain until the tab session ends.
  }
}

function isRelayAcceptanceAttempt(value: unknown, now: number): value is RelayAcceptanceAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<RelayAcceptanceAttempt>;
  return isRelayToken(attempt.requestId)
    && typeof attempt.name === 'string'
    && attempt.name.trim().length > 0
    && attempt.name.length <= 60
    && typeof attempt.neighborhood === 'string'
    && attempt.neighborhood.length <= 120
    && typeof attempt.note === 'string'
    && attempt.note.length <= 500
    && typeof attempt.savedAt === 'number'
    && Number.isFinite(attempt.savedAt)
    && attempt.savedAt <= now + MAX_CLOCK_SKEW_MS
    && now - attempt.savedAt <= MAX_ATTEMPT_AGE_MS;
}

function removeInvalidAttempt(storage: RelayAcceptanceStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable session storage.
  }
}
