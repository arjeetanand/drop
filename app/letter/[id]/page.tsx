'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Clock3, LockKeyhole, MailOpen, Sparkles, UsersRound } from 'lucide-react';
import { useParams } from 'next/navigation';
import { EnvelopeOrbit } from '@/components/EnvelopeOrbit';
import { getLetterById } from '@/lib/letterStore';
import type { MockLetter } from '@/data/mockData';
import { playInterfaceSound } from '@/lib/interfaceSound';
import { getRelayState, getRelayStats } from '@/lib/relayStore';

export default function LetterArrivalPage() {
  const params = useParams<{ id: string }>();
  const [letter, setLetter] = useState<MockLetter | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => setLetter(getLetterById(params.id) || null), [params.id]);

  const teasers = useMemo(() => letter?.teaser || [
    'A little thought found its way to you.',
    letter?.excerpt.slice(0, 46) || 'Some words are waiting behind the seal.',
    'Open when you want the whole story.',
  ], [letter]);
  const relay = letter ? getRelayState(letter.id, { subject: letter.subject, recipient: letter.recipient }) : null;
  const relayStats = relay ? getRelayStats(relay) : null;

  if (!letter) {
    return <main className="flex min-h-screen items-center justify-center p-margin-mobile"><div className="text-center"><h1 className="font-headline-lg text-headline-lg text-primary">That letter is still finding its way.</h1><Link href="/" className="mt-lg inline-block underline">Back to desk</Link></div></main>;
  }

  const reveal = () => {
    setRevealed(true);
    playInterfaceSound('reveal');
  };

  const openLetter = () => {
    setOpened(true);
    playInterfaceSound('send');
  };

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-12 bg-surface text-ink-navy">
      <div className="mx-auto max-w-[1120px] px-margin-mobile py-6 md:px-12 md:py-10 xl:px-16">
        {/* Floating Top Navigation */}
        <header className="flex items-center justify-between pb-6 border-b border-[#102a43]/[0.08]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#102a43]/[0.1] bg-white/70 backdrop-blur-sm text-xs font-mono tracking-wider uppercase text-on-surface-variant hover:text-ink-navy hover:bg-white transition-all shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to desk
          </Link>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-mint-accent/30 bg-mint-accent/10 font-mono text-xs uppercase tracking-[0.16em] text-mint-accent font-semibold">
            <Sparkles className="h-3.5 w-3.5" /> Relay Arrival
          </span>
        </header>

        {/* Hero Section */}
        <section className="mt-10 text-center max-w-2xl mx-auto">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-amber-accent font-semibold">
            From {letter.sender || 'A correspondent'}
          </p>
          <h1 className="mt-2 font-headline-lg text-[clamp(2.4rem,4.5vw,4.2rem)] leading-[1.02] tracking-[-0.035em] text-ink-navy">
            Someone carried something to you.
          </h1>
          <p className="mt-4 font-body-lg text-base md:text-lg leading-relaxed text-on-surface-variant">
            Your envelope traveled through {relayStats?.carriers || 1} human {relayStats?.carriers === 1 ? 'custodian' : 'custodians'}. Read the teaser fragments before you break the seal and unfold the full letter.
          </p>
        </section>

        {/* Reader Workspace */}
        <section className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.7fr)]">
          {/* Main Paper / Teaser Area */}
          <div className="refero-card rounded-2xl p-6 md:p-10 bg-white border border-[#102a43]/[0.08] shadow-[0_12px_40px_-8px_rgba(16,42,67,0.07)]">
            <div className="flex items-center justify-between border-b border-[#102a43]/[0.08] pb-5">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant block">Subject</span>
                <span className="font-headline-md text-2xl text-ink-navy font-bold">{letter.subject}</span>
              </div>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-full bg-mint-accent/10 border border-mint-accent/20 text-mint-accent font-medium">
                <Clock3 className="h-3.5 w-3.5" /> In your hands
              </span>
            </div>

            {/* Teasers List */}
            <div className="mt-6 space-y-3">
              {teasers.map((teaser, index) => (
                <div
                  key={teaser}
                  className={`flex items-start gap-3 rounded-xl border border-[#102a43]/[0.08] bg-[#faf8f4] p-4 transition-all duration-300 ${
                    revealed ? 'border-amber-accent/30 bg-amber-accent/[0.04]' : ''
                  }`}
                  style={{ transitionDelay: `${index * 120}ms` }}
                >
                  <div className="mt-0.5 p-1.5 rounded bg-white border border-[#102a43]/[0.1] text-amber-accent shrink-0">
                    <LockKeyhole className="h-3.5 w-3.5" />
                  </div>
                  <span className="font-serif text-base text-ink-navy leading-relaxed">
                    {revealed ? teaser : 'A confidential fragment is resting behind the seal.'}
                  </span>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {!revealed && (
                <button
                  type="button"
                  onClick={reveal}
                  className="inline-flex items-center gap-2 bg-ink-navy text-white px-6 py-3 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-[0_2px_8px_rgba(16,42,67,0.15)]"
                >
                  <Sparkles className="h-4 w-4 text-amber-accent" />
                  Reveal Fragments
                </button>
              )}
              {revealed && !opened && (
                <button
                  type="button"
                  onClick={openLetter}
                  className="inline-flex items-center gap-2 bg-mint-accent text-ink-navy px-6 py-3 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] font-semibold hover:bg-mint-accent/90 active:scale-[0.99] transition-all shadow-[0_2px_8px_rgba(43,138,107,0.2)]"
                >
                  <MailOpen className="h-4 w-4" />
                  Unfold Letter <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* The Fully Opened Stationery Sheet */}
            {opened && (
              <div className="mt-8 border-t border-[#102a43]/[0.08] pt-8" aria-live="polite">
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-mint-accent font-semibold">
                  <MailOpen className="h-4 w-4" />
                  <span>Unsealed & Open</span>
                </div>
                <div className="mt-4 p-8 rounded-2xl bg-[#faf8f4] border border-[#102a43]/[0.1] shadow-inner relative overflow-hidden">
                  <p className="font-serif text-lg md:text-xl leading-relaxed text-ink-navy italic">
                    &ldquo;{letter.excerpt}&rdquo;
                  </p>
                  <div className="mt-8 pt-4 border-t border-[#102a43]/[0.08] flex items-center justify-between">
                    <span className="font-mono text-xs text-on-surface-variant">
                      Received via Voluntary Relay
                    </span>
                    <Link
                      href={`/journey?letter=${encodeURIComponent(letter.id)}`}
                      className="inline-flex items-center gap-1.5 font-label-md text-xs uppercase tracking-[0.14em] text-ink-navy underline decoration-amber-accent decoration-2 underline-offset-4 hover:text-amber-accent transition-colors"
                    >
                      See the complete route <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar: Envelope & Stats */}
          <aside className="space-y-6">
            <div className="refero-card rounded-2xl p-6 bg-white text-center">
              <EnvelopeOrbit />
              <div className="mt-4 pt-4 border-t border-[#102a43]/[0.08]">
                <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">
                  Custody Statistics
                </p>
                <p className="mt-1 font-headline-md text-2xl text-ink-navy font-bold">
                  {relayStats?.carriers || 1} people carried it
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-mint-accent font-medium">
                  <UsersRound className="h-3.5 w-3.5" />
                  {relayStats?.cities || 1} {relayStats?.cities === 1 ? 'city' : 'cities'} touched
                </p>
              </div>
            </div>

            <div className="refero-card rounded-2xl p-6 bg-[#faf8f4] border border-[#102a43]/[0.08]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">
                Letter Identity
              </p>
              <div className="space-y-2 text-xs font-mono text-on-surface-variant">
                <div className="flex justify-between py-1 border-b border-[#102a43]/[0.06]">
                  <span>Passport:</span>
                  <span className="text-ink-navy font-bold">{letter.id}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#102a43]/[0.06]">
                  <span>Seal:</span>
                  <span className="text-ink-navy font-semibold">Intaglio Wax</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Privacy:</span>
                  <span className="text-mint-accent font-semibold">Zero Words Exposed</span>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
