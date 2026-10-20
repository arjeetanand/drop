'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Sparkles, Eye, LockKeyhole } from 'lucide-react';

interface Interactive3DEnvelopeProps {
  recipient?: string;
  subject?: string;
  excerpt?: string;
  waxColor?: string;
  monogram?: string;
  className?: string;
}

/**
 * Interactive 3D Cotton Parchment Envelope.
 * Real-time mouse movement 3D tilt + interactive flap unfolding and letter slide reveal.
 * Modern light aesthetic with realistic paper drop-shadows and translucent wax seal.
 */
export function Interactive3DEnvelope({
  recipient = 'Eleanor Hartwell',
  subject = 'Morning Light',
  excerpt = 'Morning light through the kitchen window. The kettle is whistling and I am thinking of you…',
  waxColor = '#991b1b',
  monogram = 'E',
  className = '',
}: Interactive3DEnvelopeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, mouseX: 50, mouseY: 50 });
  const [isHovered, setIsHovered] = useState(false);

  // Mouse move handler for smooth 3D parallax tilt
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Subtle natural tilt: -12 to +12 degrees
    const rotateY = (x - 0.5) * 20;
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

  const toggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn('relative flex flex-col items-center select-none py-6', className)}
      style={{ perspective: '1200px' }}
    >
      {/* 3D Envelope Wrapper */}
      <div
        onClick={toggleOpen}
        className="relative cursor-pointer transition-transform duration-200 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg) ${
            isHovered ? 'scale(1.02)' : 'scale(1)'
          }`,
        }}
      >
        {/* Envelope Container: 340px x 220px standard proportions */}
        <div className="relative w-[340px] sm:w-[380px] h-[230px] rounded-xl bg-white border border-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.06),0_20px_50px_rgba(15,23,42,0.04)] overflow-visible">
          
          {/* Subtle paper grain and specular highlight that tracks cursor */}
          <div
            className="absolute inset-0 rounded-xl pointer-events-none transition-opacity duration-300 z-30"
            style={{
              opacity: isHovered ? 1 : 0,
              background: `radial-gradient(circle at ${tilt.mouseX}% ${tilt.mouseY}%, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0) 55%)`,
              mixBlendMode: 'soft-light',
            }}
          />

          {/* ── Letter Paper that slides out ── */}
          <div
            className={cn(
              'absolute left-4 right-4 bg-[#faf9f6] border border-slate-200/70 rounded-lg p-5 shadow-sm transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-10',
              isOpen
                ? '-translate-y-28 opacity-100 shadow-xl'
                : 'translate-y-2 opacity-30 pointer-events-none'
            )}
            style={{ height: '200px' }}
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-400 mb-1">
              To {recipient}
            </p>
            <h4 className="font-headline-md text-base text-slate-900 font-semibold mb-2 line-clamp-1">
              {subject}
            </h4>
            <p className="font-serif text-xs text-slate-600 leading-relaxed italic line-clamp-4">
              &ldquo;{excerpt}&rdquo;
            </p>
            <div className="absolute bottom-3 right-4 flex items-center gap-1.5 font-mono text-[9px] text-emerald-600 font-medium">
              <Sparkles className="h-3 w-3" /> Sealed with human care
            </div>
          </div>

          {/* Envelope Back Face Inner Shadow */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-slate-100/60 to-white z-0" />

          {/* Envelope Bottom and Side Flaps (Pocket) */}
          <div
            className="absolute inset-0 rounded-xl pointer-events-none z-20 overflow-hidden"
            style={{ clipPath: 'polygon(0% 0%, 50% 50%, 100% 0%, 100% 100%, 0% 100%)' }}
          >
            <div className="absolute inset-0 bg-white border-t border-slate-100" />
            {/* Subtle flap diagonal shadows */}
            <div className="absolute bottom-0 left-0 w-full h-[50%] bg-gradient-to-t from-slate-100/40 to-transparent" />
            <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between text-slate-400 font-mono text-[10px] tracking-wider uppercase">
              <span>Drop · Relay</span>
              <span>100% Private</span>
            </div>
          </div>

          {/* Envelope Top Flap (Animated 3D Fold) */}
          <div
            className="absolute top-0 left-0 right-0 h-[52%] origin-top transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] z-25 pointer-events-none"
            style={{
              transformStyle: 'preserve-3d',
              transform: isOpen ? 'rotateX(-180deg)' : 'rotateX(0deg)',
              clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)',
            }}
          >
            <div className="w-full h-full bg-[#fdfdfd] border-b border-slate-200/90 shadow-[0_4px_12px_rgba(0,0,0,0.03)]" />
          </div>

          {/* Wax Seal (Embossed Monogram) */}
          <div
            className={cn(
              'absolute top-[48%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-300',
              isOpen ? 'scale-90 opacity-40 translate-y-[-18px]' : 'scale-100 opacity-100'
            )}
          >
            <div
              className="relative flex items-center justify-center h-12 w-12 rounded-full shadow-[0_4px_14px_rgba(153,27,27,0.35),0_1px_3px_rgba(0,0,0,0.2)] transition-transform hover:scale-110 active:scale-95"
              style={{
                backgroundColor: waxColor,
                background: `radial-gradient(circle at 35% 35%, #b91c1c, ${waxColor} 70%, #7f1d1d)`,
              }}
            >
              {/* Outer wax rim texture */}
              <div className="absolute inset-1 rounded-full border border-white/25 pointer-events-none" />
              {/* Dynamic specular highlight on wax */}
              <div className="absolute top-1.5 left-2 w-3 h-2 rounded-full bg-white/40 blur-[1px] pointer-events-none" />
              <span className="font-headline-md text-base text-amber-100/90 font-bold select-none drop-shadow-sm">
                {monogram}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Micro-Dock Trigger below envelope */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={toggleOpen}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/90 border border-slate-200/80 shadow-xs text-xs font-mono tracking-wider text-slate-700 hover:text-slate-950 hover:bg-white hover:border-slate-300 transition-all"
        >
          {isOpen ? (
            <>
              <LockKeyhole className="h-3 w-3 text-slate-500" />
              <span>Fold &amp; Reseal</span>
            </>
          ) : (
            <>
              <Eye className="h-3 w-3 text-emerald-600" />
              <span>Click to Unfold &amp; Read</span>
            </>
          )}
        </button>
        <span className="font-mono text-[10px] text-slate-400">
          Move cursor to tilt in 3D
        </span>
      </div>
    </div>
  );
}
