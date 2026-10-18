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
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({
      blob: file.slice(0, file.size, file.type),
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    } satisfies StoredAttachment, draftId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

export async function getDraftAttachment(draftId: string): Promise<File | null> {
  const database = await openDatabase();
  const record = await new Promise<StoredAttachment | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(draftId);
    request.onsuccess = () => resolve(request.result as StoredAttachment | undefined);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
  return record ? new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified }) : null;
}

export async function deleteDraftAttachment(draftId: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(draftId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}
