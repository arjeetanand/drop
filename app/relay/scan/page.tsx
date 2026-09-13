'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  QrCode,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  getCurrentPosition,
  isHandoffQRExpired,
  isWithinHandoffRange,
  parseHandoffQRPayload,
  reverseGeocode,
} from '@/lib/gpsUtils';
import { confirmHandoffFromQR, getRelayState } from '@/lib/relayStore';

type ScanPhase = 'preview' | 'locating' | 'confirmed' | 'expired' | 'invalid' | 'error';

const QR_REPLAY_PREFIX = 'dear-exe:relay-qr-replay:v1:';
const acceptedQrPayloads = new Set<string>();

function replayKey(payload: { letterId: string; pin: string; createdAt: string }) {
  return `${QR_REPLAY_PREFIX}${payload.letterId}:${payload.pin}:${payload.createdAt}`;
}

function hasBeenAccepted(key: string) {
  if (acceptedQrPayloads.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === 'accepted';
  } catch {
    return false;
  }
}

function markAccepted(key: string) {
  acceptedQrPayloads.add(key);
  try {
    window.localStorage.setItem(key, 'accepted');
  } catch {
    // The in-memory marker still prevents a same-session replay.
  }
}

function ScanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const encoded = searchParams.get('d') ?? '';
  const payload = useMemo(() => (encoded ? parseHandoffQRPayload(encoded) : null), [encoded]);

  const [phase, setPhase] = useState<ScanPhase>(encoded ? 'preview' : 'invalid');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [r2Neighborhood, setR2Neighborhood] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [relay, setRelay] = useState<{ subject: string; recipient: string; currentCarrier: string } | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName('');
    setNote('');
    setR2Neighborhood('');
    setErrorMsg('');

    if (!encoded || !payload || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
      setRelay(null);
      setPhase('invalid');
      return;
    }

    if (isHandoffQRExpired(payload.createdAt)) {
      setRelay(null);
      setPhase('expired');
      return;
    }

    const relayState = getRelayState(payload.letterId, {
      subject: payload.subject,
      recipient: payload.destination,
    });
    setRelay({
      subject: relayState.subject,
      recipient: relayState.recipient,
      currentCarrier: relayState.currentCarrierName ?? 'the previous carrier',
    });
    setPhase('preview');
  }, [encoded, payload]);

  const focusErrorSummary = () => {
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
  };

  const handleAccept = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!payload) {
      setPhase('invalid');
      return;
    }

    if (isHandoffQRExpired(payload.createdAt)) {
      setPhase('expired');
      return;
    }

    const qrReplayKey = replayKey(payload);
    if (hasBeenAccepted(qrReplayKey)) {
      setErrorMsg('This handoff code has already been accepted. Ask the current carrier to generate a fresh QR code.');
      setPhase('error');
      focusErrorSummary();
      return;
    }

    if (!name.trim()) {
      setErrorMsg('Enter your name so the new carrier can be recorded.');
      setPhase('error');
      focusErrorSummary();
      return;
    }

    setPhase('locating');
    setErrorMsg('');

    try {
      const position = await getCurrentPosition();
      if (!isWithinHandoffRange({ lat: payload.lat, lng: payload.lng }, position)) {
        throw new Error('You are more than 50 m from the current carrier. Move closer and try again so the handoff can be verified.');
      }
      const area = await reverseGeocode(position);
      setR2Neighborhood(area);
      confirmHandoffFromQR(
        payload.letterId,
        {
          coords: { lat: payload.lat, lng: payload.lng },
          neighborhood: payload.neighborhood,
          pin: payload.pin,
        },
        {
          name: name.trim(),
          coords: position,
          neighborhood: area,
          note: note.trim() || undefined,
        },
        { subject: payload.subject, recipient: payload.destination },
      );
      markAccepted(qrReplayKey);
      setPhase('confirmed');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'The GPS handoff could not be completed.');
      setPhase('error');
      focusErrorSummary();
    }
  };

  const retry = () => {
    setErrorMsg('');
    setPhase('preview');
  };

  const handleCarryIt = () => {
    if (!payload) return;
    router.push(
      `/relay/carry?letter=${encodeURIComponent(payload.letterId)}&name=${encodeURIComponent(name)}&dest=${encodeURIComponent(payload.destination)}&subject=${encodeURIComponent(payload.subject)}`,
    );
  };

  const manualHref = payload
    ? `/relay/handoff?d=${encodeURIComponent(encoded)}&letter=${encodeURIComponent(payload.letterId)}&pin=${encodeURIComponent(payload.pin)}`
    : '/relay/handoff';

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-3xl">
        <header className="page-header flex-col gap-4 sm:flex-row sm:items-end">
          <Link href="/relay" className="button-quiet -ml-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Relay passport
          </Link>
          <p className="meta inline-flex items-center gap-2 sm:ml-auto">
            <QrCode className="h-4 w-4 text-[#4f9d7a]" aria-hidden="true" />
            QR handoff
          </p>
        </header>

        {(phase === 'invalid' || phase === 'expired') && (
          <section className="panel mt-12 p-6 sm:p-8" aria-live="polite">
            <div className="flex items-start gap-4">
              {phase === 'expired' ? (
                <Clock3 className="mt-1 h-6 w-6 shrink-0 text-[#b84b3a]" aria-hidden="true" />
              ) : (
                <AlertCircle className="mt-1 h-6 w-6 shrink-0 text-[#b84b3a]" aria-hidden="true" />
              )}
              <div>
                <p className="eyebrow text-[#b84b3a]">{phase === 'expired' ? 'Fresh code required' : 'Code not recognized'}</p>
                <h1 className="section-title mt-3">{phase === 'expired' ? 'This QR code has expired.' : 'This QR code is not valid.'}</h1>
                <p className="body-copy mt-4 max-w-2xl">
                  {phase === 'expired'
                    ? 'Handoff codes stay valid for ten minutes. Ask the current carrier to generate a new code, or use the manual PIN they gave you.'
                    : 'The link is missing a readable handoff payload. Ask the current carrier to show a fresh QR code or share the manual handoff details.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/relay" className="button-primary">
                    Back to relay passport
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <Link href={manualHref} className="button-secondary">
                    Use manual PIN
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {(phase === 'preview' || phase === 'error') && payload && (
          <>
            <section className="mt-12">
              <p className="eyebrow text-[#4f9d7a]">Seamless handoff</p>
              <h1 className="display-title mt-4">You are about to carry a letter.</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg">
                “<span className="text-ink-navy">{relay?.subject ?? payload.subject}</span>” is moving toward{' '}
                <span className="text-ink-navy">{relay?.recipient ?? payload.destination}</span>. Confirm your name, then allow one GPS stamp to join the relay.
              </p>
            </section>

            {phase === 'error' && (
              <div
                ref={errorSummaryRef}
                tabIndex={-1}
                className="notice error-notice mt-8"
                role="alert"
                aria-live="assertive"
                aria-labelledby="scan-error-title"
              >
                <p id="scan-error-title" className="font-semibold">Handoff could not be completed.</p>
                <p className="mt-1">{errorMsg || 'Try again, or switch to the manual PIN fallback.'}</p>
                <button type="button" onClick={retry} className="button-quiet -ml-2 mt-3">
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </button>
              </div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
              <section className="panel p-5 sm:p-6">
                <p className="eyebrow">Handoff details</p>
                <dl className="mt-5 space-y-4">
                  <div className="border-b border-[rgba(16,42,67,0.12)] pb-4">
                    <dt className="meta">Passing from</dt>
                    <dd className="mt-2 inline-flex items-center gap-2 font-headline-md text-xl text-ink-navy">
                      <MapPin className="h-4 w-4 text-[#b84b3a]" aria-hidden="true" />
                      {payload.neighborhood}
                    </dd>
                  </div>
                  <div className="border-b border-[rgba(16,42,67,0.12)] pb-4">
                    <dt className="meta">Current carrier</dt>
                    <dd className="body-copy mt-2 text-base text-ink-navy">{relay?.currentCarrier ?? 'The previous carrier'}</dd>
                  </div>
                  <div>
                    <dt className="meta">Destination</dt>
                    <dd className="mt-2 inline-flex items-center gap-2 font-headline-md text-xl text-ink-navy">
                      <Navigation className="h-4 w-4 text-[#4f9d7a]" aria-hidden="true" />
                      {payload.destination}
                    </dd>
                  </div>
                </dl>
                <p className="body-copy mt-6 border-t border-[rgba(16,42,67,0.12)] pt-5 text-sm">
                  Your exact location is not shown. The passport records a neighborhood-level waypoint for the journey.
                </p>
              </section>

              <form onSubmit={handleAccept} className="paper-card p-5 sm:p-7">
                <p className="eyebrow">Your carrier log</p>
                <h2 className="section-title mt-3 text-3xl">Add your hand to the route.</h2>
                <div className="mt-6 space-y-5">
                  <label htmlFor="scan-carrier-name" className="field-label">
                    Your name <span className="text-[#b84b3a]">*</span>
                    <input
                      id="scan-carrier-name"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="input-field mt-2"
                      placeholder="Rohan"
                      autoComplete="name"
                      autoFocus
                    />
                  </label>
                  <label htmlFor="scan-carrier-note" className="field-label">
                    Field note <span className="font-normal text-on-surface-variant">(optional)</span>
                    <textarea
                      id="scan-carrier-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="textarea-field mt-2 min-h-[6rem]"
                      placeholder="How did you meet the carrier?"
                    />
                  </label>
                </div>
                <button type="submit" disabled={!name.trim()} className="button-primary mt-6 w-full">
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  Accept and stamp my GPS
                </button>
                <p className="field-help mt-4 inline-flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                  Your neighborhood is recorded, never your exact address.
                </p>
                <Link href={manualHref} className="button-quiet mt-4 w-full">
                  Enter the PIN manually instead
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </form>
            </div>
          </>
        )}

        {phase === 'locating' && (
          <section className="panel mt-12 p-8 text-center" aria-live="polite">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[rgba(79,157,122,0.25)] border-t-[#4f9d7a]" aria-hidden="true" />
            <p className="eyebrow mt-6 text-[#4f9d7a]">GPS confirmation</p>
            <h1 className="section-title mt-3">Stamping your place in the route.</h1>
            <p className="body-copy mx-auto mt-3 max-w-md text-sm">Allow location access when your browser asks. Only the neighborhood name will be saved.</p>
          </section>
        )}

        {phase === 'confirmed' && payload && (
          <section className="mt-12 max-w-3xl">
            <p className="eyebrow text-[#4f9d7a]">Transfer recorded</p>
            <h1 className="display-title mt-4">You have the letter.</h1>
            <p className="body-copy mt-5 max-w-2xl text-lg">
              You are now carrying “<span className="text-ink-navy">{relay?.subject ?? payload.subject}</span>”. The passport has two new GPS waypoints: the handoff point and your acceptance point.
            </p>

            <div className="panel mt-8 p-5 sm:p-7">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="mt-1 h-6 w-6 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                <div>
                  <h2 className="font-headline-md text-2xl text-ink-navy">Handoff confirmed.</h2>
                  <p className="body-copy mt-3 text-sm">
                    The route now includes <span className="text-ink-navy">{payload.neighborhood}</span> and <span className="text-ink-navy">{r2Neighborhood || 'your area'}</span>. The letter remains sealed while it travels toward <span className="text-ink-navy">{payload.destination}</span>.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={handleCarryIt} className="button-primary">
                Open carrier mode
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <Link href={`/relay?letter=${encodeURIComponent(payload.letterId)}`} className="button-secondary">
                View relay passport
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading the QR handoff…</p></div></main>}>
      <ScanContent />
    </Suspense>
  );
}
