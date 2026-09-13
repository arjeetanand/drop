'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Mail, MapPin, PenLine, Route, ShieldCheck } from 'lucide-react';
import { RelayChain } from '@/components/RelayChain';
import { RouteMap } from '@/components/RouteMap';
import { LetterCard } from '@/components/LetterCard';
import { currentFocusDraft, mockLetters } from '@/data/mockData';
import { getRemoteLetters, getRemoteProfile } from '@/lib/letterBackend';
import { getLetterDraft, getLettersWithDraft, type LetterDraftState } from '@/lib/letterStore';
import { getInitialRelayState, getRelayState, getRelayStats, type RelayState } from '@/lib/relayStore';
import { defaultUserProfile, getUserProfile, type UserProfile } from '@/lib/userStore';

export default function HomeDesk() {
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [letters, setLetters] = useState(mockLetters);
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);

  useEffect(() => {
    let active = true;
    const loadDesk = async () => {
      const localDraft = getLetterDraft();
      const [remoteLetters, remoteProfile] = await Promise.all([getRemoteLetters(), getRemoteProfile()]);
      if (!active) return;
      setDraft(localDraft);
      const localLetters = getLettersWithDraft(localDraft);
      if (!remoteLetters?.length) {
        setLetters(localLetters);
      } else {
        const merged = new Map(localLetters.map((letter) => [letter.id, letter]));
        remoteLetters.forEach((letter) => merged.set(letter.id, letter));
        setLetters(Array.from(merged.values()));
      }
      setProfile(remoteProfile || getUserProfile());
      setRelay(getRelayState(localDraft.id, {
        subject: localDraft.subject || currentFocusDraft.subject,
        recipient: localDraft.address.name || localDraft.recipient || 'Eleanor',
      }));
    };
    void loadDesk();
    return () => {
      active = false;
    };
  }, []);

  const focusDraft = draft ?? {
    ...currentFocusDraft,
    content: currentFocusDraft.excerpt,
    status: 'draft' as const,
    updatedAt: new Date().toISOString(),
    fontSize: 18,
    alignment: 'left' as const,
    address: { name: 'Eleanor Hartwell', street: '', city: 'Cotswolds Village', postcode: '', country: 'United Kingdom' },
    sealId: 'fern',
  };
  const incoming = letters.find((letter) => letter.direction === 'received') || mockLetters.find((letter) => letter.direction === 'received');
  const recentLetters = letters.filter((letter) => letter.id !== focusDraft.id && letter.id !== incoming?.id).slice(0, 4);
  const stats = getRelayStats(relay);
  const wordCount = focusDraft.content.trim() ? focusDraft.content.trim().split(/\s+/).length : 0;
  const hasDraft = focusDraft.status === 'draft';

  const deskStats = useMemo(() => [
    { value: letters.length, label: 'Letters in your desk' },
    { value: stats.carriers, label: 'People in this relay' },
    { value: `${stats.hours}h`, label: 'Time carried so far' },
  ], [letters.length, stats.carriers, stats.hours]);

  return (
    <main className="page-shell page-enter">
      <div className="page-container">
        <header className="page-header flex-col md:flex-row md:items-end">
          <div className="max-w-3xl">
            <p className="eyebrow">Your writing desk</p>
            <h1 className="display-title mt-4 max-w-3xl">A quieter way to send something real.</h1>
            <p className="body-copy mt-5 max-w-2xl text-lg">
              Write a private letter, seal it, and let thoughtful people carry it forward. The words stay yours; the journey becomes part of the story.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3 pt-2">
            <Link href={hasDraft ? '/compose' : '/compose?new=1'} className="button-primary">
              <PenLine className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" />
              {hasDraft ? 'Continue writing' : 'Write a letter'}
            </Link>
            <Link href="/mailbox" className="button-secondary">
              Open mailbox
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </header>

        <section className="mt-12 grid gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="paper-card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-5 border-b border-[rgba(16,42,67,0.13)] px-5 py-5 sm:px-8">
                <div>
                  <p className="eyebrow">Active letter</p>
                  <h2 className="mt-2 font-headline-md text-3xl tracking-[-0.03em] text-ink-navy">{focusDraft.subject || 'Untitled letter'}</h2>
                </div>
                <span className={`status-mark ${hasDraft ? 'pending' : 'success'}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  {hasDraft ? 'Draft on desk' : focusDraft.status === 'dispatched' ? 'In relay' : 'Ready to move'}
                </span>
              </div>
              <div className="grid gap-8 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div>
                  <div className="flex flex-wrap gap-x-8 gap-y-2 meta">
                    <span>To {focusDraft.address.name || focusDraft.recipient || 'someone special'}</span>
                    <span>{wordCount} words</span>
                    <span>{hasDraft ? 'Private draft' : '0 words exposed'}</span>
                  </div>
                  <p className="mt-8 max-w-2xl font-literata text-xl leading-[1.75] text-ink-navy sm:text-2xl">
                    “{focusDraft.content || 'Your next letter is waiting for its first sentence.'}”
                  </p>
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Link href={hasDraft ? '/compose' : `/journey?letter=${encodeURIComponent(focusDraft.id)}`} className="button-primary">
                      {hasDraft ? 'Continue the letter' : 'Follow its journey'}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <Link href={`/journey?letter=${encodeURIComponent(focusDraft.id)}`} className="button-quiet">
                      <Route className="h-4 w-4" aria-hidden="true" /> Journey
                    </Link>
                  </div>
                </div>
                <aside className="border-t border-[rgba(16,42,67,0.12)] pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <p className="eyebrow">Why it matters</p>
                  <p className="mt-3 font-literata text-base leading-relaxed text-on-surface-variant">
                    Carriers see only the destination. Your words remain sealed until they reach the person you named.
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-[#276a4d]">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    No words exposed in transit
                  </div>
                </aside>
              </div>
            </div>

            <div className="mt-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">A living route</p>
                  <h2 className="section-title mt-2">People make the distance.</h2>
                </div>
                <Link href={`/journey?letter=${encodeURIComponent(relay.letterId)}`} className="button-quiet">
                  Open full journey <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              <div className="mt-5 panel p-5 sm:p-7">
                <RouteMap
                  waypoints={relay.gpsWaypoints ?? []}
                  destinationNeighborhood={relay.destinationNeighborhood || 'Colaba'}
                  currentCarrierName={relay.currentCarrierName}
                />
                <div className="mt-7 border-t border-[rgba(16,42,67,0.1)] pt-5">
                  <RelayChain relay={relay} compact />
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="panel p-5">
              <p className="eyebrow">At a glance</p>
              <div className="mt-5 space-y-4">
                {deskStats.map((stat) => (
                  <div key={stat.label} className="flex items-baseline justify-between gap-3 border-b border-[rgba(16,42,67,0.1)] pb-4 last:border-0 last:pb-0">
                    <span className="font-headline-md text-2xl text-ink-navy">{stat.value}</span>
                    <span className="max-w-[135px] text-right text-xs leading-relaxed text-on-surface-variant">{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {incoming && (
              <div className="panel-muted p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow text-[#276a4d]">A note arrived</p>
                    <h2 className="mt-2 font-headline-md text-2xl text-ink-navy">{incoming.subject}</h2>
                  </div>
                  <Mail className="h-5 w-5 text-[#4f9d7a]" aria-hidden="true" />
                </div>
                <p className="mt-3 font-body-md text-sm leading-relaxed text-on-surface-variant">
                  From {incoming.sender || 'a correspondent'}. Open it when you are ready to receive the words.
                </p>
                <Link href={`/letter/${encodeURIComponent(incoming.id)}`} className="button-secondary mt-5 w-full">
                  Open the letter <ArrowUpRightIcon />
                </Link>
              </div>
            )}

            <div className="border-t border-[rgba(16,42,67,0.12)] pt-5">
              <p className="eyebrow">Your public postbox</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-ink-navy">@{profile.username}</p>
              <Link href="/profile" className="mt-3 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.08em] text-ink-navy hover:text-[#276a4d]">
                Edit profile <ArrowUpRightIcon />
              </Link>
            </div>
          </aside>
        </section>

        <section className="mt-20 grid gap-10 border-t border-[rgba(16,42,67,0.13)] pt-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div>
            <p className="eyebrow">The idea</p>
            <h2 className="section-title mt-2 max-w-md">The slower route is the point.</h2>
            <p className="body-copy mt-4 max-w-md">
              A message becomes memorable when it asks something of the world. Dear.exe keeps the private part private and lets the path collect the meaning.
            </p>
          </div>
          <div className="grid gap-x-8 gap-y-8 sm:grid-cols-3">
            {[
              { number: '01', title: 'Write', text: 'Take your time on a private, autosaved letter.' },
              { number: '02', title: 'Seal', text: 'Choose a signet and lock the message before it travels.' },
              { number: '03', title: 'Relay', text: 'Share the passport and let people carry it closer.' },
            ].map((step) => (
              <div key={step.number}>
                <span className="meta text-[#b88938]">{step.number}</span>
                <h3 className="mt-3 font-headline-md text-2xl text-ink-navy">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 border-t border-[rgba(16,42,67,0.13)] pt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Your desk</p>
              <h2 className="section-title mt-2">Recent letters.</h2>
            </div>
            <Link href="/mailbox" className="button-quiet">See the mailbox <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          <div className="mt-4">
            {recentLetters.length ? recentLetters.map((letter) => <LetterCard key={letter.id} letter={letter} showExcerpt />) : (
              <div className="panel-muted mt-4 p-8 text-center">
                <p className="font-headline-md text-xl text-ink-navy">Your next story starts here.</p>
                <p className="mt-2 text-sm text-on-surface-variant">Write a letter and give it a route through the world.</p>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(16,42,67,0.13)] pt-5">
          <p className="meta">Dear.exe · human relay</p>
          <span className="inline-flex items-center gap-2 text-xs text-on-surface-variant"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Private by design</span>
        </footer>
      </div>
    </main>
  );
}

function ArrowUpRightIcon() {
  return <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />;
}
