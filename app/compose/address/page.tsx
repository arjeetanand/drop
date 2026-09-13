'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react';
import { LetterProgress } from '@/components/LetterProgress';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { SealMark } from '@/components/SealMark';
import { getSealInfo, mockSeals, waxColors } from '@/data/mockData';
import { getLetterDraft, saveLetterDraft, type LetterAddress } from '@/lib/letterStore';
import { cn } from '@/lib/utils';

export default function DestinationAndSealPage() {
  const router = useRouter();
  const [selectedSeal, setSelectedSeal] = useState('heart');
  const [selectedColor, setSelectedColor] = useState('#b84b3a');
  const [customMonogram, setCustomMonogram] = useState('E');
  const [envelopeSide, setEnvelopeSide] = useState<'front' | 'back'>('front');
  const [ready, setReady] = useState(false);
  const [letterDetails, setLetterDetails] = useState({ recipient: '', subject: '' });
  const [address, setAddress] = useState<LetterAddress>({ name: '', street: '', city: '', postcode: '', country: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const draft = getLetterDraft();
    setAddress(draft.address);
    setSelectedSeal(draft.sealId || 'heart');
    setSelectedColor(draft.sealColor || '#b84b3a');
    setCustomMonogram(draft.sealMonogram || draft.address.name.trim().charAt(0).toUpperCase() || 'E');
    setLetterDetails({ recipient: draft.recipient, subject: draft.subject });
    setReady(true);
  }, []);

  const updateAddress = (field: keyof LetterAddress, value: string) => {
    const nextAddress = { ...address, [field]: value };
    setAddress(nextAddress);
    saveLetterDraft({ address: nextAddress });
  };

  const updateSeal = (sealId: string) => {
    setSelectedSeal(sealId);
    saveLetterDraft({ sealId, sealColor: selectedColor, sealMonogram: customMonogram, address });
  };

  const updateColor = (colorHex: string) => {
    setSelectedColor(colorHex);
    saveLetterDraft({ sealId: selectedSeal, sealColor: colorHex, sealMonogram: customMonogram, address });
  };

  const updateMonogram = (value: string) => {
    const next = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    setCustomMonogram(next);
    saveLetterDraft({ sealId: selectedSeal, sealColor: selectedColor, sealMonogram: next, address });
  };

  const hasCompleteAddress = Boolean(address.name.trim() && address.city.trim() && address.country.trim());
  const canContinue = ready && Boolean(selectedSeal) && hasCompleteAddress;
  const currentSeal = getSealInfo(selectedSeal, customMonogram, selectedColor);

  const handleContinue = () => {
    if (!canContinue) {
      setError('Add the recipient name, city, and country before continuing.');
      return;
    }
    setError('');
    saveLetterDraft({ address, sealId: selectedSeal, sealColor: selectedColor, sealMonogram: customMonogram, status: 'sealed' });
    router.push('/compose/dispatch');
  };

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[1060px]">
        <header className="page-header flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/compose" className="button-quiet -ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to letter</Link>
            <div className="meta inline-flex items-center gap-2"><LockKeyhole className="h-3.5 w-3.5 text-[#4f9d7a]" aria-hidden="true" /> Private until delivery</div>
          </div>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Address & seal</p>
              <h1 className="section-title mt-3">Give the letter somewhere to go.</h1>
              <p className="body-copy mt-3 max-w-xl">Add a destination that carriers can follow, then choose the small mark that closes the envelope.</p>
            </div>
            <LetterProgress current="address" />
          </div>
        </header>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <section className="min-w-0">
            <div className="panel p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4 border-b border-[rgba(16,42,67,0.12)] pb-5">
                <div>
                  <p className="eyebrow">Envelope face</p>
                  <h2 className="mt-2 font-headline-md text-2xl text-ink-navy">Where should it travel?</h2>
                </div>
                <span className="meta">“{letterDetails.subject || 'Untitled letter'}”</span>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="field-label sm:col-span-2" htmlFor="address-name">Recipient name <span className="text-[#b84b3a]">*</span>
                  <input id="address-name" className="input-field mt-2" value={address.name} onChange={(event) => updateAddress('name', event.target.value)} placeholder="Eleanor Hartwell" autoComplete="shipping name" />
                </label>
                <label className="field-label sm:col-span-2" htmlFor="address-street">Street address <span className="font-normal text-on-surface-variant">(optional)</span>
                  <input id="address-street" className="input-field mt-2" value={address.street} onChange={(event) => updateAddress('street', event.target.value)} placeholder="14 Willowbrook Lane" autoComplete="shipping street-address" />
                </label>
                <label className="field-label" htmlFor="address-city">City or town <span className="text-[#b84b3a]">*</span>
                  <input id="address-city" className="input-field mt-2" value={address.city} onChange={(event) => updateAddress('city', event.target.value)} placeholder="Cotswolds Village" autoComplete="shipping address-level2" />
                </label>
                <label className="field-label" htmlFor="address-postcode">Postcode <span className="font-normal text-on-surface-variant">(optional)</span>
                  <input id="address-postcode" className="input-field mt-2" value={address.postcode} onChange={(event) => updateAddress('postcode', event.target.value)} placeholder="GL54 1AB" autoComplete="shipping postal-code" />
                </label>
                <label className="field-label sm:col-span-2" htmlFor="address-country">Country <span className="text-[#b84b3a]">*</span>
                  <input id="address-country" className="input-field mt-2" value={address.country} onChange={(event) => updateAddress('country', event.target.value)} placeholder="United Kingdom" autoComplete="shipping country-name" />
                </label>
              </div>
              <p className="field-help mt-5 border-t border-[rgba(16,42,67,0.1)] pt-4">Carriers see the destination, not your letter. You can use a neighborhood or broad destination if you prefer.</p>
            </div>

            <div className="mt-6 flex items-center justify-between gap-4">
              <p className="eyebrow">Preview</p>
              <div className="flex items-center gap-1 border border-[rgba(16,42,67,0.15)] bg-white/55 p-1" role="group" aria-label="Envelope preview side">
                <button type="button" aria-pressed={envelopeSide === 'front'} onClick={() => setEnvelopeSide('front')} className={cn('min-h-11 px-3 text-xs font-bold', envelopeSide === 'front' ? 'bg-ink-navy text-white' : 'text-on-surface-variant hover:text-ink-navy')}>Address</button>
                <button type="button" aria-pressed={envelopeSide === 'back'} onClick={() => setEnvelopeSide('back')} className={cn('min-h-11 px-3 text-xs font-bold', envelopeSide === 'back' ? 'bg-ink-navy text-white' : 'text-on-surface-variant hover:text-ink-navy')}>Seal</button>
              </div>
            </div>
            <div className="paper-card mt-3 min-h-[300px] p-6 sm:p-10">
              {envelopeSide === 'front' ? (
                <div className="flex min-h-[250px] flex-col justify-between">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="meta">To</p>
                      <p className="mt-2 font-headline-md text-2xl text-ink-navy">{address.name || 'Recipient name'}</p>
                    </div>
                    <p className="meta text-right">Dear.exe<br />human relay</p>
                  </div>
                  <div className="border-t border-[rgba(16,42,67,0.12)] pt-5 font-literata text-lg leading-relaxed text-ink-navy">
                    <p>{address.street || 'Street or neighborhood'}</p>
                    <p>{address.city || 'City or town'}{address.postcode ? ` · ${address.postcode}` : ''}</p>
                    <p>{address.country || 'Country'}</p>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[250px] flex-col items-center justify-center gap-5 text-center">
                  <RelayEnvelope compact sealId={selectedSeal} sealMark={selectedSeal === 'monogram' ? customMonogram : currentSeal.displayMark} sealColor={selectedColor} />
                  <p className="meta">{currentSeal.name} · sealed on the back</p>
                </div>
              )}
            </div>
          </section>

          <aside className="min-w-0">
            <div className="panel p-5 sm:p-7">
              <div className="border-b border-[rgba(16,42,67,0.12)] pb-5">
                <p className="eyebrow">Choose a signet</p>
                <h2 className="mt-2 font-headline-md text-2xl text-ink-navy">What should close it?</h2>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">A small visual promise that the contents have not been opened on the way.</p>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Choose wax color">
                {waxColors.map((color) => (
                  <button key={color.id} type="button" aria-pressed={selectedColor === color.hex} onClick={() => updateColor(color.hex)} className={cn('flex min-h-11 items-center gap-2 border px-3 text-left text-xs font-semibold transition-colors', selectedColor === color.hex ? 'border-ink-navy bg-ink-navy/5 text-ink-navy' : 'border-[rgba(16,42,67,0.14)] text-on-surface-variant hover:border-ink-navy/40 hover:bg-white')}>
                    <span className="h-4 w-4 shrink-0 rounded-full border border-black/15" style={{ backgroundColor: color.hex }} aria-hidden="true" />
                    {color.name.replace('Antique ', '').replace('Crimson ', '')}
                  </button>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {mockSeals.map((seal) => {
                  const selected = selectedSeal === seal.id;
                  const mark = seal.id === 'monogram' ? customMonogram || 'M' : seal.id.slice(0, 1).toUpperCase();
                  return (
                    <button key={seal.id} type="button" aria-pressed={selected} onClick={() => updateSeal(seal.id)} className={cn('relative flex min-h-[112px] flex-col items-center justify-center gap-2 border px-2 py-3 text-center transition-colors', selected ? 'border-ink-navy bg-ink-navy/5' : 'border-[rgba(16,42,67,0.14)] hover:border-ink-navy/40 hover:bg-white')}>
                      <SealMark sealId={seal.id} mark={mark} color={selectedColor} size="sm" />
                      <span className="text-xs font-bold leading-tight text-ink-navy">{seal.name}</span>
                      {selected && <span className="absolute right-2 top-2 text-[#4f9d7a]"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>}
                    </button>
                  );
                })}
              </div>
              {selectedSeal === 'monogram' && (
                <label htmlFor="monogram" className="field-label mt-5">Monogram
                  <input id="monogram" value={customMonogram} onChange={(event) => updateMonogram(event.target.value)} maxLength={2} className="input-field mt-2 uppercase" placeholder="EH" />
                  <span className="field-help mt-1 block">One or two letters pressed into the seal.</span>
                </label>
              )}
              <div className="mt-6 border-t border-[rgba(16,42,67,0.1)] pt-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#276a4d]"><LockKeyhole className="h-4 w-4" aria-hidden="true" /> Contents remain private in transit</div>
              </div>
            </div>
            {error && <p className="notice error-notice mt-4" role="alert">{error}</p>}
            <button type="button" onClick={handleContinue} disabled={!ready} className="button-primary mt-5 w-full justify-between px-5">
              Continue to dispatch <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="field-help mt-3 text-center">You can return and change the address or signet at any time.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
