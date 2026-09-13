import { useId } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import type { GpsWaypoint, LatLng } from '@/lib/gpsUtils';

const PAPER = '#f7f4ee';
const INK = '#102a43';
const MINT = '#4f9d7a';
const CORAL = '#b84b3a';

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 280;
const MAP_LEFT = 44;
const MAP_RIGHT = 596;
const MAP_TOP = 42;
const MAP_BOTTOM = 226;

export type RouteStopState = 'complete' | 'current' | 'next';
export type RouteStopKind = 'origin' | 'handoff' | 'destination';

/** A privacy-safe, human-readable stop on a letter's route. */
export interface RouteStop {
  id: string;
  neighborhood: string;
  state?: RouteStopState;
  kind?: RouteStopKind;
  note?: string;
  carrierName?: string;
  /** Optional zero-based link to an item in the waypoints array. */
  waypointIndex?: number;
}

export interface RouteMapProps extends HTMLAttributes<HTMLElement> {
  /** Stops are rendered in this order. If omitted, stops are derived from waypoints. */
  stops?: readonly RouteStop[];
  /** Ordered GPS points used for the route geometry; coordinates are not printed. */
  waypoints?: readonly GpsWaypoint[];
  /** Optional destination compatible with the relay page's existing data shape. */
  destinationNeighborhood?: string;
  destinationCoords?: LatLng;
  /** Selects the current stop when stop states are not already supplied. */
  currentStopId?: string;
  /** Optional neighborhood selector for callers that do not have a stop id. */
  currentNeighborhood?: string;
  /** Optional current carrier label used when the current stop has no carrierName. */
  currentCarrierName?: string;
  /** Short alias for currentCarrierName when adapting an existing relay view. */
  currentCarrier?: string;
  heading?: string;
  description?: string;
  showLegend?: boolean;
  showWaypointTrace?: boolean;
  emptyMessage?: string;
}

interface Point {
  x: number;
  y: number;
}

interface NormalizedStop extends RouteStop {
  neighborhood: string;
  kind?: RouteStopKind;
}

