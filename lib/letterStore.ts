import { currentFocusDraft, mockAddress, mockFieldNotes, mockLetters } from '@/data/mockData';
import type { LetterStatus, MockLetter } from '@/data/mockData';

const STORAGE_KEY = 'dear-exe:active-letter:v1';
const NOTES_STORAGE_KEY = 'dear-exe:journey-notes:v1';
const HISTORY_STORAGE_KEY = 'dear-exe:letter-history:v1';

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
    sealId: null,
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
    sealId: null,
    status: 'draft',
    updatedAt: new Date().toISOString(),
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
    return {
      ...defaultDraft(),
      ...parsed,
      address: { ...mockAddress, ...(parsed.address ?? {}) },
    };
  } catch {
    return defaultDraft();
  }
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

export function getJourneyNotes(): JourneyNote[] {
  if (!canUseStorage()) return [...mockFieldNotes];

  try {
    const stored = window.localStorage.getItem(NOTES_STORAGE_KEY);
    if (!stored) return [...mockFieldNotes];
    const parsed = JSON.parse(stored) as JourneyNote[];
    return Array.isArray(parsed) ? parsed : [...mockFieldNotes];
  } catch {
    return [...mockFieldNotes];
  }
}

export function saveJourneyNotes(notes: JourneyNote[]) {
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch {
      // The journal remains usable for the current session.
    }
  }
}

export function dispatchLetter(): LetterDraftState {
  const dispatched = saveLetterDraft({
    status: 'dispatched',
    dispatchedAt: new Date().toISOString(),
  });
  const history = getLetterHistory().filter((letter) => letter.id !== dispatched.id);
  saveLetterHistory([...history, draftAsLetter(dispatched)]);
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
  };
}

export function getLettersWithDraft(draft = getLetterDraft()): MockLetter[] {
  const activeLetter = draftAsLetter(draft);
  const letters = new Map(mockLetters.map((letter) => [letter.id, letter]));

  // Once the original seeded draft becomes a new letter, the stale seed should
  // not keep appearing beside the user's real history.
  if (draft.id !== currentFocusDraft.id) letters.delete(currentFocusDraft.id);
  getLetterHistory().forEach((letter) => letters.set(letter.id, letter));
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
