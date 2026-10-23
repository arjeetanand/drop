'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Check, CircleHelp, Clock3, Route, UsersRound } from 'lucide-react';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { currentFocusDraft } from '@/data/mockData';
import { getRemoteClaimReceiptStatusForDrop } from '@/lib/letterBackend';
import { getLetterDraft, getLetterDraftById, type LetterDraftState } from '@/lib/letterStore';
import { getClaimReceiptCopy, getClaimReceiptStatusLabel, mergeClaimReceiptStatus, mergeScopedClaimReceiptStatus, resolveClaimShareOutcome, resolveRequestedReceiptDraft, type ClaimReceiptStatus, type ScopedClaimReceiptStatus } from '@/lib/claimReceipt';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { getRelayState, getRelayStats } from '@/lib/relayStore';

function SentContent() {
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [claimReceiptState, setClaimReceiptState] = useState<ScopedClaimReceiptStatus>({ letterId: null, accountId: null, status: 'checking' });
  const requestedId = searchParams.get('letter');
  const claimPending = searchParams.get('claim') === '1';
  const claimStatus: ClaimReceiptStatus = claimReceiptState.letterId === requestedId ? claimReceiptState.status : 'checking';

  useEffect(() => {
    setDraft(resolveRequestedReceiptDraft(requestedId, getLetterDraftById, getLetterDraft));
  }, [requestedId]);

  useEffect(() => {
    if (!claimPending) return;
    if (!requestedId) {
      setClaimReceiptState({ letterId: null, accountId: null, status: 'unavailable' });
      return;
    }

    let active = true;
    let identityRevision = 0;
    let inFlightRevision: number | null = null;
    let refreshTimer: number | null = null;
    setClaimReceiptState({ letterId: requestedId, accountId: null, status: 'checking' });
    const refreshStatus = () => {
      if (!active || document.visibilityState === 'hidden') return;
      const requestRevision = identityRevision;
      if (inFlightRevision === requestRevision) return;
      inFlightRevision = requestRevision;
      void getRemoteClaimReceiptStatusForDrop(requestedId)
        .then((lookup) => {
          if (!active || requestRevision !== identityRevision) return;
          if (!lookup) {
            setClaimReceiptState((current) => current.letterId === requestedId
              ? { ...current, status: mergeClaimReceiptStatus(current.status, null) }
              : { letterId: requestedId, accountId: null, status: 'unavailable' });
            return;
          }
          setClaimReceiptState((current) => mergeScopedClaimReceiptStatus(
            current,
            requestedId,
            lookup.accountId,
            lookup.status,
          ));
        })
        .finally(() => {
          if (inFlightRevision === requestRevision) inFlightRevision = null;
        });
    };

    refreshStatus();
    const interval = window.setInterval(refreshStatus, 15_000);
    const onFocus = () => refreshStatus();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    const supabase = getSupabaseBrowserClient();
    const authSubscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      identityRevision += 1;
      setClaimReceiptState({ letterId: requestedId, accountId: session?.user.id ?? null, status: 'checking' });
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refreshStatus, 0);
    }).data.subscription;
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      authSubscription?.unsubscribe();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [claimPending, requestedId]);

  const letterId = requestedId || draft?.id || currentFocusDraft.id;
  const syncedToCloud = searchParams.get('sync') === 'cloud';
  const instant = searchParams.get('mode') === 'instant';
  const fallbackDraft = requestedId ? null : currentFocusDraft;
  const relay = getRelayState(letterId, {
    subject: draft?.subject || fallbackDraft?.subject || 'A private drop',
    recipient: draft?.address.name || draft?.recipient || (fallbackDraft ? 'your correspondent' : 'their person'),
  });
  const stats = getRelayStats(relay);
  if (claimPending) {
    const outcome = resolveClaimShareOutcome(searchParams.getAll('share'));
    const receiptCopy = getClaimReceiptCopy(outcome);
    const claimStatusClass = claimStatus === 'claimed' ? 'success' : claimStatus === 'unavailable' ? 'neutral' : 'pending';
    const ClaimStatusIcon = claimStatus === 'claimed' ? Check : claimStatus === 'unavailable' ? CircleHelp : Clock3;
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-[760px]">
          <header className="flex items-center justify-between gap-4">
            <Link href="/mailbox" className="button-quiet -ml-2">Back to mailbox <ArrowRight className="h-4 w-4 rotate-180" aria-hidden="true" /></Link>
            <span role="status" aria-live="polite" aria-atomic="true" className={`status-mark ${claimStatusClass}`}><ClaimStatusIcon className="h-3.5 w-3.5" aria-hidden="true" /> {getClaimReceiptStatusLabel(claimStatus)}</span>
          </header>
          <section className="mt-12 rounded-[1.5rem] bg-[#2b45f7] p-6 text-white sm:p-10">
            <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/80">{receiptCopy.eyebrow}</p>
            <h1 className="mt-3 font-headline-md text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">{receiptCopy.heading}</h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/80 sm:text-base">{receiptCopy.body}</p>
            <div className="mt-7 flex flex-col gap-2 sm:flex-row">
              {requestedId && <Link href={`/letter/${encodeURIComponent(letterId)}`} className="button-secondary !min-h-12 !rounded-xl !border-white/20 !bg-white !text-[#223bdc]">Open your copy <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
              <Link href="/mailbox" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-bold text-white hover:bg-white/10">View Sent</Link>
            </div>
          </section>
        </div>
      </main>
    );
  }
  if (instant) {
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-[760px]">
          <header className="flex items-center justify-between gap-4">
            <Link href="/" className="button-quiet -ml-2">Back to desk <ArrowRight className="h-4 w-4 rotate-180" aria-hidden="true" /></Link>
            <span className="status-mark success"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Delivered</span>
          </header>
          <section className="mt-12 rounded-[1.5rem] bg-[#2b45f7] p-6 text-white sm:p-10">
            <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/80">It landed ✨</p>
            <h1 className="mt-3 font-headline-md text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">Your drop made it.</h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/80 sm:text-base">{draft ? `“${draft.subject || 'A little moment'}” just landed for ${draft.recipient || 'your person'}. Good timing, probably.` : 'Your drop was sent. Open it from Sent to see its details.'}</p>
            <div className="mt-7 flex flex-col gap-2 sm:flex-row">
              <Link href={`/letter/${encodeURIComponent(letterId)}`} className="button-secondary !min-h-12 !rounded-xl !border-white/20 !bg-white !text-[#223bdc]">Open your copy <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link href="/compose?new=1" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-bold text-white hover:bg-white/10">Make another drop</Link>
            </div>
          </section>
          <p className="mt-5 text-center text-xs text-on-surface-variant">Private between you and the person you chose.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[980px]">
        <header className="page-header flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="button-quiet -ml-2">Back to desk <ArrowRight className="h-4 w-4 rotate-180" aria-hidden="true" /></Link>
            <span className="status-mark success"><Check className="h-3.5 w-3.5" aria-hidden="true" /> {syncedToCloud ? 'Synced to account' : 'Saved on this device'}</span>
          </div>
          <div>
            <p className="eyebrow">Your drop is on its way</p>
            <h1 className="display-title mt-4 max-w-3xl">Let someone carry it forward.</h1>
            <p className="body-copy mt-5 max-w-2xl text-lg">“{relay.subject}” is sealed and waiting for its first human handoff. Share the passport with someone heading in the right direction.</p>
            <p className="field-help mt-3">{syncedToCloud ? 'Your account has a copy of this drop.' : 'This local-first demo keeps the drop on this device. Sign in from Profile to sync across devices.'}</p>
          </div>
        </header>

        <div className="mt-12 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)] md:items-start">
          <section>
            <div className="panel p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[rgba(16,42,67,0.12)] pb-5">
                <div><p className="eyebrow">Relay passport</p><h2 className="mt-2 font-headline-md text-3xl text-ink-navy">{relay.passcode}</h2></div>
                <span className="meta">Drop {letterId}</span>
              </div>
              <div className="mt-6 grid gap-6 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
                <div className="flex justify-center"><RelayEnvelope compact sealId={draft?.sealId} sealMark={draft?.sealMonogram || undefined} sealColor={draft?.sealColor} /></div>
                <div>
                  <p className="meta">Destination</p>
                  <p className="mt-2 font-headline-md text-2xl text-ink-navy">{relay.recipient}</p>
                  <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">The contents stay sealed until the designated recipient opens the envelope.</p>
                  <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="button-primary mt-5"><Route className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" /> Create a secure carrier invite</Link>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-3 border-y border-[rgba(16,42,67,0.12)] py-5">
              <div><p className="font-headline-md text-2xl text-ink-navy">{stats.carriers}</p><p className="mt-1 text-xs text-on-surface-variant">People carrying</p></div>
              <div className="border-l border-[rgba(16,42,67,0.12)] pl-4 sm:pl-6"><p className="font-headline-md text-2xl text-ink-navy">{stats.cities}</p><p className="mt-1 text-xs text-on-surface-variant">Stops recorded</p></div>
              <div className="border-l border-[rgba(16,42,67,0.12)] pl-4 sm:pl-6"><p className="font-headline-md text-2xl text-ink-navy">{stats.hours}h</p><p className="mt-1 text-xs text-on-surface-variant">Journey age</p></div>
            </div>
          </section>

          <aside className="panel-muted p-6 sm:p-7">
            <p className="eyebrow">What happens next</p>
            <div className="mt-6 space-y-5">
              {[
                ['01', 'Share the passport', 'Give the link to someone who can carry the envelope closer.'],
                ['02', 'They log a handoff', 'The next person sees only the destination and adds a route stop.'],
                ['03', 'Follow the journey', 'Watch the chain grow until the recipient can open it.'],
              ].map(([number, title, copy]) => (
                <div key={number} className="flex gap-3"><span className="meta mt-1 text-[#b88938]">{number}</span><div><h2 className="font-headline-md text-xl text-ink-navy">{title}</h2><p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{copy}</p></div></div>
              ))}
            </div>
            <div className="mt-7 border-t border-[rgba(16,42,67,0.12)] pt-5">
              <Link href={`/journey?letter=${encodeURIComponent(letterId)}`} className="button-secondary w-full"><Route className="h-4 w-4" aria-hidden="true" /> Follow the journey</Link>
              <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="button-quiet mt-2 w-full"><UsersRound className="h-4 w-4" aria-hidden="true" /> Open relay passport</Link>
            </div>
          </aside>
        </div>

        <p className="mt-10 text-center text-sm text-on-surface-variant">You can share the link again from the relay passport at any time.</p>
      </div>
    </main>
  );
}

export default function SentPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="page-container max-w-[900px]"><p className="meta">Preparing your relay passport…</p></div></main>}>
      <SentContent />
    </Suspense>
  );
}
