import type { TrackingEvent } from '@/data/mockData';
import { getHandoffPin, type LatLng, type GpsWaypoint } from '@/lib/gpsUtils';

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
  // GPS proof-of-carry fields (optional — only present after GPS-verified handoff)
  coords?: LatLng;
  neighborhood?: string;
  distanceClosedKm?: number;  // how much closer this carrier got the letter
}

export interface RelayState {
  letterId: string;
  subject: string;
  recipient: string;
  passcode: string;
  startedAt: string;
  durationHours: number;
  handoffs: RelayHandoff[];
  gpsWaypoints?: GpsWaypoint[];          // ordered GPS trail for the journey map
  destinationNeighborhood?: string;      // where the letter is ultimately heading
  currentCarrierName?: string;           // name of person currently holding the letter
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
  startedAt: '2026-09-13T07:12:00.000Z',
  durationHours: 6,
  destinationNeighborhood: 'Colaba',
  currentCarrierName: 'Priya',
  gpsWaypoints: [
    {
      coords: { lat: 19.0596, lng: 72.8295 },
      neighborhood: 'Bandra West',
      timestamp: '2026-09-13T07:12:00.000Z',
      carrierName: 'You',
      carrierNote: 'Sealed and started the relay at the café.',
    },
    {
      coords: { lat: 19.0176, lng: 72.8562 },
      neighborhood: 'Dadar',
      timestamp: '2026-09-13T09:30:00.000Z',
      carrierName: 'Arjun',
      carrierNote: 'Picked it up after the morning market.',
    },
    {
      coords: { lat: 18.9897, lng: 72.8307 },
      neighborhood: 'Worli',
      timestamp: '2026-09-13T11:45:00.000Z',
      carrierName: 'Priya',
      carrierNote: 'Currently carrying — heading south.',
    },
  ],
  handoffs: [
    {
      id: 'origin',
      name: 'You',
      role: 'sender',
      location: 'Bandra West',
      note: 'Sealed with care and started the relay.',
      createdAt: '2026-09-13T07:12:00.000Z',
      coords: { lat: 19.0596, lng: 72.8295 },
      neighborhood: 'Bandra West',
    },
    {
      id: 'arjun',
      name: 'Arjun',
      role: 'carrier',
      location: 'Dadar',
      note: 'Carried it after the morning market.',
      createdAt: '2026-09-13T09:30:00.000Z',
      coords: { lat: 19.0176, lng: 72.8562 },
      neighborhood: 'Dadar',
      distanceClosedKm: 5.4,
    },
    {
      id: 'priya',
      name: 'Priya',
      role: 'carrier',
      location: 'Worli',
      note: 'Currently heading south toward Colaba.',
      createdAt: '2026-09-13T11:45:00.000Z',
      coords: { lat: 18.9897, lng: 72.8307 },
      neighborhood: 'Worli',
      distanceClosedKm: 3.2,
    },
    {
      id: 'recipient',
      name: 'Eleanor',
      role: 'recipient',
      location: 'Colaba',
      note: 'The person this letter is trying to find.',
      createdAt: '2026-09-13T07:12:00.000Z',
      next: true,
      coords: { lat: 18.9220, lng: 72.8347 },
      neighborhood: 'Colaba',
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
    currentCarrierName: handoff.name,
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

// --- Available letters for carriers to pick up ---

export interface AvailableLetter {
  letterId: string;
  subject: string;
  recipientFirstName: string;
  destinationNeighborhood: string;
  currentNeighborhood: string;
  distanceKm: number;       // from carrier's current location to letter's current position
  remainingKm: number;      // from letter's position to destination
  waitingMinutes: number;   // how long letter has been waiting for a carrier
}

/** Mock letters awaiting a carrier near the user. In a real app this would be a server query. */
export function getNearbyLetters(userNeighborhood = 'Worli'): AvailableLetter[] {
  return [
    {
      letterId: DEFAULT_RELAY_ID,
      subject: 'Morning Light',
      recipientFirstName: 'Eleanor',
      destinationNeighborhood: 'Colaba',
      currentNeighborhood: userNeighborhood,
      distanceKm: 0.3,
      remainingKm: 8.2,
      waitingMinutes: 22,
    },
    {
      letterId: 'letter-ananya',
      subject: 'A Sunday Recipe',
      recipientFirstName: 'Ananya',
      destinationNeighborhood: 'Churchgate',
      currentNeighborhood: 'Prabhadevi',
      distanceKm: 1.1,
      remainingKm: 6.0,
      waitingMinutes: 47,
    },
  ];
}

/**
 * Record that a new carrier has accepted the letter.
 * Adds a GPS-stamped carrier handoff and updates the currentCarrierName.
 */
export function acceptCarry(
  letterId: string,
  details: { name: string; neighborhood: string; coords?: LatLng; note?: string },
  relayDetails: RelayDetails = {}
): RelayState {
  const current = getRelayState(letterId, relayDetails);
  const now = new Date();

  const waypoint: GpsWaypoint = {
    coords: details.coords ?? { lat: 0, lng: 0 },
    neighborhood: details.neighborhood,
    timestamp: now.toISOString(),
    carrierName: details.name,
    carrierNote: details.note ?? 'Accepted the letter.',
  };

  const handoff: RelayHandoff = {
    id: `handoff-${now.getTime()}`,
    name: details.name,
    role: 'carrier',
    location: details.neighborhood,
    note: details.note ?? 'Accepted the letter and started carrying.',
    createdAt: now.toISOString(),
    coords: details.coords,
    neighborhood: details.neighborhood,
  };

  const recipientIndex = current.handoffs.findIndex((h) => h.role === 'recipient');
  const nextHandoffs = [...current.handoffs];
  if (recipientIndex >= 0) {
    nextHandoffs.splice(recipientIndex, 0, handoff);
  } else {
    nextHandoffs.push(handoff);
  }

  const next: RelayState = {
    ...current,
    handoffs: nextHandoffs,
    currentCarrierName: details.name,
    gpsWaypoints: [...(current.gpsWaypoints ?? []), waypoint],
    durationHours: current.durationHours + 0,
  };

  return saveRelayState(next);
}

/**
 * Confirm a PIN-verified handoff between two carriers (legacy — kept as fallback).
 * Appends the new carrier's GPS waypoint to the relay trail.
 */
export function confirmHandoff(
  letterId: string,
  details: { name: string; neighborhood: string; coords?: LatLng; note?: string },
  relayDetails: RelayDetails = {}
): RelayState {
  return acceptCarry(letterId, details, relayDetails);
}

/**
 * Confirm a QR-based seamless handoff.
 *
 * Stamps TWO GPS waypoints:
 *   1. r1Coords — where the outgoing carrier was when they showed the QR
 *   2. r2Coords — where the incoming carrier was when they scanned it
 *
 * Marks the outgoing carrier's handoff as done and inserts the new carrier.
 */
export function confirmHandoffFromQR(
  letterId: string,
  r1: { coords: LatLng; neighborhood: string; pin: string },
  r2: { name: string; coords: LatLng; neighborhood: string; note?: string },
  relayDetails: RelayDetails = {}
): RelayState {
  if (!/^\d{4}$/.test(r1.pin)) {
    throw new Error('This handoff code is not valid. Ask the carrier to generate a fresh QR code.');
  }
  const storedPin = getHandoffPin(letterId);
  if (storedPin && storedPin.pin !== r1.pin) {
    throw new Error('This handoff code no longer matches the carrier. Ask them to generate a fresh QR code.');
  }

  const current = getRelayState(letterId, relayDetails);
  const now = new Date();

  // Waypoint for the exact handoff moment (R1's location when QR was shown)
  const r1Waypoint: GpsWaypoint = {
    coords: r1.coords,
    neighborhood: r1.neighborhood,
    timestamp: now.toISOString(),
    carrierName: current.currentCarrierName ?? 'Previous carrier',
    carrierNote: `Handoff point — QR scanned by ${r2.name}.`,
  };

  // Waypoint for R2's location when they scanned (may differ slightly from R1)
  const r2Waypoint: GpsWaypoint = {
    coords: r2.coords,
    neighborhood: r2.neighborhood,
    timestamp: now.toISOString(),
    carrierName: r2.name,
    carrierNote: r2.note ?? 'Accepted via QR scan.',
  };

  // Compute how much closer R2 is to the destination than R1 was (inline haversine)
  const destHandoff = current.handoffs.find((h) => h.role === 'recipient');
  const destCoords = destHandoff?.coords;
  let distanceClosedKm: number | undefined;
  if (destCoords) {
    const haversine = (a: LatLng, b: LatLng) => {
      const dLat = (b.lat - a.lat) * Math.PI / 180;
      const dLng = (b.lng - a.lng) * Math.PI / 180;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    };
    distanceClosedKm = Math.max(0, haversine(r1.coords, destCoords) - haversine(r2.coords, destCoords));
  }

  const newHandoff: RelayHandoff = {
    id: `qr-handoff-${now.getTime()}`,
    name: r2.name,
    role: 'carrier',
    location: r2.neighborhood,
    note: r2.note ?? 'Accepted via QR scan.',
    createdAt: now.toISOString(),
    coords: r2.coords,
    neighborhood: r2.neighborhood,
    distanceClosedKm,
  };

  const recipientIndex = current.handoffs.findIndex((h) => h.role === 'recipient');
  const nextHandoffs = [...current.handoffs];
  if (recipientIndex >= 0) {
    nextHandoffs.splice(recipientIndex, 0, newHandoff);
  } else {
    nextHandoffs.push(newHandoff);
  }

  const next: RelayState = {
    ...current,
    handoffs: nextHandoffs,
    currentCarrierName: r2.name,
    gpsWaypoints: [
      ...(current.gpsWaypoints ?? []),
      r1Waypoint,
      r2Waypoint,
    ],
    durationHours: current.durationHours,
  };

  return saveRelayState(next);
}
