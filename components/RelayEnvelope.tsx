'use client';

import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { getSealInfo } from '@/data/mockData';
import { getLetterDraft } from '@/lib/letterStore';
import { cn } from '@/lib/utils';
import { SealMark } from '@/components/SealMark';

export function RelayEnvelope({
  compact = false,
  className,
  sealMark,
  sealColor,
  sealId,
}: {
  compact?: boolean;
  className?: string;
  sealMark?: string;
  sealColor?: string;
  sealId?: string | null;
}) {
  const [details, setDetails] = useState({ id: sealId || 'fern', mark: sealMark || 'F', color: sealColor || '#b84b3a' });

  useEffect(() => {
    if (sealMark || sealColor || sealId) {
      const info = getSealInfo(sealId, sealMark, sealColor);
      setDetails({ id: info.id, mark: sealMark || info.displayMark, color: sealColor || info.color });
      return;
    }
    const draft = getLetterDraft();
    const info = getSealInfo(draft.sealId, draft.sealMonogram, draft.sealColor);
    setDetails({ id: info.id, mark: info.displayMark, color: info.color });
  }, [sealColor, sealId, sealMark]);

  return (
    <div
      className={cn('relative aspect-[1.58] w-full max-w-[440px]', compact && 'max-w-[270px]', className)}
      role="img"
      aria-label="A sealed letter ready to travel"
    >
      <div className="absolute inset-0 overflow-hidden border border-[rgba(16,42,67,0.18)] bg-[#fcfaf6] shadow-[0_16px_26px_rgba(16,42,67,0.1)]">
        <div className="absolute inset-0 opacity-40" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 border-t border-[rgba(16,42,67,0.16)]" />
          <span className="absolute inset-y-0 left-1/2 border-l border-[rgba(16,42,67,0.16)]" />
          <span className="absolute inset-0 rotate-[27deg] border-t border-[rgba(16,42,67,0.11)]" />
          <span className="absolute inset-0 -rotate-[27deg] border-t border-[rgba(16,42,67,0.11)]" />
        </div>
        <div className="absolute left-5 top-4 font-mono text-[0.58rem] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Dear.exe / relay</div>
        <div className="absolute bottom-4 right-5 inline-flex items-center gap-1.5 font-mono text-[0.58rem] font-bold uppercase tracking-[0.17em] text-on-surface-variant">
          <LockKeyhole className="h-3 w-3 text-[#4f9d7a]" aria-hidden="true" /> Sealed
        </div>
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <SealMark sealId={details.id} mark={details.mark} color={details.color} size={compact ? 'md' : 'lg'} label={null} />
      </div>
    </div>
  );
}
