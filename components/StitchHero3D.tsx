'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Sparkles, LockKeyhole, ShieldCheck, Thermometer, MapPin, Eye, Check } from 'lucide-react';

interface StitchHero3DProps {
  recipient?: string;
  subject?: string;
  excerpt?: string;
  carrierName?: string;
  carrierRating?: string;
  trackingId?: string;
}

export function StitchHero3D({
  recipient = 'Eleanor Hartwell',
  subject = 'Morning Light & Sea Air',
  excerpt = 'Morning light through the kitchen window. The kettle is whistling, the sea air is cool, and I am thinking of you across the bay…',
  carrierName = 'Vikram R.',
  carrierRating = '4.98',
  trackingId = '#DEL-8842-X',
}: StitchHero3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, mouseX: 50, mouseY: 50 });
  const [isHovered, setIsHovered] = useState(false);

  // Smooth 3D parallax cursor tracking
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Subtle 3D tilt angles: -14 to +14 deg
    const rotateY = (x - 0.5) * 24;
    const rotateX = -(y - 0.5) * 20;

    setTilt({
      rotateX,
      rotateY,
      mouseX: x * 100,
      mouseY: y * 100,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setTilt({ rotateX: 0, rotateY: 0, mouseX: 50, mouseY: 50 });
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative flex flex-col items-center justify-center min-h-[540px] w-full select-none overflow-visible"
    >
      {/* ── Magic UI Concentric 3D Perspective Orbit Rings ── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none perspective-stage">
        {/* Outer Orbit Ring (Counter-Clockwise) */}
        <div className="w-[480px] sm:w-[540px] h-[480px] sm:h-[540px] rounded-full border border-slate-300/40 animate-orbit-cw absolute opacity-75">
          {/* Orbit Chip 1: Carrier Profile */}
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 pointer-events-auto">
            <div className="glass-panel px-3.5 py-1.5 rounded-full shadow-sm flex items-center gap-2 border border-slate-200 cursor-pointer hover:scale-105 transition-transform bg-white/90">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="font-sans text-xs font-semibold text-slate-800">{carrierName}</span>
              <span className="font-mono text-[11px] text-slate-500 font-medium">★ {carrierRating} (1,420 pkgs)</span>
            </div>
          </div>

          {/* Orbit Chip 2: Environmental Telemetry */}
          <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 pointer-events-auto">
            <div className="glass-panel px-3.5 py-1.5 rounded-full shadow-sm flex items-center gap-2 border border-slate-200 cursor-pointer hover:scale-105 transition-transform bg-white/90">
              <Thermometer className="w-3.5 h-3.5 text-cyan-600" />
              <span className="font-mono text-[11px] text-slate-800 font-medium">28°C / 62% RH</span>
              <span className="text-emerald-600 font-mono text-[10px] font-bold">● SEAL 100% INTACT</span>
            </div>
          </div>
        </div>

        {/* Inner Orbit Ring (Clockwise) */}
        <div className="w-[360px] sm:w-[410px] h-[360px] sm:h-[410px] rounded-full border border-cyan-400/25 animate-orbit-ccw absolute opacity-80">
          {/* Orbit Chip 3: Live Custody ETA */}
          <div className="absolute top-1/2 -right-4 -translate-y-1/2 pointer-events-auto">
            <div className="glass-panel px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 border border-cyan-200/80 cursor-pointer hover:scale-105 transition-transform bg-white/90">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span className="font-mono text-[11px] font-semibold text-slate-800">Colaba Hub: 42m</span>
            </div>
          </div>

          {/* Orbit Chip 4: Cryptographic Hash Chip */}
          <div className="absolute top-1/2 -left-4 -translate-y-1/2 pointer-events-auto">
            <div className="glass-panel px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 border border-slate-200 cursor-pointer hover:scale-105 transition-transform bg-white/90">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-mono text-[11px] text-slate-600">SHA: e8f9...39a1</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Centerpiece: Aceternity 3D Floating Envelope ── */}
      <div className="perspective-stage z-20 my-auto py-8">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className={`envelope-3d-card ${isHovered ? '' : 'animate-float-envelope'} relative w-[330px] sm:w-[390px] h-60 rounded-2xl bg-gradient-to-tr from-white via-slate-50 to-slate-100/90 border border-slate-200/90 shadow-2xl p-6 flex flex-col justify-between cursor-pointer group transition-all duration-300`}
          style={{
            transform: isHovered
              ? `rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg) scale(1.03)`
              : undefined,
          }}
        >
          {/* Cursor Specular Highlight */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-300 z-30"
            style={{
              opacity: isHovered ? 1 : 0,
              background: `radial-gradient(circle at ${tilt.mouseX}% ${tilt.mouseY}%, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0) 55%)`,
              mixBlendMode: 'soft-light',
            }}
          />

          {/* Envelope Flap Polygon Illusion */}
          <div
            className="absolute -top-[1px] left-0 right-0 h-28 bg-gradient-to-b from-white/95 to-slate-100/70 border-b border-slate-200/80 rounded-t-2xl pointer-events-none transition-transform duration-500 origin-top"
            style={{
              clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
              transform: isOpen ? 'rotateX(180deg) translateY(-20px)' : 'rotateX(0deg)',
            }}
          />

          {/* Fine Paper Stitch Lines */}
          <div className="absolute inset-2 border border-dashed border-slate-300/60 rounded-xl pointer-events-none" />

          {/* Envelope Header */}
          <div className="relative z-10 flex items-start justify-between">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] text-slate-400 font-semibold tracking-wider">AIR-SEALED HUMAN RELAY</span>
              <span className="font-mono text-xs font-bold text-slate-800">{trackingId}</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] tracking-wider font-semibold">
              ARCHIVAL
            </span>
          </div>

          {/* Sliding Letter Preview Sheet (when opened) */}
          <div
            className={`absolute left-4 right-4 bg-white rounded-lg border border-slate-200 p-4 shadow-lg transition-all duration-500 z-15 ${
              isOpen ? '-top-32 opacity-100 pointer-events-auto' : 'top-6 opacity-0 pointer-events-none scale-95'
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">To: {recipient}</span>
              <span className="text-[10px] font-mono text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="w-3 h-3" /> Intact
              </span>
            </div>
            <p className="font-serif text-xs text-slate-700 italic leading-relaxed line-clamp-3">
              "{excerpt}"
            </p>
          </div>

          {/* Center Biometric Mint Wax Seal */}
          <div className="relative z-20 mx-auto flex items-center justify-center">
            <div className="relative w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center text-white shadow-xl ring-4 ring-emerald-400/40 group-hover:ring-emerald-500 transition-all">
              <LockKeyhole className="w-6 h-6 text-emerald-400" />
              {/* Orbiting Holographic Security Ring */}
              <div className="absolute -inset-1.5 rounded-full border border-emerald-400/60 border-dashed animate-spin" />
            </div>
          </div>

          {/* Envelope Footer Info */}
          <div className="relative z-10 flex items-end justify-between font-mono text-[11px]">
            <div>
              <span className="text-slate-400 block text-[9px]">CONSIGNOR SIGNATURE</span>
              <span className="text-slate-700 font-semibold">AUTHENTICATED ✓</span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[9px]">SECURITY CLASS</span>
              <span className="text-emerald-600 font-bold">LVL-4 BIOMETRIC</span>
            </div>
          </div>

          {/* Soft Drop Specular Floor Shadow */}
          <div className="absolute -bottom-10 left-8 right-8 h-8 bg-slate-900/10 blur-xl rounded-full -z-10 transform scale-90" />
        </div>
      </div>

      {/* 3D Stage Hint & Interaction Pill */}
      <div className="relative z-20 flex items-center gap-2 mt-2 px-3.5 py-1 rounded-full bg-white/80 border border-slate-200/80 text-slate-500 font-mono text-xs shadow-xs">
        <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
        <span>Click Envelope to {isOpen ? 'Close' : 'Inspect'} • 3D Mouse Parallax Active</span>
      </div>
    </div>
  );
}
