'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type LetterStep = 'write' | 'address' | 'send';

const steps: Array<{ id: LetterStep; label: string; href: string }> = [
  { id: 'write', label: 'Write', href: '/compose' },
  { id: 'address', label: 'Address & seal', href: '/compose/address' },
  { id: 'send', label: 'Dispatch', href: '/compose/dispatch' },
];

export function LetterProgress({ current }: { current: LetterStep }) {
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Drop setup progress" className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const isCurrent = step.id === current;
        const isComplete = index < currentIndex;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <Link
              href={step.href}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-sm px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]',
                isCurrent
                  ? 'bg-ink-navy text-white'
                  : isComplete
                    ? 'text-ink-navy hover:bg-white/55'
                    : 'text-on-surface-variant hover:bg-white/55'
              )}
            >
              <span className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem]',
                isCurrent ? 'border-white/35' : isComplete ? 'border-[#4f9d7a] text-[#276a4d]' : 'border-[rgba(16,42,67,0.2)]'
              )}>
                {isComplete ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}
              </span>
              <span>{step.label}</span>
            </Link>
            {index < steps.length - 1 && <span className="h-px w-5 bg-[rgba(16,42,67,0.16)]" aria-hidden="true" />}
          </div>
        );
      })}
    </nav>
  );
}
