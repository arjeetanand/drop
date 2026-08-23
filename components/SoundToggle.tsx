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
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
