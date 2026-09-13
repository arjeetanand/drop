'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  Package,
  QrCode,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  buildHandoffQRPayload,
  clearActiveCarry,
  formatDistance,
  generateHandoffPin,
  getActiveCarry,
  getCurrentPosition,
  haversineDistanceKm,
  reverseGeocode,
  saveActiveCarry,
  storeHandoffPin,
  watchPosition,
  type HandoffQRPayload,
  type LatLng,
} from '@/lib/gpsUtils';
import { acceptCarry, getInitialRelayState, getRelayState, type RelayState } from '@/lib/relayStore';

type CarryPhase = 'accepting' | 'locating' | 'carrying' | 'pass-on';

const COLABA_COORDS: LatLng = { lat: 18.922, lng: 72.8347 };

function CarryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter') ?? '3';
  const subjectParam = searchParams.get('subject') ?? 'A letter';
  const destParam = searchParams.get('dest') ?? 'Destination';
  const nameParam = searchParams.get('name') ?? '';

  const [phase, setPhase] = useState<CarryPhase>('accepting');
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [name, setName] = useState(nameParam);
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [formError, setFormError] = useState('');
  const [distanceToDestKm, setDistanceToDestKm] = useState<number | null>(null);
  const [movingStatus, setMovingStatus] = useState<'moving' | 'stationary' | 'unknown'>('unknown');
  const [stationaryMinutes, setStationaryMinutes] = useState(0);
  const [pin, setPin] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [handoffToken, setHandoffToken] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(600);
  const [transferredTo, setTransferredTo] = useState<string | null>(null);
  const [showManualPin, setShowManualPin] = useState(false);
  const [carryStartedAt, setCarryStartedAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [watchVersion, setWatchVersion] = useState(0);
  const lastPositionRef = useRef<LatLng | null>(null);
  const lastMovedAtRef = useRef<number | null>(null);

  const destinationCoords = useMemo(
    () => (destParam.trim().toLowerCase() === 'colaba' ? COLABA_COORDS : null),
    [destParam],
  );

  const relayIsLoaded = relay.letterId === letterId;
  const displaySubject = relayIsLoaded ? relay.subject : subjectParam;
  const displayDestination = relayIsLoaded ? relay.destinationNeighborhood || destParam : destParam;
  const displayRecipient = relayIsLoaded ? relay.recipient : destParam;

  useEffect(() => {
    setRelay(getRelayState(letterId, { subject: subjectParam, recipient: destParam }));
  }, [destParam, letterId, subjectParam]);

  useEffect(() => {
    if (nameParam) return;
    const activeCarry = getActiveCarry();
    if (!activeCarry || activeCarry.letterId !== letterId) return;

    const storedRelay = getRelayState(letterId, {
      subject: subjectParam,
      recipient: destParam,
    });
    const latestWaypoint = storedRelay.gpsWaypoints?.at(-1);
    const acceptedAt = new Date(activeCarry.acceptedAt).getTime();

    setRelay(storedRelay);
    setName(storedRelay.currentCarrierName || '');
    if (latestWaypoint) {
      setCoords(latestWaypoint.coords);
      setNeighborhood(latestWaypoint.neighborhood);
      setDistanceToDestKm(destinationCoords ? haversineDistanceKm(latestWaypoint.coords, destinationCoords) : null);
      lastPositionRef.current = latestWaypoint.coords;
    }
    setCarryStartedAt(Number.isFinite(acceptedAt) ? acceptedAt : Date.now());
    setClockNow(Date.now());
    setPhase('carrying');
  }, [destParam, destinationCoords, letterId, nameParam, subjectParam]);

  const updateDistance = useCallback((position: LatLng) => {
    setDistanceToDestKm(destinationCoords ? haversineDistanceKm(position, destinationCoords) : null);
  }, [destinationCoords]);

  const handleAccept = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Enter your name before accepting the letter.');
      return;
    }

    setPhase('locating');
    setGpsError('');
    setFormError('');

    try {
      const position = await getCurrentPosition();
      const area = await reverseGeocode(position);
      const next = acceptCarry(
        letterId,
        {
          name: trimmedName,
          neighborhood: area,
          coords: position,
          note: note.trim() || undefined,
        },
        { subject: subjectParam, recipient: destParam },
      );
      const acceptedAt = new Date().toISOString();

      setRelay(next);
      setCoords(position);
      setNeighborhood(area);
      updateDistance(position);
      setCarryStartedAt(new Date(acceptedAt).getTime());
      setClockNow(Date.now());
      lastPositionRef.current = position;
      lastMovedAtRef.current = Date.now();
      saveActiveCarry({
        letterId,
        subject: next.subject,
        recipient: next.recipient,
        acceptedAt,
        waypoints: next.gpsWaypoints ?? [],
        destinationNeighborhood: next.destinationNeighborhood || destParam,
      });
      setPhase('carrying');
    } catch (error) {
      setGpsError(error instanceof Error ? error.message : 'Location could not be confirmed.');
      setPhase('accepting');
    }
  };

  useEffect(() => {
    if (phase !== 'carrying') return;

    lastMovedAtRef.current = lastMovedAtRef.current ?? Date.now();
    const stopWatch = watchPosition(
      (position) => {
        const previousPosition = lastPositionRef.current;
        if (previousPosition) {
          const movedKm = haversineDistanceKm(previousPosition, position);
          if (movedKm > 0.02) {
            lastMovedAtRef.current = Date.now();
            setMovingStatus('moving');
            setStationaryMinutes(0);
          } else {
            setMovingStatus('stationary');
          }
        }
        lastPositionRef.current = position;
        setCoords(position);
        updateDistance(position);
        setGpsError('');
      },
      (message) => {
        setMovingStatus('unknown');
        setGpsError(`GPS updates paused: ${message} You can keep carrying and retry the watch when ready.`);
      },
    );

    const stationaryTimer = window.setInterval(() => {
      if (!lastMovedAtRef.current) return;
      const minutes = Math.max(0, Math.floor((Date.now() - lastMovedAtRef.current) / 60000));
      setStationaryMinutes(minutes);
      if (minutes >= 2) setMovingStatus('stationary');
    }, 30000);

    return () => {
      stopWatch();
      window.clearInterval(stationaryTimer);
    };
  }, [phase, updateDistance, watchVersion]);

  useEffect(() => {
    if (phase !== 'carrying' || !carryStartedAt) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [carryStartedAt, phase]);

  const generateQrHandoff = useCallback(() => {
    if (!coords) {
      setGpsError('Your current GPS position is not available yet. Retry the GPS watch before generating a handoff.');
      return false;
    }

    const newPin = generateHandoffPin();
    const currentNeighborhood = neighborhood || 'Nearby area';
    const createdAt = new Date().toISOString();
    const payload: HandoffQRPayload = {
      letterId,
      pin: newPin,
      lat: coords.lat,
      lng: coords.lng,
      neighborhood: currentNeighborhood,
      subject: displaySubject,
      destination: displayDestination,
      createdAt,
    };
    const encoded = buildHandoffQRPayload(payload);
    if (!encoded) {
      setGpsError('The handoff code could not be prepared. Please try again.');
      return false;
    }

    storeHandoffPin({
      letterId,
      pin: newPin,
      carrierCoords: coords,
      neighborhood: currentNeighborhood,
      createdAt,
    });
    setPin(newPin);
    setHandoffToken(encoded);
    setQrUrl(`${window.location.origin}/relay/scan?d=${encoded}`);
    setQrTimeLeft(600);
    setTransferredTo(null);
    setGpsError('');
    return true;
  }, [coords, displayDestination, displaySubject, letterId, neighborhood]);

  const handlePassOn = () => {
    if (generateQrHandoff()) setPhase('pass-on');
  };

  useEffect(() => {
    if (phase !== 'pass-on') return;

    const countdown = window.setInterval(() => {
      setQrTimeLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    const poll = window.setInterval(() => {
      const currentRelay = getRelayState(letterId, { subject: displaySubject, recipient: displayRecipient });
      if (currentRelay.currentCarrierName && currentRelay.currentCarrierName !== name.trim()) {
        setTransferredTo(currentRelay.currentCarrierName);
      }
    }, 2500);

    return () => {
      window.clearInterval(countdown);
      window.clearInterval(poll);
    };
  }, [displayRecipient, displaySubject, letterId, name, phase]);

  const handleRetryWatch = () => {
    setGpsError('');
    setWatchVersion((version) => version + 1);
  };

  const handleHandedOff = () => {
    clearActiveCarry();
    router.push(`/relay?letter=${encodeURIComponent(letterId)}`);
  };

  const elapsedMinutes = carryStartedAt && clockNow
    ? Math.max(0, Math.floor((clockNow - carryStartedAt) / 60000))
    : 0;

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-3xl">
        <header className="page-header flex-col gap-4 sm:flex-row sm:items-end">
          <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="button-quiet -ml-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Relay passport
          </Link>
          <p className="meta sm:ml-auto">
            {phase === 'carrying' ? 'Current carry' : phase === 'pass-on' ? 'Ready to pass on' : phase === 'locating' ? 'Confirming GPS' : 'Carrier setup'}
          </p>
        </header>

        {phase === 'accepting' && (
          <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div>
              <p className="eyebrow text-[#4f9d7a]">Accept a relay</p>
              <h1 className="display-title mt-4">“{subjectParam}”</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg">
                This letter is trying to reach <span className="text-ink-navy">{destParam}</span>. You do not need to go all the way—carry it as far as your route allows, then pass it to the next person.
              </p>

              <form onSubmit={handleAccept} className="panel mt-8 p-5 sm:p-7">
                <p className="eyebrow">Carrier log</p>
                <h2 className="section-title mt-3 text-3xl">Add your hand to the journey.</h2>
                <div className="mt-6 space-y-5">
                  <label htmlFor="carry-name" className="field-label">
                    Your name <span className="text-[#b84b3a]">*</span>
                    <input
                      id="carry-name"
                      required
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setFormError('');
                      }}
                      className="input-field mt-2"
                      placeholder="Rohan"
                      autoComplete="name"
                      autoFocus
                    />
                  </label>
                  <label htmlFor="carry-note" className="field-label">
                    Field note <span className="font-normal text-on-surface-variant">(optional)</span>
                    <textarea
                      id="carry-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="textarea-field mt-2 min-h-[6rem]"
                      placeholder="What were you doing when you agreed to carry this?"
                    />
                  </label>
                </div>

                {formError && <p className="notice error-notice mt-5" role="alert" aria-live="assertive">{formError}</p>}
                {gpsError && (
                  <div className="notice error-notice mt-5 flex items-start gap-3" role="alert" aria-live="assertive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>{gpsError}</p>
                  </div>
                )}

                <button type="submit" disabled={!name.trim()} className="button-primary mt-6 w-full">
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  {gpsError ? 'Try GPS again' : 'Accept and stamp my GPS'}
                </button>
                <p className="field-help mt-4 inline-flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                  Only your neighborhood is saved, never your exact address.
                </p>
              </form>
            </div>

            <aside className="paper-card p-5 sm:p-6">
              <p className="eyebrow">The carry loop</p>
              <ol className="mt-5 space-y-5">
                {[
                  ['01', 'Accept', 'Stamp your starting neighborhood.'],
                  ['02', 'Carry', 'Move the sealed letter along your route.'],
                  ['03', 'Pass on', 'Show a new QR code or share the PIN.'],
                  ['04', 'Confirm', 'The next carrier updates the passport.'],
                ].map(([number, title, text]) => (
                  <li key={number} className="border-t border-[rgba(16,42,67,0.12)] pt-4 first:border-t-0 first:pt-0">
                    <span className="meta text-[#b84b3a]">{number}</span>
                    <h2 className="mt-2 font-headline-md text-xl text-ink-navy">{title}</h2>
                    <p className="body-copy mt-1 text-sm">{text}</p>
                  </li>
                ))}
              </ol>
            </aside>
          </section>
        )}

        {phase === 'locating' && (
          <section className="panel mt-12 p-8 text-center" aria-live="polite">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[rgba(79,157,122,0.25)] border-t-[#4f9d7a]" aria-hidden="true" />
            <p className="eyebrow mt-6 text-[#4f9d7a]">GPS confirmation</p>
            <h1 className="section-title mt-3">Finding your place in the route.</h1>
            <p className="body-copy mx-auto mt-3 max-w-md text-sm">Allow location access when your browser asks. Your neighborhood will be recorded as a waypoint.</p>
          </section>
        )}

        {phase === 'carrying' && (
          <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow text-[#4f9d7a]">Current carry</p>
                  <h1 className="display-title mt-4">“{displaySubject}”</h1>
                </div>
                <span className={`status-mark ${movingStatus === 'moving' ? 'success' : 'neutral'}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  {movingStatus === 'moving' ? 'Moving' : movingStatus === 'stationary' ? 'Stationary' : 'GPS watch pending'}
                </span>
              </div>

              <p className="body-copy mt-5 max-w-2xl text-lg">
                You are carrying this sealed letter toward <span className="text-ink-navy">{displayDestination}</span>. Stop whenever your route ends and pass it on.
              </p>

              <div className="mt-8 grid gap-5 border-y border-[rgba(16,42,67,0.13)] py-5 sm:grid-cols-3">
                <div>
                  <p className="font-headline-md text-2xl text-ink-navy">{neighborhood || 'Pending'}</p>
                  <p className="meta mt-1">Your neighborhood</p>
                </div>
                <div className="border-t border-[rgba(16,42,67,0.12)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                  <p className="font-headline-md text-2xl text-ink-navy">{distanceToDestKm !== null ? formatDistance(distanceToDestKm) : 'Not mapped'}</p>
                  <p className="meta mt-1">Approx. to {displayDestination}</p>
                </div>
                <div className="border-t border-[rgba(16,42,67,0.12)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                  <p className="font-headline-md text-2xl text-ink-navy">{elapsedMinutes}m</p>
                  <p className="meta mt-1">Time carrying</p>
                </div>
              </div>

              <p className="notice mt-6 inline-flex items-start gap-3" role="status" aria-live="polite">
                <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                Head toward <span className="text-ink-navy">{displayDestination}</span>. The route is logged at neighborhood level.
              </p>

              {stationaryMinutes >= 30 && (
                <div className="notice error-notice mt-4 flex items-start gap-3" role="status" aria-live="polite">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>You have been stationary for {stationaryMinutes} minutes. If your route is done, pass the letter on.</p>
                </div>
              )}

              {gpsError && (
                <div className="notice error-notice mt-4 flex flex-wrap items-center justify-between gap-3" role="alert" aria-live="assertive">
                  <p className="inline-flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{gpsError}</span>
                  </p>
                  <button type="button" onClick={handleRetryWatch} className="button-quiet">
                    <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                    Retry GPS watch
                  </button>
                </div>
              )}

              <button type="button" onClick={handlePassOn} className="button-primary mt-8 w-full sm:w-auto">
                <QrCode className="h-4 w-4" aria-hidden="true" />
                I am ready to pass it on
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <aside className="panel p-5 sm:p-6">
              <p className="eyebrow">Privacy promise</p>
              <p className="body-copy mt-4 text-sm">
                Carriers see the destination, never the words. GPS is used to name a neighborhood waypoint; exact coordinates stay out of the passport view.
              </p>
              <div className="mt-6 border-t border-[rgba(16,42,67,0.12)] pt-5">
                <p className="meta">Destination</p>
                <p className="mt-2 inline-flex items-center gap-2 font-headline-md text-xl text-ink-navy">
                  <MapPin className="h-4 w-4 text-[#b84b3a]" aria-hidden="true" />
                  {displayDestination}
                </p>
              </div>
            </aside>
          </section>
        )}

        {phase === 'pass-on' && (
          transferredTo ? (
            <section className="mt-12 max-w-2xl">
              <p className="eyebrow text-[#4f9d7a]">Transfer recorded</p>
              <h1 className="display-title mt-4">Passed to {transferredTo}.</h1>
              <p className="body-copy mt-5 text-lg">
                The new carrier has accepted “<span className="text-ink-navy">{displaySubject}</span>”. Your neighborhood waypoint is part of the completed custody chain.
              </p>
              <p className="notice mt-7 inline-flex items-start gap-3" role="status" aria-live="polite">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                Custody transfer confirmed and saved to the relay passport.
              </p>
              <button type="button" onClick={handleHandedOff} className="button-primary mt-7">
                View relay passport
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </section>
          ) : (
            <section className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
              <div>
                <p className="eyebrow text-[#4f9d7a]">Seamless handoff</p>
                <h1 className="display-title mt-4">Show the next carrier this code.</h1>
                <p className="body-copy mt-5 max-w-2xl text-lg">
                  When they scan the QR code, their GPS acceptance and your handoff point are added to the relay together.
                </p>

                <div className="paper-card mt-8 p-6 text-center sm:p-8">
                  <div
                    className="mx-auto flex w-fit max-w-full items-center justify-center border border-[rgba(16,42,67,0.16)] bg-white p-4"
                    role="img"
                    aria-label={`Handoff QR code for ${displaySubject}`}
                  >
                    {qrUrl ? (
                      <QRCodeSVG value={qrUrl} size={220} level="M" includeMargin={false} />
                    ) : (
                      <p className="meta flex h-[220px] w-[220px] items-center justify-center text-center">Preparing the handoff code…</p>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <span className={`status-mark ${qrTimeLeft > 0 ? 'success' : 'neutral'}`}>
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {qrTimeLeft > 0 ? `Expires in ${Math.floor(qrTimeLeft / 60)}:${String(qrTimeLeft % 60).padStart(2, '0')}` : 'Code expired'}
                    </span>
                    <span className="status-mark neutral" role="status" aria-live="polite">
                      Awaiting scan
                    </span>
                  </div>

                  {qrTimeLeft === 0 && (
                    <button type="button" onClick={generateQrHandoff} className="button-secondary mt-5">
                      <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                      Generate a fresh code
                    </button>
                  )}

                  <p className="field-help mx-auto mt-5 max-w-md">The code is valid for ten minutes. The next carrier can use their phone camera without installing anything.</p>
                </div>

                <div className="panel mt-6 p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="eyebrow">Camera fallback</p>
                      <p className="body-copy mt-2 text-sm">If the camera cannot read the code, share the letter ID and PIN instead.</p>
                    </div>
                    <button type="button" onClick={() => setShowManualPin((current) => !current)} className="button-secondary">
                      {showManualPin ? 'Hide PIN' : 'Show PIN'}
                    </button>
                  </div>
                  {showManualPin && (
                    <div className="mt-5 border-t border-[rgba(16,42,67,0.12)] pt-5" aria-live="polite">
                      <p className="meta">Open /relay/handoff</p>
                      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="meta">Letter ID</dt>
                          <dd className="mt-1 font-mono text-lg font-bold text-ink-navy">{letterId}</dd>
                        </div>
                        <div>
                          <dt className="meta">Four-digit PIN</dt>
                          <dd className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-[#b84b3a]">{pin}</dd>
                        </div>
                      </dl>
                      <Link
                        href={handoffToken
                          ? `/relay/handoff?d=${encodeURIComponent(handoffToken)}&letter=${encodeURIComponent(letterId)}&pin=${encodeURIComponent(pin)}`
                          : `/relay/handoff?letter=${encodeURIComponent(letterId)}&pin=${encodeURIComponent(pin)}`}
                        className="button-quiet mt-4 -ml-2"
                      >
                        Open the manual handoff page
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  )}
                </div>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={handleHandedOff} className="button-secondary">
                    They accepted it—finish my carry
                  </button>
                  <button type="button" onClick={() => setPhase('carrying')} className="button-quiet">
                    Keep carrying
                  </button>
                </div>
              </div>

              <aside className="panel p-5 sm:p-6">
                <p className="eyebrow">Your handoff point</p>
                <p className="mt-3 inline-flex items-center gap-2 font-headline-md text-xl text-ink-navy">
                  <MapPin className="h-4 w-4 text-[#b84b3a]" aria-hidden="true" />
                  {neighborhood || 'Nearby area'}
                </p>
                <p className="body-copy mt-4 text-sm">This neighborhood is stamped into the QR payload so the passport can show where the letter changed hands.</p>
                <div className="mt-6 border-t border-[rgba(16,42,67,0.12)] pt-5">
                  <p className="meta">Destination</p>
                  <p className="mt-2 font-headline-md text-xl text-ink-navy">{displayDestination}</p>
                </div>
              </aside>
            </section>
          )
        )}
      </div>
    </main>
  );
}

export default function CarryPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading carrier mode…</p></div></main>}>
      <CarryContent />
    </Suspense>
  );
}
