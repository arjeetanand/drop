'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Clock3, Feather, HeartHandshake, LockKeyhole, Mail, MapPin, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { RelayChain } from '@/components/RelayChain';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { LetterCard } from '@/components/LetterCard';
import { currentFocusDraft, mockLetters } from '@/data/mockData';
import { getLetterDraft, getLettersWithDraft, type LetterDraftState } from '@/lib/letterStore';
import { getRemoteLetters, getRemoteProfile } from '@/lib/letterBackend';
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
      setLetters(remoteLetters?.length ? remoteLetters : getLettersWithDraft(localDraft));
      setProfile(remoteProfile || getUserProfile());
      setRelay(getRelayState(currentFocusDraft.id, {
        subject: currentFocusDraft.subject,
        recipient: 'Eleanor',
      }));
    };
    void loadDesk();
    return () => { active = false; };
  }, []);

  const focusDraft = draft ?? { ...currentFocusDraft, content: currentFocusDraft.excerpt, status: 'draft' as const };
  const focusRecipient = focusDraft.recipient || 'someone special';
  const incoming = letters.find((letter) => letter.direction === 'received') || mockLetters.find((letter) => letter.direction === 'received');
  const recentLetters = letters.filter((letter) => letter.id !== focusDraft.id && letter.id !== incoming?.id).slice(0, 4);
  const relayStats = getRelayStats(relay);

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-12">
      <div className="mx-auto max-w-[1180px] px-margin-mobile py-lg md:px-12 md:py-xl xl:px-16">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-outline-variant/70 pb-md">
          <div className="flex items-center gap-sm">
            <span className="font-headline-md text-sm text-ink-navy">Dear.exe</span>
            <span className="font-caption text-caption text-on-surface-variant">/ Your Desk</span>
          </div>
          <div className="flex items-center gap-md">
            <span className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant">
              <span className="h-2 w-2 rounded-full bg-mint-accent" />
              {relayStats.carriers} carriers in motion
            </span>
          </div>
        </header>

        {/* Hero: Welcome & Core Action */}
        <section className="grid min-w-0 items-center gap-10 border-b border-outline-variant/70 py-12 md:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] md:py-16">
          <div className="min-w-0 max-w-[580px]">
            <p className="font-caption text-caption uppercase tracking-[0.22em] text-amber-accent">Slow Postal Network</p>
            <h1 className="mt-3 font-headline-lg text-[clamp(2.75rem,5.5vw,5rem)] leading-[0.98] tracking-[-0.04em] text-ink-navy">
              Letters that travel through human hands.
            </h1>
            <p className="mt-6 max-w-[500px] font-body-lg text-body-lg leading-relaxed text-on-surface-variant">
              Write something thoughtful. Seal it with wax. Send it on a journey carried by real people from city to city. Carriers see the route, never your words.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-md">
              <Link
                href="/compose?new=1"
                className="inline-flex items-center gap-sm bg-ink-navy px-xl py-md font-label-md text-label-md uppercase tracking-[0.12em] text-surface-bright transition-transform hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Feather className="h-4 w-4" />
                Write a Letter
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-sm border border-outline px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-ink-navy transition-colors hover:bg-ink-navy/5"
              >
                How It Works
                <ArrowDown className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-6 flex items-center gap-lg font-caption text-caption text-on-surface-variant">
              <span className="inline-flex items-center gap-xs">
                <LockKeyhole className="h-3.5 w-3.5 text-mint-accent" /> Sealed until arrival
              </span>
              <span className="inline-flex items-center gap-xs">
                <UsersRound className="h-3.5 w-3.5 text-amber-accent" /> Human-powered relay
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center border-l border-outline-variant/70 pl-0 md:pl-10">
            <RelayEnvelope />
            <p className="mt-4 font-caption text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
              Sealed with wax · Private in transit
            </p>
          </div>
        </section>

        {/* How It Works: 3-Step Clear Explainer */}
        <section id="how-it-works" className="border-b border-outline-variant/70 py-12 md:py-16">
          <div className="text-center max-w-xl mx-auto">
            <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">The Philosophy</p>
            <h2 className="mt-2 font-headline-md text-headline-md text-ink-navy">How Dear.exe Works</h2>
            <p className="mt-3 font-body-md text-body-md text-on-surface-variant">
              In a world of instant messages, we make words travel slower so they carry more meaning.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {/* Step 1 */}
            <div className="paper-layer p-lg card-depth rounded-sm border border-outline-variant/50 flex flex-col justify-between">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-navy text-surface-bright mb-md">
                  <Feather className="h-5 w-5" />
                </div>
                <p className="font-caption text-caption uppercase tracking-wider text-amber-accent">Step 1</p>
                <h3 className="mt-1 font-headline-md text-[20px] text-ink-navy">Pen Your Letter</h3>
                <p className="mt-3 font-body-md text-body-md leading-relaxed text-on-surface-variant">
                  A tranquil typewriter canvas on warm parchment. Autosaved to your desk so you can write at your own pace.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-outline-variant/40 font-caption text-caption text-on-surface-variant">
                Private drafting
              </div>
            </div>

            {/* Step 2 */}
            <div className="paper-layer p-lg card-depth rounded-sm border border-outline-variant/50 flex flex-col justify-between">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wax-red text-surface-bright mb-md">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <p className="font-caption text-caption uppercase tracking-wider text-wax-red">Step 2</p>
                <h3 className="mt-1 font-headline-md text-[20px] text-ink-navy">Seal with Wax</h3>
                <p className="mt-3 font-body-md text-body-md leading-relaxed text-on-surface-variant">
                  Choose a custom wax seal and press it. Once stamped, the contents are permanently locked and hidden.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-outline-variant/40 font-caption text-caption text-on-surface-variant">
                Zero words exposed
              </div>
            </div>

            {/* Step 3 */}
            <div className="paper-layer p-lg card-depth rounded-sm border border-outline-variant/50 flex flex-col justify-between">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#102a43] text-mint-accent mb-md">
                  <HeartHandshake className="h-5 w-5" />
                </div>
                <p className="font-caption text-caption uppercase tracking-wider text-mint-accent">Step 3</p>
                <h3 className="mt-1 font-headline-md text-[20px] text-ink-navy">The Human Relay</h3>
                <p className="mt-3 font-body-md text-body-md leading-relaxed text-on-surface-variant">
                  Share the passport with friends or couriers. Each carrier logs their stop without opening the letter, building a living route.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-outline-variant/40 font-caption text-caption text-on-surface-variant">
                A route remembered
              </div>
            </div>
          </div>
        </section>

        {/* Featured Active Journey */}
        <section className="border-b border-outline-variant/70 py-12 md:py-16">
          <div className="flex flex-wrap items-end justify-between gap-md border-b border-outline-variant/70 pb-md">
            <div>
              <p className="font-caption text-caption uppercase tracking-[0.2em] text-mint-accent">
                <span className="h-2 w-2 rounded-full bg-mint-accent inline-block mr-2" />
                Active on the Road
              </p>
              <h2 className="mt-2 font-headline-md text-headline-md text-ink-navy">
                Track a Letter in Motion
              </h2>
            </div>
            <Link
              href={`/journey?letter=${encodeURIComponent(relay.letterId)}`}
              className="inline-flex items-center gap-sm font-label-md text-label-md uppercase tracking-[0.12em] text-ink-navy hover:underline"
            >
              Open Full Journey Tracker <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
            <div className="paper-layer p-lg md:p-xl card-depth rounded-sm border border-outline-variant/50">
              <div className="flex items-start justify-between gap-md">
                <div>
                  <h3 className="font-headline-lg text-headline-lg text-ink-navy">{relay.subject}</h3>
                  <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
                    Heading to {relay.recipient} · Sealed from view
                  </p>
                </div>
                <span className="font-caption text-caption uppercase tracking-wider text-amber-accent bg-amber-accent/10 px-sm py-xs rounded-full">
                  {relayStats.hours}h travelling
                </span>
              </div>

              <div className="mt-8 border-y border-outline-variant/60 py-6">
                <RelayChain relay={relay} />
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-md">
                <div className="flex gap-lg font-caption text-caption text-on-surface-variant">
                  <span><strong className="font-headline-md text-base text-ink-navy">{relayStats.carriers}</strong> people carried it</span>
                  <span><strong className="font-headline-md text-base text-ink-navy">{relayStats.cities}</strong> cities visited</span>
                </div>
                <Link
                  href={`/journey?letter=${encodeURIComponent(relay.letterId)}`}
                  className="inline-flex items-center gap-sm bg-ink-navy px-md py-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-surface-bright hover:bg-ink-navy/90"
                >
                  View Route Logbook <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <aside className="flex flex-col justify-between border border-outline-variant/70 bg-[#f8f5ee] p-lg rounded-sm">
              <div>
                <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">Relay Passport</p>
                <p className="mt-2 font-mono text-sm tracking-[0.14em] text-ink-navy break-all">{relay.passcode}</p>
                <div className="mt-5 flex h-20 w-20 items-center justify-center border border-ink-navy/40 bg-surface-container-lowest p-2">
                  <div className="qr-grid" aria-hidden="true" />
                </div>
                <p className="mt-4 font-body-md text-sm leading-relaxed text-on-surface-variant">
                  Have this envelope in hand? You can record your city and pass it forward without opening it.
                </p>
              </div>
              <Link
                href={`/journey?letter=${encodeURIComponent(relay.letterId)}&join=1`}
                className="mt-6 inline-flex items-center justify-center gap-sm border border-ink-navy bg-white py-sm px-md font-label-md text-[11px] uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy hover:text-surface-bright transition-colors"
              >
                I Carried This Letter <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </aside>
          </div>
        </section>

        {/* Your Correspondence Overview */}
        <section className="mt-12 grid gap-10 md:mt-16 md:grid-cols-[minmax(0,1fr)_320px]">
          {/* Recent Letters & Drafts */}
          <div>
            <div className="flex items-end justify-between gap-md border-b border-outline-variant/70 pb-md">
              <div>
                <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">Your Desk</p>
                <h2 className="mt-1 font-headline-md text-headline-md text-ink-navy">Recent Letters</h2>
              </div>
              <Link href="/mailbox" className="font-caption text-caption text-on-surface-variant hover:text-ink-navy">
                Open All in Mailbox →
              </Link>
            </div>

            {/* In-progress Draft if any */}
            {focusDraft && (
              <div className="border-b border-outline-variant/70 py-6">
                <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-caption text-[10px] uppercase tracking-wider text-amber-accent bg-amber-accent/15 px-2 py-0.5 rounded">
                      Unfinished Draft
                    </span>
                    <h3 className="mt-2 font-headline-md text-xl text-ink-navy">
                      {focusDraft.subject || 'Untitled Letter'}
                    </h3>
                    <p className="mt-1 font-body-md text-sm text-on-surface-variant">
                      To {focusRecipient} · {focusDraft.content.trim() ? `${focusDraft.content.trim().split(/\s+/).length} words written` : 'Empty draft'}
                    </p>
                  </div>
                  <Link
                    href="/compose"
                    className="inline-flex shrink-0 items-center gap-sm border border-ink-navy px-md py-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy/5"
                  >
                    Continue Writing <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}

            {/* List of recent letters */}
            <div className="divide-y divide-outline-variant/50">
              {recentLetters.map((letter) => (
                <LetterCard key={letter.id} letter={letter} />
              ))}
              {!recentLetters.length && (
                <p className="py-8 font-body-md text-body-md text-on-surface-variant">
                  No other letters yet. Start writing your first one!
                </p>
              )}
            </div>
          </div>

          {/* Incoming Letter / Arrival Highlight */}
          <aside className="border-l border-outline-variant/70 pl-0 md:pl-8">
            <div className="paper-layer p-lg card-depth rounded-sm border border-outline-variant/60">
              <div className="flex items-center gap-sm font-caption text-caption uppercase tracking-[0.16em] text-mint-accent">
                <ShieldCheck className="h-4 w-4" /> Letter Arrival
              </div>
              <h3 className="mt-3 font-headline-md text-headline-md text-ink-navy">
                {incoming ? 'A note arrived for you.' : 'Your Mailbox is Quiet.'}
              </h3>
              <p className="mt-2 font-body-md text-body-md leading-relaxed text-on-surface-variant">
                {incoming
                  ? `From ${incoming.sender || 'a correspondent'}. The envelope traveled across cities and is sealed with wax.`
                  : 'When someone sends a letter to your username, it will appear here.'}
              </p>

              {incoming && (
                <Link
                  href={`/letter/${incoming.id}`}
                  className="mt-6 inline-flex w-full items-center justify-center gap-sm bg-mint-accent px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-ink-navy hover:bg-mint-accent/80 transition-colors"
                >
                  <Sparkles className="h-4 w-4" />
                  Open & Break Seal
                </Link>
              )}
            </div>

            <div className="mt-8 space-y-4 border-t border-outline-variant/70 pt-6">
              <p className="font-caption text-caption uppercase tracking-wider text-on-surface-variant">Your Postal Link</p>
              <p className="font-body-md text-sm text-ink-navy break-all">
                Share <strong>@{profile.username}</strong> with friends so they can write to you.
              </p>
              <Link
                href="/profile"
                className="inline-flex items-center gap-sm font-caption text-caption text-ink-navy hover:underline"
              >
                Edit your profile & share link →
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
