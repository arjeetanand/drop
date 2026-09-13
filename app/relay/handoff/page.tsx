'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, AlertCircle, Fingerprint, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getCurrentPosition, reverseGeocode, getHandoffPin,
  type LatLng,
} from '@/lib/gpsUtils';
import { confirmHandoff, getRelayState } from '@/lib/relayStore';

type HandoffPhase = 'enter' | 'locating' | 'confirmed' | 'error';

function HandoffContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillLetterId = searchParams.get('letter') ?? '';
  const prefillPin = searchParams.get('pin') ?? '';

  const [letterId, setLetterId] = useState(prefillLetterId);
  const [pin, setPin] = useState(prefillPin);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<HandoffPhase>('enter');
  const [errorMsg, setErrorMsg] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [confirmedRelay, setConfirmedRelay] = useState<{ subject: string; recipient: string } | null>(null);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!letterId.trim() || !pin.trim() || !name.trim()) return;

    setPhase('locating');
    setErrorMsg('');

    try {
      // Get carrier's current GPS
      const pos = await getCurrentPosition();
      setCoords(pos);
      const area = await reverseGeocode(pos);
      setNeighborhood(area);

      // Verify PIN
      const stored = getHandoffPin(letterId.trim());

      if (!stored) {
        // Demo mode: accept any 4-digit PIN for the seeded letter
        if (letterId.trim() === '3' && /^\d{4}$/.test(pin.trim())) {
          // Accept in demo mode
        } else {
          throw new Error('No active handoff PIN found for this letter. Ask the current carrier to generate one.');
        }
      } else if (stored.pin !== pin.trim()) {
        throw new Error(`Incorrect PIN. Double-check with the carrier — it is a 4-digit number.`);
      }

      // Record the handoff
      const relay = getRelayState(letterId.trim());
      confirmHandoff(
        letterId.trim(),
        { name: name.trim(), neighborhood: area, coords: pos, note: note.trim() || undefined },
        { subject: relay.subject, recipient: relay.recipient }
      );

      setConfirmedRelay({ subject: relay.subject, recipient: relay.recipient });
      setPhase('confirmed');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed.');
      setPhase('error');
    }
  };

  const handleCarryIt = () => {
    router.push(
      `/relay/carry?letter=${encodeURIComponent(letterId)}&name=${encodeURIComponent(name)}&dest=${encodeURIComponent(confirmedRelay?.recipient ?? 'Destination')}&subject=${encodeURIComponent(confirmedRelay?.subject ?? '')}`
    );
  };

  return (
    <main className="page-enter min-h-screen bg-[#f7f4ee]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#102a43]/[0.08] bg-[#fbf9f4]/95 backdrop-blur-md">
        <div className="mx-auto max-w-[640px] flex items-center justify-between px-4 py-3">
          <Link
            href="/relay"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-on-surface-variant hover:text-ink-navy transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Relay page
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            Handoff Verification
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[640px] px-4 py-8 space-y-6">

        {/* ── ENTER PIN ── */}
        {(phase === 'enter' || phase === 'error') && (
          <>
            <div>
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-accent/10 border border-amber-accent/30 font-mono text-[10px] uppercase tracking-wider text-amber-accent font-semibold">
                <Fingerprint className="h-3 w-3" /> Manual Handoff Fallback
              </span>
              <h1 className="mt-4 font-headline-lg text-3xl text-ink-navy leading-tight">
                Verify with PIN
              </h1>
              <p className="mt-3 font-body-md text-base text-on-surface-variant leading-relaxed">
                If camera QR scanning isn&apos;t available, you can enter the 4-digit PIN provided by the carrier to accept the letter.
              </p>
            </div>

            <div className="refero-card rounded-2xl p-4 bg-mint-accent/5 border border-mint-accent/20 flex items-center justify-between gap-3">
              <p className="font-body-md text-xs text-on-surface-variant">
                <strong>Tip:</strong> Scanning the carrier&apos;s on-screen QR code is instant &mdash; no PIN or ID typing needed!
              </p>
            </div>

            {phase === 'error' && (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1">Verification failed</p>
                  <p className="font-body-md text-sm text-red-700">{errorMsg}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleConfirm} className="refero-card rounded-2xl p-6 bg-white space-y-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-accent font-semibold mb-4">
                  Handoff details
                </p>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
                  Letter ID
                </label>
                <input
                  value={letterId}
                  onChange={(e) => setLetterId(e.target.value)}
                  required
                  className="typewriter-input text-lg text-ink-navy w-full font-mono"
                  placeholder="e.g. 3 or MORNING-LIGHT"
                />
              </div>

              {/* PIN boxes */}
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                  4-digit PIN <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <input
                      key={i}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={pin[i] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        const arr = (pin + '    ').split('').slice(0, 4);
                        arr[i] = val.slice(-1);
                        const next = arr.join('').trim().slice(0, 4);
                        setPin(next);
                        // Auto-focus next box
                        if (val && i < 3) {
                          const nextInput = document.querySelector<HTMLInputElement>(`[data-pin="${i + 1}"]`);
                          nextInput?.focus();
                        }
                      }}
                      data-pin={i}
                      className="h-14 w-full rounded-xl border-2 border-[#102a43]/[0.12] bg-[#faf8f4] text-center font-headline-lg text-2xl text-ink-navy font-bold outline-none focus:border-ink-navy focus:bg-white transition-colors"
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
                    Your name <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="typewriter-input text-base text-ink-navy w-full"
                    placeholder="e.g. Kavya"
                  />
                </div>
                <div>
                  <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
                    A carry note (optional)
                  </label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="typewriter-input text-base text-ink-navy w-full"
                    placeholder="How did you receive it?"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!letterId.trim() || pin.length < 4 || !name.trim()}
                className="w-full flex items-center justify-center gap-2 bg-ink-navy text-white px-6 py-3.5 rounded-xl font-label-md text-xs uppercase tracking-widest hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Fingerprint className="h-4 w-4 text-mint-accent" />
                Verify PIN &amp; accept letter
              </button>

              <p className="font-mono text-[10px] text-on-surface-variant/50 text-center">
                GPS will confirm you are nearby the current carrier.
              </p>
            </form>
          </>
        )}

        {/* ── LOCATING ── */}
        {phase === 'locating' && (
          <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
            <div className="h-14 w-14 rounded-full border-2 border-amber-accent/30 border-t-amber-accent animate-spin" />
            <div>
              <p className="font-headline-md text-xl text-ink-navy">Verifying handoff…</p>
              <p className="mt-2 font-body-md text-sm text-on-surface-variant">
                Checking your GPS and the carrier PIN.
              </p>
            </div>
          </div>
        )}

        {/* ── CONFIRMED ── */}
        {phase === 'confirmed' && (
          <>
            <div className="flex flex-col items-center text-center pt-6 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-mint-accent/10 border border-mint-accent/30">
                <CheckCircle2 className="h-8 w-8 text-mint-accent" />
              </div>
              <div>
                <h1 className="font-headline-lg text-3xl text-ink-navy">Handoff confirmed</h1>
                <p className="mt-2 font-body-md text-base text-on-surface-variant">
                  You are now carrying <strong className="text-ink-navy">&ldquo;{confirmedRelay?.subject}&rdquo;</strong>.<br />
                  The relay passport has been updated.
                </p>
              </div>
            </div>

            {/* GPS stamp confirmation */}
            <div className="refero-card rounded-2xl p-5 bg-white">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-8 w-8 flex items-center justify-center rounded-full bg-mint-accent/10 border border-mint-accent/30">
                  <MapPin className="h-4 w-4 text-mint-accent" />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">GPS waypoint stamped</p>
                  <p className="font-headline-md text-base text-ink-navy">{neighborhood || 'Your area'}</p>
                </div>
              </div>
              <p className="font-body-md text-sm text-on-surface-variant leading-relaxed">
                Your neighborhood has been added to the letter&apos;s journey trail. The sender and recipient can see the route the letter is taking — never the exact addresses.
              </p>
            </div>

            {/* What happens to previous carrier */}
            <div className="refero-card rounded-xl p-4 bg-white/60 border border-[#102a43]/[0.06]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold mb-2">
                Previous carrier
              </p>
              <p className="font-body-md text-sm text-on-surface-variant">
                The person who gave you this letter has been recorded in the custody chain. Their carry is complete — they get a badge for it.
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={handleCarryIt}
                className="w-full flex items-center justify-center gap-2 bg-ink-navy text-white px-6 py-4 rounded-2xl font-label-md text-sm uppercase tracking-widest hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-xl"
              >
                Open carrier mode → start carrying
              </button>
              <Link
                href={`/relay?letter=${encodeURIComponent(letterId)}`}
                className="w-full text-center font-mono text-xs uppercase tracking-wider text-on-surface-variant/60 py-2"
              >
                View relay passport
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function HandoffPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f7f4ee]" />}>
      <HandoffContent />
    </Suspense>
  );
}
