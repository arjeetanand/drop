import { getLocalAccountId, localAccountStorageKey } from './localAccountScope.ts';

// GPS utilities for the human relay system.
// Uses browser-native geolocation + Nominatim for reverse geocoding (no API key).

export interface LatLng {
  lat: number;
  lng: number;
}

function isValidLatLng(value: { lat: number; lng: number }): boolean {
  return Number.isFinite(value.lat)
    && Number.isFinite(value.lng)
    && value.lat >= -90
    && value.lat <= 90
    && value.lng >= -180
    && value.lng <= 180;
}

export interface GpsWaypoint {
  coords: LatLng;
  neighborhood: string;  // human-readable neighborhood, never exact address
  timestamp: string;     // ISO string
  carrierName: string;
  carrierNote?: string;
}

// Earth radius in km
const EARTH_RADIUS_KM = 6371;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine formula — great-circle distance between two points in km */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const chord =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

/** True if two carriers are close enough for a verified handoff (≤ 50m) */
export function isWithinHandoffRange(a: LatLng, b: LatLng): boolean {
  return haversineDistanceKm(a, b) <= 0.05;
}

/** Distance display helper */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

/**
 * Reverse geocode lat/lng to a neighborhood name via Nominatim.
 * Returns a human-readable area name, never a full address.
 * Falls back gracefully if the network request fails.
 */
export async function reverseGeocode(coords: LatLng): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=14&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'DearExe-HumanRelay/1.0' },
    });
    if (!response.ok) throw new Error('Nominatim request failed');
    const data = await response.json() as {
      address?: {
        neighbourhood?: string;
        suburb?: string;
        quarter?: string;
        city_district?: string;
        town?: string;
        city?: string;
        county?: string;
      };
    };
    const addr = data.address ?? {};
    return (
      addr.neighbourhood ||
      addr.suburb ||
      addr.quarter ||
      addr.city_district ||
      addr.town ||
      addr.city ||
      addr.county ||
      'Unknown area'
    );
  } catch {
    // Never expose precise coordinates when reverse geocoding is unavailable.
    return 'Nearby area';
  }
}

/**
 * Get the current position as a Promise.
 * Rejects with a friendly message if permission denied.
 */
export function getCurrentPosition(
  options?: PositionOptions
): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const messages: Record<number, string> = {
          1: 'Location permission denied. Please allow location access to carry letters.',
          2: 'Location unavailable. Try moving to an area with better signal.',
          3: 'Location request timed out. Please try again.',
        };
        reject(new Error(messages[err.code] ?? 'Location error.'));
      },
      { timeout: 10000, maximumAge: 30000, ...options }
    );
  });
}

/**
 * Watch position — returns a cleanup function.
 * Calls onUpdate each time GPS reports a new position.
 * Calls onError on failure.
 */
export function watchPosition(
  onUpdate: (coords: LatLng) => void,
  onError?: (message: string) => void
): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.('Geolocation not available.');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (err) => onError?.(err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

// --- PIN handoff helpers ---

/** Generate a random 4-digit PIN string */
export function generateHandoffPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const PIN_STORAGE_KEY = 'dear-exe:handoff-pin:v1';

export interface PinRecord {
  letterId: string;
  pin: string;
  carrierCoords: LatLng;
  neighborhood: string;
  createdAt: string;
}

export function storeHandoffPin(record: PinRecord): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(localAccountStorageKey(PIN_STORAGE_KEY), JSON.stringify(record));
  } catch { /* storage full or blocked */ }
}

export function getHandoffPin(letterId: string): PinRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(PIN_STORAGE_KEY));
    if (!stored) return null;
    const record = JSON.parse(stored) as PinRecord;
    return record.letterId === letterId ? record : null;
  } catch {
    return null;
  }
}

export function clearHandoffPin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(localAccountStorageKey(PIN_STORAGE_KEY));
  } catch { /* ignore */ }
}

// --- QR handoff payload helpers ---

export interface HandoffQRPayload {
  letterId: string;
  pin: string;
  lat: number;
  lng: number;
  neighborhood: string;
  subject: string;
  destination: string;
  createdAt: string; // ISO string — used to enforce TTL
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Encode a handoff payload into a base64url string suitable for embedding in a URL.
 * The QR encodes the full URL: /relay/scan?d=<encoded>
 */
export function buildHandoffQRPayload(payload: HandoffQRPayload): string {
  try {
    const json = JSON.stringify(payload);
    // Encode UTF-8 before base64 so subjects and destinations can contain any language.
    return encodeUtf8Base64(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '~');
  } catch {
    return '';
  }
}

/**
 * Decode and validate a QR payload string.
 * Returns null if the string is malformed.
 */
export function parseHandoffQRPayload(encoded: string): HandoffQRPayload | null {
  try {
    // Restore standard base64 chars
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/~/g, '=');
    const json = decodeUtf8Base64(base64);
    const parsed = JSON.parse(json) as HandoffQRPayload;
    // Basic shape validation
    if (
      typeof parsed.letterId === 'string' &&
      typeof parsed.pin === 'string' &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      typeof parsed.neighborhood === 'string' &&
      typeof parsed.subject === 'string' &&
      typeof parsed.destination === 'string' &&
      /^\d{4}$/.test(parsed.pin) &&
      typeof parsed.createdAt === 'string' &&
      !Number.isNaN(new Date(parsed.createdAt).getTime()) &&
      isValidLatLng({ lat: parsed.lat, lng: parsed.lng })
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the QR payload has passed its TTL (default 10 minutes).
 */
export function isHandoffQRExpired(createdAt: string, ttlMinutes = 10): boolean {
  try {
    const created = new Date(createdAt).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(ttlMinutes) || ttlMinutes <= 0) return true;
    const now = Date.now();
    // A future-dated token is invalid rather than a way to extend its life.
    return created > now + 60_000 || now - created > ttlMinutes * 60 * 1000;
  } catch {
    return true; // treat unparseable dates as expired
  }
}

// --- Active carry state ---

const ACTIVE_CARRY_KEY = 'dear-exe:active-carry:v1';

export interface ActiveCarry {
  letterId: string;
  subject: string;
  recipient: string;
  acceptedAt: string;
  waypoints: GpsWaypoint[];
  destinationNeighborhood: string;
  /** Short-lived bearer capability for the next cross-device relay handoff. */
  successorToken?: string;
  successorExpiresAt?: string;
}

export function saveActiveCarry(carry: ActiveCarry, accountId = getLocalAccountId()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(localAccountStorageKey(ACTIVE_CARRY_KEY, accountId), JSON.stringify(carry));
  } catch { /* ignore */ }
}

export function getActiveCarry(accountId = getLocalAccountId()): ActiveCarry | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(localAccountStorageKey(ACTIVE_CARRY_KEY, accountId));
    if (!stored) return null;
    return JSON.parse(stored) as ActiveCarry;
  } catch {
    return null;
  }
}

export function clearActiveCarry(accountId = getLocalAccountId()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(localAccountStorageKey(ACTIVE_CARRY_KEY, accountId));
  } catch { /* ignore */ }
}
