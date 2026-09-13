'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, Sparkles, RotateCw } from 'lucide-react';
import { mockSeals, waxColors, getSealInfo } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { getLetterDraft, saveLetterDraft, type LetterAddress } from '@/lib/letterStore';
import { LetterProgress } from '@/components/LetterProgress';

export default function DestinationAndSealPage() {
  const router = useRouter();
  const [selectedSeal, setSelectedSeal] = useState<string>('heart');
  const [selectedColor, setSelectedColor] = useState<string>('#991b1b');
  const [customMonogram, setCustomMonogram] = useState<string>('E');
  const [envelopeSide, setEnvelopeSide] = useState<'front' | 'back'>('front');
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
    setSelectedSeal(draft.sealId || 'heart');
    setSelectedColor(draft.sealColor || '#991b1b');
    const initialMonogram =
      draft.sealMonogram || (draft.address.name ? draft.address.name.trim()[0]?.toUpperCase() : 'E') || 'E';
    setCustomMonogram(initialMonogram);
    setLetterDetails({ recipient: draft.recipient, subject: draft.subject });
    setReady(true);
  }, []);

  const updateAddress = (field: keyof LetterAddress, value: string) => {
    const nextAddress = { ...address, [field]: value };
    setAddress(nextAddress);
    if (field === 'name' && (!customMonogram || customMonogram === 'E') && value.trim()) {
      setCustomMonogram(value.trim()[0].toUpperCase());
    }
    saveLetterDraft({ address: nextAddress });
  };

  const handleSealSelect = (sealId: string) => {
    setSelectedSeal(sealId);
    saveLetterDraft({ sealId, sealColor: selectedColor, sealMonogram: customMonogram, address });
  };

  const handleColorSelect = (colorHex: string) => {
    setSelectedColor(colorHex);
    saveLetterDraft({ sealId: selectedSeal, sealColor: colorHex, sealMonogram: customMonogram, address });
  };

  const handleMonogramChange = (val: string) => {
    const clean = val.toUpperCase().slice(0, 2);
    setCustomMonogram(clean);
    saveLetterDraft({ sealId: selectedSeal, sealColor: selectedColor, sealMonogram: clean, address });
  };

  const hasCompleteAddress = Boolean(address.name.trim() && address.city.trim() && address.country.trim());
  const canDispatch = ready && Boolean(selectedSeal) && hasCompleteAddress;

  const handleDispatch = () => {
    if (!canDispatch || !selectedSeal) return;
    saveLetterDraft({
      address,
      sealId: selectedSeal,
      sealColor: selectedColor,
      sealMonogram: customMonogram,
      status: 'sealed',
    });
    router.push('/compose/dispatch');
  };

  const currentSealDetails = getSealInfo(selectedSeal, customMonogram, selectedColor);

  return (
    <div className="page-enter min-h-screen flex flex-col bg-surface pb-20">
      {/* Top Header (Static, non-obstructive) */}
      <header className="px-margin-mobile md:px-12 py-5 border-b border-outline-variant/70 bg-surface">
        <div className="max-w-[1240px] mx-auto flex items-center justify-between">
          <Link
            href="/compose"
            className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-caption text-caption uppercase tracking-wider"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Letter</span>
          </Link>
          <h1 className="font-headline-md text-xl md:text-2xl text-primary">Destination & Wax Seal</h1>
          <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant/80 hidden sm:inline">
            Stage 2 of 3
          </span>
        </div>
        <div className="mx-auto mt-4 max-w-[1240px] border-t border-outline-variant/30 pt-3">
          <LetterProgress current="address" />
        </div>
      </header>

      {/* Main Studio Container */}
      <main className="flex-grow w-full max-w-[1240px] mx-auto px-margin-mobile md:px-12 pt-6 md:pt-8">
        {/* Stage Overview Banner */}
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-outline-variant/70 pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">Address & Signet</p>
            <h2 className="mt-1 font-headline-lg text-2xl sm:text-3xl text-ink-navy">
              Where should this letter travel?
            </h2>
            <p className="mt-1 font-body-md text-sm text-on-surface-variant max-w-2xl">
              Write the delivery destination directly on the envelope, then choose the wax seal that binds it shut. Human carriers deliver it hand-to-hand without opening it.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded border border-outline-variant/60 bg-surface-container-lowest px-3.5 py-2 font-caption text-xs text-on-surface-variant self-start sm:self-auto shrink-0">
            <LockKeyhole className="h-3.5 w-3.5 text-mint-accent" />
            <span>&ldquo;{letterDetails.subject || 'Untitled Letter'}&rdquo;</span>
          </div>
        </div>

        {/* 2-Column Responsive Workspace */}
        <div className="grid gap-8 lg:grid-cols-12 items-start">
          {/* LEFT COLUMN: The Physical Postal Envelope with Front/Back View */}
          <div className="lg:col-span-6 flex flex-col">
            {/* View Switcher Controls */}
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="font-caption text-xs uppercase tracking-wider text-on-surface-variant font-medium">
                Physical Stationery Preview
              </span>
              <div className="inline-flex items-center rounded border border-outline-variant/70 bg-surface-container-lowest p-0.5 text-xs font-caption">
                <button
                  type="button"
                  onClick={() => setEnvelopeSide('front')}
                  className={cn(
                    'px-3 py-1 rounded transition-colors',
                    envelopeSide === 'front'
                      ? 'bg-ink-navy text-surface-bright font-semibold'
                      : 'text-on-surface-variant hover:text-ink-navy'
                  )}
                >
                  Envelope Face (Address)
                </button>
                <button
                  type="button"
                  onClick={() => setEnvelopeSide('back')}
                  className={cn(
                    'flex items-center gap-1 px-3 py-1 rounded transition-colors',
                    envelopeSide === 'back'
                      ? 'bg-ink-navy text-surface-bright font-semibold'
                      : 'text-on-surface-variant hover:text-ink-navy'
                  )}
                >
                  <span>Flap (Wax Seal)</span>
                </button>
              </div>
            </div>

            {/* ENVELOPE CONTAINER */}
            <div className="w-full relative rounded-md border border-[#cbbda9] bg-[#faf6ee] shadow-[0_16px_36px_rgba(16,42,67,0.08)] p-6 sm:p-8 min-h-[440px] flex flex-col justify-between transition-all">
              {envelopeSide === 'front' ? (
                /* --- FRONT: POSTAL ENVELOPE FACE --- */
                <div>
                  {/* Top Row: Return Address & Vintage Postage Stamp */}
                  <div className="flex items-start justify-between border-b border-[#102a43]/10 pb-4 mb-5">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-[#102a43]/60">
                        Return Dispatch
                      </p>
                      <p className="font-mono text-xs text-[#102a43]/85">From the writer&apos;s desk</p>
                    </div>
                    {/* Vintage Postage Stamp with Perforations and Postmark */}
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:block text-[#102a43]/40 font-mono text-[10px] select-none tracking-tighter">
                        〰〰〰〰
                      </div>
                      <div className="border-2 border-dashed border-[#b84b3a]/60 bg-[#f4ece1] px-2.5 py-1.5 rounded-xs text-center shadow-xs">
                        <p className="font-mono text-[8px] uppercase tracking-widest text-[#b84b3a] font-bold">
                          RELAY POST
                        </p>
                        <p className="font-mono text-[9px] tracking-wider text-[#102a43] font-semibold">1ST CLASS</p>
                      </div>
                    </div>
                  </div>

                  {/* Addressing Form on Envelope Ruled Lines */}
                  <div className="space-y-4 my-2">
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-[#102a43]/60 mb-1">
                        Recipient Name <span className="text-red-600">*</span>
                      </label>
                      <input
                        className="typewriter-input text-lg font-medium text-[#102a43] placeholder:text-[#102a43]/30"
                        value={address.name}
                        onChange={(e) => updateAddress('name', e.target.value)}
                        placeholder="e.g. Eleanor Hartwell"
                        aria-label="Recipient name"
                        autoComplete="name"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-[#102a43]/60 mb-1">
                        Street Address / Landmark (optional)
                      </label>
                      <input
                        className="typewriter-input text-base text-[#102a43] placeholder:text-[#102a43]/30"
                        value={address.street}
                        onChange={(e) => updateAddress('street', e.target.value)}
                        placeholder="e.g. 14 Willowbrook Lane"
                        aria-label="Street address"
                        autoComplete="street-address"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block font-mono text-[10px] uppercase tracking-wider text-[#102a43]/60 mb-1">
                          City / Village <span className="text-red-600">*</span>
                        </label>
                        <input
                          className="typewriter-input text-base text-[#102a43] placeholder:text-[#102a43]/30"
                          value={address.city}
                          onChange={(e) => updateAddress('city', e.target.value)}
                          placeholder="e.g. Cotswolds Village"
                          aria-label="City"
                          autoComplete="address-level2"
                        />
                      </div>
                      <div>
                        <label className="block font-mono text-[10px] uppercase tracking-wider text-[#102a43]/60 mb-1">
                          Postcode
                        </label>
                        <input
                          className="typewriter-input text-base text-[#102a43] placeholder:text-[#102a43]/30"
                          value={address.postcode}
                          onChange={(e) => updateAddress('postcode', e.target.value)}
                          placeholder="e.g. GL54"
                          aria-label="Postal code"
                          autoComplete="postal-code"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-[#102a43]/60 mb-1">
                        Country <span className="text-red-600">*</span>
                      </label>
                      <input
                        className="typewriter-input text-base text-[#102a43] placeholder:text-[#102a43]/30"
                        value={address.country}
                        onChange={(e) => updateAddress('country', e.target.value)}
                        placeholder="e.g. United Kingdom"
                        aria-label="Country"
                        autoComplete="country-name"
                      />
                    </div>
                  </div>

                  {/* Envelope Bottom Seal Preview Pill */}
                  <div className="mt-8 pt-4 border-t border-[#102a43]/10 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setEnvelopeSide('back')}
                      className="flex items-center gap-2 group text-left cursor-pointer"
                    >
                      <div
                        className="wax-seal-tactile flex h-9 w-9 shrink-0 items-center justify-center text-white shadow-sm transition-transform group-hover:scale-110"
                        style={{ backgroundColor: selectedColor }}
                      >
                        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/30 wax-bezel">
                          <span className="wax-intaglio font-headline-md text-xs select-none">
                            {currentSealDetails.displayMark}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="font-caption text-xs font-semibold text-[#102a43] group-hover:underline flex items-center gap-1">
                          <span>{currentSealDetails.name}</span>
                          <RotateCw className="h-3 w-3 text-on-surface-variant opacity-60" />
                        </p>
                        <p className="font-mono text-[9px] uppercase tracking-wider text-[#102a43]/60">
                          Inspect Seal on Flap
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#102a43]/60">
                      <LockKeyhole className="h-3.5 w-3.5 text-mint-accent" /> Sealed
                    </div>
                  </div>
                </div>
              ) : (
                /* --- BACK: ENVELOPE FLAP & WAX SEAL --- */
                <div className="flex flex-col items-center justify-between h-full py-4 text-center">
                  <div className="w-full flex items-center justify-between border-b border-[#102a43]/10 pb-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-[#102a43]/60">
                      Flap Closure
                    </p>
                    <button
                      type="button"
                      onClick={() => setEnvelopeSide('front')}
                      className="font-mono text-[10px] text-ink-navy hover:underline flex items-center gap-1"
                    >
                      <span>← Flip to Address</span>
                    </button>
                  </div>

                  {/* Envelope Triangular Flap Fold Graphic with Centered Wax Seal */}
                  <div className="my-8 relative w-full max-w-[320px] aspect-[1.5] border border-[#cbbda9] bg-[#f5efe4] rounded shadow-inner flex items-center justify-center overflow-hidden">
                    {/* Diagonal flap lines */}
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(16,42,67,0.12)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(16,42,67,0.12)_50%,transparent_50.5%)] pointer-events-none" />
                    <div className="absolute top-0 left-0 right-0 h-1/2 border-b border-[#102a43]/15 pointer-events-none" />

                    {/* Centered Wax Seal */}
                    <div
                      className="wax-seal-tactile relative z-10 flex h-20 w-20 items-center justify-center text-white shadow-xl transition-transform hover:scale-105"
                      style={{ backgroundColor: selectedColor }}
                    >
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/35 wax-bezel">
                        <span className="wax-intaglio font-headline-md text-2xl select-none">
                          {currentSealDetails.displayMark}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-headline-md text-base text-[#102a43]">{currentSealDetails.name}</h4>
                    <p className="mt-1 font-body-md text-xs italic text-on-surface-variant max-w-xs mx-auto">
                      &ldquo;{currentSealDetails.description}&rdquo;
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEnvelopeSide('front')}
                    className="mt-4 font-caption text-xs text-ink-navy underline"
                  >
                    Return to Address Form
                  </button>
                </div>
              )}
            </div>

            <p className="mt-3 font-caption text-xs text-on-surface-variant text-center">
              Human relay carriers only see the recipient name, city, and country on the envelope face.
            </p>
          </div>

          {/* RIGHT COLUMN: The Wax Seal Atelier & Action Button */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
            <div className="border border-outline-variant/70 bg-surface-container-lowest p-6 rounded-md shadow-sm">
              {/* Atelier Header */}
              <div className="border-b border-outline-variant/60 pb-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-md text-xl text-ink-navy">Choose the Mark</h3>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-amber-accent">
                    6 Signets
                  </span>
                </div>
                <p className="mt-1 font-body-md text-xs text-on-surface-variant">
                  This is the small sign that tells the recipient the letter is truly theirs.
                </p>
              </div>

              {/* Wax Color Palette Selector (Pills with Full Text, No Truncation) */}
              <div className="my-5">
                <label className="block font-caption text-[11px] uppercase tracking-[0.16em] text-on-surface-variant mb-2.5 font-medium">
                  Wax Palette Tone
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                  {waxColors.map((color) => {
                    const isColorActive = selectedColor === color.hex;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => handleColorSelect(color.hex)}
                        className={cn(
                          'flex items-center gap-2.5 rounded border px-3 py-2 font-label-md text-xs transition-all text-left',
                          isColorActive
                            ? 'border-ink-navy bg-ink-navy/5 shadow-xs ring-1 ring-ink-navy text-ink-navy font-semibold'
                            : 'border-outline-variant/60 text-on-surface-variant hover:border-ink-navy/60 hover:text-ink-navy'
                        )}
                      >
                        <span
                          className="h-4 w-4 shrink-0 rounded-full shadow-inner border border-black/20"
                          style={{ backgroundColor: color.hex }}
                        />
                        <span className="whitespace-nowrap">{color.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 6 Curated Brass Seal Matrices in 3x2 Grid */}
              <div>
                <label className="block font-caption text-[11px] uppercase tracking-[0.16em] text-on-surface-variant mb-2.5 font-medium">
                  Signet Die Engraving
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {mockSeals.map((seal) => {
                    const isSelected = selectedSeal === seal.id;
                    const displayGlyph = seal.id === 'monogram' ? customMonogram || 'M' : seal.mark;

                    return (
                      <button
                        type="button"
                        key={seal.id}
                        onClick={() => handleSealSelect(seal.id)}
                        aria-pressed={isSelected}
                        className={cn(
                          'group flex flex-col items-center justify-between border p-3 text-center transition-all duration-200 hover:-translate-y-0.5 rounded-sm',
                          isSelected
                            ? 'border-ink-navy bg-ink-navy/[0.04] ring-1 ring-ink-navy shadow-xs'
                            : 'border-outline-variant/60 bg-surface-container-lowest hover:border-ink-navy/40'
                        )}
                      >
                        <div className="relative my-1">
                          <div
                            className="wax-seal-tactile flex h-11 w-11 items-center justify-center text-white transition-transform group-hover:scale-105"
                            style={{ backgroundColor: selectedColor }}
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 wax-bezel">
                              <span className="wax-intaglio font-headline-md text-sm select-none">
                                {displayGlyph}
                              </span>
                            </div>
                          </div>
                          {isSelected && (
                            <div className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink-navy text-surface-bright shadow">
                              <CheckCircle2 className="h-3 w-3" />
                            </div>
                          )}
                        </div>

                        <div className="mt-2 w-full">
                          <span className="block font-headline-md text-xs font-semibold text-primary truncate">
                            {seal.name}
                          </span>
                          <span className="block font-caption text-[10px] text-amber-accent font-medium truncate">
                            {seal.subtitle}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Monogram Customizer (Appears when Monogram is selected) */}
              {selectedSeal === 'monogram' && (
                <div className="mt-4 border border-outline-variant/70 bg-surface-container-low p-3.5 rounded-sm">
                  <div className="flex items-center gap-1.5 font-caption text-xs uppercase tracking-wider text-amber-accent font-medium">
                    <Sparkles className="h-3.5 w-3.5" /> Bespoke Monogram Die
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="text"
                      maxLength={2}
                      value={customMonogram}
                      onChange={(e) => handleMonogramChange(e.target.value)}
                      className="w-12 h-9 border-2 border-ink-navy bg-surface-container-lowest text-center font-headline-md text-lg uppercase tracking-wider text-ink-navy focus:outline-none focus:ring-1 focus:ring-amber-accent"
                    />
                    <span className="font-caption text-xs text-on-surface-variant">
                      Type 1–2 letters to engrave your custom intaglio monogram.
                    </span>
                  </div>
                </div>
              )}

              {/* Seal Motto Quote */}
              <div className="mt-4 border-t border-outline-variant/50 pt-3">
                <p className="font-body-md text-xs italic text-on-surface-variant text-center">
                  &ldquo;{currentSealDetails.description}&rdquo;
                </p>
              </div>
            </div>

            {/* Action Bar */}
            <div className="border border-outline-variant/70 bg-surface-container-lowest p-5 rounded-md shadow-sm space-y-3">
              <button
                type="button"
                onClick={handleDispatch}
                disabled={!canDispatch}
                className={cn(
                  'w-full bg-ink-navy text-surface-bright py-3.5 px-6 text-center font-label-md text-xs uppercase tracking-widest transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md flex items-center justify-center gap-2 rounded-sm',
                  !canDispatch && 'opacity-45 cursor-not-allowed'
                )}
              >
                <span>Proceed to Wax Ceremony</span>
                <ArrowRight className="h-4 w-4 text-surface-bright" />
              </button>

              <div className="text-center">
                {!hasCompleteAddress ? (
                  <p className="font-caption text-xs text-amber-accent">
                    Please provide recipient name, city, and country on the envelope face.
                  </p>
                ) : (
                  <p className="inline-flex items-center gap-1 font-caption text-xs text-mint-accent">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Envelope addressed and ready for wax ceremony
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
