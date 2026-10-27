export const RECIPIENT_DROP_READ_EVENT = 'drop:recipient-read';

export interface RecipientDropReadEventDetail {
  accountId: string;
  letterId: string;
  readAt: string;
}

function isRecipientDropReadEventDetail(value: unknown): value is RecipientDropReadEventDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<RecipientDropReadEventDetail>;
  return typeof detail.accountId === 'string'
    && detail.accountId.length > 0
    && typeof detail.letterId === 'string'
    && detail.letterId.length > 0
    && typeof detail.readAt === 'string'
    && detail.readAt.length > 0;
}

/** Reject receipts delivered after the active account has changed. */
export function isRecipientDropReadForAccount(
  detail: RecipientDropReadEventDetail,
  accountId: string | null,
) {
  return Boolean(accountId && detail.accountId === accountId);
}

/** Broadcast a successful server read receipt to other views in this browser tab. */
export function announceRecipientDropRead(detail: RecipientDropReadEventDetail) {
  if (!isRecipientDropReadEventDetail(detail) || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<RecipientDropReadEventDetail>(RECIPIENT_DROP_READ_EVENT, { detail }));
}

/** Subscribe to read receipts from another view in this browser tab. */
export function subscribeToRecipientDropReads(
  listener: (detail: RecipientDropReadEventDetail) => void,
) {
  if (typeof window === 'undefined') return () => {};

  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isRecipientDropReadEventDetail(detail)) listener(detail);
  };
  window.addEventListener(RECIPIENT_DROP_READ_EVENT, handleEvent);
  return () => window.removeEventListener(RECIPIENT_DROP_READ_EVENT, handleEvent);
}
