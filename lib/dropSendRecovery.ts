export type StoredDropSend = {
  senderId: string;
  recipientUsername: string | null;
  subject: string;
  content: string | null;
  sealId: string | null;
  payloadKind: string | null;
  deliveryMode: string | null;
  mediaPath: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
  status: string;
  dispatchedAt: string | null;
};

export type DropSendIntent = Omit<StoredDropSend, 'mediaPath' | 'status' | 'dispatchedAt'> & {
  status: 'delivered' | 'dispatched';
};

export function matchesStoredDropMetadata(stored: StoredDropSend, intent: DropSendIntent) {
  return stored.senderId === intent.senderId
    && stored.recipientUsername === intent.recipientUsername
    && stored.subject === intent.subject
    && stored.content === intent.content
    && stored.sealId === intent.sealId
    && stored.payloadKind === intent.payloadKind
    && stored.deliveryMode === intent.deliveryMode
    && stored.status === intent.status
    && Boolean(stored.dispatchedAt)
    && (intent.mediaMimeType
      ? Boolean(stored.mediaPath) && stored.mediaMimeType === intent.mediaMimeType && stored.mediaSizeBytes === intent.mediaSizeBytes
      : !stored.mediaPath && !stored.mediaMimeType && stored.mediaSizeBytes === null);
}
