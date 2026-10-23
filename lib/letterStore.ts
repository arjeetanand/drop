import { currentFocusDraft, mockAddress, mockFieldNotes, mockLetters } from '../data/mockData.ts';
import type { DropDeliveryMode, DropPayloadKind, LetterStatus, MockLetter, RecipientInviteProgress, RecipientInviteProgressStatus } from '../data/mockData.ts';
import { getDemoReactions } from './demoReactionStore.ts';
import { normalizeDropRecipient } from './dropValidation.ts';
import { getLocalAccountId, localAccountStorageKey } from './localAccountScope.ts';

const STORAGE_KEY = 'dear-exe:active-letter:v1';
const NOTES_STORAGE_KEY = 'dear-exe:journey-notes:v1';
const HISTORY_STORAGE_KEY = 'dear-exe:letter-history:v1';
const DRAFT_HISTORY_STORAGE_KEY = 'dear-exe:letter-drafts:v1';

export type LetterAlignment = 'left' | 'center' | 'right';

export interface LetterAddress {
  name: string;
  street: string;
  city: string;
  postcode: string;
  country: string;
}

export interface LetterDraftState {
  id: string;
  recipient: string;
  subject: string;
  content: string;
  fontSize: number;
  alignment: LetterAlignment;
  address: LetterAddress;
  sealId: string | null;
  sealColor?: string;
  sealMonogram?: string;
  payloadKind: DropPayloadKind;
  deliveryMode: DropDeliveryMode;
  mediaPath?: string;
  mediaMimeType?: string;
  mediaSizeBytes?: number;
  mediaUploadId?: string;
  recipientInviteProgress?: RecipientInviteProgress;
  status: LetterStatus;
  updatedAt: string;
  dispatchedAt?: string;
  localDemo?: boolean;
}

export interface JourneyNote {
  id: string;
  date: string;
  text: string;
}

function defaultDraft(): LetterDraftState {
  return {
    id: currentFocusDraft.id,
    recipient: currentFocusDraft.recipient,
    subject: currentFocusDraft.subject,
    content: currentFocusDraft.excerpt,
    fontSize: 18,
    alignment: 'left',
    address: { ...mockAddress },
    sealId: 'fern',
    sealColor: '#991b1b',
    sealMonogram: 'E',
    payloadKind: 'text',
    deliveryMode: 'instant',
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

function blankAddress(): LetterAddress {
  return { name: '', street: '', city: '', postcode: '', country: '' };
}

function blankDraft(): LetterDraftState {
  return {
    ...defaultDraft(),
    id: `draft-${crypto.randomUUID()}`,
    recipient: '',
    subject: '',
    content: '',
    address: blankAddress(),
    sealId: 'fern',
    sealColor: '#991b1b',
    sealMonogram: '',
    payloadKind: 'text',
    deliveryMode: 'instant',
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

function hydrateDraft(value: Partial<LetterDraftState>): LetterDraftState {
  const fallback = defaultDraft();
  const legacy = value as Partial<LetterDraftState> & {
    inviteFollowUp?: { username?: unknown; method?: unknown; status?: unknown; manualLinkAvailable?: unknown };
  };
  const rawProgress = legacy.recipientInviteProgress ?? legacy.inviteFollowUp;
  const rawStatus = rawProgress?.status ?? legacy.inviteFollowUp?.method;
  const inviteUsername = typeof rawProgress?.username === 'string'
    ? normalizeDropRecipient(rawProgress.username)
    : null;
  const hydrated: LetterDraftState = {
    ...fallback,
    ...value,
    payloadKind: value.payloadKind ?? 'text',
    deliveryMode: value.deliveryMode ?? 'instant',
    address: { ...mockAddress, ...(value.address ?? {}) },
  };
  if (inviteUsername && ['shared', 'copied', 'cancelled', 'unavailable'].includes(String(rawStatus))) {
    const manualLinkAvailable = rawProgress?.manualLinkAvailable === true || rawStatus === 'unavailable';
    hydrated.recipientInviteProgress = {
      username: inviteUsername,
      status: rawStatus as RecipientInviteProgressStatus,
      ...(manualLinkAvailable ? { manualLinkAvailable: true } : {}),
    };
  } else {
    delete hydrated.recipientInviteProgress;
  }
  delete (hydrated as LetterDraftState & { inviteFollowUp?: unknown }).inviteFollowUp;
  return hydrated;
}

function canUseStorage() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readStoredLetterDraft(accountId = getLocalAccountId()): LetterDraftState | null {
  if (!canUseStorage()) return null;

  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(STORAGE_KEY, accountId));
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<LetterDraftState>;
    return hydrateDraft(parsed);
  } catch {
    return null;
  }
}

export function getLetterDraft(accountId = getLocalAccountId()): LetterDraftState {
  return readStoredLetterDraft(accountId) ?? defaultDraft();
}

function getDraftHistory(accountId = getLocalAccountId()): LetterDraftState[] {
  if (!canUseStorage()) return [];

  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(DRAFT_HISTORY_STORAGE_KEY, accountId));
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Array<Partial<LetterDraftState>>;
    return Array.isArray(parsed) ? parsed.map(hydrateDraft) : [];
  } catch {
    return [];
  }
}

