'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Mail } from 'lucide-react';
import dynamic from 'next/dynamic';
import { dispatchLetter, getLetterDraft } from '@/lib/letterStore';
import { syncLetterToBackend } from '@/lib/letterBackend';
import { LetterProgress } from '@/components/LetterProgress';

const WaxSealScene = dynamic(
  () => import('@/components/WaxSealScene').then((m) => m.WaxSealScene),
  { ssr: false }
);
const PostboxScene = dynamic(
  () => import('@/components/PostboxScene').then((m) => m.PostboxScene),
  { ssr: false }
);

type Scene = 'wax' | 'postbox';

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
    const hasAddress = Object.values(draft.address).every((value) => value.trim().length > 0);

    if (!draft.content.trim()) {
      router.replace('/compose');
      return;
    }
    if (!draft.sealId || !hasAddress) {
      router.replace('/compose/address');
      return;
    }

    setPosted(draft.status === 'dispatched');
    setLetterDetails({ recipient: draft.address.name || draft.recipient, subject: draft.subject });
    setReady(true);
  }, [router]);

  const goToPostbox = () => {
    if (!sealed) return;
    setTransitioning(true);
    setTimeout(() => {
      setScene('postbox');
      setTransitioning(false);
    }, 800);
  };

  const handlePosted = () => {
    const dispatched = dispatchLetter();
    void syncLetterToBackend(dispatched);
    setPosted(true);
  };

  const handleSealed = () => {
    setSealed(true);
  };

  const handleCompleteDispatch = () => {
    if (!posted) return;
    router.push('/sent');
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1a1410]">
        <p className="font-caption text-caption text-parchment/50">Preparing the dispatch...</p>
      </div>
    );
  }

  return (
    <div className="page-enter min-h-screen flex flex-col bg-[#1a1410]">
      {/* Header */}
      <header className="px-margin-mobile md:px-margin-desktop py-lg border-b border-wax-red/20 bg-[#1a1410]/90 backdrop-blur-sm sticky top-0 z-40">
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
          {scene === 'wax' ? 'Make it official' : 'Give it a send-off'}
        </h1>
        <p className="font-body-md text-body-md text-parchment/50">
          {scene === 'wax'
            ? 'Press the seal yourself, then send your letter on its way.'
            : `Your letter to ${letterDetails.recipient || 'your correspondent'} is ready for the pillar box.`}
        </p>
        <div className="mx-auto mt-md flex max-w-md items-center justify-center gap-sm font-caption text-caption text-parchment/50">
          <Mail className="h-4 w-4" />
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
          {scene === 'wax' ? <WaxSealScene onPressed={handleSealed} /> : <PostboxScene onPosted={handlePosted} />}
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
            {sealed ? 'Continue to postbox' : 'Press the seal first'}
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-sm font-caption text-caption text-parchment/30">
            {sealed ? 'One more step and it is on its way.' : 'Drag to rotate, then press the seal.'}
          </p>
        </div>
      )}

      {scene === 'postbox' && (
        <div className="pb-xxl px-margin-mobile md:px-margin-desktop text-center">
          <button
            type="button"
            onClick={handleCompleteDispatch}
            disabled={!posted}
            className="inline-flex items-center gap-sm px-xl py-md border border-parchment/30 text-parchment font-label-md text-label-md uppercase tracking-widest rounded-sm hover:bg-parchment/10 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {posted ? 'View delivery details' : 'Send it through the postbox'}
            <ArrowRight className="h-4 w-4" />
          </button>
          {!posted && (
            <p className="mt-sm font-caption text-caption text-parchment/40">
              Send the letter through the postbox to continue
            </p>
          )}
        </div>
      )}
    </div>
  );
}
