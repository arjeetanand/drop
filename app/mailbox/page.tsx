'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail, PenLine, Search, X } from 'lucide-react';
import { LetterCard } from '@/components/LetterCard';
import { mockLetters, type MockLetter } from '@/data/mockData';
import { getRemoteLetters } from '@/lib/letterBackend';
import { getLetterDraft, getLettersWithDraft } from '@/lib/letterStore';
import { cn } from '@/lib/utils';

type FilterTab = 'all' | 'transit' | 'received' | 'sent' | 'drafts';

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
      const localLetters = getLettersWithDraft(draft);
      if (!remoteLetters?.length) {
        setLetters(localLetters);
        return;
      }
      const merged = new Map(localLetters.map((letter) => [letter.id, letter]));
      remoteLetters.forEach((letter) => merged.set(letter.id, letter));
      setLetters(Array.from(merged.values()));
    };
    void loadLetters();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => ({
    transit: letters.filter((letter) => letter.status === 'dispatched').length,
    received: letters.filter((letter) => letter.direction === 'received').length,
    sent: letters.filter((letter) => letter.direction !== 'received' && letter.status !== 'draft' && letter.status !== 'sealed').length,
    drafts: letters.filter((letter) => letter.status === 'draft' || letter.status === 'sealed').length,
  }), [letters]);

  const tabs: Array<{ id: FilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All drops', count: letters.length },
    { id: 'transit', label: 'On a journey', count: counts.transit },
    { id: 'received', label: 'Received', count: counts.received },
    { id: 'sent', label: 'Sent', count: counts.sent },
    { id: 'drafts', label: 'Drafts', count: counts.drafts },
  ];

  const filteredLetters = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return letters.filter((letter) => {
      if (activeTab === 'transit' && letter.status !== 'dispatched') return false;
      if (activeTab === 'received' && letter.direction !== 'received') return false;
      if (activeTab === 'sent' && (letter.direction === 'received' || letter.status === 'draft' || letter.status === 'sealed')) return false;
      if (activeTab === 'drafts' && letter.status !== 'draft' && letter.status !== 'sealed') return false;
      if (!query) return true;
      return [letter.subject, letter.recipient, letter.sender, letter.excerpt]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [activeTab, letters, searchQuery]);

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

        <section className="grid grid-cols-2 gap-0 border-b border-[rgba(16,42,67,0.13)] py-7 sm:grid-cols-4">
          {[
            { label: 'Total drops', value: letters.length },
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
          <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Filter drops">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
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
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
            <label htmlFor="mailbox-search" className="sr-only">Search drops</label>
            <input
              id="mailbox-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Find a drop"
              className="input-field pl-10 pr-10"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-on-surface-variant hover:text-ink-navy">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </section>

        <section className="mt-2">
          {filteredLetters.length ? filteredLetters.map((letter) => <LetterCard key={letter.id} letter={letter} showExcerpt />) : (
            <div className="panel-muted my-10 rounded-2xl p-8 text-center sm:p-10">
              <Mail className="mx-auto h-7 w-7 text-on-surface-variant" aria-hidden="true" />
              <h2 className="mt-4 font-headline-md text-2xl text-ink-navy">No drops in this little corner yet.</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-on-surface-variant">
                {searchQuery ? 'Try a different search or clear the filter.' : 'Send something small to get this started.'}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {searchQuery && <button type="button" onClick={() => setSearchQuery('')} className="button-secondary">Clear search</button>}
                <Link href="/compose?new=1" className="button-primary !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">Make a drop <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
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