function saveDraftHistory(drafts: LetterDraftState[], accountId = getLocalAccountId()) {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(localAccountStorageKey(DRAFT_HISTORY_STORAGE_KEY, accountId), JSON.stringify(drafts));
    return true;
  } catch {
    // The active letter remains usable when storage is blocked or full.
    return false;
  }
}

export interface DeletedDraftSnapshot {
  accountId: string | null;
  active: string | null;
  drafts: string | null;
  letters: string | null;
}

function canDeleteDraft(draft: LetterDraftState | null | undefined) {
  return Boolean(draft
    && (draft.status === 'draft' || draft.status === 'sealed')
    && !draft.localDemo
    && !mockLetters.some((letter) => letter.id === draft.id && letter.sample));
}

export function canDeleteLocalDraft(id: string, accountId = getLocalAccountId()) {
  const active = readStoredLetterDraft(accountId);
  const saved = getDraftHistory(accountId).find((draft) => draft.id === id);
  const stored = active?.id === id ? active : saved;
  return canDeleteDraft(stored);
}

export function deleteLocalDraft(id: string, accountId = getLocalAccountId()):
  | { status: 'deleted'; snapshot: DeletedDraftSnapshot; nextDraft: LetterDraftState }
  | { status: 'not-found' | 'not-deletable' }
  | { status: 'storage-error'; restored: boolean } {
  if (!canUseStorage()) return { status: 'not-found' };
  const activeKey = localAccountStorageKey(STORAGE_KEY, accountId);
  const draftsKey = localAccountStorageKey(DRAFT_HISTORY_STORAGE_KEY, accountId);
  const lettersKey = localAccountStorageKey(HISTORY_STORAGE_KEY, accountId);
  let snapshot: DeletedDraftSnapshot;
  try {
    snapshot = {
      accountId,
      active: window.localStorage.getItem(activeKey),
      drafts: window.localStorage.getItem(draftsKey),
      letters: window.localStorage.getItem(lettersKey),
    };
  } catch {
    return { status: 'storage-error', restored: true };
  }
  const active = readStoredLetterDraft(accountId);
  const history = getDraftHistory(accountId);
  const target = active?.id === id ? active : history.find((draft) => draft.id === id);
  if (!target) return { status: 'not-found' };
  if (!canDeleteDraft(target)) return { status: 'not-deletable' };

  const remainingDrafts = history.filter((draft) => draft.id !== id);
  const nextDraft = active?.id === id
    ? remainingDrafts.filter(canDeleteDraft).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? blankDraft()
    : active && canDeleteDraft(active) ? active : blankDraft();
  const letters = getLetterHistory(accountId);
  const nextLetters = letters.filter((letter) => letter.id !== id);

  try {
    if (history.some((draft) => draft.id === id)) window.localStorage.setItem(draftsKey, JSON.stringify(remainingDrafts));
    if (letters.some((letter) => letter.id === id)) window.localStorage.setItem(lettersKey, JSON.stringify(nextLetters));
    if (nextDraft.id !== active?.id) window.localStorage.setItem(activeKey, JSON.stringify(nextDraft));
  } catch {
    return { status: 'storage-error', restored: restoreDeletedDraft(snapshot) };
  }
  return { status: 'deleted', snapshot, nextDraft };
}

