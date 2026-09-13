'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail, PenLine, Search, UsersRound, X } from 'lucide-react';
import { mockLetters, type MockLetter } from '@/data/mockData';
import { LetterCard } from '@/components/LetterCard';
import { getLetterDraft, getLettersWithDraft } from '@/lib/letterStore';
import { getRemoteLetters } from '@/lib/letterBackend';
import { cn } from '@/lib/utils';

type FilterTab = 'all' | 'transit' | 'received' | 'delivered' | 'drafts';

export default function Mailbox() {
  const [letters, setLetters] = useState<MockLetter[]>(mockLetters);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let active = true;
    const loadLetters = async () => {
      const draft = getLetterDraft();
      const remoteLetters = await getRemoteLetters();
      if (!active) return;
      setLetters(remoteLetters?.length ? remoteLetters : getLettersWithDraft(draft));
    };
    void loadLetters();
    return () => { active = false; };
  }, []);

  const transitCount = useMemo(() => letters.filter((l) => l.status === 'dispatched').length, [letters]);
  const receivedCount = useMemo(() => letters.filter((l) => l.direction === 'received').length, [letters]);
  const deliveredCount = useMemo(
    () => letters.filter((l) => l.direction !== 'received' && l.status === 'delivered').length,
    [letters]
  );
  const draftsCount = useMemo(
    () => letters.filter((l) => l.status === 'draft' || l.status === 'sealed').length,
    [letters]
  );

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all', label: 'All Letters', count: letters.length },
    { id: 'transit', label: 'In Transit', count: transitCount },
    { id: 'received', label: 'Received', count: receivedCount },
    { id: 'delivered', label: 'Delivered', count: deliveredCount },
    { id: 'drafts', label: 'Drafts', count: draftsCount },
  ];

  const filteredLetters = useMemo(() => {
    return letters.filter((letter) => {
      if (activeTab === 'transit' && letter.status !== 'dispatched') return false;
      if (activeTab === 'received' && letter.direction !== 'received') return false;
      if (activeTab === 'delivered' && (letter.direction === 'received' || letter.status !== 'delivered')) return false;
      if (activeTab === 'drafts' && letter.status !== 'draft' && letter.status !== 'sealed') return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        letter.subject.toLowerCase().includes(q) ||
        letter.recipient.toLowerCase().includes(q) ||
        (letter.sender && letter.sender.toLowerCase().includes(q)) ||
        (letter.excerpt && letter.excerpt.toLowerCase().includes(q))
      );
    });
  }, [letters, activeTab, searchQuery]);

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[1180px] px-margin-mobile py-lg md:px-12 md:py-xl xl:px-16">
        {/* Header */}
        <header className="border-b border-outline-variant/70 pb-8">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="font-caption text-caption uppercase tracking-[0.22em] text-amber-accent">Mailbox & Archive</p>
              <h1 className="mt-3 font-headline-lg text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.98] tracking-[-0.04em] text-ink-navy">
                Every letter holds a journey.
              </h1>
              <p className="mt-4 max-w-2xl font-body-lg text-body-lg leading-relaxed text-on-surface-variant">
                Browse your drafts waiting for words, letters in active human relay across the country, and envelopes delivered to your doorstep.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/compose"
                className="inline-flex items-center gap-sm bg-ink-navy px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-surface-bright transition-transform hover:-translate-y-0.5 hover:shadow-lg"
              >
                <PenLine className="h-4 w-4 text-amber-accent" /> Write a Letter
              </Link>
              <Link
                href="/journey"
                className="inline-flex items-center gap-sm border border-ink-navy px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy/5"
              >
                <UsersRound className="h-4 w-4" /> Live Relay
              </Link>
            </div>
          </div>
        </header>

        {/* Quick Postal Overview */}
        <section className="grid grid-cols-2 gap-4 border-b border-outline-variant/70 py-6 md:grid-cols-4">
          <div className="border border-outline-variant/50 bg-surface-container-lowest p-4">
            <p className="font-caption text-caption uppercase tracking-[0.14em] text-on-surface-variant">Total Letters</p>
            <p className="mt-1 font-headline-lg text-2xl text-ink-navy">{letters.length}</p>
          </div>
          <div className="border border-outline-variant/50 bg-surface-container-lowest p-4">
            <p className="font-caption text-caption uppercase tracking-[0.14em] text-mint-accent">In Transit</p>
            <p className="mt-1 font-headline-lg text-2xl text-ink-navy">{transitCount}</p>
          </div>
          <div className="border border-outline-variant/50 bg-surface-container-lowest p-4">
            <p className="font-caption text-caption uppercase tracking-[0.14em] text-on-surface-variant">Delivered / Received</p>
            <p className="mt-1 font-headline-lg text-2xl text-ink-navy">{receivedCount + deliveredCount}</p>
          </div>
          <div className="border border-outline-variant/50 bg-surface-container-lowest p-4">
            <p className="font-caption text-caption uppercase tracking-[0.14em] text-amber-accent">Drafts on Desk</p>
            <p className="mt-1 font-headline-lg text-2xl text-ink-navy">{draftsCount}</p>
          </div>
        </section>

        {/* Filters & Search */}
        <section className="mt-8 flex flex-col gap-4 border-b border-outline-variant/70 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 font-label-md text-xs uppercase tracking-[0.12em] transition-colors',
                  activeTab === tab.id
                    ? 'bg-ink-navy text-surface-bright shadow-sm'
                    : 'border border-outline-variant/70 text-on-surface-variant hover:border-ink-navy hover:text-ink-navy'
                )}
              >
                {tab.label}{' '}
                <span className={cn('text-[10px]', activeTab === tab.id ? 'text-surface-bright/80' : 'text-on-surface-variant/70')}>
                  ({tab.count})
                </span>
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by recipient, subject..."
              className="w-full border border-outline-variant/70 bg-surface-container-lowest py-1.5 pl-9 pr-8 font-body-md text-sm text-ink-navy outline-none placeholder:text-on-surface-variant/60 focus:border-ink-navy"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-ink-navy"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </section>

        {/* Letter List */}
        <section className="py-6">
          {filteredLetters.length > 0 ? (
            <div className="flex flex-col">
              {filteredLetters.map((letter) => (
                <LetterCard key={letter.id} letter={letter} showExcerpt={true} />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center">
              <Mail className="mx-auto h-8 w-8 text-outline-variant" />
              <h3 className="mt-3 font-headline-md text-lg text-ink-navy">
                {searchQuery ? 'No letters match your search.' : 'No letters in this section.'}
              </h3>
              <p className="mt-1 font-body-md text-sm text-on-surface-variant">
                {searchQuery ? 'Try another keyword or clear the search field.' : 'Ready to begin your next dispatch?'}
              </p>
              <div className="mt-5 flex justify-center gap-3">
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="border border-outline-variant px-4 py-2 font-label-md text-xs uppercase tracking-wider text-ink-navy hover:bg-ink-navy/5"
                  >
                    Clear search
                  </button>
                )}
                <Link
                  href="/compose"
                  className="inline-flex items-center gap-2 bg-ink-navy px-4 py-2 font-label-md text-xs uppercase tracking-wider text-surface-bright hover:shadow-md"
                >
                  <PenLine className="h-3.5 w-3.5 text-amber-accent" /> Write a Letter
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* Postal Note */}
        <aside className="mt-12 border-t border-outline-variant/70 pt-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <p className="font-caption text-caption uppercase tracking-[0.16em] text-amber-accent">How Relays Move</p>
              <p className="mt-1 max-w-xl font-body-md text-sm text-on-surface-variant">
                Letters in Dear.exe are carried from person to person. When you give a sealed letter to someone, they scan or log their handoff to update its path.
              </p>
            </div>
            <Link
              href="/journey"
              className="inline-flex items-center gap-2 font-label-md text-xs uppercase tracking-[0.14em] text-ink-navy underline decoration-amber-accent decoration-2 underline-offset-4"
            >
              Open Live Journey Tracker <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
