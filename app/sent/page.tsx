'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MailCheck, MapPin, Sparkles } from 'lucide-react';
import { getLetterDraft, type LetterDraftState } from '@/lib/letterStore';
import { LetterProgress } from '@/components/LetterProgress';

export default function Postman() {
  const [draft, setDraft] = useState<LetterDraftState | null>(null);

  useEffect(() => {
    setDraft(getLetterDraft());
  }, []);

  const recipient = draft?.address.name || draft?.recipient || 'your correspondent';
  const subject = draft?.subject || 'Your letter';

  return (
    <div className="page-enter min-h-screen flex flex-col bg-surface">
      {/* Minimal header */}
      <header className="px-margin-mobile md:px-margin-desktop py-lg border-b border-outline-variant bg-surface">
        <div className="max-w-[1140px] mx-auto flex justify-between items-center">
          <h1 className="font-headline-md text-headline-md text-primary uppercase tracking-widest">
            Correspondence
          </h1>
          <Link
            href="/"
            className="font-label-md text-label-md text-on-surface-variant hover:text-primary transition-colors uppercase tracking-widest"
          >
            Desk
          </Link>
        </div>
        <div className="mx-auto mt-lg max-w-[1140px] border-t border-outline-variant/20 pt-md">
          <LetterProgress current="send" />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-grow flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop w-full max-w-[1140px] mx-auto gap-xxl">
        <div className="w-full max-w-2xl flex flex-col items-center gap-xl text-center">
          {/* Dispatch receipt */}
          <div className="relative flex aspect-[4/3] w-full max-w-lg animate-fade-in items-center justify-center overflow-hidden bg-[#1a1410] p-sm card-depth">
            <div className="absolute inset-x-12 top-1/2 h-px -translate-y-1/2 bg-amber-accent/40" />
            <div className="absolute left-10 top-1/2 -translate-y-1/2 text-amber-accent">
              <MapPin className="h-7 w-7" />
            </div>
            <div className="relative z-10 flex h-36 w-52 -rotate-2 flex-col items-center justify-center gap-sm border border-parchment/30 bg-parchment p-md shadow-2xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-wax-red text-wax-red">
                <MailCheck className="h-7 w-7" />
              </div>
              <span className="font-caption text-caption uppercase tracking-[0.25em] text-ink-navy">On its way</span>
            </div>
            <div className="absolute right-10 top-1/2 -translate-y-1/2 text-amber-accent">
              <Sparkles className="h-7 w-7 animate-pulse" />
            </div>
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 font-caption text-caption uppercase tracking-[0.3em] text-parchment/50">
              POSTED WITH CARE
            </div>
          </div>

          {/* Confirmation text */}
          <div className="flex flex-col items-center gap-md max-w-md mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <MailCheck className="h-8 w-8 text-outline" />
            <h2 className="font-headline-lg text-headline-lg text-primary">
              Your letter is in the world.
            </h2>
            <p className="font-caption text-caption text-primary">
              {subject} · To {recipient}
            </p>
            <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
              It has left your desk and started its journey. Expect it to arrive in 3–5 days.
            </p>

            {/* Progress bar */}
            <div className="mt-lg w-full max-w-[200px] h-[1px] bg-outline-variant/50 relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-primary w-1/3 rounded-full animate-progress" />
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-md mt-lg">
              <Link
                href="/journey"
                className="px-lg py-sm border border-primary text-primary font-label-md text-label-md hover:bg-secondary-container transition-colors uppercase tracking-widest"
              >
                Follow the Journey
              </Link>
              <Link
                href="/"
                className="px-lg py-sm bg-ink-navy text-surface-bright font-label-md text-label-md uppercase tracking-widest hover:bg-ink-navy/90 transition-colors rounded-sm"
              >
                Return to Desk
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
