import { validateDropMedia } from './dropValidation.ts';

const DATABASE = 'drop-share-target-handoffs';
const DATABASE_VERSION = 1;
const STORE = 'handoffs';

export const SHARE_TARGET_HANDOFF_TTL_MS = 60 * 60 * 1000;
export const MAX_SHARE_TARGET_CAPTION_CHARS = 5_000;

const HANDOFF_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ShareTargetCaptionSource = {
  text?: unknown;
  title?: unknown;
};

type StoredShareTargetHandoff = {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  caption: string;
  createdAt: number;
};

export type ShareTargetHandoff = {
  id: string;
  file: File;
  caption: string;
  createdAt: number;
};

export function isValidShareTargetHandoffId(value: unknown): value is string {
  return typeof value === 'string' && HANDOFF_ID_PATTERN.test(value);
}

export function validateShareTargetHandoffFile(file: Pick<File, 'type' | 'size'> | null): string | null {
  return validateDropMedia(file);
}

function boundedCaption(value: string): string {
  let result = '';
  for (const character of value) {
    if (result.length + character.length > MAX_SHARE_TARGET_CAPTION_CHARS) break;
    result += character;
  }
  return result;
}

export function normalizeShareTargetHandoffCaption(source: ShareTargetCaptionSource = {}): string {
  const sharedText = typeof source.text === 'string' ? source.text.trim() : '';
  const pageTitle = typeof source.title === 'string' ? source.title.trim() : '';
  return boundedCaption(sharedText || pageTitle);
}

function assertHandoffId(id: string): void {
  if (!isValidShareTargetHandoffId(id)) throw new TypeError('A canonical UUID v4 handoff ID is required.');
}

function assertClockTime(now: number): void {
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Handoff time must be a non-negative finite number.');
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('Share handoffs require browser IndexedDB.'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the share handoff store.'));
    request.onblocked = () => reject(new Error('The share handoff store is blocked by another tab.'));
  });
}

async function readRecord(id: string): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let result: unknown;
      const transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(id);
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Could not read the share handoff.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not read the share handoff.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Share handoff read was interrupted.'));
    });
  } finally {
    database.close();
  }
}

async function writeRecord(id: string, record: StoredShareTargetHandoff): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(record, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the share handoff.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Share handoff save was interrupted.'));
    });
  } finally {
    database.close();
  }
}

export async function saveShareTargetHandoff(
  id: string,
  file: File,
  captionSource: ShareTargetCaptionSource = {},
  now = Date.now(),
): Promise<void> {
  assertHandoffId(id);
  assertClockTime(now);

  const mediaError = validateShareTargetHandoffFile(file);
  if (mediaError) throw new Error(mediaError);
  if (
    typeof file.name !== 'string'
    || file.name.trim().length === 0
    || !Number.isFinite(file.lastModified)
    || file.lastModified < 0
    || !(file instanceof Blob)
    || typeof file.slice !== 'function'
  ) {
    throw new TypeError('Valid file metadata is required for a share handoff.');
  }

  const record: StoredShareTargetHandoff = {
    id,
    blob: file.slice(0, file.size, file.type),
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    caption: normalizeShareTargetHandoffCaption(captionSource),
    createdAt: now,
  };
  await writeRecord(id, record);
}

function isValidStoredRecord(value: unknown, id: string): value is StoredShareTargetHandoff {
  if (!isValidShareTargetHandoffId(id)) return false;
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredShareTargetHandoff>;
  const keys = Object.keys(value).sort();
  const expectedKeys = ['blob', 'caption', 'createdAt', 'id', 'lastModified', 'name', 'type'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return false;
  if (record.id !== id || !(record.blob instanceof Blob)) return false;
  if (typeof record.name !== 'string' || record.name.trim().length === 0) return false;
  if (typeof record.type !== 'string' || validateDropMedia({ type: record.type, size: record.blob.size }) !== null) return false;
  if (typeof record.lastModified !== 'number' || !Number.isFinite(record.lastModified) || record.lastModified < 0) return false;
  if (typeof record.caption !== 'string' || record.caption.length > MAX_SHARE_TARGET_CAPTION_CHARS) return false;
  return typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) && record.createdAt >= 0;
}

/**
 * Best-effort startup cleanup for expired or malformed handoffs. This is opportunistic, not an
 * exact-time deletion guarantee; reads still enforce the one-hour expiry before returning media.
 */
export async function cleanupShareTargetHandoffs(now = Date.now()): Promise<void> {
  assertClockTime(now);

  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch {
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const cursorRequest = transaction.objectStore(STORE).openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;

        const key = cursor.primaryKey;
        const valid = typeof key === 'string'
          && isValidStoredRecord(cursor.value, key)
          && cursor.value.createdAt <= now
          && now - cursor.value.createdAt < SHARE_TARGET_HANDOFF_TTL_MS;
        if (!valid) cursor.delete();
        cursor.continue();
      };

      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Could not scan share handoffs.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clean share handoffs.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Share handoff cleanup was interrupted.'));
    });
  } catch {
    // Leave records available for a later cleanup attempt if the best-effort scan cannot finish.
  } finally {
    database.close();
  }
}

async function deleteRecord(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete the share handoff.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Share handoff deletion was interrupted.'));
    });
  } finally {
    database.close();
  }
}

/** Reads and revalidates a pending share without consuming it. */
export async function getShareTargetHandoff(id: string, now = Date.now()): Promise<ShareTargetHandoff | null> {
  assertHandoffId(id);
  assertClockTime(now);

  const stored = await readRecord(id);
  if (stored === undefined) return null;
  if (!isValidStoredRecord(stored, id)) {
    await deleteRecord(id);
    return null;
  }

  if (stored.createdAt > now || now - stored.createdAt >= SHARE_TARGET_HANDOFF_TTL_MS) {
    await deleteRecord(id);
    return null;
  }

  const file = new File([stored.blob], stored.name, {
    type: stored.type,
    lastModified: stored.lastModified,
  });
  if (validateShareTargetHandoffFile(file)) {
    await deleteRecord(id);
    return null;
  }

  return { id, file, caption: stored.caption, createdAt: stored.createdAt };
}

/** Call only after the imported draft and attachment have been saved successfully. */
export async function deleteShareTargetHandoff(id: string): Promise<void> {
  assertHandoffId(id);
  await deleteRecord(id);
}
