import type { LatLng } from '@/lib/gpsUtils';

export const RELAY_TOKEN_TTL_SECONDS = 600;
export const RELAY_CARRIER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface RelayHandoffSubmission {
  name: string;
  neighborhood: string;
  note?: string;
  handoffCoords?: LatLng | null;
  acceptedCoords?: LatLng | null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRelayToken(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function validCoords(coords?: LatLng | null) {
  return !coords || (
    Number.isFinite(coords.lat)
    && Number.isFinite(coords.lng)
    && coords.lat >= -90
    && coords.lat <= 90
    && coords.lng >= -180
    && coords.lng <= 180
  );
}

export function validateRelayHandoff(input: RelayHandoffSubmission): string | null {
  if (!input.name.trim() || input.name.trim().length > 60) return 'Use a carrier name between 1 and 60 characters.';
  if (!input.neighborhood.trim() || input.neighborhood.trim().length > 120) return 'Use a neighborhood between 1 and 120 characters.';
  if ((input.note?.trim().length ?? 0) > 500) return 'Keep the handoff note under 500 characters.';
  if (!validCoords(input.handoffCoords) || !validCoords(input.acceptedCoords)) return 'The handoff coordinates are not valid.';
  return null;
}
