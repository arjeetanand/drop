'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, LockKeyhole, Share2, UsersRound } from 'lucide-react';
import { currentFocusDraft } from '@/data/mockData';
import { getLetterDraft, type LetterDraftState } from '@/lib/letterStore';
import { getRelayState, getRelayStats } from '@/lib/relayStore';
import { LetterProgress } from '@/components/LetterProgress';
import { RelayEnvelope } from '@/components/RelayEnvelope';

export default function Postman() {
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDraft(getLetterDraft());
  }, []);

  const letterId = draft?.id || currentFocusDraft.id;
  const relay = getRelayState(letterId, {
    subject: draft?.subject || currentFocusDraft.subject,
    recipient: draft?.address.name || draft?.recipient || 'your correspondent',
  });
  const stats = getRelayStats(relay);
  const shareLink = typeof window === 'undefined'
    ? `/relay?letter=${encodeURIComponent(letterId)}&join=1`
    : `${window.location.origin}/relay?letter=${encodeURIComponent(letterId)}&join=1`;

  const copyRelayLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setNotice('The first handoff link is ready to share.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(shareLink);
    }
  };

  return (
    <div className="page-enter min-h-screen bg-surface">
      <header className="border-b border-outline-variant/70 px-margin-mobile py-lg md:px-12 xl:px-16">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between">
          <Link href="/" className="font-headline-md text-headline-md text-ink-navy">Dear.exe</Link>
          <Link href="/" className="font-caption text-caption uppercase tracking-[0.16em] text-on-surface-variant hover:text-ink-navy">Back to desk</Link>
        </div>
        <div className="mx-auto mt-lg max-w-[1180px] border-t border-outline-variant/30 pt-md"><LetterProgress current="send" /></div>
      </header>

      <main className="mx-auto grid max-w-[1180px] items-center gap-12 px-margin-mobile py-12 md:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] md:px-12 md:py-20 xl:px-16">
        <div className="order-2 md:order-1">
          <div className="flex items-center gap-sm font-caption text-caption uppercase tracking-[0.18em] text-mint-accent"><span className="h-2 w-2 rounded-full bg-mint-accent" /> Passport created</div>
          <h1 className="mt-4 max-w-[560px] font-headline-lg text-[clamp(2.8rem,5vw,5rem)] leading-[0.98] tracking-[-0.04em] text-ink-navy">Your letter is ready for human hands.</h1>
          <p className="mt-6 max-w-[520px] font-body-lg text-body-lg leading-relaxed text-on-surface-variant">{relay.subject} is sealed and waiting for its first carrier. Share the passport with someone you trust, and let the journey begin.</p>
          <div className="mt-8 flex flex-wrap items-center gap-md">
            <button type="button" onClick={copyRelayLink} className="inline-flex items-center gap-sm bg-ink-navy px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-surface-bright hover:-translate-y-0.5 hover:shadow-lg">{copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />} {copied ? 'Link copied' : 'Copy handoff link'}</button>
            <Link href={`/journey?letter=${encodeURIComponent(letterId)}`} className="inline-flex items-center gap-sm border border-ink-navy px-lg py-md font-label-md text-label-md uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy/5">Follow the Journey <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {notice && <p className="mt-4 font-caption text-caption text-mint-accent" aria-live="polite">{notice}</p>}
          <div className="mt-10 grid max-w-[520px] grid-cols-3 gap-md border-t border-outline-variant/70 pt-6">
            <div><p className="font-headline-md text-headline-md text-ink-navy">{stats.carriers}</p><p className="mt-1 font-caption text-caption text-on-surface-variant">human links</p></div>
            <div><p className="font-headline-md text-headline-md text-ink-navy">0</p><p className="mt-1 font-caption text-caption text-on-surface-variant">words exposed</p></div>
            <div><p className="font-headline-md text-headline-md text-ink-navy">{stats.hours}h</p><p className="mt-1 font-caption text-caption text-on-surface-variant">so far</p></div>
          </div>
        </div>

        <div className="order-1 flex min-h-[420px] flex-col items-center justify-center border border-outline-variant/70 bg-[#eee9e0] p-8 md:order-2 md:p-12">
          <div className="mb-8 flex items-center gap-sm font-caption text-caption uppercase tracking-[0.2em] text-ink-navy/60"><LockKeyhole className="h-4 w-4 text-mint-accent" /> Sealed from view</div>
          <RelayEnvelope />
          <div className="mt-10 text-center"><p className="font-caption text-caption uppercase tracking-[0.18em] text-amber-accent">Relay passport</p><p className="mt-2 font-mono text-sm tracking-[0.14em] text-ink-navy">{relay.passcode}</p><p className="mt-3 inline-flex items-center gap-sm font-body-md text-body-md text-on-surface-variant"><UsersRound className="h-4 w-4" /> Waiting for its first carrier</p></div>
        </div>
      </main>
    </div>
  );
}
