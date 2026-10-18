import { currentFocusDraft, mockAddress, mockFieldNotes, mockLetters } from '../data/mockData.ts';
import type { DropDeliveryMode, DropPayloadKind, LetterStatus, MockLetter } from '../data/mockData.ts';
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
  return {
    ...fallback,
    ...value,
    payloadKind: value.payloadKind ?? 'text',
    deliveryMode: value.deliveryMode ?? 'instant',
    address: { ...mockAddress, ...(value.address ?? {}) },
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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

/** Return a complete local draft, including an older letter saved before a new one was started. */
export function getLetterDraftById(id: string, accountId = getLocalAccountId()): LetterDraftState | null {
  const active = readStoredLetterDraft(accountId);
  if (active?.id === id) return active;
  const saved = getDraftHistory(accountId).find((draft) => draft.id === id);
  if (saved) return saved;
  if (!active && id === currentFocusDraft.id) return defaultDraft();

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

  if (canUseStorage()) {
    try {
      window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY), JSON.stringify(next));
    } catch {
      // The app remains usable when storage is blocked or full.
    }
  }

  return next;
}

function getLetterHistory(): MockLetter[] {
  if (!canUseStorage()) return [];

  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(HISTORY_STORAGE_KEY));
    if (!stored) return [];
    const parsed = JSON.parse(stored) as MockLetter[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLetterHistory(letters: MockLetter[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(localAccountStorageKey(HISTORY_STORAGE_KEY), JSON.stringify(letters));
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

export function dispatchLetter(letterId = getLetterDraft().id, status: LetterStatus = 'dispatched', dispatchedAt = new Date().toISOString()): LetterDraftState {
  const source = getLetterDraftById(letterId) ?? getLetterDraft();
  const activeSource = source.id === getLetterDraft().id ? source : setActiveLetterDraft(source);
  const dispatched = saveLetterDraft({
    status,
    dispatchedAt,
  });
  const history = getLetterHistory().filter((letter) => letter.id !== dispatched.id);
  saveLetterHistory([...history, draftAsLetter(dispatched)]);
  const draftHistory = getDraftHistory().filter((draft) => draft.id !== dispatched.id && draft.id !== activeSource.id);
  saveDraftHistory([...draftHistory, dispatched]);
  return dispatched;
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
    status: draft.status,
    excerpt: draft.content.trim() || (draft.payloadKind === 'text' ? 'An empty letter, waiting for your words.' : 'A little moment worth sharing.'),
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
    localDemo: draft.localDemo,
  };
}

export function getLettersWithDraft(draft = getLetterDraft()): MockLetter[] {
  const activeLetter = draftAsLetter(draft);
  const demoReactions = getDemoReactions();
  const withLocalReaction = (letter: MockLetter) => letter.localDemo && demoReactions[letter.id]
    ? { ...letter, reaction: demoReactions[letter.id] }
    : letter;
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