export function restoreDeletedDraft(snapshot: DeletedDraftSnapshot) {
  try {
    if (!canUseStorage()) return false;
    const entries: Array<[string, string | null]> = [
      [localAccountStorageKey(STORAGE_KEY, snapshot.accountId), snapshot.active],
      [localAccountStorageKey(DRAFT_HISTORY_STORAGE_KEY, snapshot.accountId), snapshot.drafts],
      [localAccountStorageKey(HISTORY_STORAGE_KEY, snapshot.accountId), snapshot.letters],
    ];
    entries.forEach(([key, value]) => {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    });
    return true;
  } catch {
    return false;
  }
}

/** Return a complete local draft, including an older letter saved before a new one was started. */
export function getLetterDraftById(id: string, accountId = getLocalAccountId()): LetterDraftState | null {
  const active = readStoredLetterDraft(accountId);
  if (active?.id === id) return active;
  const saved = getDraftHistory(accountId).find((draft) => draft.id === id);
  if (saved) return saved;
  if (id === currentFocusDraft.id) return active ? null : defaultDraft();

  // Older seeded letters pre-date the complete local draft format. Hydrate the
  // small amount of information needed to continue their flow instead of
  // sending a visible mailbox action to a dead end.
  const seededLetter = mockLetters.find((letter) => letter.id === id);
  if (!seededLetter) return null;
  return hydrateDraft({
    id: seededLetter.id,
    recipient: seededLetter.recipient,
    subject: seededLetter.subject,
    content: seededLetter.excerpt,
    address: { name: seededLetter.recipient, street: '', city: '', postcode: '', country: '' },
    sealId: seededLetter.sealId ?? 'heart',
    sealColor: seededLetter.sealColor,
    sealMonogram: seededLetter.sealMonogram,
    status: seededLetter.status,
    updatedAt: new Date().toISOString(),
  });
}

/** Return only a draft persisted in the requested account's storage scope. */
export function getStoredLetterDraftById(id: string, accountId = getLocalAccountId()): LetterDraftState | null {
  const active = readStoredLetterDraft(accountId);
  if (active?.id === id) return active;
  return getDraftHistory(accountId).find((draft) => draft.id === id) ?? null;
}

export function getGuestDraftById(id: string): LetterDraftState | null {
  const active = readStoredLetterDraft(null);
  return active?.id === id ? active : getDraftHistory(null).find((item) => item.id === id) ?? null;
}

export async function copyGuestDraftToAccount(
  id: string,
  accountId: string,
  copyAttachment?: (draftId: string, accountId: string, targetDraftId: string) => Promise<'copied' | 'existing' | false>,
  rollbackAttachment?: (draftId: string, accountId: string) => Promise<void>,
): Promise<LetterDraftState | null> {
  if (!accountId || !canUseStorage()) return null;
  const draft = getGuestDraftById(id);
  if (!draft) return null;

  const activeTarget = readStoredLetterDraft(accountId);
  const targetDrafts = getDraftHistory(accountId);
  const historyCopy = targetDrafts.find((item) => item.id === id);
  const alreadyTransferred = activeTarget?.id !== id
    && historyCopy
    && JSON.stringify(historyCopy) === JSON.stringify(draft);
  const transferredDraft = alreadyTransferred
    ? historyCopy
    : activeTarget?.id === id || historyCopy
      ? { ...draft, id: `draft-${crypto.randomUUID()}` }
      : draft;

  let copiedAttachment = false;
  if (draft.payloadKind !== 'text') {
    try {
      if (!copyAttachment) return null;
      const result = await copyAttachment(id, accountId, transferredDraft.id);
      if (!result) return null;
      copiedAttachment = result === 'copied';
    } catch {
      return null;
    }
  }

  const preservedDrafts = activeTarget
    ? [...targetDrafts.filter((item) => item.id !== activeTarget.id), activeTarget]
    : targetDrafts;
  const nextDrafts = alreadyTransferred ? preservedDrafts : [...preservedDrafts, transferredDraft];
  if (saveDraftHistory(nextDrafts, accountId)) return transferredDraft;

  if (copiedAttachment && rollbackAttachment) {
    try {
      await rollbackAttachment(transferredDraft.id, accountId);
    } catch { /* A leftover private blob is safer than obscuring the transfer failure. */ }
  }
  return null;
}

/** Make a complete draft the active working letter for a focused flow such as dispatch. */
export function setActiveLetterDraft(draft: LetterDraftState): LetterDraftState {
  const next = hydrateDraft(draft);
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY), JSON.stringify(next));
    } catch {
      // The caller can continue with the in-memory copy.
    }
  }
  return next;
}

