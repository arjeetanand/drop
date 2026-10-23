import type { TrackingEvent } from '@/data/mockData';
import { getHandoffPin, type LatLng, type GpsWaypoint } from '@/lib/gpsUtils';
import { localAccountStorageKey } from '@/lib/localAccountScope';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isRelayToken, validateRelayHandoff, type RelayHandoffSubmission } from '@/lib/relayValidation';

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

export interface RelayRecipientCollection {
  isCollected: boolean;
  collectedAt?: string | null;
}

export interface RelayCollectionSource {
  direction?: 'sent' | 'received' | null;
  deliveryMode?: string | null;
  status?: string | null;
  activityAt?: string | null;
}

/** Only a sender's delivered relay can complete the recipient stop. */
export function getRelayRecipientCollection(
  letter: RelayCollectionSource | null | undefined,
): RelayRecipientCollection | undefined {
  if (letter?.direction !== 'sent' || letter.deliveryMode !== 'relay' || letter.status !== 'delivered') return undefined;

  return { isCollected: true, collectedAt: letter.activityAt };
}

export interface RelayRecipientCollectionState {
  letterId: string;
  collection: RelayRecipientCollection | undefined;
}

/** Keep a known terminal state when a refresh cannot read the sender's letter. */
export function mergeRelayRecipientCollectionState(
  previous: RelayRecipientCollectionState | null,
  letterId: string,
  letter: RelayCollectionSource | null | undefined,
): RelayRecipientCollectionState | null {
  if (!letter) return previous?.letterId === letterId ? previous : null;
  return { letterId, collection: getRelayRecipientCollection(letter) };
}

export interface RelayHandoffPresentation {
  isNext: boolean;
  isCollected: boolean;
  isComplete: boolean;
  label: string;
}

export function getRelayHandoffPresentation(
  handoff: Pick<RelayHandoff, 'role' | 'next'>,
  recipientCollection?: RelayRecipientCollection,
): RelayHandoffPresentation {
  const isCollected = handoff.role === 'recipient' && recipientCollection?.isCollected === true;
  const isNext = Boolean(handoff.next) && !isCollected;
  const label = isNext
    ? 'Next stop'
    : isCollected
      ? 'Collected'
      : handoff.role === 'sender'
        ? 'Started here'
        : handoff.role === 'recipient'
          ? 'Delivered'
          : 'Carried forward';

  return { isNext, isCollected, isComplete: !isNext, label };
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

export interface IssuedRelayToken {
  token: string;
  expiresAt: string;
}

export interface AcceptedRelayHandoff {
  handoffId: string;
  letterId: string;
  successorToken: string;
  successorExpiresAt: string;
}

export interface RelayHandoffStatus {
  accepted: boolean;
  acceptedBy?: string;
  acceptedAt?: string;
}

export interface CarrierRelayRouteEvent {
  id: string;
  carrierName: string;
  neighborhood: string;
  note: string;
  createdAt: string;
}

interface RelayHandoffRow {
  id: string;
  carrier_name: string;
  neighborhood: string;
  note: string;
  handoff_lat: number | null;
  handoff_lng: number | null;
  accepted_lat: number | null;
  accepted_lng: number | null;
  created_at: string;
}

interface RelayTokenRow {
  token: string;
  expires_at: string;
}

interface AcceptedRelayHandoffRow {
  handoff_id: string;
  letter_id: string;
  successor_token: string;
  successor_expires_at: string;
}

interface RelayHandoffStatusRow {
  accepted: boolean;
  accepted_by: string | null;
  accepted_at: string | null;
}

interface CarrierRelayRouteRow {
  handoff_id: string;
  carrier_name: string;
  neighborhood: string;
  carrier_note: string;
  created_at: string;
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
      note: 'The person this drop is trying to find.',
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
  const subject = details.subject?.trim() || 'A drop worth carrying';
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
    const stored = window.localStorage.getItem(localAccountStorageKey(STORAGE_KEY));
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
    window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY), JSON.stringify({ ...relays, [relay.letterId]: relay }));
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
    note: details.note?.trim() || 'Carried the drop forward.',
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