interface ResolvedStop extends NormalizedStop {
  state: RouteStopState;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const MAP_GUIDES = [
  'M 20 82 H 620',
  'M 28 156 H 612',
  'M 78 30 L 142 246',
  'M 274 30 L 230 246',
  'M 480 30 L 550 246',
] as const;

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function cleanId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

function isValidCoords(coords: LatLng | undefined): coords is LatLng {
  return Boolean(
    coords &&
      Number.isFinite(coords.lat) &&
      Number.isFinite(coords.lng) &&
      coords.lat >= -90 &&
      coords.lat <= 90 &&
      coords.lng >= -180 &&
      coords.lng <= 180
  );
}

function normalizeLabel(label: string | undefined, fallback: string): string {
  const trimmed = label?.trim();
  return trimmed || fallback;
}

function sameLabel(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function makeStops(
  stops: readonly RouteStop[] | undefined,
  waypoints: readonly GpsWaypoint[],
  destinationNeighborhood: string | undefined,
  hasDestinationCoords: boolean,
  currentNeighborhood: string | undefined
): NormalizedStop[] {
  const fallbackCurrentNeighborhood = currentNeighborhood?.trim();
  const sourceStops: NormalizedStop[] = stops && stops.length > 0
    ? stops.map((stop, index) => ({
        ...stop,
        id: stop.id || `stop-${index + 1}`,
        neighborhood: normalizeLabel(stop.neighborhood, `Stop ${index + 1}`),
        waypointIndex: stop.waypointIndex ?? (index < waypoints.length ? index : undefined),
      }))
    : waypoints.length > 0
      ? waypoints.map((waypoint, index) => ({
          id: `waypoint-${index + 1}`,
          neighborhood: normalizeLabel(waypoint.neighborhood, `Stop ${index + 1}`),
          kind: (index === 0 ? 'origin' : 'handoff') as RouteStopKind,
          note: waypoint.carrierNote,
          carrierName: waypoint.carrierName,
          waypointIndex: index,
        }))
      : fallbackCurrentNeighborhood
        ? [{
            id: 'current',
            neighborhood: fallbackCurrentNeighborhood,
            kind: 'handoff' as RouteStopKind,
          }]
        : [];

  const destination = destinationNeighborhood?.trim() || (hasDestinationCoords ? 'Destination' : '');
  if (!destination) return sourceStops;

  const existingDestinationIndex = sourceStops.findIndex(
    (stop) => stop.kind === 'destination' || sameLabel(stop.neighborhood, destination)
  );

  if (existingDestinationIndex >= 0) {
    return sourceStops.map((stop, index) =>
      index === existingDestinationIndex ? { ...stop, kind: 'destination' } : stop
    );
  }

  return [
    ...sourceStops,
    {
      id: 'destination',
      neighborhood: destination,
      kind: 'destination',
    },
  ];
}

function resolveStops(
  stops: readonly NormalizedStop[],
  currentStopId: string | undefined,
  currentNeighborhood: string | undefined
): ResolvedStop[] {
  if (stops.length === 0) return [];

  const requestedCurrentIndex = currentStopId
    ? stops.findIndex((stop) => stop.id === currentStopId)
    : currentNeighborhood
      ? stops.findIndex((stop) => sameLabel(stop.neighborhood, currentNeighborhood))
      : -1;
  const explicitCurrentIndex = requestedCurrentIndex >= 0
    ? requestedCurrentIndex
    : stops.findIndex((stop) => stop.state === 'current');
  const hasRequestedCurrent = requestedCurrentIndex >= 0;
  const hasExplicitState = stops.some((stop) => Boolean(stop.state));
  const lastNonDestinationIndex = [...stops]
    .map((stop, index) => ({ stop, index }))
    .reverse()
    .find(({ stop }) => stop.kind !== 'destination')?.index ?? -1;
  const derivedCurrentIndex = explicitCurrentIndex >= 0
    ? explicitCurrentIndex
    : hasExplicitState
      ? -1
      : lastNonDestinationIndex >= 0
        ? lastNonDestinationIndex
        : -1;

  return stops.map((stop, index) => {
    const state = index === derivedCurrentIndex
      ? 'current'
      : hasRequestedCurrent && stop.state === 'current'
        ? index < derivedCurrentIndex ? 'complete' : 'next'
        : stop.state
        ?? (derivedCurrentIndex >= 0
          ? index < derivedCurrentIndex ? 'complete' : 'next'
          : stop.kind === 'destination' ? 'next' : index === 0 ? 'current' : 'next');

    return { ...stop, state };
  });
}

function getBounds(points: readonly LatLng[]): Bounds {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);
  const rawMinLng = Math.min(...lngs);
  const rawMaxLng = Math.max(...lngs);
  const latSpan = Math.max(rawMaxLat - rawMinLat, 0.01);
  const lngSpan = Math.max(rawMaxLng - rawMinLng, 0.01);

  return {
    minLat: rawMinLat - Math.max(latSpan * 0.16, 0.005),
    maxLat: rawMaxLat + Math.max(latSpan * 0.16, 0.005),
    minLng: rawMinLng - Math.max(lngSpan * 0.12, 0.005),
    maxLng: rawMaxLng + Math.max(lngSpan * 0.12, 0.005),
  };
}

function project(coords: LatLng, bounds: Bounds): Point {
  const lngSpan = bounds.maxLng - bounds.minLng || 0.01;
  const latSpan = bounds.maxLat - bounds.minLat || 0.01;

  return {
    x: MAP_LEFT + ((coords.lng - bounds.minLng) / lngSpan) * (MAP_RIGHT - MAP_LEFT),
    y: MAP_BOTTOM - ((coords.lat - bounds.minLat) / latSpan) * (MAP_BOTTOM - MAP_TOP),
  };
}

function getFallbackPoint(index: number, count: number): Point {
  if (count === 1) return { x: VIEWBOX_WIDTH / 2, y: 138 };

  const progress = index / (count - 1);
  const x = MAP_LEFT + progress * (MAP_RIGHT - MAP_LEFT);
  const yPattern = [174, 84, 196, 102, 156, 74] as const;
  const y = yPattern[index % yPattern.length];
  return { x, y };
}

function pathFor(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}

function shortLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21).trimEnd()}…` : label;
}

function statusLabel(state: RouteStopState): string {
  switch (state) {
    case 'complete':
      return 'Complete';
    case 'current':
      return 'Current';
    case 'next':
      return 'Next';
  }
}

function stateMarkerColor(state: RouteStopState): string {
  switch (state) {
    case 'complete':
      return MINT;
    case 'current':
      return CORAL;
    case 'next':
      return INK;
  }
}

function markerRadius(state: RouteStopState): number {
  return state === 'current' ? 8 : 6;
}

function labelOffset(point: Point, index: number): { dy: number; anchor: 'start' | 'middle' | 'end' } {
  const anchor = point.x < 92 ? 'start' : point.x > 548 ? 'end' : 'middle';
  const dy = point.y > 128 || index % 2 === 0 ? -16 : 20;
  return { dy, anchor };
}

function StateGlyph({ state }: { state: RouteStopState }) {
  if (state === 'complete') {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
        <path d="m3.2 8.2 3 3 6.5-6.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (state === 'current') {
    return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#b84b3a]" />;
  }

  return <span aria-hidden="true" className="font-mono text-[10px] leading-none">→</span>;
}

export function RouteMap({
  stops,
  waypoints = [],
  destinationNeighborhood,
  destinationCoords,
  currentStopId,
  currentNeighborhood,
  currentCarrierName,
  currentCarrier,
  heading = 'The route so far',
  description,
  showLegend = true,
  showWaypointTrace = true,
  emptyMessage = 'No route stops yet.',
  className,
  style,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...sectionProps
}: RouteMapProps) {
  const rawId = useId();
  const componentId = cleanId(rawId);
  const headingId = `route-map-heading-${componentId}`;
  const descriptionId = `route-map-description-${componentId}`;
  const svgTitleId = `route-map-svg-title-${componentId}`;
  const svgDescriptionId = `route-map-svg-description-${componentId}`;

  const suppliedWaypoints = Array.from(waypoints);
  const validWaypointCoords = suppliedWaypoints
    .map((waypoint) => waypoint.coords)
    .filter(isValidCoords);
  const hasDestinationCoords = isValidCoords(destinationCoords);
  const normalizedStops = makeStops(
    stops,
    suppliedWaypoints,
    destinationNeighborhood,
    hasDestinationCoords,
    currentNeighborhood
  );
  const carrierLabel = currentCarrierName || currentCarrier;
  const resolvedStops = resolveStops(normalizedStops, currentStopId, currentNeighborhood).map((stop) =>
    stop.state === 'current' && !stop.carrierName && carrierLabel
      ? { ...stop, carrierName: carrierLabel }
      : stop
  );
  const hasRouteContent = resolvedStops.length > 0;

  const geographicPoints = hasDestinationCoords
    ? [...validWaypointCoords, destinationCoords]
    : validWaypointCoords;
  const bounds = geographicPoints.length > 0 ? getBounds(geographicPoints) : undefined;
  const waypointPoints = suppliedWaypoints.map((waypoint) =>
    bounds && isValidCoords(waypoint.coords) ? project(waypoint.coords, bounds) : undefined
  );
  const destinationPoint = bounds && hasDestinationCoords
    ? project(destinationCoords, bounds)
    : undefined;
  const fallbackPoints = resolvedStops.map((_, index) => getFallbackPoint(index, resolvedStops.length));
  const stopPoints = resolvedStops.map((stop, index) => {
    const linkedPoint = typeof stop.waypointIndex === 'number'
      ? waypointPoints[stop.waypointIndex]
      : waypointPoints[index];

    if (linkedPoint) return linkedPoint;
    if (stop.kind === 'destination' && destinationPoint) return destinationPoint;
    return fallbackPoints[index];
  });

  const geographicRoutePoints = waypointPoints.filter((point): point is Point => Boolean(point));
  const hasRecordedTrace = geographicRoutePoints.length > 0;
  const baseRoutePoints = geographicRoutePoints.length >= 2
    ? [
        ...geographicRoutePoints,
        ...stopPoints.slice(geographicRoutePoints.length),
      ]
    : stopPoints;
  const basePath = pathFor(baseRoutePoints);

  const currentIndex = resolvedStops.findIndex((stop) => stop.state === 'current');
  const lastCompleteIndex = resolvedStops.reduce(
    (lastIndex, stop, index) => stop.state === 'complete' ? index : lastIndex,
    -1
  );
  const completeThroughIndex = currentIndex >= 0 ? currentIndex : lastCompleteIndex;
  const completePath = completeThroughIndex >= 1
    ? pathFor(stopPoints.slice(0, completeThroughIndex + 1))
    : '';
  const futureStartIndex = currentIndex >= 0
    ? currentIndex
    : Math.max(lastCompleteIndex, 0);
  const futurePath = stopPoints.length - futureStartIndex >= 2
    ? pathFor(stopPoints.slice(futureStartIndex))
    : '';

  const sectionA11y = ariaLabelledBy
    ? { 'aria-labelledby': ariaLabelledBy }
    : ariaLabel
      ? { 'aria-label': ariaLabel }
      : { 'aria-labelledby': headingId };

  return (
    <section
      {...sectionProps}
      {...sectionA11y}
      className={cx(
        'w-full overflow-hidden border border-[#102a43]/[0.12] bg-[#f7f4ee] text-[#102a43]',
        className
      )}
      style={{ ...style, backgroundColor: PAPER }}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#102a43]/[0.12] px-5 py-5 sm:px-7">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#102a43]/[0.62]">
            Letter route
          </p>
          <h2 id={headingId} className="mt-1 font-headline-md text-xl leading-tight text-[#102a43]">
            {heading}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-2 max-w-[54ch] text-sm leading-6 text-[#102a43]/[0.7]">
              {description}
            </p>
          )}
        </div>

        <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[#102a43]/[0.62]">
          {hasRecordedTrace
            ? `${geographicRoutePoints.length} GPS ${geographicRoutePoints.length === 1 ? 'point' : 'points'}`
            : hasRouteContent
              ? `${resolvedStops.length} ${resolvedStops.length === 1 ? 'stop' : 'stops'}`
              : 'Awaiting first stop'}
        </p>
      </header>

      {hasRouteContent ? (
        <>
          <div className="relative border-b border-[#102a43]/[0.12] px-3 py-3 sm:px-6 sm:py-5">
            <svg
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              width={VIEWBOX_WIDTH}
              height={VIEWBOX_HEIGHT}
              role="img"
              aria-labelledby={svgTitleId}
              aria-describedby={svgDescriptionId}
              className="block h-auto w-full"
              preserveAspectRatio="xMidYMid meet"
            >
              <title id={svgTitleId}>{heading}</title>
              <desc id={svgDescriptionId}>
                {resolvedStops.map((stop, index) => `${index + 1}. ${stop.neighborhood}, ${statusLabel(stop.state)}`).join('; ')}.
              </desc>

              <g aria-hidden="true" fill="none" stroke={INK} strokeOpacity="0.085" strokeWidth="1" vectorEffect="non-scaling-stroke">
                {MAP_GUIDES.map((guide) => <path key={guide} d={guide} />)}
              </g>

              <g aria-hidden="true" fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                {basePath && <path d={basePath} stroke={INK} strokeOpacity="0.18" strokeWidth="2.25" />}
                {completePath && <path d={completePath} stroke={MINT} strokeOpacity="0.98" strokeWidth="3.5" />}
                {futurePath && (
                  <path
                    d={futurePath}
                    stroke={CORAL}
                    strokeOpacity="0.74"
                    strokeWidth="2.25"
                    strokeDasharray="7 7"
                  />
                )}
              </g>

              {showWaypointTrace && hasRecordedTrace && (
                <g aria-hidden="true">
                  {waypointPoints.map((point, index) => point ? (
                    <circle
                      key={`gps-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r="2.75"
                      fill={PAPER}
                      stroke={INK}
                      strokeOpacity="0.48"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null)}
                </g>
              )}

              <g aria-hidden="true">
                {resolvedStops.map((stop, index) => {
                  const point = stopPoints[index];
                  const color = stateMarkerColor(stop.state);
                  const radius = markerRadius(stop.state);
                  const label = labelOffset(point, index);
                  const isDestination = stop.kind === 'destination';

                  return (
                    <g key={stop.id}>
                      {stop.state === 'current' && (
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="14"
                          fill="none"
                          stroke={CORAL}
                          strokeOpacity="0.34"
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}

                      {isDestination && stop.state === 'next' ? (
                        <rect
                          x={point.x - radius}
                          y={point.y - radius}
                          width={radius * 2}
                          height={radius * 2}
                          rx="1.5"
                          fill={PAPER}
                          stroke={color}
                          strokeWidth="2"
                          strokeDasharray="3 2"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={radius}
                          fill={stop.state === 'next' ? PAPER : color}
                          stroke={color}
                          strokeWidth={stop.state === 'next' ? 2 : 1}
                          vectorEffect="non-scaling-stroke"
                        />
                      )}

                      {stop.state === 'complete' ? (
                        <path
                          d={`M ${(point.x - 3.2).toFixed(1)} ${point.y.toFixed(1)} l 2.2 2.3 4.8 -5.1`}
                          fill="none"
                          stroke={PAPER}
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : (
                        <text
                          x={point.x}
                          y={point.y + 3}
                          textAnchor="middle"
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontSize="8"
                          fontWeight="700"
                          fill={stop.state === 'next' ? color : PAPER}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </text>
                      )}

                      <text
                        x={point.x}
                        y={point.y + label.dy}
                        textAnchor={label.anchor}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontSize="10"
                        fontWeight="600"
                        letterSpacing="0.3"
                        fill={INK}
                      >
                        {shortLabel(stop.neighborhood)}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g aria-hidden="true" transform="translate(578 36)">
                <text x="0" y="0" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="9" fontWeight="700" fill={INK}>
                  N
                </text>
                <path d="M 0 5 V 17 M -3 8 L 0 5 3 8" stroke={INK} strokeOpacity="0.64" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
            </svg>
          </div>

          <ol aria-label="Route stops" className="grid gap-0 divide-y divide-[#102a43]/[0.1] sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
            {resolvedStops.map((stop, index) => (
              <li key={stop.id} className="min-w-0 px-5 py-4 sm:px-6">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={cx(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs',
                      stop.state === 'complete' && 'border-[#4f9d7a] bg-[#4f9d7a] text-[#f7f4ee]',
                      stop.state === 'current' && 'border-[#b84b3a] bg-[#b84b3a]/[0.12] text-[#102a43]',
                      stop.state === 'next' && 'border-[#102a43]/[0.35] bg-[#f7f4ee] text-[#102a43]'
                    )}
                  >
                    {stop.state === 'complete' ? <StateGlyph state="complete" /> : String(index + 1).padStart(2, '0')}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h3 className="min-w-0 break-words font-headline-md text-base leading-snug text-[#102a43]">
                        {stop.neighborhood}
                      </h3>
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#102a43]/[0.64]">
                        <StateGlyph state={stop.state} />
                        {statusLabel(stop.state)}
                      </span>
                    </div>
                    {stop.carrierName && (
                      <p className="mt-1 text-sm leading-5 text-[#102a43]/[0.72]">
                        With {stop.carrierName}
                      </p>
                    )}
                    {stop.note && (
                      <p className="mt-1 text-sm leading-5 text-[#102a43]/[0.66]">
                        {stop.note}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {showLegend && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#102a43]/[0.12] px-5 py-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[#102a43]/[0.66] sm:px-7">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#4f9d7a]" aria-hidden="true" />
                Complete
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#b84b3a]" aria-hidden="true" />
                Current
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full border border-[#102a43]/[0.55]" aria-hidden="true" />
                Next
              </span>
              <span className="basis-full normal-case tracking-normal text-[#102a43]/[0.56] sm:basis-auto">
                {hasRecordedTrace ? 'Line follows recorded GPS points.' : 'Line follows the order of the stops.'}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-[190px] flex-col items-center justify-center px-6 py-10 text-center">
          <span aria-hidden="true" className="relative mb-4 block h-8 w-8 rounded-full border border-[#102a43]/[0.32]">
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 bg-[#102a43]/[0.42]" />
          </span>
          <p className="font-headline-md text-lg text-[#102a43]">{emptyMessage}</p>
          <p className="mt-2 max-w-[38ch] text-sm leading-6 text-[#102a43]/[0.66]">
            Add a neighborhood stop or a recorded GPS waypoint to draw the route.
          </p>
        </div>
      )}
    </section>
  );
}
