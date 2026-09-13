'use client';

import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, UserRound, UsersRound } from 'lucide-react';
import { playInterfaceSound } from '@/lib/interfaceSound';

export function RelayLaunchScene({ onLaunched }: { onLaunched?: () => void }) {
  const [launched, setLaunched] = useState(false);
  const onLaunchedRef = useRef(onLaunched);

  useEffect(() => {
    onLaunchedRef.current = onLaunched;
  }, [onLaunched]);

  useEffect(() => {
    if (!launched) return;
    const timer = window.setTimeout(() => onLaunchedRef.current?.(), 1300);
    return () => window.clearTimeout(timer);
  }, [launched]);

  const launch = () => {
    if (launched) return;
    setLaunched(true);
    playInterfaceSound('send');
  };

  return (
    <div className="relative min-h-[360px] h-full w-full overflow-hidden bg-[#102a43]">
      <div className="absolute inset-x-[10%] top-1/2 h-px bg-[#bfe6d0]/35" />
      <div className="absolute left-[12%] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#bfe6d0] shadow-[0_0_0_6px_rgba(191,230,208,0.1)]" />
      <div className="absolute right-[12%] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#c99543] shadow-[0_0_0_6px_rgba(201,149,67,0.1)]" />

      <div className={`absolute left-1/2 top-1/2 flex h-48 w-72 -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-transform duration-1000 ${launched ? 'translate-y-[-180%] rotate-6 opacity-0' : ''}`}>
        <div className="absolute h-28 w-48 rotate-[-5deg] border border-[#cbbda9] bg-[#fbf7f0] shadow-[0_18px_30px_rgba(0,0,0,0.28)]">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(184,75,58,0.15)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(16,42,67,0.12)_50%,transparent_50.5%)]" />
          <div className="absolute left-1/2 top-1/2 h-px w-32 -translate-x-1/2 bg-[#102a43]/15" />
        </div>
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-[5px] border-[#b84b3a]/30 bg-[#b84b3a] text-[#fbf7f0] shadow-[0_10px_24px_rgba(184,75,58,0.34)]">
          <span className="font-headline-md text-xl">D.</span>
        </div>
      </div>

      <div className="absolute left-1/2 top-[16%] flex -translate-x-1/2 items-center gap-3 font-caption text-caption uppercase tracking-[0.24em] text-[#f6f2ea]/55">
        <LockKeyhole className="h-4 w-4 text-[#bfe6d0]" /> Sealed from view
      </div>

      <div className="absolute bottom-[19%] left-1/2 flex -translate-x-1/2 items-center gap-12 text-[#f6f2ea]/70">
        <div className="flex flex-col items-center gap-2"><UserRound className="h-5 w-5 text-[#bfe6d0]" /><span className="font-caption text-[10px] uppercase tracking-[0.16em]">You</span></div>
        <div className="flex flex-col items-center gap-2"><UsersRound className="h-5 w-5 text-[#c99543]" /><span className="font-caption text-[10px] uppercase tracking-[0.16em]">A friend</span></div>
        <div className="flex flex-col items-center gap-2"><span className="h-5 w-5 rounded-full border border-[#f6f2ea]/55" /><span className="font-caption text-[10px] uppercase tracking-[0.16em]">Them</span></div>
      </div>

      {!launched && <button type="button" onClick={launch} className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#c99543] px-xl py-md font-label-md text-label-md uppercase tracking-widest text-[#102a43] transition-transform hover:-translate-y-0.5 hover:bg-[#d8ab62]">Start the relay</button>}
      {launched && <p className="absolute bottom-8 left-1/2 -translate-x-1/2 font-caption text-caption uppercase tracking-[0.2em] text-[#bfe6d0]">Relay passport created</p>}
    </div>
  );
}
