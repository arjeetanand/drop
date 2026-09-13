'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, LockKeyhole, UsersRound } from 'lucide-react';
import dynamic from 'next/dynamic';
import { dispatchLetter, getLetterDraft } from '@/lib/letterStore';
import { syncLetterToBackend } from '@/lib/letterBackend';
import { LetterProgress } from '@/components/LetterProgress';

const WaxSealScene = dynamic(
  () => import('@/components/WaxSealScene').then((m) => m.WaxSealScene),
  { ssr: false }
);
const RelayLaunchScene = dynamic(
  () => import('@/components/RelayLaunchScene').then((m) => m.RelayLaunchScene),
  { ssr: false }
);

type Scene = 'wax' | 'relay';

export default function DispatchSequence() {
  const router = useRouter();
  const [scene, setScene] = useState<Scene>('wax');
  const [transitioning, setTransitioning] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [posted, setPosted] = useState(false);
  const [ready, setReady] = useState(false);
  const [letterDetails, setLetterDetails] = useState({ recipient: '', subject: '' });

  useEffect(() => {
    const draft = getLetterDraft();
    const hasAddress = Boolean(draft.address.name.trim() && draft.address.city.trim() && draft.address.country.trim());

    if (!draft.content.trim()) {
      router.replace('/compose');
      return;
    }
    if (!draft.sealId || !hasAddress) {
      router.replace('/compose/address');
      return;
    }

    const alreadyStarted = draft.status === 'dispatched' || draft.status === 'delivered';
    setPosted(alreadyStarted);
    setSealed(Boolean(draft.sealId));
    setScene(alreadyStarted ? 'relay' : 'wax');
    setLetterDetails({ recipient: draft.address.name || draft.recipient, subject: draft.subject });
    setReady(true);
  }, [router]);

  const goToPostbox = () => {
    if (!sealed) return;
    setTransitioning(true);
    setTimeout(() => {
      setScene('relay');
      setTransitioning(false);
    }, 800);
  };

  const handlePosted = () => {
    const dispatched = dispatchLetter();
    void syncLetterToBackend(dispatched);
    setPosted(true);
    setTimeout(() => {
      router.push('/sent');
    }, 400);
  };

  const handleSealed = () => {
    setSealed(true);
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#102a43]">
        <p className="font-caption text-caption text-parchment/50">Preparing the dispatch...</p>
      </div>
    );
  }

  return (
    <div className="page-enter min-h-screen flex flex-col bg-[#102a43]">
      {/* Header */}
      <header className="px-margin-mobile md:px-margin-desktop py-lg border-b border-parchment/15 bg-[#102a43]/90 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1140px] mx-auto flex items-center justify-between">
          <Link
            href="/compose/address"
            className="flex items-center gap-sm text-parchment/60 hover:text-parchment transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-caption text-caption hidden sm:inline">Back</span>
          </Link>
          <LetterProgress current="send" dark />
          <div className="w-20" />
        </div>
      </header>

      {/* Scene title */}
      <div className="px-margin-mobile pt-xl pb-md text-center md:px-margin-desktop">
        <h1 className="font-headline-lg text-headline-lg text-parchment mb-xs">
          {scene === 'wax' ? 'Make it official' : 'Put it in human hands'}
        </h1>
        <p className="font-body-md text-body-md text-parchment/50">
          {scene === 'wax'
            ? 'Press the seal yourself. The next step creates a passport for the people who carry it.'
            : `Your letter to ${letterDetails.recipient || 'your correspondent'} is sealed and ready to move hand to hand.`}
        </p>
        <div className="mx-auto mt-md flex max-w-md items-center justify-center gap-sm font-caption text-caption text-parchment/50">
          {scene === 'wax' ? <LockKeyhole className="h-4 w-4" /> : <UsersRound className="h-4 w-4" />}
          <span>{letterDetails.subject || 'Your letter'}</span>
        </div>
      </div>

      {/* 3D Canvas */}
      <div
        className={`relative min-h-[360px] flex-1 transition-opacity duration-700 ${
          transitioning ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full">
              <p className="font-caption text-caption text-parchment/40">
                Preparing the ritual...
              </p>
            </div>
          }
        >
          {scene === 'wax' ? <WaxSealScene onPressed={handleSealed} /> : <RelayLaunchScene onLaunched={handlePosted} />}
        </Suspense>
      </div>

      {/* Scene transition button */}
      {scene === 'wax' && (
        <div className="pb-xxl px-margin-mobile md:px-margin-desktop text-center">
          <button
            onClick={goToPostbox}
            disabled={!sealed}
            className="inline-flex items-center gap-sm rounded-sm bg-amber-accent px-xl py-md font-label-md text-label-md uppercase tracking-widest text-ink-navy transition-all duration-300 hover:-translate-y-0.5 hover:bg-amber-accent/90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sealed ? 'Continue to the relay' : 'Press the seal first'}
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-sm font-caption text-caption text-parchment/30">
            {sealed ? 'One more step and it can find its first carrier.' : 'Press the seal to lock the words.'}
          </p>
        </div>
      )}

      {scene === 'relay' && (
        <div className="pb-xxl px-margin-mobile md:px-margin-desktop text-center">
          <p className="font-caption text-caption text-parchment/60">
            {posted ? 'Letter launched! Preparing your passport…' : 'Click "Start the relay" above to begin the journey.'}
          </p>
        </div>
      )}
    </div>
  );
}
