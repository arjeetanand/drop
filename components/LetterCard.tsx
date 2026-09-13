'use client';

import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Clock3, FileEdit, Mail, PackageCheck } from 'lucide-react';
import type { LetterStatus, MockLetter } from '@/data/mockData';
import { cn } from '@/lib/utils';

const statusConfig: Record<LetterStatus, { label: string; icon: typeof Mail; tone: string }> = {
  draft: { label: 'Draft', icon: FileEdit, tone: 'text-[#8a611b]' },
  sealed: { label: 'Sealed', icon: PackageCheck, tone: 'text-[#8a611b]' },
  dispatched: { label: 'In relay', icon: Clock3, tone: 'text-[#276a4d]' },
  delivered: { label: 'Delivered', icon: CheckCircle2, tone: 'text-[#276a4d]' },
};

export function LetterCard({ letter, showExcerpt = false }: { letter: MockLetter; showExcerpt?: boolean }) {
  const isReceived = letter.direction === 'received';
  const config = isReceived
    ? { label: 'Received', icon: Mail, tone: 'text-[#276a4d]' }
    : statusConfig[letter.status] || statusConfig.draft;
  const Icon = config.icon;
  const href = isReceived
    ? `/letter/${encodeURIComponent(letter.id)}`
    : letter.status === 'draft'
      ? '/compose'
      : letter.status === 'sealed'
        ? `/compose/dispatch?letter=${encodeURIComponent(letter.id)}`
        : `/journey?letter=${encodeURIComponent(letter.id)}`;
  const action = isReceived
    ? 'Open letter'
    : letter.status === 'draft'
      ? 'Continue writing'
      : letter.status === 'sealed'
        ? 'Dispatch'
        : 'View journey';

  return (
    <Link
      href={href}
      className="group grid gap-4 border-t border-[rgba(16,42,67,0.12)] py-5 transition-colors hover:bg-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-[rgba(16,42,67,0.16)] bg-white/60 text-ink-navy">
          <Icon className={cn('h-4 w-4', config.tone)} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-headline-md text-xl leading-tight text-ink-navy group-hover:underline group-hover:decoration-[#b88938] group-hover:underline-offset-4">
              {letter.subject}
            </span>
            <span className="meta">{isReceived ? `From ${letter.sender || 'a correspondent'}` : `To ${letter.recipient}`}</span>
          </span>
          {showExcerpt && letter.excerpt && (
            <span className="mt-1 block line-clamp-2 max-w-2xl font-body-md text-sm leading-relaxed text-on-surface-variant">
              “{letter.excerpt}”
            </span>
          )}
          <span className={cn('mt-2 inline-flex items-center gap-1.5 meta font-semibold', config.tone)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {config.label}
          </span>
        </span>
      </div>
      <span className="flex items-center justify-between gap-5 sm:flex-col sm:items-end sm:justify-center">
        <span className="meta whitespace-nowrap">{letter.date}</span>
        <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.08em] text-ink-navy">
          {action}
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
