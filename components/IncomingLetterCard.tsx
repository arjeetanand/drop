'use client';

import Link from 'next/link';
import { ArrowUpRight, LockKeyhole, Sparkles } from 'lucide-react';
import type { MockLetter } from '@/data/mockData';
import { playInterfaceSound } from '@/lib/interfaceSound';
import { EnvelopeOrbit } from '@/components/EnvelopeOrbit';

export function IncomingLetterCard({ letter }: { letter: MockLetter }) {
  return (
    <article className="arrival-card relative overflow-hidden border border-outline-variant/60 bg-surface-container-lowest p-lg card-depth md:p-xl">
      <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-mint-accent/20 blur-3xl" />
      <div className="relative z-10 grid items-center gap-lg md:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <div className="mb-md flex items-center gap-sm font-caption text-caption uppercase tracking-[0.2em] text-mint-accent">
            <Sparkles className="h-4 w-4" />
            A new arrival
          </div>
          <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">
            From {letter.sender || 'someone special'}
          </p>
          <h2 className="mt-xs font-headline-lg text-headline-lg text-primary">Someone wrote to you.</h2>
          <p className="mt-sm max-w-xl font-body-md text-body-md leading-relaxed text-on-surface-variant">
            The envelope made it through. Three little clues are waiting before you open the whole thing.
          </p>
          <div className="mt-lg flex flex-wrap items-center gap-md">
            <Link
              href={`/letter/${letter.id}`}
              onClick={() => playInterfaceSound('tap')}
              className="inline-flex items-center gap-sm rounded-sm bg-mint-accent px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-ink-navy transition-transform hover:-translate-y-0.5"
            >
              See what arrived
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <span className="inline-flex items-center gap-xs font-caption text-caption text-on-surface-variant">
              <LockKeyhole className="h-3.5 w-3.5" />
              Preview only
            </span>
          </div>
        </div>
        <EnvelopeOrbit compact />
      </div>
    </article>
  );
}
