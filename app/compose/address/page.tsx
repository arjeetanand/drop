'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { mockSeals } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { getLetterDraft, saveLetterDraft, type LetterAddress } from '@/lib/letterStore';
import { LetterProgress } from '@/components/LetterProgress';

export default function FinishingTouches() {
  const router = useRouter();
  const [selectedSeal, setSelectedSeal] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [letterDetails, setLetterDetails] = useState({ recipient: '', subject: '' });
  const [address, setAddress] = useState<LetterAddress>({
    name: '',
    street: '',
    city: '',
    postcode: '',
    country: '',
  });

  useEffect(() => {
    const draft = getLetterDraft();
    setAddress(draft.address);
    setSelectedSeal(draft.sealId);
    setLetterDetails({ recipient: draft.recipient, subject: draft.subject });
    setReady(true);
  }, []);

  const updateAddress = (field: keyof LetterAddress, value: string) => {
    const nextAddress = { ...address, [field]: value };
    setAddress(nextAddress);
    saveLetterDraft({ address: nextAddress });
  };

  const hasCompleteAddress = Object.values(address).every((value) => value.trim().length > 0);
  const canDispatch = ready && Boolean(selectedSeal) && hasCompleteAddress;

  const handleSealSelect = (sealId: string) => {
    setSelectedSeal(sealId);
    saveLetterDraft({ sealId, address });
  };

  const handleDispatch = () => {
    if (!canDispatch || !selectedSeal) return;
    saveLetterDraft({ address, sealId: selectedSeal, status: 'sealed' });
    router.push('/compose/dispatch');
  };

  return (
    <div className="page-enter min-h-screen flex flex-col bg-surface">
      {/* Minimal header */}
      <header className="px-margin-mobile md:px-margin-desktop py-lg border-b border-outline-variant bg-surface/90 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1140px] mx-auto flex items-center justify-between">
          <Link
            href="/compose"
            className="flex items-center gap-sm text-on-surface-variant hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-caption text-caption hidden sm:inline">Back to Letter</span>
          </Link>
          <h1 className="font-headline-md text-headline-md text-primary">Correspondence</h1>
          <div className="w-20" />
        </div>
        <div className="mx-auto mt-lg max-w-[1140px] border-t border-outline-variant/20 pt-md">
          <LetterProgress current="address" />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-grow flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop w-full max-w-[1140px] mx-auto">
        <header className="mb-xl text-center md:mb-xxl">
          <h1 className="font-headline-lg text-headline-lg md:text-display-lg text-primary mb-md">
            Make it ready to travel
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
            Address the envelope, choose a seal, and give your letter a proper send-off.
          </p>
        </header>

        <div className="mb-lg flex w-full max-w-3xl flex-col gap-xs border border-outline-variant/50 bg-secondary-container/20 px-lg py-md sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">Your letter</p>
            <p className="font-headline-md text-headline-md text-primary">{letterDetails.subject || 'Untitled letter'}</p>
          </div>
          <p className="font-caption text-caption text-on-surface-variant">For {letterDetails.recipient || 'your correspondent'}</p>
        </div>

        {/* Stationery Canvas */}
        <div className="w-full max-w-3xl bg-surface-container-lowest border border-outline-variant shadow-sm relative overflow-hidden card-depth">
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
            }}
          />
          <div className="p-xl md:p-xxl flex flex-col items-center relative z-10">
            {/* Fold line */}
            <div className="w-full border-t border-dashed border-outline-variant opacity-50 mb-xl relative">
              <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-surface-container-lowest px-2 font-caption text-caption text-outline">
                Fold Here
              </span>
            </div>

            {/* Addressing Area */}
            <div className="mb-xl mt-lg w-full max-w-md">
              <h2 className="mb-xs text-center font-headline-md text-headline-md text-primary">
                Where should it go?
              </h2>
              <p className="mb-lg text-center font-caption text-caption text-on-surface-variant">
                Every line helps it find its way.
              </p>
              <div className="space-y-sm">
                <input
                  className="typewriter-input text-center text-lg"
                  value={address.name}
                  onChange={(e) => updateAddress('name', e.target.value)}
                  placeholder="Name"
                  aria-label="Recipient name"
                  autoComplete="name"
                />
                <input
                  className="typewriter-input text-center text-lg"
                  value={address.street}
                  onChange={(e) => updateAddress('street', e.target.value)}
                  placeholder="Street Address"
                  aria-label="Street address"
                  autoComplete="street-address"
                />
                <div className="flex gap-sm">
                  <input
                    className="typewriter-input text-center text-lg flex-1"
                    value={address.city}
                    onChange={(e) => updateAddress('city', e.target.value)}
                    placeholder="City"
                    aria-label="City"
                    autoComplete="address-level2"
                  />
                  <input
                    className="typewriter-input text-center text-lg w-32"
                    value={address.postcode}
                    onChange={(e) => updateAddress('postcode', e.target.value)}
                    placeholder="Postcode"
                    aria-label="Postcode"
                    autoComplete="postal-code"
                  />
                </div>
                <input
                  className="typewriter-input text-center text-lg"
                  value={address.country}
                  onChange={(e) => updateAddress('country', e.target.value)}
                  placeholder="Country"
                  aria-label="Country"
                  autoComplete="country-name"
                />
              </div>
            </div>

            {/* Wax Seal Interaction */}
            <fieldset className="w-full max-w-2xl border-t border-outline-variant/30 pt-xl">
              <legend className="mx-auto px-md font-headline-md text-headline-md text-primary">
                Choose a seal
              </legend>
              <p className="mb-lg text-center font-caption text-caption text-on-surface-variant">
                Pick the little mark they will find when they open it.
              </p>
              <div className="grid grid-cols-2 gap-sm sm:grid-cols-4">
                {mockSeals.map((seal) => {
                  const isSelected = selectedSeal === seal.id;
                  return (
                    <button
                      type="button"
                      key={seal.id}
                      onClick={() => handleSealSelect(seal.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        'group flex min-h-[132px] flex-col items-center justify-center gap-xs border p-md text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-wax-red hover:shadow-md',
                        isSelected
                          ? 'border-wax-red bg-wax-red/10 shadow-sm'
                          : 'border-outline-variant bg-surface'
                      )}
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-wax-red/30 bg-wax-red/5 text-3xl text-wax-red transition-transform group-hover:scale-105">
                        {seal.emoji}
                      </span>
                      <span className="font-label-md text-label-md text-primary">{seal.name}</span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 text-wax-red" />}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>

        {/* Dispatch Action */}
        <div className="mt-xxl w-full max-w-md flex flex-col items-center">
          <button
            type="button"
            onClick={handleDispatch}
            disabled={!canDispatch}
            className={cn(
              'w-full hatched-bg border border-primary py-lg px-xl text-center relative overflow-hidden group transition-transform duration-300 hover:-translate-y-1 block',
              !canDispatch && 'opacity-50 cursor-not-allowed'
            )}
          >
            <div className="absolute inset-0 bg-secondary-container transform scale-y-0 origin-bottom transition-transform duration-300 group-hover:scale-y-100 z-0" />
            <div className="relative z-10 flex items-center justify-center space-x-4">
              <span className="font-label-md text-label-md uppercase tracking-widest text-primary group-hover:text-on-secondary-container transition-colors">
                Continue to the send-off
              </span>
              <ArrowRight className="h-4 w-4 text-primary group-hover:text-on-secondary-container transition-colors" />
            </div>
          </button>
          {!selectedSeal ? (
            <p className="mt-sm font-caption text-caption text-on-surface-variant">
              Choose a seal to continue
            </p>
          ) : !hasCompleteAddress ? (
            <p className="mt-sm font-caption text-caption text-on-surface-variant">
              Complete the address above to continue
            </p>
          ) : null}
        </div>
      </main>

    </div>
  );
}
