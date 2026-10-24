'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, CheckCircle2, Clock3, Eye, FileEdit, Image as ImageIcon, Mail, PackageCheck, Sparkles, Type } from 'lucide-react';
import type { LetterStatus, MockLetter } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { getClaimedDropLabel } from '@/lib/claimInviteStatus';

const statusConfig: Record<LetterStatus, { label: string; icon: typeof Mail; tone: string }> = {
  draft: { label: 'Draft', icon: FileEdit, tone: 'text-[#8a611b]' },
  sealed: { label: 'Sealed', icon: PackageCheck, tone: 'text-[#8a611b]' },
  dispatched: { label: 'On a journey', icon: Clock3, tone: 'text-[#276a4d]' },
  delivered: { label: 'Delivered', icon: CheckCircle2, tone: 'text-[#276a4d]' },
  claim_pending: { label: 'Waiting for them to claim', icon: Clock3, tone: 'text-[#8a611b]' },
};

export function LetterCard({ letter, showExcerpt = false }: { letter: MockLetter; showExcerpt?: boolean }) {
  const isReceived = letter.direction === 'received';
  const claimedLabel = getClaimedDropLabel(letter);
  const config = letter.sample
    ? { label: 'Sample · not sent', icon: Eye, tone: 'text-[#8a611b]' }
    : letter.localDemo
      ? { label: 'Demo · not sent', icon: Eye, tone: 'text-[#8a611b]' }
      : isReceived
        ? { label: 'Received', icon: Mail, tone: 'text-[#276a4d]' }
        : claimedLabel
          ? { ...statusConfig.delivered, label: claimedLabel }
          : statusConfig[letter.status] || statusConfig.draft;
  const Icon = letter.reaction && !isReceived && !claimedLabel ? Sparkles : config.icon;
  const href = letter.sample
    ? `/letter/${encodeURIComponent(letter.id)}`
    : letter.localDemo
      ? `/letter/${encodeURIComponent(letter.id)}?view=sender`
      : isReceived
        ? `/letter/${encodeURIComponent(letter.id)}`
        : letter.status === 'draft'
          ? `/compose?letter=${encodeURIComponent(letter.id)}`
          : letter.status === 'sealed'
            ? `/compose?letter=${encodeURIComponent(letter.id)}&mode=relay`
            : letter.deliveryMode === 'relay' || letter.status === 'dispatched'
              ? `/journey?letter=${encodeURIComponent(letter.id)}`
              : `/letter/${encodeURIComponent(letter.id)}`;
  const action = letter.sample
    ? 'Open sample'
    : letter.localDemo
      ? 'View sender copy'
      : isReceived
        ? 'Open drop'
        : letter.status === 'draft'
          ? letter.recipientInviteProgress
            ? letter.recipientInviteProgress.status === 'shared' || letter.recipientInviteProgress.status === 'copied' ? 'Check handle' : 'Resume invite'
            : 'Keep making it'
          : letter.status === 'claim_pending'
          ? 'View sent note'
          : letter.status === 'sealed'
            ? 'Send it'
            : letter.deliveryMode === 'relay' || letter.status === 'dispatched'
              ? 'View journey'
              : 'Open sent drop';
  const kind = letter.payloadKind || 'text';
  const KindIcon = kind === 'text' ? Type : ImageIcon;

  return (
    <Link
      href={href}
      className="group grid gap-4 border-t border-[rgba(16,42,67,0.12)] py-5 transition-colors hover:bg-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="relative mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[rgba(16,42,67,0.12)] bg-[#f2eee5] text-ink-navy">
          {letter.mediaUrl ? <Image src={letter.mediaUrl} alt="" fill sizes="48px" className="object-cover" /> : <KindIcon className={cn('h-4 w-4', config.tone)} aria-hidden="true" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-headline-md text-xl leading-tight text-ink-navy group-hover:underline group-hover:decoration-[#b88938] group-hover:underline-offset-4">
              {letter.subject}
            </span>
            <span className="meta">{isReceived ? `From ${letter.sender || 'a correspondent'}` : `To ${letter.recipient}`}</span>
          </span>
          <span className="mt-1 inline-flex flex-wrap gap-1.5">
            <span className="rounded-full bg-[#f2eee5] px-2 py-0.5 font-mono text-[0.58rem] font-bold uppercase tracking-[0.1em] text-on-surface-variant">{kind === 'text' ? 'Note' : kind === 'gif' ? 'GIF' : 'Photo'}</span>
            {letter.sample && <span className="rounded-full bg-[#fff4dc] px-2 py-0.5 font-mono text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#76520d]">Sample</span>}
            {letter.localDemo && <span className="rounded-full bg-[#fff4dc] px-2 py-0.5 font-mono text-[0.58rem] font-bold uppercase tracking-[0.1em] text-[#76520d]">On this device</span>}
          </span>
          {showExcerpt && letter.excerpt && (
            <span className="mt-1 block line-clamp-2 max-w-2xl font-body-md text-sm leading-relaxed text-on-surface-variant">
              “{letter.excerpt}”
            </span>
          )}
          <span className={cn('mt-2 inline-flex items-center gap-1.5 meta font-semibold', config.tone)}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {isReceived && letter.reaction
              ? `Reacted ${letter.reaction}`
              : letter.reaction && !claimedLabel
                ? `They reacted ${letter.reaction}`
                : config.label}
          </span>
          {claimedLabel && letter.reaction && <span className="mt-1 block text-xs font-medium text-on-surface-variant">They reacted {letter.reaction}</span>}
          {letter.status === 'draft' && letter.recipientInviteProgress && <span className="mt-1 block max-w-xl text-xs leading-relaxed text-on-surface-variant">{letter.recipientInviteProgress.status === 'shared'
            ? `Invite shared · check @${letter.recipientInviteProgress.username} when they join.`
            : letter.recipientInviteProgress.status === 'copied'
              ? `Invite link copied · check @${letter.recipientInviteProgress.username} when they join.`
              : letter.recipientInviteProgress.status === 'cancelled'
                ? 'Invite not shared · pick up where you left off.'
                : 'Invite link ready to copy from your draft.'}</span>}
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
