'use client';

import { useEffect, useRef, useState } from 'react';
import { playInterfaceSound } from '@/lib/interfaceSound';

export function PostboxScene({ onPosted }: { onPosted?: () => void }) {
  const [sent, setSent] = useState(false);
  const [shaking, setShaking] = useState(false);
  const onPostedRef = useRef(onPosted);

  useEffect(() => {
    onPostedRef.current = onPosted;
  }, [onPosted]);

  useEffect(() => {
    if (!sent) return;

    const shakeTimer = window.setTimeout(() => setShaking(true), 1500);
    const finishTimer = window.setTimeout(() => {
      setShaking(false);
      onPostedRef.current?.();
    }, 2100);

    return () => {
      window.clearTimeout(shakeTimer);
      window.clearTimeout(finishTimer);
    };
  }, [sent]);

  return (
    <div className="relative min-h-[360px] h-full w-full overflow-hidden bg-[radial-gradient(circle_at_50%_28%,rgba(255,204,136,0.18),transparent_32%),linear-gradient(180deg,#241812_0%,#1a1410_100%)]">
      <div className="absolute inset-x-[10%] bottom-[18%] h-px bg-amber-accent/20" />
      <div className="absolute bottom-[18%] left-1/2 h-24 w-[min(78vw,620px)] -translate-x-1/2 rounded-[50%] bg-black/30 blur-2xl" />

      <div className={`scene-postbox absolute left-1/2 top-[48%] h-64 w-40 -translate-x-1/2 -translate-y-1/2 ${shaking ? 'scene-postbox-shaking' : ''}`}>
        <div className="absolute bottom-0 left-1/2 h-48 w-32 -translate-x-1/2 rounded-t-[2.5rem] border border-wax-red/50 bg-[linear-gradient(90deg,#6b1f1f_0%,#a13a38_48%,#6b1f1f_100%)] shadow-2xl" />
        <div className="absolute left-1/2 top-2 h-20 w-36 -translate-x-1/2 rounded-t-full border border-wax-red/50 bg-[#8b2d2d] shadow-lg" />
        <div className="absolute left-1/2 top-24 h-3 w-16 -translate-x-1/2 rounded-sm bg-ink-navy/80" />
        <div className="absolute bottom-14 left-1/2 h-12 w-16 -translate-x-1/2 rounded-sm border border-wax-red/40 bg-[#6b1f1f]" />
        <div className="absolute bottom-24 left-1/2 h-4 w-20 -translate-x-1/2 border border-amber-accent/50 bg-parchment/30 text-center font-caption text-[8px] tracking-[0.3em] text-amber-accent">POST</div>
      </div>

      <div className={`scene-post-envelope absolute left-1/2 top-[22%] h-16 w-28 -translate-x-1/2 rotate-[-7deg] border border-parchment/35 bg-parchment shadow-xl ${sent ? 'scene-post-envelope-sent' : ''}`}>
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(139,45,45,0.16)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(139,45,45,0.12)_50%,transparent_50.5%)]" />
      </div>

      <p className="absolute left-1/2 top-8 -translate-x-1/2 font-caption text-caption uppercase tracking-[0.3em] text-parchment/35">
        The road begins here
      </p>

      {!sent && (
        <button
          type="button"
          onClick={() => {
            setSent(true);
            playInterfaceSound('send');
          }}
          className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-sm bg-wax-red px-xl py-md font-label-md text-label-md uppercase tracking-widest text-surface-bright transition-all hover:-translate-y-0.5 hover:bg-wax-red-dark hover:shadow-lg"
        >
          Send Letter
        </button>
      )}
      {sent && !shaking && (
        <p className="absolute bottom-8 left-1/2 -translate-x-1/2 font-caption text-caption text-parchment/60">Sliding into the postbox...</p>
      )}
      {shaking && (
        <p className="absolute bottom-8 left-1/2 -translate-x-1/2 font-caption text-caption text-wax-red">Posted!</p>
      )}
    </div>
  );
}