export function saveLetterDraft(
  updates: Partial<Omit<LetterDraftState, 'updatedAt'>>
): LetterDraftState {
  const next = {
    ...getLetterDraft(),
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  if (next.recipientInviteProgress === undefined) delete next.recipientInviteProgress;

  if (canUseStorage()) {
    try {
      window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY), JSON.stringify(next));
    } catch {
      // The app remains usable when storage is blocked or full.
    }
  }

  return next;
}

export function isLetterDraftPersisted(
  draft: LetterDraftState,
  accountId = getLocalAccountId(),
): boolean {
  const stored = readStoredLetterDraft(accountId);
  return Boolean(stored && JSON.stringify(stored) === JSON.stringify(hydrateDraft(draft)));
}

/** Persist a stable finalized-media ID for a restored media draft before retryable upload flows. */
export function ensureLetterDraftMediaUploadId(
  draft: LetterDraftState,
  accountId = getLocalAccountId(),
): LetterDraftState | null {
  if (getLocalAccountId() !== accountId
    || (draft.payloadKind !== 'image' && draft.payloadKind !== 'gif')
    || !isLetterDraftPersisted(draft, accountId)) return null;
  if (draft.mediaUploadId) return draft;

  const next = setActiveLetterDraft({
    ...draft,
    mediaUploadId: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  });
  return isLetterDraftPersisted(next, accountId) ? next : null;
}

function updateDraftById(
  draftId: string,
  accountId: string | null,
  updates: Partial<Omit<LetterDraftState, 'id' | 'updatedAt'>>,
  expectedProgressUsername?: string,
): LetterDraftState | null {
  if (!canUseStorage() || getLocalAccountId() !== accountId) return null;

  const active = readStoredLetterDraft(accountId);
  if (active?.id === draftId) {
    if (expectedProgressUsername && active.recipientInviteProgress?.username !== expectedProgressUsername) return null;
    if (updates.recipientInviteProgress
      && normalizeDropRecipient(active.recipient) !== updates.recipientInviteProgress.username) return null;
    const updated = hydrateDraft({ ...active, ...updates, updatedAt: new Date().toISOString() });
    try {
      window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY, accountId), JSON.stringify(updated));
      return updated;
    } catch {
      return null;
    }
  }

  const history = getDraftHistory(accountId);
  const index = history.findIndex((draft) => draft.id === draftId);
  if (index < 0) return null;
  if (expectedProgressUsername && history[index].recipientInviteProgress?.username !== expectedProgressUsername) return null;
  if (updates.recipientInviteProgress
    && normalizeDropRecipient(history[index].recipient) !== updates.recipientInviteProgress.username) return null;
  const updated = hydrateDraft({ ...history[index], ...updates, updatedAt: new Date().toISOString() });
  history[index] = updated;
  return saveDraftHistory(history, accountId) ? updated : null;
}

export function recordRecipientInviteProgress(
  draftId: string,
  accountId: string | null,
  username: string,
  status: RecipientInviteProgressStatus,
  manualLinkAvailable = status === 'unavailable',
): LetterDraftState | null {
  const normalizedUsername = normalizeDropRecipient(username);
  if (!normalizedUsername) return null;
  return updateDraftById(draftId, accountId, {
    recipientInviteProgress: {
      username: normalizedUsername,
      status,
      ...(manualLinkAvailable ? { manualLinkAvailable: true } : {}),
    },
  });
}

export function clearRecipientInviteProgressForDraft(
  draftId: string,
  accountId: string | null,
  expectedUsername?: string,
): LetterDraftState | null {
  const normalizedUsername = expectedUsername ? normalizeDropRecipient(expectedUsername) : undefined;
  return updateDraftById(draftId, accountId, { recipientInviteProgress: undefined }, normalizedUsername ?? undefined);
}

function getLetterHistory(accountId = getLocalAccountId()): MockLetter[] {
  if (!canUseStorage()) return [];

  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(HISTORY_STORAGE_KEY, accountId));
    if (!stored) return [];
    const parsed = JSON.parse(stored) as MockLetter[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLetterHistory(letters: MockLetter[], accountId = getLocalAccountId()) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(localAccountStorageKey(HISTORY_STORAGE_KEY, accountId), JSON.stringify(letters));
  } catch {
    // The active letter remains usable when storage is blocked or full.
  }
}

