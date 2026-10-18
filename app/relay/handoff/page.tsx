'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Fingerprint,
  MapPin,
  Navigation,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react';
import { RelayTokenHandoff } from '@/components/RelayTokenHandoff';
import {
  getCurrentPosition,
  getHandoffPin,
  isHandoffQRExpired,
  isWithinHandoffRange,
  parseHandoffQRPayload,
  reverseGeocode,
  type HandoffQRPayload,
  type LatLng,
} from '@/lib/gpsUtils';
import { confirmHandoff, getRelayState } from '@/lib/relayStore';

type HandoffPhase = 'enter' | 'locating' | 'confirmed' | 'error';
type FieldErrors = Partial<Record<'letterId' | 'pin' | 'name', string>>;

const HANDOFF_REPLAY_PREFIX = 'dear-exe:relay-qr-replay:v1:';
const acceptedHandoffs = new Set<string>();

function replayKey(letterId: string, pin: string, createdAt: string) {
  return `${HANDOFF_REPLAY_PREFIX}${letterId}:${pin}:${createdAt}`;
}

function wasAccepted(key: string) {
  if (acceptedHandoffs.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === 'accepted';
  } catch {
    return false;
  }
}

function markAccepted(key: string) {
  acceptedHandoffs.add(key);
  try {
    window.localStorage.setItem(key, 'accepted');
  } catch {
    // The in-memory marker still prevents a same-session replay.
  }
}

function HandoffContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const encoded = searchParams.get('d') ?? '';
  const token = searchParams.get('token') ?? '';
  const handoffPayload = useMemo<HandoffQRPayload | null>(
    () => (encoded ? parseHandoffQRPayload(encoded) : null),
    [encoded],
  );
  const queryLetterId = searchParams.get('letter') ?? '';
  const queryPin = searchParams.get('pin') ?? '';
  const querySubject = searchParams.get('subject') ?? '';
  const queryDestination = searchParams.get('dest') ?? '';
  const tokenDestination = searchParams.get('dest') ?? 'Recipient area';
  const initialLetterId = queryLetterId || handoffPayload?.letterId || '3';
  const initialPin = queryPin || handoffPayload?.pin || '';

  const [letterId, setLetterId] = useState(initialLetterId);
  const [pin, setPin] = useState(initialPin);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<HandoffPhase>('enter');
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [confirmedRelay, setConfirmedRelay] = useState<{ subject: string; recipient: string } | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLetterId(initialLetterId);
    setPin(initialPin);
    setPhase('enter');
    setErrorMsg('');
    setFieldErrors({});
    setName('');
    setNote('');
  }, [initialLetterId, initialPin]);

  const focusErrorSummary = () => {
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
  };

  const handleConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLetterId = letterId.trim();
    const normalizedPin = pin.trim();
    const normalizedName = name.trim();
    const nextFieldErrors: FieldErrors = {};

    if (!normalizedLetterId) nextFieldErrors.letterId = 'Enter the letter ID.';
    if (!/^\d{4}$/.test(normalizedPin)) nextFieldErrors.pin = 'Enter the four-digit PIN exactly as provided.';
    if (!normalizedName) nextFieldErrors.name = 'Enter your name so the new carrier can be recorded.';

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setErrorMsg('Check the highlighted details before verifying the handoff.');
      setPhase('error');
      focusErrorSummary();
      return;
    }

    setPhase('locating');
    setErrorMsg('');
    setFieldErrors({});

    try {
      let carrierCoords: LatLng;
      let carrierNeighborhood: string;
      let createdAt: string;

      if (handoffPayload) {
        if (handoffPayload.letterId !== normalizedLetterId) {
          throw new Error('The letter ID does not match this handoff code. Use the ID shown by the carrier.');
        }
        if (!Number.isFinite(handoffPayload.lat) || !Number.isFinite(handoffPayload.lng)) {
          throw new Error('The handoff location is not valid. Ask the carrier to generate a fresh code.');
        }
        if (isHandoffQRExpired(handoffPayload.createdAt)) {
          throw new Error('This handoff code has expired. Ask the carrier to generate a fresh QR code or PIN.');
        }
        if (handoffPayload.pin !== normalizedPin) {
          throw new Error('Incorrect PIN. Check the four digits with the current carrier and try again.');
        }
        carrierCoords = { lat: handoffPayload.lat, lng: handoffPayload.lng };
        carrierNeighborhood = handoffPayload.neighborhood;
        createdAt = handoffPayload.createdAt;
      } else {
        const storedPin = getHandoffPin(normalizedLetterId);
        if (!storedPin) {
          throw new Error('No active handoff PIN was found on this device. Ask the carrier to generate a fresh code and share its QR fallback link.');
        }
        if (isHandoffQRExpired(storedPin.createdAt)) {
          throw new Error('This handoff PIN has expired. Ask the carrier to generate a new PIN.');
        }
        if (storedPin.pin !== normalizedPin) {
          throw new Error('Incorrect PIN. Check the four digits with the current carrier and try again.');
        }
        if (!Number.isFinite(storedPin.carrierCoords.lat) || !Number.isFinite(storedPin.carrierCoords.lng)) {
          throw new Error('The handoff location is not available. Ask the carrier to generate a fresh code.');
        }
        carrierCoords = storedPin.carrierCoords;
        carrierNeighborhood = storedPin.neighborhood;
        createdAt = storedPin.createdAt;
      }

      const handoffReplayKey = replayKey(normalizedLetterId, normalizedPin, createdAt);
      if (wasAccepted(handoffReplayKey)) {
        throw new Error('This handoff has already been accepted. Ask the carrier to generate a fresh code.');
      }

      const position = await getCurrentPosition();
      if (!isWithinHandoffRange(carrierCoords, position)) {
        throw new Error('You are more than 50 m from the current carrier. Move closer and try again so the handoff can be verified.');
      }

      const area = await reverseGeocode(position);
      const relay = getRelayState(normalizedLetterId, {
        subject: handoffPayload?.subject || querySubject,
        recipient: handoffPayload?.destination || queryDestination,
      });
      confirmHandoff(
        normalizedLetterId,
        {
          name: normalizedName,
          neighborhood: area,
          coords: position,
          note: note.trim() || undefined,
        },
        { subject: relay.subject, recipient: relay.recipient },
      );
      markAccepted(handoffReplayKey);
      setCoords(position);
      setNeighborhood(area);
      setConfirmedRelay({ subject: relay.subject, recipient: relay.recipient });
      setPhase('confirmed');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'The handoff could not be verified.');
      setPhase('error');
      focusErrorSummary();
    }
  };

  const retry = () => {
    setErrorMsg('');
    setFieldErrors({});
    setPhase('enter');
  };

  const handleCarryIt = () => {
    router.push(
      `/relay/carry?letter=${encodeURIComponent(letterId.trim())}&name=${encodeURIComponent(name.trim())}&dest=${encodeURIComponent(confirmedRelay?.recipient ?? 'Destination')}&subject=${encodeURIComponent(confirmedRelay?.subject ?? '')}`,
    );
  };

  const backHref = letterId.trim()
    ? `/relay?letter=${encodeURIComponent(letterId.trim())}`
    : '/relay';

  if (token) {
    const tokenBackHref = queryLetterId
      ? `/relay?letter=${encodeURIComponent(queryLetterId)}`
      : '/relay?mode=carrier';
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-3xl">
          <header className="page-header flex-col gap-4 sm:flex-row sm:items-end">
            <Link href={tokenBackHref} className="button-quiet -ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Relay passport</Link>
            <p className="meta inline-flex items-center gap-2 sm:ml-auto"><Fingerprint className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> Secure carrier link</p>
          </header>
          <div className="mt-7 rounded-3xl bg-[#2b45f7] p-5 text-white sm:p-8">
            <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-white/75">A sealed drop is on its way</p>
            <h1 className="mt-3 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">Carry it toward {tokenDestination}.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">Add your name to join the route. A neighborhood is optional; the drop’s text and media stay private.</p>
          </div>
          <RelayTokenHandoff token={token} destination={tokenDestination} backHref={tokenBackHref} method="link" />
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-3xl">
        <header className="page-header flex-col gap-4 sm:flex-row sm:items-end">
          <Link href={backHref} className="button-quiet -ml-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Relay passport
          </Link>
          <p className="meta inline-flex items-center gap-2 sm:ml-auto">
            <Fingerprint className="h-4 w-4 text-[#4f9d7a]" aria-hidden="true" />
            Manual verification
          </p>
        </header>

        {(phase === 'enter' || phase === 'error') && (
          <section className="mt-12">
            <p className="eyebrow text-[#b84b3a]">Carrier-issued PIN</p>
            <h1 className="display-title mt-4">Verify the handoff.</h1>
            <p className="body-copy mt-5 max-w-2xl text-lg">
              Enter the letter ID and four-digit PIN the current carrier gave you. We will confirm your GPS is within 50 m of their handoff point before recording the new carrier.
            </p>

            {phase === 'error' && (
              <div
                ref={errorSummaryRef}
                tabIndex={-1}
                className="notice error-notice mt-8"
                role="alert"
                aria-live="assertive"
                aria-labelledby="handoff-error-title"
              >
                <p id="handoff-error-title" className="font-semibold">Handoff could not be verified.</p>
                <p className="mt-1">{errorMsg}</p>
                {Object.keys(fieldErrors).length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5">
                    {fieldErrors.letterId && <li><a className="underline underline-offset-2" href="#handoff-letter-id">Letter ID: {fieldErrors.letterId}</a></li>}
                    {fieldErrors.pin && <li><a className="underline underline-offset-2" href="#handoff-pin">PIN: {fieldErrors.pin}</a></li>}
                    {fieldErrors.name && <li><a className="underline underline-offset-2" href="#handoff-name">Name: {fieldErrors.name}</a></li>}
                  </ul>
                )}
                <button type="button" onClick={retry} className="button-quiet -ml-2 mt-3">
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </button>
              </div>
            )}

            <form onSubmit={handleConfirm} className="paper-card mt-8 p-5 sm:p-7">
              <p className="eyebrow">Handoff details</p>
              <div className="mt-6 space-y-5">
                <label htmlFor="handoff-letter-id" className="field-label">
                  Letter ID <span className="text-[#b84b3a]">*</span>
                  <input
                    id="handoff-letter-id"
                    required
                    value={letterId}
                    onChange={(event) => {
                      setLetterId(event.target.value);
                      setFieldErrors((current) => ({ ...current, letterId: undefined }));
                    }}
                    className="input-field mt-2"
                    placeholder="3"
                    aria-invalid={Boolean(fieldErrors.letterId)}
                    aria-describedby={fieldErrors.letterId ? 'handoff-letter-id-error' : undefined}
                  />
                  {fieldErrors.letterId && <span id="handoff-letter-id-error" className="mt-1 block text-sm font-normal text-[#b84b3a]">{fieldErrors.letterId}</span>}
                </label>

                <label htmlFor="handoff-pin" className="field-label">
                  Four-digit PIN <span className="text-[#b84b3a]">*</span>
                  <input
                    id="handoff-pin"
                    required
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={4}
                    pattern="[0-9]{4}"
                    value={pin}
                    onChange={(event) => {
                      setPin(event.target.value.replace(/\D/g, '').slice(0, 4));
                      setFieldErrors((current) => ({ ...current, pin: undefined }));
                    }}
                    className="input-field mt-2 font-mono text-xl tracking-[0.2em]"
                    placeholder="0000"
                    aria-invalid={Boolean(fieldErrors.pin)}
                    aria-describedby={fieldErrors.pin ? 'handoff-pin-error' : undefined}
                  />
                  {fieldErrors.pin && <span id="handoff-pin-error" className="mt-1 block text-sm font-normal text-[#b84b3a]">{fieldErrors.pin}</span>}
                </label>

                <label htmlFor="handoff-name" className="field-label">
                  Your name <span className="text-[#b84b3a]">*</span>
                  <input
                    id="handoff-name"
                    required
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setFieldErrors((current) => ({ ...current, name: undefined }));
                    }}
                    className="input-field mt-2"
                    placeholder="Rohan"
                    autoComplete="name"
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? 'handoff-name-error' : undefined}
                  />
                  {fieldErrors.name && <span id="handoff-name-error" className="mt-1 block text-sm font-normal text-[#b84b3a]">{fieldErrors.name}</span>}
                </label>

                <label htmlFor="handoff-note" className="field-label">
                  Field note <span className="font-normal text-on-surface-variant">(optional)</span>
                  <textarea
                    id="handoff-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="textarea-field mt-2 min-h-[6rem]"
                    placeholder="How did you receive the letter?"
                  />
                </label>
              </div>

              <button type="submit" className="button-primary mt-6 w-full">
                <Fingerprint className="h-4 w-4" aria-hidden="true" />
                Verify PIN and accept letter
              </button>
              <p className="field-help mt-4 inline-flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                The PIN expires after ten minutes and can only be used once.
              </p>
            </form>

            <div className="panel-muted mt-6 p-5 sm:p-6">
              <p className="eyebrow">If you have the QR link</p>
              <p className="body-copy mt-3 text-sm">
                Open the carrier&apos;s QR fallback link to carry its handoff payload with the PIN. A PIN by itself is accepted only when this browser has the matching carrier-issued record; there is no demo or seeded PIN bypass.
              </p>
              <Link href="/relay" className="button-quiet mt-4 -ml-2">
                Return to relay passport
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        )}

        {phase === 'locating' && (
          <section className="panel mt-12 p-8 text-center" aria-live="polite">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[rgba(79,157,122,0.25)] border-t-[#4f9d7a]" aria-hidden="true" />
            <p className="eyebrow mt-6 text-[#4f9d7a]">GPS verification</p>
            <h1 className="section-title mt-3">Checking the handoff point.</h1>
            <p className="body-copy mx-auto mt-3 max-w-md text-sm">Allow location access when your browser asks. We will record only your neighborhood after the proximity check passes.</p>
          </section>
        )}

        {phase === 'confirmed' && (
          <section className="mt-12 max-w-2xl">
            <p className="eyebrow text-[#4f9d7a]">Transfer recorded</p>
            <h1 className="display-title mt-4">Handoff confirmed.</h1>
            <p className="body-copy mt-5 text-lg">
              You are now carrying “<span className="text-ink-navy">{confirmedRelay?.subject}</span>”. The relay passport has been updated with your neighborhood waypoint.
            </p>

            <div className="panel mt-8 p-5 sm:p-7">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="mt-1 h-6 w-6 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                <div>
                  <h2 className="font-headline-md text-2xl text-ink-navy">Your place in the route is saved.</h2>
                  <p className="body-copy mt-3 text-sm">
                    <span className="inline-flex items-center gap-2 text-ink-navy"><MapPin className="h-4 w-4 text-[#b84b3a]" aria-hidden="true" />{neighborhood || 'Nearby area'}</span>
                    <br />Only the neighborhood is visible to the relay; your exact coordinates are not shown.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={handleCarryIt} className="button-primary">
                Open carrier mode
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <Link href={backHref} className="button-secondary">
                View relay passport
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function HandoffPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading manual verification…</p></div></main>}>
      <HandoffContent />
    </Suspense>
  );
}
