import { currentFocusDraft, mockAddress, mockFieldNotes, mockLetters } from '@/data/mockData';
import type { LetterStatus, MockLetter } from '@/data/mockData';

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
  status: LetterStatus;
  updatedAt: string;
  dispatchedAt?: string;
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
    id: `draft-${Date.now()}`,
    recipient: '',
    subject: '',
    content: '',
    address: blankAddress(),
    sealId: 'fern',
    sealColor: '#991b1b',
    sealMonogram: '',
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

function hydrateDraft(value: Partial<LetterDraftState>): LetterDraftState {
  const fallback = defaultDraft();
  return {
    ...fallback,
    ...value,
    address: { ...mockAddress, ...(value.address ?? {}) },
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getLetterDraft(): LetterDraftState {
  if (!canUseStorage()) return defaultDraft();

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultDraft();

    const parsed = JSON.parse(stored) as Partial<LetterDraftState>;
    return hydrateDraft(parsed);
  } catch {
    return defaultDraft();
  }
}

function getDraftHistory(): LetterDraftState[] {
  if (!canUseStorage()) return [];

  try {
    const stored = window.localStorage.getItem(DRAFT_HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Array<Partial<LetterDraftState>>;
    return Array.isArray(parsed) ? parsed.map(hydrateDraft) : [];
  } catch {
    return [];
  }
}

function saveDraftHistory(drafts: LetterDraftState[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(DRAFT_HISTORY_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // The active letter remains usable when storage is blocked or full.
  }
}

/** Return a complete local draft, including an older letter saved before a new one was started. */
export function getLetterDraftById(id: string): LetterDraftState | null {
  const active = getLetterDraft();
  if (active.id === id) return active;
  const saved = getDraftHistory().find((draft) => draft.id === id);
  if (saved) return saved;

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

/** Make a complete draft the active working letter for a focused flow such as dispatch. */
export function setActiveLetterDraft(draft: LetterDraftState): LetterDraftState {
  const next = hydrateDraft(draft);
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The app remains usable when storage is blocked or full.
    }
  }

  return next;
}

function getLetterHistory(): MockLetter[] {
  if (!canUseStorage()) return [];

  try {
    const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
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
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(letters));
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The new letter still works for the current session.
    }
  }
  return next;
}

function getStoredNotes(): Record<string, JourneyNote[]> {
  if (!canUseStorage()) return {};

  try {
    const stored = window.localStorage.getItem(NOTES_STORAGE_KEY);
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
      window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify({ ...getStoredNotes(), [letterId]: notes }));
    } catch {
      // The journal remains usable for the current session.
    }
  }
}

export function dispatchLetter(letterId = getLetterDraft().id): LetterDraftState {
  const source = getLetterDraftById(letterId) ?? getLetterDraft();
  const activeSource = source.id === getLetterDraft().id ? source : setActiveLetterDraft(source);
  const dispatched = saveLetterDraft({
    status: 'dispatched',
    dispatchedAt: new Date().toISOString(),
  });
  const history = getLetterHistory().filter((letter) => letter.id !== dispatched.id);
  saveLetterHistory([...history, draftAsLetter(dispatched)]);
  const draftHistory = getDraftHistory().filter((draft) => draft.id !== dispatched.id && draft.id !== activeSource.id);
  saveDraftHistory([...draftHistory, dispatched]);
  return dispatched;
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
    excerpt: draft.content.trim() || 'An empty letter, waiting for your words.',
    subject: draft.subject || 'Untitled Letter',
    direction: 'sent',
    sealId: draft.sealId ?? undefined,
    sealColor: draft.sealColor,
    sealMonogram: draft.sealMonogram,
  };
}

export function getLettersWithDraft(draft = getLetterDraft()): MockLetter[] {
  const activeLetter = draftAsLetter(draft);
  const letters = new Map(mockLetters.map((letter) => [letter.id, letter]));

  // Once the original seeded draft becomes a new letter, the stale seed should
  // not keep appearing beside the user's real history.
  if (draft.id !== currentFocusDraft.id) letters.delete(currentFocusDraft.id);
  getLetterHistory().forEach((letter) => letters.set(letter.id, letter));
  getDraftHistory().forEach((savedDraft) => letters.set(savedDraft.id, draftAsLetter(savedDraft)));
  letters.set(activeLetter.id, activeLetter);

  return Array.from(letters.values()).sort((a, b) => {
    if (a.id === activeLetter.id) return -1;
    if (b.id === activeLetter.id) return 1;
    return 0;
  });
}

export function getLetterById(id: string) {
  return getLettersWithDraft().find((letter) => letter.id === id);
}
