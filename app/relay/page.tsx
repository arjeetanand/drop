'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Clock3, LockKeyhole, MapPin, Share2, ShieldCheck, UsersRound } from 'lucide-react';
import { RelayChain } from '@/components/RelayChain';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { currentFocusDraft } from '@/data/mockData';
import { addRelayHandoff, getInitialRelayState, getRelayState, getRelayStats, type RelayState } from '@/lib/relayStore';
import { useSearchParams } from 'next/navigation';

function RelayContent() {
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter') || currentFocusDraft.id;
  const joinRequested = searchParams.get('join') === '1';
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [showHandoff, setShowHandoff] = useState(joinRequested);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setRelay(getRelayState(letterId, {
      subject: currentFocusDraft.subject,
      recipient: 'Eleanor',
    }));
    setShowHandoff(joinRequested);
  }, [joinRequested, letterId]);

  const stats = getRelayStats(relay);
  const completedHandoffs = relay.handoffs.filter((handoff) => !handoff.next);
  const shareLink = typeof window === 'undefined'
    ? `/relay?letter=${encodeURIComponent(letterId)}&join=1`
    : `${window.location.origin}/relay?letter=${encodeURIComponent(letterId)}&join=1`;

  const copyRelayLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setNotice('Relay passport copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(shareLink);
    }
  };

  const recordHandoff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !location.trim()) return;
    const next = addRelayHandoff(letterId, { name, location, note }, {
      subject: relay.subject,
      recipient: relay.recipient,
    });
    setRelay(next);
    setName('');
    setLocation('');
    setNote('');
    setShowHandoff(false);
    setNotice(`${name.trim()} is now part of the relay.`);
  };

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[1180px] px-margin-mobile py-lg md:px-12 md:py-xl xl:px-16">
        <header className="flex items-center justify-between border-b border-outline-variant/70 pb-md">
          <Link href="/" className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant transition-colors hover:text-ink-navy"><ArrowLeft className="h-4 w-4" /> Back to desk</Link>
          <span className="font-caption text-caption uppercase tracking-[0.22em] text-on-surface-variant">Relay / {relay.passcode}</span>
        </header>

        <section className="grid min-w-0 items-start gap-10 border-b border-outline-variant/70 py-10 md:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)] md:py-14">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-mint-accent animate-pulse" />
              <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">Human Relay Passport</p>
            </div>
            <h1 className="mt-3 max-w-[650px] font-headline-lg text-[clamp(2.7rem,5.4vw,5.2rem)] leading-[0.98] tracking-[-0.04em] text-ink-navy">
              The story between here and there.
            </h1>
            <p className="mt-6 max-w-[570px] font-body-lg text-body-lg leading-relaxed text-on-surface-variant">
              <strong className="text-ink-navy">{relay.subject}</strong> is traveling toward <strong className="text-ink-navy">{relay.recipient}</strong> through voluntary human hands. The envelope stays wax-sealed. Only the route is shared.
            </p>

            {joinRequested && !showHandoff && (
              <div className="mt-6 border-l-2 border-mint-accent bg-mint-accent/10 p-4">
                <p className="font-body-md text-sm text-ink-navy">
                  You received this passport link to log that you carried this letter. Click below to add your stop.
                </p>
              </div>
            )}

            <div className="mt-9 flex flex-wrap items-center gap-md">
              <button
                type="button"
                onClick={() => setShowHandoff((current) => !current)}
                className="inline-flex items-center gap-sm bg-ink-navy px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-surface-bright transition-transform hover:-translate-y-0.5 hover:shadow-lg"
              >
                <UsersRound className="h-4 w-4 text-mint-accent" />
                {showHandoff ? 'Close handoff form' : 'I carried this letter forward'}
              </button>
              <Link
                href={`/journey?letter=${encodeURIComponent(letterId)}`}
                className="inline-flex items-center gap-sm border border-ink-navy px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy/5"
              >
                Full timeline & notes <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {notice && <p className="mt-4 font-caption text-caption text-mint-accent" aria-live="polite">{notice}</p>}

            {/* Handoff Form right below hero */}
            {showHandoff && (
              <form onSubmit={recordHandoff} className="mt-8 border border-ink-navy/25 bg-surface-container-lowest p-6 md:p-8">
                <div className="flex items-start justify-between gap-md">
                  <div>
                    <p className="font-caption text-caption uppercase tracking-[0.18em] text-amber-accent">Carrier Log</p>
                    <h3 className="mt-1 font-headline-md text-xl text-ink-navy">Record your handoff</h3>
                  </div>
                  <LockKeyhole className="h-5 w-5 text-mint-accent" />
                </div>
                <p className="mt-2 font-body-md text-sm leading-relaxed text-on-surface-variant">
                  You do not need to read the letter. Just record that you held it, where you were, and where you passed it next.
                </p>
                <div className="mt-5 grid gap-md sm:grid-cols-2">
                  <label className="font-caption text-caption uppercase tracking-[0.14em] text-on-surface-variant">
                    Your name
                    <input
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="typewriter-input mt-2 text-base text-ink-navy"
                      placeholder="e.g. Maya"
                    />
                  </label>
                  <label className="font-caption text-caption uppercase tracking-[0.14em] text-on-surface-variant">
                    Your city / stop
                    <input
                      required
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      className="typewriter-input mt-2 text-base text-ink-navy"
                      placeholder="e.g. Chicago, IL"
                    />
                  </label>
                </div>
                <label className="mt-4 block font-caption text-caption uppercase tracking-[0.14em] text-on-surface-variant">
                  A tiny memory or note (optional)
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="mt-2 min-h-[80px] w-full resize-none border border-outline-variant bg-transparent p-md font-body-md text-sm text-ink-navy outline-none focus:border-ink-navy"
                    placeholder="What did the weather or moment feel like?"
                  />
                </label>
                <div className="mt-5 flex flex-wrap items-center gap-md">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-sm bg-mint-accent px-lg py-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-ink-navy hover:bg-mint-accent/80"
                  >
                    Confirm handoff <ArrowRight className="h-4 w-4" />
                  </button>
                  <span className="font-caption text-caption text-on-surface-variant">
                    Contents remain 100% sealed
                  </span>
                </div>
              </form>
            )}
          </div>

          <div className="flex min-w-0 justify-center border-l border-outline-variant/70 pl-0 md:pl-10">
            <RelayEnvelope />
          </div>
        </section>

        <section className="grid min-w-0 gap-10 border-b border-outline-variant/70 py-10 md:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.5fr)] md:py-12">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-md border-b border-outline-variant/70 pb-md">
              <div><p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">Handoff chain</p><h2 className="mt-2 font-headline-md text-headline-md text-ink-navy">Every hand leaves a mark.</h2></div>
              <span className="font-caption text-caption text-on-surface-variant">{completedHandoffs.length} recorded handoffs</span>
            </div>
            <div className="mt-8 border-y border-outline-variant/70 py-7">
              <RelayChain relay={relay} />
            </div>
            <div className="grid grid-cols-3 gap-md pt-7">
              <div><p className="font-headline-md text-headline-md text-ink-navy">{stats.carriers}</p><p className="mt-1 font-caption text-caption text-on-surface-variant">people carried it</p></div>
              <div><p className="font-headline-md text-headline-md text-ink-navy">{stats.cities}</p><p className="mt-1 font-caption text-caption text-on-surface-variant">cities touched</p></div>
              <div><p className="font-headline-md text-headline-md text-ink-navy">{stats.hours}h</p><p className="mt-1 font-caption text-caption text-on-surface-variant">in the world</p></div>
            </div>
          </div>

          <aside className="min-w-0 border-l border-outline-variant/70 pl-0 md:pl-8">
            <p className="font-caption text-caption uppercase tracking-[0.18em] text-on-surface-variant">Relay passport</p>
            <p className="mt-3 break-all font-mono text-sm tracking-[0.13em] text-ink-navy">{relay.passcode}</p>
            <div className="mt-5 flex h-28 w-28 items-center justify-center border border-ink-navy/50 bg-surface-container-lowest p-2"><div className="qr-grid" aria-hidden="true" /></div>
            <button type="button" onClick={copyRelayLink} className="mt-5 inline-flex items-center gap-sm border border-ink-navy px-md py-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy/5">{copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy handoff link'}</button>
            <div className="mt-8 border-t border-outline-variant/70 pt-6">
              <div className="flex gap-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-accent" /><p className="font-body-md text-body-md leading-relaxed text-on-surface-variant">The message is sealed until the recipient opens it.</p></div>
              <div className="mt-5 flex gap-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-accent" /><p className="font-body-md text-body-md leading-relaxed text-on-surface-variant">Locations are recorded as broad places, never private addresses.</p></div>
              <div className="mt-5 flex gap-sm"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-accent" /><p className="font-body-md text-body-md leading-relaxed text-on-surface-variant">The longer it takes, the more of the journey there is to remember.</p></div>
            </div>
          </aside>
        </section>

        <section className="py-10 md:py-12">
          <div className="flex items-end justify-between gap-md border-b border-outline-variant/70 pb-md"><div><p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">The logbook</p><h2 className="mt-2 font-headline-md text-headline-md text-ink-navy">A quiet record of the trip.</h2></div><span className="font-caption text-caption text-on-surface-variant">{completedHandoffs.length} entries</span></div>
          <div className="divide-y divide-outline-variant/70">
            {completedHandoffs.slice().reverse().map((handoff) => (
              <article key={handoff.id} className="grid gap-md py-5 sm:grid-cols-[140px_1fr_180px] sm:items-start">
                <p className="font-caption text-caption uppercase tracking-[0.12em] text-on-surface-variant">{handoff.role === 'sender' ? 'Origin' : 'Handoff'}</p>
                <div><h3 className="font-headline-md text-[20px] leading-6 text-ink-navy">{handoff.name} {handoff.role === 'sender' ? 'started it' : 'carried it forward'}</h3><p className="mt-1 font-body-md text-body-md leading-relaxed text-on-surface-variant">{handoff.note}</p></div>
                <p className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant sm:justify-end"><MapPin className="h-3.5 w-3.5" /> {handoff.location}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function RelayPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><RelayContent /></Suspense>;
}
