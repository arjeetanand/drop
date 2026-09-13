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
      <header className="border-b border-[#102a43]/[0.08] px-margin-mobile py-5 md:px-12 xl:px-16 bg-surface">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between">
          <Link href="/" className="font-headline-md text-xl text-ink-navy">Dear.exe</Link>
          <Link href="/" className="font-caption text-xs uppercase tracking-wider text-on-surface-variant hover:text-ink-navy">
            Back to desk
          </Link>
        </div>
        <div className="mx-auto mt-4 max-w-[1180px] border-t border-[#102a43]/[0.06] pt-3">
          <LetterProgress current="send" />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1180px] items-center gap-12 px-margin-mobile py-10 md:grid-cols-[minmax(0,1fr)_minmax(380px,1fr)] md:px-12 md:py-16 xl:px-16">
        {/* Left Column: Celebratory Info & Handoff Actions */}
        <div className="order-2 md:order-1">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-mint-accent font-semibold">
            <span className="h-2 w-2 rounded-full bg-mint-accent" />
            Passport Minted & Registered
          </div>
          <h1 className="mt-4 max-w-[560px] font-headline-lg text-[clamp(2.5rem,4.5vw,4rem)] leading-[1.02] tracking-tight text-ink-navy">
            Your letter is ready for human hands.
          </h1>
          <p className="mt-5 max-w-[500px] font-body-lg text-base md:text-lg leading-relaxed text-on-surface-variant">
            &ldquo;{relay.subject}&rdquo; is sealed in wax and waiting for its first carrier. Share the passport with someone who is travelling toward your recipient, or pass it to a friend.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copyRelayLink}
              className="inline-flex items-center gap-2 rounded-md bg-ink-navy px-6 py-3.5 font-label-md text-xs uppercase tracking-widest text-surface-bright shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[0.99]"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4 text-amber-accent" />}
              <span>{copied ? 'Link Copied to Clipboard' : 'Copy Handoff Link'}</span>
            </button>
            <Link
              href={`/journey?letter=${encodeURIComponent(letterId)}`}
              className="inline-flex items-center gap-2 rounded-md border border-[#102a43]/20 bg-white/70 px-5 py-3.5 font-label-md text-xs uppercase tracking-widest text-ink-navy transition-all hover:bg-white hover:border-[#102a43]/40"
            >
              <span>Follow the Journey</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {notice && (
            <p className="mt-3 font-mono text-xs text-mint-accent" aria-live="polite">
              ✓ {notice}
            </p>
          )}

          {/* Key Metrics */}
          <div className="mt-10 grid max-w-[500px] grid-cols-3 gap-4 border-t border-[#102a43]/[0.08] pt-6">
            <div>
              <p className="font-headline-md text-2xl text-ink-navy font-semibold">{stats.carriers}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70 mt-0.5">Carrier In Motion</p>
            </div>
            <div>
              <p className="font-headline-md text-2xl text-ink-navy font-semibold">0</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70 mt-0.5">Words Exposed</p>
            </div>
            <div>
              <p className="font-headline-md text-2xl text-ink-navy font-semibold">{stats.hours}h</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70 mt-0.5">Journey Age</p>
            </div>
          </div>
        </div>

        {/* Right Column: Physical Postal Passport Document Card */}
        <div className="order-1 md:order-2 refero-card p-8 md:p-10 rounded-md flex flex-col items-center justify-between text-center relative overflow-hidden bg-[#faf7f0]">
          {/* Perforated edge top decoration */}
          <div className="w-full flex items-center justify-between border-b border-[#102a43]/10 pb-4 mb-6">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-on-surface-variant/70">
              International Human Relay
            </span>
            <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-mint-accent font-semibold">
              <LockKeyhole className="h-3 w-3" /> Sealed & Private
            </span>
          </div>

          <RelayEnvelope />

          <div className="mt-8 w-full border-t border-[#102a43]/10 pt-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-accent font-semibold">
              Passport Clearance Code
            </p>
            <p className="mt-1 font-mono text-base tracking-widest text-ink-navy font-bold">{relay.passcode}</p>
            <p className="mt-2.5 inline-flex items-center gap-1.5 font-mono text-xs text-on-surface-variant/80">
              <UsersRound className="h-3.5 w-3.5 text-amber-accent" />
              <span>Waiting for initial courier hand-off</span>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
