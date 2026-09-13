'use client';

import { useEffect, useRef } from 'react';
import type { GpsWaypoint } from '@/lib/gpsUtils';

interface WaypointMapProps {
  waypoints: GpsWaypoint[];
  destinationNeighborhood?: string;
  destinationCoords?: { lat: number; lng: number };
  className?: string;
}

const W = 480;
const H = 220;
const PAD = 32;

/** Map lat/lng to SVG x/y coordinates within [PAD, W-PAD] x [PAD, H-PAD] */
function project(
  coords: { lat: number; lng: number },
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): { x: number; y: number } {
  const rangeX = bounds.maxLng - bounds.minLng || 0.001;
  const rangeY = bounds.maxLat - bounds.minLat || 0.001;
  const x = PAD + ((coords.lng - bounds.minLng) / rangeX) * (W - PAD * 2);
  // SVG Y is flipped vs geographic lat (north = up = smaller SVG y)
  const y = H - PAD - ((coords.lat - bounds.minLat) / rangeY) * (H - PAD * 2);
  return { x, y };
}

function getBounds(points: { lat: number; lng: number }[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats) - 0.005;
  const maxLat = Math.max(...lats) + 0.005;
  const minLng = Math.min(...lngs) - 0.005;
  const maxLng = Math.max(...lngs) + 0.005;
  return { minLat, maxLat, minLng, maxLng };
}

export function WaypointMap({
  waypoints,
  destinationNeighborhood,
  destinationCoords,
  className = '',
}: WaypointMapProps) {
  const pathRef = useRef<SVGPathElement>(null);

  const allPoints = [
    ...waypoints.map((w) => w.coords),
    ...(destinationCoords ? [destinationCoords] : []),
  ];

  if (allPoints.length < 2) {
    return (
      <div className={`flex items-center justify-center h-[140px] font-mono text-xs text-on-surface-variant/50 ${className}`}>
        Waiting for first carrier GPS stamp…
      </div>
    );
  }

  const bounds = getBounds(allPoints);
  const projected = waypoints.map((w) => ({ ...project(w.coords, bounds), ...w }));
  const destProj = destinationCoords ? project(destinationCoords, bounds) : null;

  // Build SVG path string
  const completedPoints = projected;
  const pathD = completedPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  // Dashed line from last carrier to destination
  const lastP = completedPoints[completedPoints.length - 1];
  const dashD = destProj
    ? `M ${lastP.x.toFixed(1)},${lastP.y.toFixed(1)} L ${destProj.x.toFixed(1)},${destProj.y.toFixed(1)}`
    : '';

  return (
    <div className={`relative overflow-hidden rounded-xl bg-[#f5f0e8] border border-[#102a43]/[0.08] ${className}`}>
      {/* Map label */}
      <div className="absolute top-3 left-4 font-mono text-[9px] uppercase tracking-[0.2em] text-on-surface-variant/60">
        Journey trail
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        aria-label="Letter journey map"
        role="img"
      >
        {/* Grid lines (subtle) */}
        {[1, 2, 3].map((i) => (
          <line
            key={i}
            x1={PAD} y1={(H / 4) * i}
            x2={W - PAD} y2={(H / 4) * i}
            stroke="#102a43" strokeOpacity="0.04" strokeWidth="1"
          />
        ))}

        {/* Completed route — solid animated line */}
        <path
          ref={pathRef}
          d={pathD}
          fill="none"
          stroke="#2b8a6b"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="waypoint-trail"
        />

        {/* Dashed projected route to destination */}
        {dashD && (
          <path
            d={dashD}
            fill="none"
            stroke="#102a43"
            strokeWidth="1.5"
            strokeDasharray="5,4"
            strokeOpacity="0.3"
            strokeLinecap="round"
          />
        )}

        {/* Carrier waypoint dots */}
        {projected.map((p, i) => {
          const isOrigin = i === 0;
          const isCurrent = i === projected.length - 1;
          return (
            <g key={p.timestamp}>
              {/* Pulse ring for current carrier */}
              {isCurrent && (
                <circle
                  cx={p.x} cy={p.y} r="10"
                  fill="#2b8a6b" fillOpacity="0.12"
                  className="animate-ping origin-center"
                  style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                />
              )}
              <circle
                cx={p.x} cy={p.y} r={isOrigin ? 5 : 4}
                fill={isOrigin ? '#b45309' : isCurrent ? '#2b8a6b' : '#102a43'}
                fillOpacity={isOrigin || isCurrent ? 1 : 0.7}
              />
              {/* Carrier initial badge */}
              <text
                x={p.x}
                y={p.y - 10}
                textAnchor="middle"
                fontSize="8"
                fontFamily="monospace"
                fill="#102a43"
                fillOpacity="0.7"
                fontWeight="600"
              >
                {p.carrierName.charAt(0).toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Destination dot */}
        {destProj && (
          <g>
            <circle
              cx={destProj.x} cy={destProj.y} r={5}
              fill="none"
              stroke="#991b1b"
              strokeWidth="2"
              strokeDasharray="3,2"
            />
            <text
              x={destProj.x}
              y={destProj.y - 10}
              textAnchor="middle"
              fontSize="7"
              fontFamily="monospace"
              fill="#991b1b"
              fillOpacity="0.8"
            >
              {destinationNeighborhood ?? 'Destination'}
            </text>
          </g>
        )}
      </svg>

      {/* Neighborhood legend strip */}
      <div className="flex items-center gap-4 overflow-x-auto px-4 pb-3 pt-1 border-t border-[#102a43]/[0.06]">
        {projected.map((p, i) => (
          <div key={p.timestamp} className="shrink-0 flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: i === 0 ? '#b45309' : i === projected.length - 1 ? '#2b8a6b' : '#102a43' }}
            />
            <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-wider">
              {p.neighborhood}
            </span>
          </div>
        ))}
        {destinationNeighborhood && (
          <>
            <span className="text-[#102a43]/20 shrink-0">···</span>
            <div className="shrink-0 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full shrink-0 border border-[#991b1b]" />
              <span className="font-mono text-[9px] text-[#991b1b] uppercase tracking-wider">
                {destinationNeighborhood}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