export function startNewLetter(): LetterDraftState {
  const current = getLetterDraft();

  // Avoid creating a second blank letter during React's development remount.
  if (current.id.startsWith('draft-') && current.status === 'draft' && !current.content.trim()) {
    return current;
  }

  const history = getLetterHistory().filter((letter) => letter.id !== current.id);
  saveLetterHistory([...history, draftAsLetter(current)]);
  const draftHistory = getDraftHistory().filter((draft) => draft.id !== current.id);
  saveDraftHistory([...draftHistory, current]);

  const next = blankDraft();
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY), JSON.stringify(next));
    } catch {
      // The new letter still works for the current session.
    }
  }
  return next;
}

function getStoredNotes(): Record<string, JourneyNote[]> {
  if (!canUseStorage()) return {};

  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(NOTES_STORAGE_KEY));
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, JourneyNote[]> | JourneyNote[];
    // Migrate the original single-list format to the seeded letter only.
    if (Array.isArray(parsed)) return { [currentFocusDraft.id]: parsed };
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getJourneyNotes(letterId = currentFocusDraft.id): JourneyNote[] {
  if (!canUseStorage()) return letterId === currentFocusDraft.id ? [...mockFieldNotes] : [];

  try {
    const notes = getStoredNotes()[letterId];
    if (Array.isArray(notes)) return notes;
    return letterId === currentFocusDraft.id ? [...mockFieldNotes] : [];
  } catch {
    return letterId === currentFocusDraft.id ? [...mockFieldNotes] : [];
  }
}

export function saveJourneyNotes(notes: JourneyNote[], letterId = currentFocusDraft.id) {
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(localAccountStorageKey(NOTES_STORAGE_KEY), JSON.stringify({ ...getStoredNotes(), [letterId]: notes }));
    } catch {
      // The journal remains usable for the current session.
    }
  }
}

export function completeSuccessfulSend(
  submittedDraft: LetterDraftState,
  accountId: string | null,
  status: LetterStatus,
  dispatchedAt: string,
  metadata: Pick<LetterDraftState, 'mediaPath' | 'mediaMimeType' | 'mediaSizeBytes'>,
): LetterDraftState | null {
  if (!canUseStorage() || getLocalAccountId() !== accountId) return null;

  const activeKey = localAccountStorageKey(STORAGE_KEY, accountId);
  const draftsKey = localAccountStorageKey(DRAFT_HISTORY_STORAGE_KEY, accountId);
  const lettersKey = localAccountStorageKey(HISTORY_STORAGE_KEY, accountId);
  let previous: Array<[string, string | null]>;
  try {
    previous = [activeKey, draftsKey, lettersKey].map((key) => [key, window.localStorage.getItem(key)]);
  } catch {
    return null;
  }

  const active = readStoredLetterDraft(accountId);
  const history = getDraftHistory(accountId);
  const source = active?.id === submittedDraft.id ? active : history.find((draft) => draft.id === submittedDraft.id);
  const normalizedRecipient = normalizeDropRecipient(submittedDraft.recipient);
  const submittedComposition = [
    submittedDraft.recipient,
    submittedDraft.subject,
    submittedDraft.content,
    submittedDraft.fontSize,
    submittedDraft.alignment,
    submittedDraft.address,
    submittedDraft.sealId,
    submittedDraft.sealColor,
    submittedDraft.sealMonogram,
    submittedDraft.payloadKind,
    submittedDraft.deliveryMode,
    submittedDraft.mediaPath,
    submittedDraft.mediaMimeType,
    submittedDraft.mediaSizeBytes,
    submittedDraft.mediaUploadId,
    submittedDraft.status,
  ];
  const currentComposition = source && [
    source.recipient,
    source.subject,
    source.content,
    source.fontSize,
    source.alignment,
    source.address,
    source.sealId,
    source.sealColor,
    source.sealMonogram,
    source.payloadKind,
    source.deliveryMode,
    source.mediaPath,
    source.mediaMimeType,
    source.mediaSizeBytes,
    source.mediaUploadId,
    source.status,
  ];
  if (!source || !normalizedRecipient || normalizeDropRecipient(source.recipient) !== normalizedRecipient
    || JSON.stringify(currentComposition) !== JSON.stringify(submittedComposition)) return null;

  const next = hydrateDraft({
    ...source,
    ...metadata,
    ...(source.recipientInviteProgress?.username === normalizedRecipient ? { recipientInviteProgress: undefined } : {}),
    status,
    dispatchedAt,
    updatedAt: new Date().toISOString(),
  });
  const nextDraftHistory = [...history.filter((draft) => draft.id !== submittedDraft.id), next];
  const nextLetterHistory = [...getLetterHistory(accountId).filter((letter) => letter.id !== submittedDraft.id), draftAsLetter(next)];

  try {
    window.localStorage.setItem(draftsKey, JSON.stringify(nextDraftHistory));
    if (active?.id === submittedDraft.id) window.localStorage.setItem(activeKey, JSON.stringify(next));
    window.localStorage.setItem(lettersKey, JSON.stringify(nextLetterHistory));
    return next;
  } catch {
    try {
      previous.forEach(([key, value]) => {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      });
    } catch {
      // Keep the send result authoritative; recovery remains available through the account sync.
    }
    return null;
  }
}

