'use client';

import Link from 'next/link';
import { CheckCircle2, Clock, FileEdit, UsersRound } from 'lucide-react';
import { MockLetter, LetterStatus } from '@/data/mockData';
import { cn } from '@/lib/utils';

const statusConfig: Record<LetterStatus, { label: string; icon: typeof UsersRound; className: string }> = {
  draft: { label: 'Draft on desk', icon: FileEdit, className: 'text-amber-accent' },
  sealed: { label: 'Sealed · Ready to relay', icon: Clock, className: 'text-amber-accent' },
  dispatched: { label: 'In relay transit', icon: UsersRound, className: 'text-mint-accent' },
  delivered: { label: 'Arrived safely', icon: CheckCircle2, className: 'text-mint-accent' },
};

export function LetterCard({ letter, showExcerpt = false }: { letter: MockLetter; showExcerpt?: boolean }) {
  const isReceived = letter.direction === 'received';
  const config = isReceived
    ? { label: 'Received letter', icon: CheckCircle2, className: 'text-mint-accent' }
    : statusConfig[letter.status] || statusConfig.draft;
  const Icon = config.icon;

  const href = isReceived
    ? `/letter/${letter.id}`
    : letter.status === 'draft'
      ? '/compose'
      : letter.status === 'sealed'
        ? `/compose/dispatch?letter=${letter.id}`
        : `/journey?letter=${letter.id}`;

  return (
    <Link
      href={href}
      className="group flex flex-col justify-between gap-3 border-b border-outline-variant/70 py-4 transition-all duration-200 hover:bg-ink-navy/[0.02] hover:pl-2 sm:flex-row sm:items-center sm:py-5"
    >
      <div className="flex items-start gap-md sm:items-center">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center border border-outline-variant/60 bg-surface-container-lowest sm:mt-0">
          <Icon className={cn('h-4 w-4', config.className)} />
        </div>
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 className="font-headline-md text-[18px] text-ink-navy group-hover:underline decoration-amber-accent decoration-2 underline-offset-4">
              {letter.subject}
            </h4>
            <span className="font-caption text-caption text-on-surface-variant">
              {isReceived ? `From ${letter.sender || 'A correspondent'}` : `To ${letter.recipient}`}
            </span>
          </div>
          {showExcerpt && letter.excerpt && (
            <p className="mt-1 line-clamp-1 max-w-xl font-body-md text-sm text-on-surface-variant">
              &ldquo;{letter.excerpt}&rdquo;
            </p>
          )}
          <p className="mt-1 font-caption text-caption text-on-surface-variant">
            <span className={cn('font-medium', config.className)}>{config.label}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
        <span className="font-caption text-caption text-on-surface-variant whitespace-nowrap">
          {letter.date}
        </span>
        <span className="font-caption text-xs uppercase tracking-[0.14em] text-ink-navy underline decoration-outline-variant group-hover:decoration-amber-accent">
          {isReceived
            ? 'Open letter →'
            : letter.status === 'draft'
              ? 'Edit draft →'
              : letter.status === 'sealed'
                ? 'Dispatch →'
                : 'View journey →'}
        </span>
      </div>
    </Link>
  );
}
