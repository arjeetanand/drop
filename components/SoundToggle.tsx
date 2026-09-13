'use client';

import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isSoundMuted, playInterfaceSound, setSoundMuted } from '@/lib/interfaceSound';

export function SoundToggle() {
  const [muted, setMuted] = useState(false);

  useEffect(() => setMuted(isSoundMuted()), []);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
    if (!next) playInterfaceSound('tap');
  };

  const Icon = muted ? VolumeX : Volume2;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? 'Turn sound on' : 'Mute interface sounds'}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgba(16,42,67,0.16)] bg-white/45 text-on-surface-variant transition-colors hover:border-ink-navy hover:bg-white hover:text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
