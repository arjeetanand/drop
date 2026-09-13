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
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[920px] px-margin-mobile py-xl md:px-margin-desktop md:py-xxl">
        <header className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant hover:text-primary"><ArrowLeft className="h-4 w-4" /> Back to desk</Link>
          <span className="inline-flex items-center gap-xs font-caption text-caption uppercase tracking-[0.18em] text-mint-accent"><Sparkles className="h-4 w-4" /> New relay arrival</span>
        </header>

        <section className="mt-xl text-center">
          <p className="font-caption text-caption uppercase tracking-[0.22em] text-on-surface-variant">From {letter.sender || 'a correspondent'}</p>
          <h1 className="mt-sm font-headline-lg text-headline-lg text-primary md:text-display-lg">Someone carried something to you.</h1>
          <p className="mx-auto mt-md max-w-xl font-body-md text-body-md leading-relaxed text-on-surface-variant">Your envelope made it through {relayStats?.carriers || 1} human {relayStats?.carriers === 1 ? 'link' : 'links'}. Take a peek at the feeling before you open the full letter.</p>
        </section>

        <section className="mt-xl grid items-center gap-xl md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="paper-layer p-lg card-depth md:p-xl">
            <div className="flex items-center justify-between border-b border-outline-variant/40 pb-md">
              <span className="font-headline-md text-headline-md text-primary">{letter.subject}</span>
              <span className="inline-flex items-center gap-xs font-caption text-caption text-mint-accent"><Clock3 className="h-3.5 w-3.5" /> In your hands</span>
            </div>
            <div className="mt-lg space-y-sm">
              {teasers.map((teaser, index) => <div key={teaser} className={`reveal-line flex items-center gap-sm border border-outline-variant/50 bg-surface-container-lowest px-md py-md ${revealed ? 'reveal-line-visible' : ''}`} style={{ transitionDelay: `${index * 110}ms` }}><LockKeyhole className="h-4 w-4 shrink-0 text-amber-accent" /><span className="font-body-md text-body-md text-primary">{revealed ? teaser : 'A small secret is hiding here.'}</span></div>)}
            </div>
            {!revealed && <button type="button" onClick={reveal} className="mt-lg inline-flex items-center gap-sm rounded-sm bg-secondary-container px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-on-secondary-container hover:bg-secondary-fixed">Reveal a little <Sparkles className="h-4 w-4" /></button>}
            {revealed && !opened && <button type="button" onClick={openLetter} className="mt-lg inline-flex items-center gap-sm rounded-sm bg-mint-accent px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-ink-navy hover:-translate-y-0.5">Open letter <ArrowRight className="h-4 w-4" /></button>}
            {opened && <div className="mt-lg border-t border-outline-variant/40 pt-lg" aria-live="polite"><div className="flex items-center gap-sm font-caption text-caption uppercase tracking-widest text-mint-accent"><MailOpen className="h-4 w-4" /> Fully opened</div><p className="mt-md font-body-lg text-body-lg leading-relaxed text-primary">&ldquo;{letter.excerpt}&rdquo;</p><Link href={`/journey?letter=${encodeURIComponent(letter.id)}`} className="mt-lg inline-flex items-center gap-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-primary underline decoration-amber-accent decoration-2 underline-offset-4">See the route it took <ArrowRight className="h-3.5 w-3.5" /></Link></div>}
          </div>
          <div><EnvelopeOrbit /><div className="mx-auto -mt-md max-w-xs border border-outline-variant/60 bg-surface-container-lowest p-md text-center"><p className="font-caption text-caption text-on-surface-variant">Human delivery</p><p className="mt-xs font-headline-md text-headline-md text-primary">{relayStats?.carriers || 1} people carried it</p><p className="mt-xs inline-flex items-center gap-xs font-caption text-caption text-mint-accent"><UsersRound className="h-3.5 w-3.5" /> {relayStats?.cities || 1} {relayStats?.cities === 1 ? 'place' : 'places'} touched</p></div></div>
        </section>
      </div>
    </main>
  );
}
