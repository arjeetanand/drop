'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle, CheckCircle2, MapPin, Navigation, QrCode, Clock,
} from 'lucide-react';
import {
  parseHandoffQRPayload, isHandoffQRExpired,
  getCurrentPosition, reverseGeocode,
  type LatLng,
} from '@/lib/gpsUtils';
import { confirmHandoffFromQR, getRelayState } from '@/lib/relayStore';

type ScanPhase = 'preview' | 'locating' | 'confirmed' | 'expired' | 'invalid' | 'error';

function ScanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const encoded = searchParams.get('d') ?? '';

  const [phase, setPhase] = useState<ScanPhase>('preview');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [r2Neighborhood, setR2Neighborhood] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [relay, setRelay] = useState<{ subject: string; recipient: string; currentCarrier: string } | null>(null);

  // Parse the QR payload once on mount
  const payload = encoded ? parseHandoffQRPayload(encoded) : null;

  useEffect(() => {
    if (!encoded) { setPhase('invalid'); return; }
    if (!payload) { setPhase('invalid'); return; }
    if (isHandoffQRExpired(payload.createdAt)) { setPhase('expired'); return; }
    const relayState = getRelayState(payload.letterId);
    setRelay({
      subject: relayState.subject,
      recipient: relayState.recipient,
      currentCarrier: relayState.currentCarrierName ?? 'the previous carrier',
    });
    setPhase('preview');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded]);

  const handleAccept = async () => {
    if (!name.trim() || !payload) return;
    setPhase('locating');
    setErrorMsg('');
    try {
      const pos = await getCurrentPosition();
      const area = await reverseGeocode(pos);
      setR2Neighborhood(area);
      confirmHandoffFromQR(
        payload.letterId,
        { coords: { lat: payload.lat, lng: payload.lng }, neighborhood: payload.neighborhood, pin: payload.pin },
        { name: name.trim(), coords: pos, neighborhood: area, note: note.trim() || undefined },
        { subject: payload.subject, recipient: payload.destination },
      );
      setPhase('confirmed');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
      setPhase('error');
    }
  };

  const handleCarryIt = () => {
    if (!payload) return;
    router.push(
      '/relay/carry?letter=' + encodeURIComponent(payload.letterId) +
      '&name=' + encodeURIComponent(name) +
      '&dest=' + encodeURIComponent(payload.destination) +
      '&subject=' + encodeURIComponent(payload.subject)
    );
  };

  return (
    <main className="page-enter min-h-screen bg-[#f7f4ee]">
      <header className="sticky top-0 z-40 border-b border-[#102a43]/[0.08] bg-[#fbf9f4]/95 backdrop-blur-md">
        <div className="mx-auto max-w-[640px] flex items-center justify-between px-4 py-3">
          <Link href="/relay" className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-on-surface-variant hover:text-ink-navy transition-colors">
            ← Relay page
          </Link>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            <QrCode className="h-3.5 w-3.5" />
            QR Handoff
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[640px] px-4 py-8 space-y-6">

        {phase === 'invalid' && (
          <div className="flex flex-col items-center text-center py-16 gap-5">
            <div className="h-14 w-14 flex items-center justify-center rounded-full bg-red-50 border border-red-200">
              <AlertCircle className="h-7 w-7 text-red-500" />
            </div>
            <div>
              <h1 className="font-headline-lg text-2xl text-ink-navy">Invalid QR code</h1>
              <p className="mt-2 font-body-md text-sm text-on-surface-variant">
                This link does not contain a valid handoff payload. Ask the carrier to show you a fresh QR code.
              </p>
            </div>
            <Link href="/relay" className="inline-flex items-center gap-2 bg-ink-navy text-white px-5 py-2.5 rounded-xl font-label-md text-xs uppercase tracking-widest hover:bg-ink-navy/90 transition-all">
              Go to relay page
            </Link>
          </div>
        )}

        {phase === 'expired' && (
          <div className="flex flex-col items-center text-center py-16 gap-5">
            <div className="h-14 w-14 flex items-center justify-center rounded-full bg-amber-50 border border-amber-200">
              <Clock className="h-7 w-7 text-amber-500" />
            </div>
            <div>
              <h1 className="font-headline-lg text-2xl text-ink-navy">QR code expired</h1>
              <p className="mt-2 font-body-md text-sm text-on-surface-variant">
                This handoff QR has expired (valid for 10 minutes). Ask the carrier to generate a new one.
              </p>
            </div>
            <Link href="/relay" className="inline-flex items-center gap-2 bg-ink-navy text-white px-5 py-2.5 rounded-xl font-label-md text-xs uppercase tracking-widest hover:bg-ink-navy/90 transition-all">
              Go to relay page
            </Link>
          </div>
        )}

        {phase === 'preview' && payload && (
          <>
            <div>
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-mint-accent/10 border border-mint-accent/30 font-mono text-[10px] uppercase tracking-wider text-mint-accent font-semibold">
                <Navigation className="h-3 w-3" /> QR Handoff
              </span>
              <h1 className="mt-4 font-headline-lg text-3xl md:text-4xl text-ink-navy leading-tight">
                You are about to carry
              </h1>
              <p className="mt-2 font-body-md text-base text-on-surface-variant">
                &ldquo;<strong className="text-ink-navy">{relay?.subject ?? payload.subject}</strong>&rdquo; &mdash; heading to{' '}
                <strong className="text-ink-navy">{payload.destination}</strong>
              </p>
            </div>

            <div className="refero-card rounded-2xl p-5 bg-white space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                Handoff details
              </p>
              <div className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-amber-accent shrink-0 mt-0.5" />
                <div>
                  <p className="font-body-md text-sm text-ink-navy font-semibold">
                    Passing from <span className="font-mono">{payload.neighborhood}</span>
                  </p>
                  <p className="font-mono text-[10px] text-on-surface-variant mt-0.5">
                    Current carrier: {relay?.currentCarrier}
                  </p>
                </div>
              </div>
              <p className="font-body-md text-sm text-on-surface-variant leading-relaxed">
                Carry it as far as you can toward{' '}
                <strong className="text-ink-navy">{payload.destination}</strong>, then pass it on with a new QR.
              </p>
            </div>

            <div className="refero-card rounded-2xl p-6 bg-white space-y-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-accent font-semibold">
                Your carrier log
              </p>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
                  Your name <span className="text-red-500">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="typewriter-input text-lg text-ink-navy w-full"
                  placeholder="e.g. Rohan"
                  autoFocus
                />
              </div>
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5">
                  A carry note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full resize-none rounded-lg border border-[#102a43]/[0.12] bg-[#faf8f4] p-3 font-body-md text-sm text-ink-navy outline-none focus:bg-white focus:border-ink-navy transition-colors min-h-[64px]"
                  placeholder="How did you meet the carrier?"
                />
              </div>
              <button
                onClick={handleAccept}
                disabled={!name.trim()}
                className="w-full flex items-center justify-center gap-2 bg-ink-navy text-white px-6 py-3.5 rounded-xl font-label-md text-xs uppercase tracking-widest hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Navigation className="h-4 w-4 text-mint-accent" />
                Accept &amp; stamp my GPS
              </button>
              <p className="font-mono text-[10px] text-on-surface-variant/50 text-center">
                Your neighborhood will be recorded, never your exact address.
              </p>
            </div>

            <p className="text-center font-mono text-[10px] text-on-surface-variant/50">
              Problems?{' '}
              <Link
                href={'/relay/handoff?letter=' + encodeURIComponent(payload.letterId) + '&pin=' + encodeURIComponent(payload.pin)}
                className="underline underline-offset-2 hover:text-ink-navy"
              >
                Enter PIN manually instead
              </Link>
            </p>
          </>
        )}

        {phase === 'locating' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
            <div className="h-14 w-14 rounded-full border-2 border-mint-accent/30 border-t-mint-accent animate-spin" />
            <div>
              <p className="font-headline-md text-xl text-ink-navy">Stamping your GPS&hellip;</p>
              <p className="mt-2 font-body-md text-sm text-on-surface-variant">
                Please allow location access when your browser asks.
              </p>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1">Transfer failed</p>
                <p className="font-body-md text-sm text-red-700">{errorMsg}</p>
              </div>
            </div>
            <button
              onClick={() => setPhase('preview')}
              className="w-full flex items-center justify-center gap-2 border border-[#102a43]/[0.15] bg-white px-5 py-3 rounded-xl font-label-md text-xs uppercase tracking-widest text-ink-navy hover:bg-[#faf8f4] transition-all"
            >
              Try again
            </button>
          </div>
        )}

        {phase === 'confirmed' && payload && (
          <>
            <div className="flex flex-col items-center text-center pt-6 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-mint-accent/10 border border-mint-accent/30">
                <CheckCircle2 className="h-8 w-8 text-mint-accent" />
              </div>
              <div>
                <h1 className="font-headline-lg text-3xl text-ink-navy">You have the letter</h1>
                <p className="mt-2 font-body-md text-base text-on-surface-variant">
                  You are now carrying{' '}
                  <strong className="text-ink-navy">&ldquo;{relay?.subject ?? payload.subject}&rdquo;</strong>.
                  <br />The relay passport has been updated with two new GPS waypoints.
                </p>
              </div>
            </div>

            <div className="refero-card rounded-2xl p-5 bg-white space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold mb-3">
                GPS waypoints stamped
              </p>
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-amber-accent shrink-0" />
                <div>
                  <p className="font-mono text-xs text-on-surface-variant">Handoff point (carrier location)</p>
                  <p className="font-headline-md text-sm text-ink-navy font-semibold">{payload.neighborhood}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-mint-accent shrink-0" />
                <div>
                  <p className="font-mono text-xs text-on-surface-variant">Your acceptance point</p>
                  <p className="font-headline-md text-sm text-ink-navy font-semibold">{r2Neighborhood || 'Your area'}</p>
                </div>
              </div>
              <p className="font-body-md text-xs text-on-surface-variant leading-relaxed pt-1">
                Only neighborhoods are visible in the relay trail &mdash; never exact addresses.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleCarryIt}
                className="w-full flex items-center justify-center gap-2.5 bg-ink-navy text-white px-6 py-4 rounded-2xl font-label-md text-sm uppercase tracking-widest hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-xl"
              >
                <Navigation className="h-4 w-4 text-mint-accent" />
                Open carrier mode &rarr; start carrying
              </button>
              <Link
                href={'/relay?letter=' + encodeURIComponent(payload.letterId)}
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

export default function ScanPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f7f4ee]" />}>
      <ScanContent />
    </Suspense>
  );
}
