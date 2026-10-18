import type { GpsWaypoint } from '@/lib/gpsUtils';
import type { RelayHandoff, RelayState } from '@/lib/relayStore';

/** Combine participant-visible handoffs with legacy local history for display. */
export function mergeRemoteRelayHandoffs(local: RelayState, remote: RelayHandoff[]): RelayState {
  const remoteIds = new Set(remote.map((handoff) => handoff.id));
  const handoffs = [
    ...local.handoffs.filter((handoff) => !remoteIds.has(handoff.id)),
    ...remote,
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const waypointMap = new Map<string, GpsWaypoint>();
  for (const waypoint of local.gpsWaypoints ?? []) {
    waypointMap.set(`${waypoint.carrierName}|${waypoint.timestamp}|${waypoint.neighborhood}`, waypoint);
  }
  for (const handoff of remote) {
    if (!handoff.coords || !handoff.neighborhood) continue;
    const waypoint: GpsWaypoint = {
      coords: handoff.coords,
      neighborhood: handoff.neighborhood,
      timestamp: handoff.createdAt,
      carrierName: handoff.name,
      carrierNote: handoff.note,
    };
    waypointMap.set(`${waypoint.carrierName}|${waypoint.timestamp}|${waypoint.neighborhood}`, waypoint);
  }

  const gpsWaypoints = Array.from(waypointMap.values()).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const carriers = handoffs.filter((handoff) => handoff.role === 'carrier');
  const currentCarrierName = carriers[carriers.length - 1]?.name || local.currentCarrierName;
  const firstAt = handoffs[0] ? Date.parse(handoffs[0].createdAt) : NaN;
  const lastHandoff = handoffs[handoffs.length - 1];
  const lastAt = lastHandoff ? Date.parse(lastHandoff.createdAt) : NaN;
  const remoteDurationHours = Number.isFinite(firstAt) && Number.isFinite(lastAt)
    ? Math.max(0, Math.floor((lastAt - firstAt) / 3_600_000))
    : 0;

  return {
    ...local,
    handoffs,
    gpsWaypoints,
    currentCarrierName,
    durationHours: Math.max(local.durationHours, remoteDurationHours),
  };
}
