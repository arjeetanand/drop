'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail, PenLine, Search, X } from 'lucide-react';
import { LiveDropCue, LiveDropStatus } from '@/components/LiveDropCue';
import { LiveReactionCue } from '@/components/LiveReactionCue';
import { LetterCard } from '@/components/LetterCard';
import { RelayRecipientCard } from '@/components/RelayRecipientCard';
import { useLiveInbox } from '@/lib/useLiveInbox';
import { filterMailboxLetters, getMailboxCounts, getMailboxEmptyState, type MailboxFilter } from '@/lib/mailboxView';
import { cn } from '@/lib/utils';

export default function Mailbox() {
  const { letters, arrival, arrivalCount, dismissArrival, reaction, reactionCount, dismissReaction, refreshInbox } = useLiveInbox();
  const [activeTab, setActiveTab] = useState<MailboxFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const clearSearch = () => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const counts = useMemo(() => getMailboxCounts(letters), [letters]);

  const tabs: Array<{ id: MailboxFilter; label: string; count: number }> = [
    { id: 'all', label: 'All drops', count: counts.total },
    { id: 'transit', label: 'On a journey', count: counts.transit },
    { id: 'received', label: 'Received', count: counts.received },
    { id: 'sent', label: 'Sent', count: counts.sent },
    { id: 'drafts', label: 'Drafts', count: counts.drafts },
    { id: 'samples', label: 'Samples', count: counts.samples },
  ];

  const filteredLetters = useMemo(() => filterMailboxLetters(letters, activeTab, searchQuery), [activeTab, letters, searchQuery]);
  const emptyState = getMailboxEmptyState(activeTab, searchQuery);

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[1080px]">
        <header className="page-header flex-col gap-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">Your inbox & archive</p>
            <h1 className="display-title mt-4 max-w-3xl">A mailbox for your people.</h1>
            <p className="body-copy mt-4 max-w-2xl text-base">Photos, notes, GIFs, and the occasional long way around.</p>
          </div>
          <Link href="/compose?new=1" className="button-primary shrink-0 !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">
            <PenLine className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" />
            Make a drop
          </Link>
        </header>

        <LiveDropStatus letter={arrival} count={arrivalCount} />
        {arrival && <div className="mt-5"><LiveDropCue letter={arrival} count={arrivalCount} onDismiss={dismissArrival} /></div>}
        <LiveReactionCue letter={reaction} count={reactionCount} onDismiss={dismissReaction} />

        <section className="grid grid-cols-2 gap-0 border-b border-[rgba(16,42,67,0.13)] py-7 sm:grid-cols-4">
          {[
            { label: 'Total drops', value: counts.total },
            { label: 'On a journey', value: counts.transit },
            { label: 'Received', value: counts.received },
            { label: 'Sent', value: counts.sent },
          ].map((stat, index) => (
            <div key={stat.label} className={cn('py-1', index > 0 && 'border-l border-[rgba(16,42,67,0.12)] pl-4 sm:pl-6')}>
              <p className="font-headline-md text-3xl text-ink-navy">{stat.value}</p>
              <p className="mt-1 text-xs text-on-surface-variant">{stat.label}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 flex flex-col gap-4 border-b border-[rgba(16,42,67,0.13)] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0">
            <div className="flex gap-1 overflow-x-auto pb-1 pr-7" role="group" aria-label="Filter drops">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7]',
                    activeTab === tab.id ? 'bg-ink-navy text-white' : 'text-on-surface-variant hover:bg-white/55 hover:text-ink-navy'
                  )}
                >
                  {tab.label} <span className="ml-1 font-mono text-[0.68rem] opacity-70">{tab.count}</span>
                </button>
              ))}
            </div>
            <span className="pointer-events-none absolute right-0 top-0 h-11 w-7 bg-gradient-to-l from-[#f7f4ee] to-transparent lg:hidden" aria-hidden="true" />
          </div>
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
            <label htmlFor="mailbox-search" className="sr-only">Search drops</label>
            <input
              id="mailbox-search"
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Find a drop"
              className="input-field appearance-none pl-10 pr-10"
            />
            {searchQuery && (
              <button type="button" onClick={clearSearch} aria-label="Clear search" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-on-surface-variant hover:text-ink-navy">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </section>

        <section className="mt-2">
          {filteredLetters.length ? filteredLetters.map((letter) => (
            letter.direction === 'received'
              && letter.status === 'dispatched'
              && !letter.sample
              && !letter.localDemo
              ? <RelayRecipientCard key={letter.id} letter={letter} onRefresh={refreshInbox} />
              : <LetterCard key={letter.id} letter={letter} showExcerpt />
          )) : (
            <div className="panel-muted my-10 rounded-2xl p-8 text-center sm:p-10">
              <Mail className="mx-auto h-7 w-7 text-on-surface-variant" aria-hidden="true" />
              <h2
                className="mt-4 font-headline-md text-2xl text-ink-navy"
                aria-live={emptyState.kind === 'search' ? 'polite' : undefined}
                aria-atomic={emptyState.kind === 'search' ? 'true' : undefined}
              >
                {emptyState.title}
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-on-surface-variant">
                {emptyState.description}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {emptyState.kind === 'search' ? (
                  <button type="button" onClick={clearSearch} className="button-secondary">Clear search</button>
                ) : (
                  <Link href={emptyState.actionHref} className="button-primary !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">
                    {emptyState.actionLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="mt-14 grid gap-4 border-t border-[rgba(16,42,67,0.13)] pt-7 md:grid-cols-[auto_minmax(0,1fr)] md:items-start md:gap-8">
          <p className="eyebrow text-[#b88938]">Want the scenic route?</p>
          <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            Pick a journey when you want a drop to move hand to hand. Carriers can follow the route without opening the private part.
          </p>
        </aside>
      </div>
    </main>
  );
}
