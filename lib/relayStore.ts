import type { TrackingEvent } from '@/data/mockData';

const STORAGE_KEY = 'dear-exe:relay-state:v1';
const DEFAULT_RELAY_ID = '3';

export type RelayRole = 'sender' | 'carrier' | 'recipient';

export interface RelayHandoff {
  id: string;
  name: string;
  role: RelayRole;
  location: string;
  note: string;
  createdAt: string;
  next?: boolean;
}

export interface RelayState {
  letterId: string;
  subject: string;
  recipient: string;
  passcode: string;
  startedAt: string;
  durationHours: number;
  handoffs: RelayHandoff[];
}

export interface RelayDetails {
  subject?: string;
  recipient?: string;
}

export interface RelayStats {
  carriers: number;
  cities: number;
  hours: number;
}

const seededRelay: RelayState = {
  letterId: DEFAULT_RELAY_ID,
  subject: 'Morning Light',
  recipient: 'Eleanor',
  passcode: 'MORNING-LIGHT',
  startedAt: '2026-08-26T07:12:00.000Z',
  durationHours: 14,
  handoffs: [
    {
      id: 'origin',
      name: 'You',
      role: 'sender',
      location: 'Portland',
      note: 'Sealed with care and started the relay.',
      createdAt: '2026-08-26T07:12:00.000Z',
    },
    {
      id: 'maya',
      name: 'Maya',
      role: 'carrier',
      location: 'Portland',
      note: 'Carried it across town after the morning market.',
      createdAt: '2026-08-26T09:04:00.000Z',
    },
    {
      id: 'jon',
      name: 'Jon',
      role: 'carrier',
      location: 'Nashville',
      note: 'Picked it up on the road and kept it moving.',
      createdAt: '2026-08-26T16:58:00.000Z',
    },
    {
      id: 'recipient',
      name: 'Eleanor',
      role: 'recipient',
      location: 'Nashville',
      note: 'The person this letter is trying to find.',
      createdAt: '2026-08-27T01:12:00.000Z',
      next: true,
    },
  ],
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function copyRelay(relay: RelayState): RelayState {
  return {
    ...relay,
    handoffs: relay.handoffs.map((handoff) => ({ ...handoff })),
  };
}

function createRelay(letterId: string, details: RelayDetails = {}): RelayState {
  const subject = details.subject?.trim() || 'A letter worth carrying';
  const recipient = details.recipient?.trim() || 'your correspondent';
  const now = new Date().toISOString();

  return {
    letterId,
    subject,
    recipient,
    passcode: `${letterId.toUpperCase()}-RELAY`,
    startedAt: now,
    durationHours: 0,
    handoffs: [
      {
        id: `origin-${letterId}`,
        name: 'You',
        role: 'sender',
        location: 'Your desk',
        note: 'The relay begins with you.',
        createdAt: now,
      },
      {
        id: `recipient-${letterId}`,
        name: recipient,
        role: 'recipient',
        location: details.recipient?.trim() || 'Their destination',
        note: 'Waiting at the end of the route.',
        createdAt: now,
        next: true,
      },
    ],
  };
}

function readStoredRelays(): Record<string, RelayState> {
  if (!canUseStorage()) return {};

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, RelayState>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredRelay(relay: RelayState) {
  if (!canUseStorage()) return;

  try {
    const relays = readStoredRelays();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...relays, [relay.letterId]: relay }));
  } catch {
    // The relay remains usable in memory when storage is blocked or full.
  }
}

export function getRelayState(letterId = DEFAULT_RELAY_ID, details: RelayDetails = {}): RelayState {
  const stored = readStoredRelays()[letterId];
  if (stored) return copyRelay(stored);
  if (letterId === DEFAULT_RELAY_ID) return copyRelay(seededRelay);
  return createRelay(letterId, details);
}

// Client components use this for their first render so the server and browser
// agree before localStorage is read inside an effect.
export function getInitialRelayState(): RelayState {
  return copyRelay(seededRelay);
}

export function saveRelayState(relay: RelayState) {
  saveStoredRelay(relay);
  return copyRelay(relay);
}

export function addRelayHandoff(
  letterId: string,
  details: { name: string; location: string; note?: string },
  relayDetails: RelayDetails = {}
): RelayState {
  const current = getRelayState(letterId, relayDetails);
  const now = new Date();
  const handoff: RelayHandoff = {
    id: `handoff-${now.getTime()}`,
    name: details.name.trim(),
    role: 'carrier',
    location: details.location.trim(),
    note: details.note?.trim() || 'Carried the letter forward.',
    createdAt: now.toISOString(),
  };
  const recipientIndex = current.handoffs.findIndex((item) => item.role === 'recipient');
  const nextHandoffs = [...current.handoffs];

  if (recipientIndex >= 0) {
    nextHandoffs.splice(recipientIndex, 0, handoff);
  } else {
    nextHandoffs.push(handoff);
  }

  const next = {
    ...current,
    handoffs: nextHandoffs,
    durationHours: Math.max(current.durationHours, current.durationHours + 2),
  };
  return saveRelayState(next);
}

export function getRelayStats(relay: RelayState): RelayStats {
  const carriers = relay.handoffs.filter((handoff) => handoff.role !== 'recipient').length;
  const cities = new Set(
    relay.handoffs
      .map((handoff) => handoff.location.trim().toLowerCase())
      .filter(Boolean)
  ).size;

  return {
    carriers,
    cities,
    hours: relay.durationHours,
  };
}

function formatEventDate(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(isoDate));
}

function formatEventTime(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(isoDate));
}

export function relayToTrackingEvents(relay: RelayState): TrackingEvent[] {
  return relay.handoffs.map((handoff, index, all) => {
    const isNext = Boolean(handoff.next);
    const isLast = index === all.length - 1;
    const status = handoff.role === 'sender'
      ? 'Relay started'
      : handoff.role === 'recipient'
        ? isNext ? `Waiting for ${handoff.name}` : 'Delivered'
        : `${handoff.name} carried it`;
    const note = handoff.role === 'sender'
      ? handoff.note
      : handoff.role === 'recipient'
        ? isNext ? `${handoff.name} is the next person this letter is trying to reach.` : handoff.note
        : `${handoff.note} Recorded in ${handoff.location}.`;

    return {
      id: handoff.id,
      status,
      note,
      date: formatEventDate(handoff.createdAt),
      time: formatEventTime(handoff.createdAt),
      done: !isNext,
      current: isNext || isLast,
    };
  });
}
