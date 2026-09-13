'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Navigation, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { GpsWaypoint } from '@/lib/gpsUtils';

interface Luminous3DMapProps {
  waypoints?: GpsWaypoint[];
  currentCarrier?: string;
  currentNeighborhood?: string;
  destinationNeighborhood?: string;
  className?: string;
}

const DEFAULT_STOPS = [
  { name: 'Bandra', x: 80, y: 70, z: 24, status: 'Origin' },
  { name: 'Dadar', x: 190, y: 130, z: 32, status: 'Handed off' },
  { name: 'Worli', x: 280, y: 190, z: 40, status: 'Active Carrier' },
  { name: 'Colaba', x: 420, y: 250, z: 16, status: 'Destination' },
];

/**
 * Modern Light-Theme 3D Architectural City Route Map.
 * Real-time mouse movement 3D perspective tilt + animated neon-mint fiber-optic laser arcs.
 */
export function Luminous3DMap({
  waypoints,
  currentCarrier = 'Priya',
  currentNeighborhood = 'Worli',
  destinationNeighborhood = 'Colaba',
  className = '',
}: Luminous3DMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rotateX: 25, rotateY: -8, mouseX: 50, mouseY: 50 });
  const [animProgress, setAnimProgress] = useState(1);
  const [isReplaying, setIsReplaying] = useState(false);

  // Mouse move handler for natural 3D camera pan/tilt
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Camera tilts between 18 and 32 degrees on X, -18 and 2 degrees on Y
    const rotateX = 25 - (y - 0.5) * 14;
    const rotateY = -8 + (x - 0.5) * 16;

    setTilt({
      rotateX,
      rotateY,
      mouseX: x * 100,
      mouseY: y * 100,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ rotateX: 25, rotateY: -8, mouseX: 50, mouseY: 50 });
  }, []);

  // Replay animation effect
  const handleReplay = () => {
    setIsReplaying(true);
    setAnimProgress(0);
    let start = performance.now();
    const duration = 2400; // 2.4s

    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      setAnimProgress(progress);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setIsReplaying(false);
      }
    };
    requestAnimationFrame(step);
  };

  return (
    <div
      ref={mapRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#ffffff] to-[#f8f9fa] border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.06)] p-6 sm:p-8 select-none',
        className
      )}
      style={{ perspective: '1400px' }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 z-20 relative">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 animate-pulse" />
          <p className="font-mono text-xs uppercase tracking-widest text-slate-500 font-semibold">
            3D Route Telemetry · Same-City Relay
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReplay}
            disabled={isReplaying}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-mono text-[11px] tracking-wider uppercase transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3 text-slate-600" />
            <span>{isReplaying ? 'Tracing…' : 'Replay Path'}</span>
          </button>
          <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
            Interactive 3D Tilt
          </span>
        </div>
      </div>

      {/* 3D Scene Viewport */}
      <div className="relative h-[320px] sm:h-[380px] w-full flex items-center justify-center overflow-hidden">
        
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.4] pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.12) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* 3D Tilted Isometric Plane */}
        <div
          className="relative w-[500px] h-[340px] transition-transform duration-200 ease-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg) rotateZ(-6deg)`,
          }}
        >
          {/* Base Architectural Floor */}
          <div className="absolute inset-0 rounded-3xl bg-[#fdfdfd] border border-slate-200 shadow-[0_20px_50px_rgba(15,23,42,0.08)]" />

          {/* 3D Extruded Architectural City Blocks (Clean White Minimalist Style) */}
          {[
            { x: 60, y: 50, w: 45, h: 40, h3d: 28 },
            { x: 120, y: 70, w: 35, h: 50, h3d: 38 },
            { x: 170, y: 110, w: 40, h: 35, h3d: 22 },
            { x: 230, y: 140, w: 50, h: 45, h3d: 46 },
            { x: 260, y: 220, w: 38, h: 38, h3d: 32 },
            { x: 340, y: 180, w: 45, h: 55, h3d: 52 },
            { x: 400, y: 240, w: 42, h: 40, h3d: 26 },
          ].map((block, idx) => (
            <div
              key={idx}
              className="absolute bg-white border border-slate-200/90 rounded-md shadow-[4px_6px_16px_rgba(15,23,42,0.06)]"
              style={{
                left: `${block.x}px`,
                top: `${block.y}px`,
                width: `${block.w}px`,
                height: `${block.h}px`,
                transform: `translateZ(${block.h3d}px)`,
              }}
            >
              {/* Top face ambient highlight */}
              <div className="w-full h-full bg-gradient-to-br from-white to-slate-50/60 rounded-md" />
            </div>
          ))}

          {/* SVG Trajectory Layer with Glowing Laser Arcs */}
          <svg
            viewBox="0 0 500 340"
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'translateZ(20px)' }}
          >
            <defs>
              <linearGradient id="laserGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                <stop offset="50%" stopColor="#34d399" stopOpacity="1" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
              </linearGradient>
              <filter id="glowBlur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Path 1: Bandra to Dadar */}
            <path
              d="M 80 70 Q 130 50, 190 130"
              fill="none"
              stroke="#10b981"
              strokeWidth="3.5"
              strokeLinecap="round"
              filter="url(#glowBlur)"
              strokeDasharray="200"
              strokeDashoffset={Math.max(0, 200 - animProgress * 300)}
            />

            {/* Path 2: Dadar to Worli */}
            <path
              d="M 190 130 Q 230 110, 280 190"
              fill="none"
              stroke="#10b981"
              strokeWidth="3.5"
              strokeLinecap="round"
              filter="url(#glowBlur)"
              strokeDasharray="200"
              strokeDashoffset={Math.max(0, 200 - Math.max(0, animProgress - 0.33) * 300)}
            />

            {/* Path 3: Worli to Colaba (Projected) */}
            <path
              d="M 280 190 Q 350 160, 420 250"
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.5"
              strokeDasharray="6 6"
              strokeLinecap="round"
              strokeOpacity="0.55"
            />
          </svg>

          {/* 3D Waypoint Nodes */}
          {DEFAULT_STOPS.map((stop, idx) => {
            const isActive = stop.name === currentNeighborhood;
            const isOrigin = idx === 0;
            const isDest = idx === DEFAULT_STOPS.length - 1;

            return (
              <div
                key={stop.name}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${stop.x}px`,
                  top: `${stop.y}px`,
                  transform: `translate(-50%, -50%) translateZ(${stop.z + 10}px)`,
                }}
              >
                {/* Active Carrier Floating Pill */}
                {isActive && (
                  <div className="absolute -top-12 whitespace-nowrap px-3 py-1 rounded-full bg-slate-900/90 text-white shadow-xl flex items-center gap-1.5 font-mono text-[11px] animate-bounce">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>{currentCarrier} · 3.2km closer</span>
                  </div>
                )}

                {/* Node marker */}
                <div
                  className={cn(
                    'flex items-center justify-center h-6 w-6 rounded-full shadow-md transition-transform',
                    isActive
                      ? 'bg-emerald-500 text-white ring-4 ring-emerald-500/25 scale-125'
                      : isOrigin
                      ? 'bg-slate-900 text-white'
                      : isDest
                      ? 'bg-amber-500 text-white'
                      : 'bg-white border-2 border-emerald-500 text-emerald-600'
                  )}
                >
                  <span className="text-[10px] font-mono font-bold">{idx + 1}</span>
                </div>

                {/* Label */}
                <span className="mt-1 font-mono text-[11px] font-bold text-slate-800 tracking-wider bg-white/85 px-1.5 py-0.5 rounded shadow-2xs">
                  {stop.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modern Light Status Strip below map */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-5 mt-2 border-t border-slate-100">
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Current Custody</p>
          <p className="font-sans text-sm font-semibold text-slate-900 mt-0.5">{currentCarrier} in {currentNeighborhood}</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Destination</p>
          <p className="font-sans text-sm font-semibold text-slate-900 mt-0.5">{destinationNeighborhood}</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Distance Closed</p>
          <p className="font-sans text-sm font-semibold text-emerald-600 mt-0.5">+8.6 km forward</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-100">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Transit Status</p>
          <p className="font-sans text-sm font-semibold text-slate-900 mt-0.5">3 Handshakes · In Motion</p>
        </div>
      </div>
    </div>
  );
}
