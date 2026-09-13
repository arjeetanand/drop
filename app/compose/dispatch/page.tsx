'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, Sparkles } from 'lucide-react';
import { dispatchLetter, getLetterDraft, saveLetterDraft, type LetterDraftState } from '@/lib/letterStore';
import { syncLetterToBackend } from '@/lib/letterBackend';
import { LetterProgress } from '@/components/LetterProgress';
import { WaxSealScene } from '@/components/WaxSealScene';
import { playInterfaceSound } from '@/lib/interfaceSound';

export default function DispatchSequence() {
  const router = useRouter();
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [sealed, setSealed] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const currentDraft = getLetterDraft();
    const hasAddress = Boolean(
      currentDraft.address.name.trim() && currentDraft.address.city.trim() && currentDraft.address.country.trim()
    );

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
  }, [router]);

  const handleSealPressed = () => {
    if (sealed) return;
    setSealed(true);
    saveLetterDraft({ status: 'sealed' });
  };

  const handleDispatch = () => {
    if (!sealed || dispatching) return;
    setDispatching(true);
    playInterfaceSound('send');

    const dispatched = dispatchLetter();
    void syncLetterToBackend(dispatched);

    window.setTimeout(() => {
      router.push('/sent');
    }, 700);
  };

  if (!ready || !draft) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="font-caption text-caption text-on-surface-variant">Preparing the ritual...</p>
      </div>
    );
  }

  const recipientName = draft.address.name || draft.recipient || 'Your correspondent';
  const destination = `${draft.address.city}, ${draft.address.country}`;

  return (
    <div className="page-enter min-h-screen flex flex-col bg-surface">
      {/* Header */}
      <header className="px-margin-mobile md:px-margin-desktop py-lg border-b border-outline-variant bg-surface">
        <div className="max-w-[1140px] mx-auto flex items-center justify-between">
          <Link
            href="/compose/address"
            className="flex items-center gap-sm text-on-surface-variant hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-caption text-caption hidden sm:inline">Back to Destination</span>
          </Link>
          <h1 className="font-headline-md text-headline-md text-primary">The Sealing Ceremony</h1>
          <div className="w-20" />
        </div>
        <div className="mx-auto mt-lg max-w-[1140px] border-t border-outline-variant/20 pt-md">
          <LetterProgress current="send" />
        </div>
      </header>

      {/* Main Ceremony Container */}
      <main className="flex-grow flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop w-full max-w-[1020px] mx-auto">
        {/* Stage Header */}
        <div className="mb-8 text-center">
          <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">Stage 3 of 3</p>
          <h1 className="mt-2 font-headline-lg text-[clamp(2.4rem,4.5vw,4.2rem)] leading-[1] tracking-[-0.03em] text-ink-navy">
            Make it official.
          </h1>
          <p className="mt-3 font-body-lg text-body-lg text-on-surface-variant max-w-xl mx-auto leading-relaxed">
            {sealed
              ? 'Your words are sealed and locked behind unbroken wax. Dispatch the envelope to mint its human relay passport.'
              : 'Press the brass die into the warm wax pool. Once stamped, the letter cannot be unread by any carrier along the way.'}
          </p>

          {/* Letter Info Capsule */}
          <div className="mt-4 inline-flex items-center gap-2 border border-outline-variant/60 bg-surface-container-lowest px-4 py-1.5 font-caption text-caption text-on-surface-variant rounded-full">
            <LockKeyhole className="h-3.5 w-3.5 text-mint-accent" />
            <span>To <strong className="text-ink-navy">{recipientName}</strong> in {destination}</span>
            <span>·</span>
            <span>&ldquo;{draft.subject}&rdquo;</span>
          </div>
        </div>

        {/* The Tactile Sealing Desk */}
        <div className="w-full">
          <WaxSealScene
            sealId={draft.sealId || 'fern'}
            sealColor={draft.sealColor || '#991b1b'}
            sealMonogram={draft.sealMonogram || 'E'}
            recipientName={recipientName}
            destinationCity={draft.address.city}
            destinationCountry={draft.address.country}
            isSealed={sealed}
            onPressed={handleSealPressed}
          />
        </div>

        {/* Action Controls */}
        <div className="mt-8 w-full max-w-md flex flex-col items-center text-center">
          {!sealed ? (
            <>
              <button
                type="button"
                onClick={handleSealPressed}
                className="w-full inline-flex items-center justify-center gap-2 bg-ink-navy py-4 px-xl font-label-md text-label-md uppercase tracking-widest text-surface-bright transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg rounded-sm"
              >
                <Sparkles className="h-4 w-4 text-amber-accent" />
                <span>Stamp the Wax Seal</span>
              </button>
              <p className="mt-3 font-caption text-caption text-on-surface-variant">
                Click above or tap the brass die on the envelope to press.
              </p>
            </>
          ) : (
            <>
              {/* Sealed Status Pill */}
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-mint-accent/50 bg-mint-accent/10 px-4 py-1.5 font-caption text-caption text-ink-navy">
                <CheckCircle2 className="h-4 w-4 text-mint-accent" />
                <span>Envelope wax-sealed & protected · 0 words exposed</span>
              </div>

              {/* Final Dispatch Button */}
              <button
                type="button"
                onClick={handleDispatch}
                disabled={dispatching}
                className="w-full inline-flex items-center justify-center gap-3 bg-amber-accent py-4 px-xl font-label-md text-label-md uppercase tracking-widest text-ink-navy transition-all duration-300 hover:-translate-y-0.5 hover:bg-amber-accent/90 hover:shadow-lg rounded-sm disabled:opacity-50"
              >
                <span>{dispatching ? 'Minting Relay Passport…' : 'Dispatch to Human Relay'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-3 font-caption text-caption text-on-surface-variant">
                Next: Share your relay passport link with the first person to carry it.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
