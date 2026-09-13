'use client';

import { Flag, MapPin, UserRound } from 'lucide-react';
import type { RelayHandoff, RelayState } from '@/lib/relayStore';
import { cn } from '@/lib/utils';

function HandoffIcon({ handoff }: { handoff: RelayHandoff }) {
  if (handoff.role === 'recipient') return <Flag className="h-4 w-4" aria-hidden="true" />;
  if (handoff.role === 'sender') return <UserRound className="h-4 w-4" aria-hidden="true" />;
  return <span className="font-headline-md text-base" aria-hidden="true">{handoff.name.slice(0, 1).toUpperCase()}</span>;
}

export function RelayChain({ relay, compact = false }: { relay: RelayState; compact?: boolean }) {
  return (
    <div className="relative">
      <div className="absolute left-[10%] right-[10%] top-5 hidden h-px bg-[rgba(16,42,67,0.16)] lg:block" aria-hidden="true" />
      <ol className={cn('relative grid gap-5 sm:grid-cols-2 lg:grid-cols-4', compact && 'gap-4')} aria-label="Relay handoff chain">
        {relay.handoffs.map((handoff) => {
          const isNext = Boolean(handoff.next);
          const isComplete = !isNext;
          return (
            <li key={handoff.id} className="relative z-10 min-w-0">
              <div className="flex items-start gap-3 lg:flex-col lg:items-center lg:text-center">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-[#f7f4ee] text-ink-navy', isNext ? 'border-[#b84b3a] text-[#8c3328]' : handoff.role === 'sender' ? 'border-ink-navy' : 'border-[#4f9d7a] text-[#276a4d]')}>
                  <HandoffIcon handoff={handoff} />
                </div>
                <div className="min-w-0 lg:mt-3">
                  <p className="break-words font-headline-md text-lg leading-tight text-ink-navy">{handoff.name}</p>
                  <p className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-on-surface-variant"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> <span className="break-words">{handoff.location}</span></p>
                  <p className={cn('mt-2 text-[0.68rem] font-bold uppercase tracking-[0.08em]', isNext ? 'text-[#8c3328]' : isComplete ? 'text-[#276a4d]' : 'text-on-surface-variant')}>{isNext ? 'Next stop' : handoff.role === 'sender' ? 'Started here' : 'Carried forward'}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
