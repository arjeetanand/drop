'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type LetterStep = 'write' | 'address' | 'send';

const steps: Array<{ id: LetterStep; label: string; href: string }> = [
  { id: 'write', label: 'Write', href: '/compose' },
  { id: 'address', label: 'Address', href: '/compose/address' },
  { id: 'send', label: 'Send', href: '/compose/dispatch' },
];

export function LetterProgress({ current, dark = false }: { current: LetterStep; dark?: boolean }) {
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Letter progress" className="flex items-center justify-center gap-2 sm:gap-3">
      {steps.map((step, index) => {
        const isCurrent = step.id === current;
        const isComplete = index < currentIndex;

        return (
          <div key={step.id} className="flex items-center gap-2 sm:gap-3">
            <Link
              href={step.href}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full px-2.5 py-1.5 font-caption text-caption transition-colors',
                dark
                  ? isCurrent
                    ? 'bg-amber-accent text-ink-navy'
                    : isComplete
                      ? 'text-parchment'
                      : 'text-parchment/45'
                  : isCurrent
                    ? 'bg-secondary-container text-on-secondary-container'
                    : isComplete
                      ? 'text-primary'
                      : 'text-on-surface-variant/60'
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                  dark
                    ? isCurrent
                      ? 'border-ink-navy/30'
                      : isComplete
                        ? 'border-parchment/50'
                        : 'border-parchment/25'
                    : isCurrent
                      ? 'border-on-secondary-container/30'
                      : isComplete
                        ? 'border-primary/40'
                        : 'border-outline-variant'
                )}
              >
                {isComplete ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </Link>
            {index < steps.length - 1 && (
              <span className={cn('h-px w-4 sm:w-8', dark ? 'bg-parchment/20' : 'bg-outline-variant')} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

