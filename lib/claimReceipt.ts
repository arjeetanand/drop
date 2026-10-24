import type { DropDeliveryMode } from '../data/mockData.ts';

export type ClaimShareOutcome = 'shared' | 'copied' | 'unknown';
export type ClaimReceiptStatus = 'checking' | 'waiting' | 'claimed' | 'unavailable';

export type ScopedClaimReceiptStatus = {
  letterId: string | null;
  accountId: string | null;
  status: ClaimReceiptStatus;
};

export type SentReceiptPathInput =
  | { kind: 'claim'; letterId: string; shareOutcome: 'shared' | 'copied' }
  | { kind: 'delivery'; letterId: string; mode: DropDeliveryMode };

export type ClaimReceiptCopy = {
  eyebrow: string;
  heading: string;
  body: string;
};

export function getComposerClaimPendingCopy(hasUnsharedLink: boolean): ClaimReceiptCopy {
  return hasUnsharedLink
    ? {
      eyebrow: 'Private link ready · not shared yet',
      heading: 'Ready when you are.',
      body: 'Your drop is saved. Copy the link below and send it directly to your friend.',
    }
    : {
      eyebrow: 'Private claim drop',
      heading: 'Your drop is saved.',
      body: 'Open the saved drop below to check its claim status or prepare a fresh private link.',
    };
}

export function buildPrivateClaimDetailsPath(letterId: string): string {
  return `/letter/${encodeURIComponent(letterId)}`;
}

export type SenderClaimReceiptRow = {
  id: string;
  status: string;
  recipient_id: string | null;
  delivery_mode: string | null;
  payload_kind: string | null;
};

const claimReceiptCopy: Record<ClaimShareOutcome, ClaimReceiptCopy> = {
  shared: {
    eyebrow: 'Link shared',
    heading: 'Your private drop is ready.',
    body: 'The share sheet finished, but Drop can’t confirm the link reached them or was opened. They’ll need a Drop account and an explicit claim before the drop opens. Anyone holding the link can claim it.',
  },
  copied: {
    eyebrow: 'Link copied · paste it into chat',
    heading: 'Paste it into chat.',
    body: 'The private link is on your clipboard. Paste it into a chat to share it. They’ll need a Drop account and an explicit claim before the drop opens; anyone holding the link can claim it.',
  },
  unknown: {
    eyebrow: 'Private claim link',
    heading: 'Your drop is in Sent.',
    body: 'Drop can’t confirm how the link was shared. They’ll need the private link, a Drop account, and an explicit claim before the drop opens. Anyone holding the link can claim it.',
  },
};

const claimReceiptStatusLabels: Record<ClaimReceiptStatus, string> = {
  checking: 'Checking claim status…',
  waiting: 'Waiting to be claimed',
  claimed: 'Claimed',
  unavailable: 'Claim status unavailable',
};

export function buildSentReceiptPath(receipt: SentReceiptPathInput): string {
  const query = new URLSearchParams();
  query.set('letter', receipt.letterId);
  query.set('sync', 'cloud');
  query.set('mode', receipt.kind === 'claim' ? 'instant' : receipt.mode);

  if (receipt.kind === 'claim') {
    query.set('claim', '1');
    query.set('share', receipt.shareOutcome);
  }

  return `/sent?${query.toString()}`;
}

export function resolveClaimShareOutcome(values: readonly string[] | null | undefined): ClaimShareOutcome {
  if (!values || values.length !== 1) return 'unknown';
  if (values[0] === 'shared' || values[0] === 'copied') return values[0];
  return 'unknown';
}

export function getClaimReceiptCopy(outcome: ClaimShareOutcome): ClaimReceiptCopy {
  return claimReceiptCopy[outcome];
}

export function resolveRequestedReceiptDraft<T>(
  requestedId: string | null,
  findById: (id: string) => T | null,
  getLatest: () => T | null,
): T | null {
  return requestedId ? findById(requestedId) : getLatest();
}

/** Return only a durable sender-side claim result; unknown rows stay neutral. */
export function resolveSenderClaimReceiptResult(
  row: SenderClaimReceiptRow | null,
  claimedDropIds: readonly string[] | null,
): boolean | null {
  if (!row || row.delivery_mode !== 'instant' || !['text', 'image', 'gif'].includes(row.payload_kind || '')) {
    return null;
  }
  if (row.status === 'claim_pending' && row.recipient_id === null) return false;
  if (row.status === 'delivered' && row.recipient_id && claimedDropIds) {
    return claimedDropIds.includes(row.id) ? true : null;
  }
  return null;
}

export function mergeClaimReceiptStatus(
  current: ClaimReceiptStatus,
  remoteResult: boolean | null,
): ClaimReceiptStatus {
  if (current === 'claimed' || remoteResult === true) return 'claimed';
  if (remoteResult === false || current === 'waiting') return 'waiting';
  return 'unavailable';
}

export function mergeScopedClaimReceiptStatus(
  current: ScopedClaimReceiptStatus,
  letterId: string,
  accountId: string | null,
  remoteResult: boolean | null,
): ScopedClaimReceiptStatus {
  const sameScope = current.letterId === letterId && current.accountId === accountId;
  return {
    letterId,
    accountId,
    status: mergeClaimReceiptStatus(sameScope ? current.status : 'checking', remoteResult),
  };
}

export function getClaimReceiptStatusLabel(status: ClaimReceiptStatus): string {
  return claimReceiptStatusLabels[status];
}