export function dispatchLetter(letterId = getLetterDraft().id, status: LetterStatus = 'dispatched', dispatchedAt = new Date().toISOString()): LetterDraftState {
  const source = getLetterDraftById(letterId) ?? getLetterDraft();
  return completeSuccessfulSend(source, getLocalAccountId(), status, dispatchedAt, {
    mediaPath: source.mediaPath,
    mediaMimeType: source.mediaMimeType,
    mediaSizeBytes: source.mediaSizeBytes,
  }) ?? source;
}

export function saveLocalDemoDrop(letterId: string): LetterDraftState | null {
  const source = getLetterDraftById(letterId);
  if (!canUseStorage() || !source || source.status !== 'draft' || source.deliveryMode !== 'instant' || !normalizeDropRecipient(source.recipient) || (source.payloadKind === 'text' && !source.content.trim())) return null;
  setActiveLetterDraft({ ...source, localDemo: true });
  return dispatchLetter(source.id, 'delivered');
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(isoDate));
}

export function draftAsLetter(draft: LetterDraftState): MockLetter {
  return {
    id: draft.id,
    recipient: draft.address.name || draft.recipient,
    date: formatDate(draft.dispatchedAt ?? draft.updatedAt),
    activityAt: draft.dispatchedAt ?? draft.updatedAt,
    status: draft.status,
    excerpt: draft.content.trim() || (draft.payloadKind === 'text' ? 'An empty drop, waiting for your words.' : 'A little moment worth sharing.'),
    subject: draft.subject || 'A little moment',
    direction: 'sent',
    sealId: draft.sealId ?? undefined,
    sealColor: draft.sealColor,
    sealMonogram: draft.sealMonogram,
    payloadKind: draft.payloadKind,
    deliveryMode: draft.deliveryMode,
    mediaPath: draft.mediaPath,
    mediaMimeType: draft.mediaMimeType,
    mediaSizeBytes: draft.mediaSizeBytes,
    ...(draft.recipientInviteProgress ? { recipientInviteProgress: draft.recipientInviteProgress } : {}),
    localDemo: draft.localDemo,
  };
}

export function getLettersWithDraft(draft = getLetterDraft()): MockLetter[] {
  const activeLetter = draftAsLetter(draft);
  const demoReactions = getDemoReactions();
  const withLocalReaction = (letter: MockLetter) => ({
    ...letter,
    ...(mockLetters.some((seed) => seed.id === letter.id && seed.sample) ? { sample: true } : {}),
    ...(letter.localDemo && demoReactions[letter.id] ? { reaction: demoReactions[letter.id] } : {}),
  });
  const letters = new Map(mockLetters.map((letter) => [
    letter.id,
    letter.direction === 'received' && demoReactions[letter.id]
      ? { ...letter, reaction: demoReactions[letter.id] }
      : letter,
  ]));

  // Once the original seeded draft becomes a new letter, the stale seed should
  // not keep appearing beside the user's real history.
  if (draft.id !== currentFocusDraft.id) letters.delete(currentFocusDraft.id);
  getLetterHistory().forEach((letter) => letters.set(letter.id, withLocalReaction(letter)));
  getDraftHistory().forEach((savedDraft) => letters.set(savedDraft.id, withLocalReaction(draftAsLetter(savedDraft))));
  letters.set(activeLetter.id, withLocalReaction(activeLetter));

  return Array.from(letters.values()).sort((a, b) => {
    if (a.id === activeLetter.id) return -1;
    if (b.id === activeLetter.id) return 1;
    return 0;
  });
}

export function getLetterById(id: string) {
  return getLettersWithDraft().find((letter) => letter.id === id);
}