export function relayToTrackingEvents(
  relay: RelayState,
  recipientCollection?: RelayRecipientCollection,
): TrackingEvent[] {
  return relay.handoffs.map((handoff, index, all) => {
    const presentation = getRelayHandoffPresentation(handoff, recipientCollection);
    const isLast = index === all.length - 1;
    const collectedAt = presentation.isCollected
      && recipientCollection?.collectedAt
      && Number.isFinite(Date.parse(recipientCollection.collectedAt))
      ? recipientCollection.collectedAt
      : handoff.createdAt;
    const status = handoff.role === 'sender'
      ? 'Relay started'
      : handoff.role === 'recipient'
        ? presentation.isCollected ? 'Drop collected' : presentation.isNext ? `Waiting for ${handoff.name}` : 'Delivered'
        : `${handoff.name} carried it`;
    const note = handoff.role === 'sender'
      ? handoff.note
      : handoff.role === 'recipient'
        ? presentation.isCollected
          ? `${handoff.name} collected this drop.`
          : presentation.isNext ? `${handoff.name} is the next person this drop is trying to reach.` : handoff.note
        : `${handoff.note} Recorded in ${handoff.location}.`;

    return {
      id: handoff.id,
      status,
      note,
      date: formatEventDate(collectedAt),
      time: formatEventTime(collectedAt),
      done: presentation.isComplete,
      current: recipientCollection?.isCollected ? false : presentation.isNext || isLast,
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
 * Adds a carrier handoff and records a GPS waypoint when location is available.
 */
export function acceptCarry(
  letterId: string,
  details: { name: string; neighborhood: string; coords?: LatLng; note?: string },
  relayDetails: RelayDetails = {}
): RelayState {
  const current = getRelayState(letterId, relayDetails);
  const now = new Date();

  const handoff: RelayHandoff = {
    id: `handoff-${now.getTime()}`,
    name: details.name,
    role: 'carrier',
    location: details.neighborhood,
    note: details.note ?? 'Accepted the drop and started carrying.',
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
    gpsWaypoints: details.coords
      ? [...(current.gpsWaypoints ?? []), {
          coords: details.coords,
          neighborhood: details.neighborhood,
          timestamp: now.toISOString(),
          carrierName: details.name,
          carrierNote: details.note ?? 'Accepted the drop.',
        }]
      : current.gpsWaypoints,
    durationHours: current.durationHours + 0,
  };

  return saveRelayState(next);
}

/**
 * Confirm a PIN-verified handoff between two carriers (legacy — kept as fallback).
 * Records a GPS waypoint when the incoming carrier's location is available.
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
 * Records the outgoing carrier's handoff point and, when available, a waypoint for the incoming carrier:
 *   1. r1Coords — where the outgoing carrier was when they showed the QR
 *   2. r2Coords — where the incoming carrier was when they scanned it
 *
 * Marks the outgoing carrier's handoff as done and inserts the new carrier.
 */
export function confirmHandoffFromQR(
  letterId: string,
  r1: { coords: LatLng; neighborhood: string; pin: string },
  r2: { name: string; coords?: LatLng; neighborhood: string; note?: string },
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
  const r2Waypoint: GpsWaypoint | null = r2.coords ? {
    coords: r2.coords,
    neighborhood: r2.neighborhood,
    timestamp: now.toISOString(),
    carrierName: r2.name,
    carrierNote: r2.note ?? 'Accepted via QR scan.',
  } : null;

  // Compute how much closer R2 is to the destination than R1 was (inline haversine)
  const destHandoff = current.handoffs.find((h) => h.role === 'recipient');
  const destCoords = destHandoff?.coords;
  let distanceClosedKm: number | undefined;
  if (destCoords && r2.coords) {
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
      ...(r2Waypoint ? [r2Waypoint] : []),
    ],
    durationHours: current.durationHours,
  };

  return saveRelayState(next);
}

/** Issue the sender's first short-lived QR/manual pass for a dispatched relay. */
export async function issueRelayHandoffToken(letterId: string): Promise<IssuedRelayToken> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Relay handoffs need a connected Drop account.');

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error('Sign in as the sender to start this relay.');

  const { data, error } = await supabase.rpc('issue_relay_handoff_token', { p_letter_id: letterId });
  if (error) throw new Error(error.message || 'A relay handoff code could not be created.');

  const row = (Array.isArray(data) ? data[0] : data) as RelayTokenRow | null;
  if (!row || !isRelayToken(row.token) || !Number.isFinite(Date.parse(row.expires_at))) {
    throw new Error('The relay handoff code response was incomplete.');
  }

  return { token: row.token, expiresAt: row.expires_at };
}

/** Mint a fresh short-lived pass when the current carrier is ready to pass on. */
export async function issueRelayPassFromCarrier(carrierToken: string): Promise<IssuedRelayToken> {
  if (!isRelayToken(carrierToken)) throw new Error('This carrier code is invalid or expired.');
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Relay handoffs need a connected Drop service.');

  const { data, error } = await supabase.rpc('issue_relay_pass_from_carrier', { p_carrier_token: carrierToken });
  if (error) throw new Error(error.message || 'A fresh handoff code could not be created.');

  const row = (Array.isArray(data) ? data[0] : data) as RelayTokenRow | null;
  if (!row || !isRelayToken(row.token) || !Number.isFinite(Date.parse(row.expires_at))) {
    throw new Error('The relay handoff code response was incomplete.');
  }

  return { token: row.token, expiresAt: row.expires_at };
}

/**
 * Accept a one-time relay pass and atomically persist the handoff while
 * minting the next carrier's long-lived capability. The carrier receives route details
 * only; this endpoint never returns letter content or media.
 */
export async function acceptRelayHandoffToken(
  input: RelayHandoffSubmission & { token: string; requestId: string }
): Promise<AcceptedRelayHandoff> {
  if (!isRelayToken(input.token)) throw new Error('This handoff code is invalid or expired.');
  if (!isRelayToken(input.requestId)) throw new Error('This handoff request is incomplete.');
  const validationError = validateRelayHandoff(input);
  if (validationError) throw new Error(validationError);

  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Relay handoffs need a connected Drop service.');

  const { data, error } = await supabase.rpc('accept_relay_handoff_token', {
    p_token: input.token,
    p_request_id: input.requestId,
    p_carrier_name: input.name.trim(),
    p_neighborhood: input.neighborhood.trim(),
    p_note: input.note?.trim() || '',
    p_handoff_lat: input.handoffCoords?.lat ?? null,
    p_handoff_lng: input.handoffCoords?.lng ?? null,
    p_accepted_lat: input.acceptedCoords?.lat ?? null,
    p_accepted_lng: input.acceptedCoords?.lng ?? null,
  });
  if (error) throw new Error(error.message || 'This handoff code is invalid or expired.');

  const row = (Array.isArray(data) ? data[0] : data) as AcceptedRelayHandoffRow | null;
  if (!row || !isRelayToken(row.successor_token) || !Number.isFinite(Date.parse(row.successor_expires_at)) || !row.handoff_id || !row.letter_id) {
    throw new Error('The relay handoff response was incomplete.');
  }

  return {
    handoffId: row.handoff_id,
    letterId: row.letter_id,
    successorToken: row.successor_token,
    successorExpiresAt: row.successor_expires_at,
  };
}

/** Load participant-visible route events without loading letter body or media. */
export async function getRemoteRelayHandoffs(letterId: string): Promise<RelayHandoff[] | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data, error } = await supabase
    .from('relay_handoffs')
    .select('id, carrier_name, neighborhood, note, handoff_lat, handoff_lng, accepted_lat, accepted_lng, created_at')
    .eq('letter_id', letterId)
    .order('created_at', { ascending: true })
    .returns<RelayHandoffRow[]>();

  if (error || !data) return null;
  return data.map((row) => {
    const coords = row.accepted_lat !== null && row.accepted_lng !== null
      ? { lat: row.accepted_lat, lng: row.accepted_lng }
      : row.handoff_lat !== null && row.handoff_lng !== null
        ? { lat: row.handoff_lat, lng: row.handoff_lng }
        : undefined;
    return {
      id: row.id,
      name: row.carrier_name,
      role: 'carrier',
      location: row.neighborhood,
      neighborhood: row.neighborhood,
      note: row.note,
      createdAt: row.created_at,
      coords,
    };
  });
}

/** Load the route visible to an active carrier without exposing message or location data. */
export async function getCarrierRelayRoute(carrierToken: string): Promise<CarrierRelayRouteEvent[] | null> {
  if (!isRelayToken(carrierToken)) return null;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('get_carrier_relay_route', { p_carrier_token: carrierToken });
  if (error || !Array.isArray(data)) return null;
  return (data as CarrierRelayRouteRow[]).map((row) => ({
    id: row.handoff_id,
    carrierName: row.carrier_name,
    neighborhood: row.neighborhood,
    note: row.carrier_note,
    createdAt: row.created_at,
  }));
}

/** Check whether this carrier's short-lived handoff pass has been consumed. */
export async function getRelayHandoffStatus(token: string): Promise<RelayHandoffStatus | null> {
  if (!isRelayToken(token)) return null;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('get_relay_handoff_token_status', { p_token: token });
  if (error) return null;

  const row = (Array.isArray(data) ? data[0] : data) as RelayHandoffStatusRow | null;
  if (!row || typeof row.accepted !== 'boolean') return null;
  return {
    accepted: row.accepted,
    acceptedBy: row.accepted_by || undefined,
    acceptedAt: row.accepted_at || undefined,
  };
}
