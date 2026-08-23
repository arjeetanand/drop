'use client';

import { useState } from 'react';
import { playInterfaceSound } from '@/lib/interfaceSound';

export function WaxSealScene({ onPressed }: { onPressed?: () => void }) {
  const [pressed, setPressed] = useState(false);

  const handlePress = () => {
    if (pressed) return;
    setPressed(true);
    playInterfaceSound('seal');
    onPressed?.();
  };

  return (
    <div className="relative min-h-[360px] h-full w-full overflow-hidden bg-[radial-gradient(circle_at_50%_34%,rgba(196,168,130,0.2),transparent_40%),linear-gradient(180deg,#241812_0%,#1a1410_100%)]">
      <div className="absolute inset-x-[15%] top-[16%] h-px bg-amber-accent/20" />
      <div className="absolute inset-x-[12%] bottom-[18%] h-px bg-amber-accent/10" />

      <div className="absolute left-1/2 top-1/2 h-56 w-80 -translate-x-1/2 -translate-y-1/2 [perspective:900px]">
        <div className="scene-envelope absolute left-1/2 top-[58%] h-28 w-48 -translate-x-1/2 -translate-y-1/2 rotate-[-5deg] border border-parchment/30 bg-parchment shadow-2xl">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(139,45,45,0.16)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(139,45,45,0.12)_50%,transparent_50.5%)]" />
          <div className="absolute left-1/2 top-1/2 h-px w-32 -translate-x-1/2 bg-ink-navy/20" />
        </div>

        <div className="scene-wax absolute left-1/2 top-[55%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-wax-red/30 bg-wax-red shadow-[0_0_40px_rgba(192,64,64,0.3)]">
          <div className="absolute inset-2 flex items-center justify-center rounded-full border border-parchment/25 text-2xl text-parchment/85">♥</div>
        </div>

        <div className={`scene-stamp absolute left-1/2 top-[14%] h-24 w-24 -translate-x-1/2 rounded-full border-8 border-[#5a4a3a] bg-[#3a2a1a] shadow-xl ${pressed ? 'scene-stamp-pressed' : ''}`}>
          <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#8b7561]" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg text-parchment">♥</div>
        </div>
      </div>

      <p className="absolute left-1/2 top-8 -translate-x-1/2 font-caption text-caption uppercase tracking-[0.3em] text-parchment/35">
        A small ceremony
      </p>

      <button
        type="button"
        onClick={handlePress}
        disabled={pressed}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-sm bg-wax-red px-xl py-md font-label-md text-label-md uppercase tracking-widest text-surface-bright transition-all hover:-translate-y-0.5 hover:bg-wax-red-dark hover:shadow-lg disabled:cursor-default disabled:bg-wax-red/60"
      >
        {pressed ? 'Seal pressed' : 'Press the seal'}
      </button>
    </div>
  );
}
