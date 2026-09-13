'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react';
import { LetterProgress } from '@/components/LetterProgress';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { dispatchLetter, getLetterDraft, getLetterDraftById, saveLetterDraft, setActiveLetterDraft, type LetterDraftState } from '@/lib/letterStore';
import { syncLetterToBackend } from '@/lib/letterBackend';

function DispatchSequence() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [sealed, setSealed] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [ready, setReady] = useState(false);
  const [missingLetter, setMissingLetter] = useState(false);

  useEffect(() => {
    const requestedId = searchParams.get('letter');
    const currentDraft = requestedId ? getLetterDraftById(requestedId) : getLetterDraft();
    if (!currentDraft) {
      setMissingLetter(true);
      setReady(true);
      return;
    }
    if (requestedId && currentDraft.id !== getLetterDraft().id) setActiveLetterDraft(currentDraft);
    const hasAddress = Boolean(currentDraft.address.name.trim() && currentDraft.address.city.trim() && currentDraft.address.country.trim());
    if (!currentDraft.content.trim()) {
      router.replace('/compose');
      return;
    }
    if (!currentDraft.sealId || !hasAddress) {
      router.replace('/compose/address');
      return;
    }
    setDraft(currentDraft);
    setSealed(currentDraft.status === 'sealed' || currentDraft.status === 'dispatched');
    setReady(true);
  }, [router, searchParams]);

  const pressSeal = () => {
    if (sealed) return;
    setSealed(true);
    setDraft((current) => current ? { ...current, status: 'sealed' } : current);
    saveLetterDraft({ status: 'sealed' });
  };

  const handleDispatch = async () => {
    if (!sealed || dispatching) return;
    setDispatching(true);
    const dispatched = dispatchLetter(draft?.id);
    setDraft(dispatched);
    const synced = await syncLetterToBackend(dispatched);
    router.push(`/sent?letter=${encodeURIComponent(dispatched.id)}&sync=${synced ? 'cloud' : 'local'}`);
  };

  if (missingLetter) {
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-[680px]">
          <div className="panel p-8 sm:p-10">
            <p className="eyebrow">Dispatch unavailable</p>
            <h1 className="section-title mt-3">That letter is no longer on this desk.</h1>
            <p className="body-copy mt-4">Open the journey passport to follow it, or return to your mailbox and choose a letter saved on this device.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/mailbox" className="button-primary">Back to mailbox <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link href="/journey" className="button-secondary">Open journey</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!ready || !draft) {
    return <main className="page-shell"><div className="page-container max-w-[900px]"><p className="meta">Preparing your envelope…</p></div></main>;
  }

  const recipient = draft.address.name || draft.recipient || 'your correspondent';
  const destination = [draft.address.city, draft.address.country].filter(Boolean).join(', ');

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[980px]">
        <header className="page-header flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/compose/address" className="button-quiet -ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to address</Link>
            <span className="meta inline-flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-[#4f9d7a]" aria-hidden="true" /> {draft.content.trim().split(/\s+/).length} words protected</span>
          </div>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Dispatch</p>
              <h1 className="section-title mt-3">Close the envelope. Let it go.</h1>
              <p className="body-copy mt-3 max-w-xl">One last check, then your letter gets a relay passport you can share with its first carrier.</p>
            </div>
            <LetterProgress current="send" />
          </div>
        </header>

        <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(300px,0.78fr)] md:items-start">
          <section className="paper-card p-6 sm:p-9">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(16,42,67,0.12)] pb-5">
              <div>
                <p className="eyebrow">Your letter</p>
                <h2 className="mt-2 font-headline-md text-3xl text-ink-navy">{draft.subject || 'Untitled letter'}</h2>
              </div>
              <span className={`status-mark ${sealed ? 'success' : 'pending'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> {sealed ? 'Sealed' : 'Ready to seal'}</span>
            </div>
            <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <div><p className="meta">To</p><p className="mt-1 font-semibold text-ink-navy">{recipient}</p></div>
              <div><p className="meta">Destination</p><p className="mt-1 font-semibold text-ink-navy">{destination}</p></div>
            </div>
            <div className="mt-7 border-t border-[rgba(16,42,67,0.1)] pt-7">
              <div className="flex justify-center py-5">
                <RelayEnvelope compact sealId={draft.sealId} sealMark={draft.sealMonogram || undefined} sealColor={draft.sealColor} />
              </div>
              <p className="mx-auto mt-5 max-w-md text-center font-literata text-lg leading-relaxed text-on-surface-variant">“{draft.content.slice(0, 220)}{draft.content.length > 220 ? '…' : ''}”</p>
            </div>
          </section>

          <aside className="panel p-6 sm:p-7">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(79,157,122,0.12)] text-[#276a4d]"><LockKeyhole className="h-4 w-4" aria-hidden="true" /></span>
              <div><h2 className="font-headline-md text-2xl text-ink-navy">Private by design</h2><p className="mt-2 text-sm leading-relaxed text-on-surface-variant">Carriers can move the envelope without seeing the message inside.</p></div>
            </div>
            <div className="mt-7 space-y-4 border-t border-[rgba(16,42,67,0.1)] pt-6 text-sm">
              {['The letter is saved to your desk.', 'The seal marks the envelope as protected.', 'A relay passport lets people carry it forward.'].map((item) => <div key={item} className="flex items-start gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" /><span className="leading-relaxed text-on-surface-variant">{item}</span></div>)}
            </div>
            {!sealed ? (
              <button type="button" onClick={pressSeal} className="button-primary mt-8 w-full justify-between">Press the wax seal <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            ) : (
              <div className="mt-8 space-y-3">
                <div className="notice flex items-center gap-2"><Check className="h-4 w-4" aria-hidden="true" /> Envelope sealed. Nothing is exposed.</div>
                <button type="button" onClick={() => void handleDispatch()} disabled={dispatching} className="button-primary w-full justify-between disabled:opacity-60">{dispatching ? 'Minting passport…' : 'Dispatch to human relay'} <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

export default function DispatchPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="page-container max-w-[900px]"><p className="meta">Preparing your envelope…</p></div></main>}>
      <DispatchSequence />
    </Suspense>
  );
}
