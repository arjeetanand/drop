import { getLocalAccountId, isCurrentLocalAccount, localAccountRecordId } from './localAccountScope.ts';

const DATABASE = 'dear-exe-draft-media';
const STORE = 'attachments';

type StoredAttachment = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraftAttachment(draftId: string, file: File) {
  const accountId = getLocalAccountId();
  const recordId = localAccountRecordId(draftId, accountId);
  const database = await openDatabase();
  try {
    if (!isCurrentLocalAccount(accountId)) throw new Error('The active account changed while saving the attachment.');
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({
        blob: file.slice(0, file.size, file.type),
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
      } satisfies StoredAttachment, recordId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    if (!isCurrentLocalAccount(accountId)) throw new Error('The active account changed while saving the attachment.');
  } finally {
    database.close();
  }
}

export async function getDraftAttachment(draftId: string): Promise<File | null> {
  const accountId = getLocalAccountId();
  const recordId = localAccountRecordId(draftId, accountId);
  const database = await openDatabase();
  try {
    if (!isCurrentLocalAccount(accountId)) return null;
    const record = await new Promise<StoredAttachment | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(recordId);
      request.onsuccess = () => resolve(request.result as StoredAttachment | undefined);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
    if (!isCurrentLocalAccount(accountId)) return null;
    return record ? new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified }) : null;
  } finally {
    database.close();
  }
}

export async function copyGuestDraftAttachmentToAccount(draftId: string, accountId: string, targetDraftId = draftId) {
  const database = await openDatabase();
  return new Promise<'copied' | 'existing' | false>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(localAccountRecordId(draftId, null));
    let result: 'copied' | 'existing' | false = false;
    request.onsuccess = () => {
      if (!request.result) return;
      const target = store.get(localAccountRecordId(targetDraftId, accountId));
      target.onsuccess = () => {
        if (target.result) result = 'existing';
        else {
          store.put(request.result, localAccountRecordId(targetDraftId, accountId));
          result = 'copied';
        }
      };
      target.onerror = () => reject(target.error);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

export async function deleteDraftAttachment(draftId: string, accountId?: string | null) {
  const activeAccountId = getLocalAccountId();
  const targetAccountId = accountId === undefined ? activeAccountId : accountId;
  const recordId = localAccountRecordId(draftId, targetAccountId);
  const database = await openDatabase();
  try {
    if (accountId === undefined && !isCurrentLocalAccount(activeAccountId)) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(recordId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
