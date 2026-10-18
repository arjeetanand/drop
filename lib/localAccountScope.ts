let currentAccountId: string | null = null;

export function setLocalAccountId(accountId: string | null) {
  currentAccountId = accountId || null;
}

export function getLocalAccountId() {
  return currentAccountId;
}

export function isCurrentLocalAccount(accountId: string | null) {
  return currentAccountId === accountId;
}

export function localAccountStorageKey(key: string, accountId = currentAccountId) {
  return accountId ? `${key}:account:${encodeURIComponent(accountId)}` : key;
}

export function localAccountRecordId(id: string, accountId = currentAccountId) {
  return accountId ? `account:${encodeURIComponent(accountId)}:${id}` : id;
}
