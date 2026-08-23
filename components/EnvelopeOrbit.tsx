'use client';

import { Sparkles } from 'lucide-react';

export function EnvelopeOrbit({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden ${compact ? 'h-40 w-full' : 'h-72 w-full max-w-[480px]'}`}
    >
      <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-accent/30 [transform:rotateX(66deg)]" />
      <div className="absolute left-1/2 top-1/2 h-32 w-64 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-wax-red/20 [transform:rotateX(66deg)_rotateZ(-12deg)]" />
      <div className="absolute left-[18%] top-[22%] text-amber-accent animate-pulse">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="absolute right-[17%] top-[32%] h-2 w-2 rounded-full bg-mint-accent shadow-[0_0_0_5px_rgba(148,201,182,0.18)]" />
      <div className="hero-envelope absolute left-1/2 top-1/2 h-36 w-60 -translate-x-1/2 -translate-y-1/2 rotate-[-7deg] rounded-md border border-parchment-deep/60 bg-parchment shadow-[0_22px_40px_rgba(63,46,30,0.2)] [transform-style:preserve-3d]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(139,45,45,0.16)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(139,45,45,0.12)_50%,transparent_50.5%)]" />
        <div className="absolute left-1/2 top-1/2 h-px w-40 -translate-x-1/2 bg-ink-navy/15" />
        <div className="hero-envelope-seal absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-wax-red/30 bg-wax-red text-2xl text-parchment shadow-lg">
          <span className="rounded-full border border-parchment/30 px-2 py-1 text-sm">D.</span>
        </div>
      </div>
    </div>
  );
}
