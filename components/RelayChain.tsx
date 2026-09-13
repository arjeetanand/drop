'use client';

import { Flag, MapPin, UserRound } from 'lucide-react';
import type { RelayHandoff, RelayState } from '@/lib/relayStore';
import { cn } from '@/lib/utils';

function HandoffIcon({ handoff }: { handoff: RelayHandoff }) {
  if (handoff.role === 'recipient') return <Flag className="h-4 w-4" />;
  if (handoff.role === 'sender') return <UserRound className="h-4 w-4" />;
  return <span className="font-headline-md text-sm">{handoff.name.slice(0, 1).toUpperCase()}</span>;
}

export function RelayChain({ relay, compact = false }: { relay: RelayState; compact?: boolean }) {
  return (
    <div className={cn('overflow-x-auto pb-2', compact ? 'min-w-0' : '')}>
      <div className={cn('relative flex min-w-[430px] items-start', compact ? 'min-w-[360px]' : '')}>
        <div className="absolute left-8 right-8 top-5 h-px bg-[#d9d4ca]" aria-hidden="true" />
        {relay.handoffs.map((handoff) => (
          <div key={handoff.id} className="relative z-10 flex min-w-[92px] flex-1 flex-col items-center text-center">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full border bg-[#f6f2ea] text-[#102a43] transition-transform duration-300',
                handoff.next
                  ? 'border-dashed border-[#c99543] text-[#c99543]'
                  : handoff.role === 'sender'
                    ? 'border-[#102a43]'
                    : 'border-[#9cccb7] bg-[#bfe6d0]'
              )}
              title={handoff.next ? 'Next person to receive the letter' : `${handoff.name} is part of the relay`}
            >
              <HandoffIcon handoff={handoff} />
            </div>
            <p className="mt-2 max-w-[88px] truncate font-headline-md text-[16px] leading-5 text-[#102a43]">{handoff.name}</p>
            <p className="mt-1 inline-flex max-w-[100px] items-center gap-1 truncate font-caption text-[10px] uppercase tracking-[0.08em] text-[#67717d]">
              <MapPin className="h-3 w-3 shrink-0" /> {handoff.location}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
