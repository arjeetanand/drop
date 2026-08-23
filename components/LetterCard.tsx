'use client';

import Link from 'next/link';
import { Send, FileEdit, Clock, CheckCircle2 } from 'lucide-react';
import { MockLetter, LetterStatus } from '@/data/mockData';
import { cn } from '@/lib/utils';

const statusConfig: Record<LetterStatus, { label: string; icon: typeof Send; className: string }> = {
  draft: { label: 'Draft saved', icon: FileEdit, className: 'text-on-surface-variant' },
  sealed: { label: 'Sealed, ready', icon: Clock, className: 'text-amber-accent' },
  dispatched: { label: 'Dispatched', icon: Send, className: 'text-on-surface-variant' },
  delivered: { label: 'Delivered', icon: CheckCircle2, className: 'text-green-700' },
};

export function LetterCard({ letter }: { letter: MockLetter }) {
  const config = statusConfig[letter.status];
  const Icon = config.icon;
  const href = letter.direction === 'received'
    ? `/letter/${letter.id}`
    : letter.status === 'draft'
      ? '/compose'
      : `/journey?letter=${letter.id}`;

  return (
    <Link
      href={href}
      className="flex items-center justify-between py-md border-b border-outline-variant hover:pl-md transition-all duration-300 cursor-pointer group"
    >
      <div className="flex items-center gap-md">
        <Icon className={cn('h-5 w-5 text-outline-variant group-hover:text-primary transition-colors', config.className)} />
        <div>
          <h4 className="font-label-md text-label-md text-primary">
            {letter.direction === 'received' ? `From: ${letter.sender || 'A correspondent'}` : `To: ${letter.recipient}`}
          </h4>
          <p className="font-caption text-caption text-on-surface-variant">
            {letter.subject} — {config.label}
          </p>
        </div>
      </div>
      <span className="font-caption text-caption text-on-surface-variant whitespace-nowrap">
        {letter.date}
      </span>
    </Link>
  );
}
