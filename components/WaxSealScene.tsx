'use client';

import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { playInterfaceSound } from '@/lib/interfaceSound';
import { getSealInfo } from '@/data/mockData';

interface WaxSealSceneProps {
  sealId?: string;
  sealColor?: string;
  sealMonogram?: string;
  recipientName?: string;
  destinationCity?: string;
  destinationCountry?: string;
  isSealed: boolean;
  onPressed?: () => void;
}

export function WaxSealScene({
  sealId = 'fern',
  sealColor = '#991b1b',
  sealMonogram = 'E',
  recipientName = 'Eleanor Hartwell',
  destinationCity = 'Cotswolds Village',
  destinationCountry = 'United Kingdom',
  isSealed,
  onPressed,
}: WaxSealSceneProps) {
  const [animating, setAnimating] = useState(false);
  const sealInfo = getSealInfo(sealId, sealMonogram, sealColor);

  const handlePress = () => {
    if (isSealed || animating) return;
    setAnimating(true);
    playInterfaceSound('seal');

    // Smooth timing: stamp descends, presses, and registers sealed state
    window.setTimeout(() => {
      onPressed?.();
      setAnimating(false);
    }, 700);
  };

  return (
    <div
      role="region"
      aria-label="Wax Sealing Ceremony Desk"
      className="relative min-h-[380px] md:min-h-[420px] w-full flex items-center justify-center overflow-hidden rounded-md border border-outline-variant/40 bg-[radial-gradient(circle_at_50%_35%,rgba(201,149,67,0.18)_0%,rgba(16,42,67,0.95)_75%)] p-6 shadow-inner select-none"
    >
      {/* Table accent lighting */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-amber-accent/20" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-ink-navy/40" />

      {/* Folded Parchment Envelope on the Desk */}
      <div className="relative w-full max-w-[440px] aspect-[1.62] rounded border border-[#cbbda9] bg-[#fbf7f0] shadow-[0_22px_45px_rgba(0,0,0,0.38)] overflow-hidden transition-all duration-500">
        {/* Paper crease / diagonal flap lines */}
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(16,42,67,0.08)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(16,42,67,0.06)_50%,transparent_50.5%)]" />
        <div className="absolute left-1/2 top-1/2 h-px w-[62%] -translate-x-1/2 bg-[#102a43]/15" />

        {/* Envelope Header stamp */}
        <div className="absolute left-5 top-4 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-[#102a43]/50">
          <span>Drop</span>
          <span>·</span>
          <span>Postal Relay</span>
        </div>

        {/* Written Recipient & Address on Envelope */}
        <div className="absolute left-6 bottom-5 max-w-[240px] text-left">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#102a43]/40">Deliver to</p>
          <p className="font-headline-md text-base leading-snug text-[#102a43] truncate">
            {recipientName || 'Recipient'}
          </p>
          <p className="font-mono text-[11px] text-[#102a43]/60 truncate">
            {destinationCity ? `${destinationCity}, ` : ''}{destinationCountry || 'Everywhere'}
          </p>
        </div>

        {/* Right seal status hint */}
        <div className="absolute right-5 bottom-4 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#102a43]/45">
          <LockKeyhole className="h-3 w-3 text-mint-accent" />
          <span>{isSealed ? 'Sealed' : 'Awaiting Stamp'}</span>
        </div>

        {/* --- Center Wax Seal & Brass Die Assembly --- */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          {/* If already sealed: Stamped 3D Intaglio Wax Seal */}
          {isSealed ? (
            <div
              className="wax-seal-tactile flex h-20 w-20 items-center justify-center text-white shadow-[0_12px_28px_rgba(0,0,0,0.35)] animate-in fade-in zoom-in duration-500"
              style={{ backgroundColor: sealColor }}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/30 wax-bezel">
                <span className="wax-intaglio font-headline-md text-2xl select-none">
                  {sealInfo.displayMark}
                </span>
              </div>
            </div>
          ) : (
            /* If not sealed: Warm molten wax pool + hovering brass stamp die */
            <div className="relative flex flex-col items-center cursor-pointer" onClick={handlePress}>
              {/* Molten wax pool */}
              <div
                className="relative flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition-transform duration-300 hover:scale-105"
                style={{ backgroundColor: sealColor }}
              >
                <div className="absolute inset-0 rounded-full wax-shimmer wax-pulse opacity-90" />
                <span className="font-caption text-[10px] uppercase tracking-wider text-white/70">
                  Wax pool
                </span>
              </div>

              {/* Brass Die hovering above */}
              <div
                className={`absolute -top-24 flex flex-col items-center transition-all duration-500 ${
                  animating ? 'translate-y-14 scale-95 opacity-90' : 'hover:-translate-y-1'
                }`}
                title="Click to stamp the seal"
              >
                {/* Brass Die Lathed Handle */}
                <div className="h-10 w-4 rounded-t-sm bg-gradient-to-r from-[#4a3b2c] via-[#8b7561] to-[#3a2c1e] shadow-md border-x border-[#9b8571]" />
                <div className="h-3 w-8 rounded-sm bg-gradient-to-r from-[#6b5845] via-[#a89078] to-[#5a4835] shadow-sm" />
                {/* Brass Die Face with Engraved Mark */}
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#8b7561] bg-gradient-to-b from-[#4a3826] to-[#2c2014] text-amber-100 shadow-xl">
                  <span className="font-headline-md text-xl opacity-90">
                    {sealInfo.displayMark}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Ceremony Caption */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.28em] text-parchment/40">
        {isSealed ? 'Envelope Sealed & Closed' : 'Click the die to stamp'}
      </div>
    </div>
  );
}
