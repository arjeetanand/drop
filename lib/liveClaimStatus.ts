import type { MockLetter } from '@/data/mockData';

export interface LiveClaimCompletionUpdate {
  letter: MockLetter;
  announcement: string;
}

const CLAIMABLE_PAYLOAD_KINDS = new Set(['text', 'image', 'gif']);

/** Accept only the first private-link claim transition for the open sender drop. */
export function getLiveClaimCompletionUpdate(
  current: MockLetter | null,
  refreshed: MockLetter | null,
  expectedDropId: string,
): LiveClaimCompletionUpdate | null {
  if (!current || !refreshed
    || current.id !== expectedDropId
    || refreshed.id !== expectedDropId
    || current.direction !== 'sent'
    || refreshed.direction !== 'sent'
    || current.status !== 'claim_pending'
    || refreshed.status !== 'delivered'
    || current.deliveryMode !== 'instant'
    || refreshed.deliveryMode !== 'instant'
    || current.payloadKind !== refreshed.payloadKind
    || !current.payloadKind
    || !refreshed.payloadKind
    || !CLAIMABLE_PAYLOAD_KINDS.has(current.payloadKind)
    || !CLAIMABLE_PAYLOAD_KINDS.has(refreshed.payloadKind)) {
    return null;
  }

  const recipient = refreshed.recipient?.trim() || 'your recipient';
  return {
    letter: { ...current, ...refreshed, claimedViaInvite: true },
    announcement: 'Claimed by ' + recipient + '. The private drop is now addressed to them.',
  };
}
