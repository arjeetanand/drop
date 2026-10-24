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
import { RelayTokenHandoff } from '@/components/RelayTokenHandoff';
import {
  getConsentedCurrentPosition,
  isHandoffQRExpired,
  isWithinHandoffRange,
  parseHandoffQRPayload,
} from '@/lib/gpsUtils';
import { confirmHandoffFromQR, getRelayState } from '@/lib/relayStore';
import { resolveRelayToken, stripRelayTokenQuery } from '@/lib/relayInviteUrl';
import { getLocalAccountId, isCurrentLocalAccount, localAccountStorageKey } from '@/lib/localAccountScope';

type ScanPhase = 'preview' | 'locating' | 'confirmed' | 'expired' | 'invalid' | 'error';

const QR_REPLAY_PREFIX = 'dear-exe:relay-qr-replay:v1:';
const acceptedQrPayloads = new Set<string>();

function replayKey(payload: { letterId: string; pin: string; createdAt: string }) {
  return `${QR_REPLAY_PREFIX}${payload.letterId}:${payload.pin}:${payload.createdAt}`;
}

function hasBeenAccepted(key: string, accountId: string | null) {
  const scopedKey = localAccountStorageKey(key, accountId);
  if (acceptedQrPayloads.has(scopedKey)) return true;
  try {
    return window.localStorage.getItem(scopedKey) === 'accepted';
  } catch {
    return false;
  }
}

function markAccepted(key: string, accountId: string | null) {
  const scopedKey = localAccountStorageKey(key, accountId);
  acceptedQrPayloads.add(scopedKey);
  try {
    window.localStorage.setItem(scopedKey, 'accepted');
  } catch {
    // The in-memory marker still prevents a same-session replay.
  }
}

function ScanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const encoded = searchParams.get('d') ?? '';
  const hasQueryToken = searchParams.has('token');
  const tokenLetterId = searchParams.get('letter') ?? '';
  const tokenDestination = searchParams.get('dest') ?? 'Recipient area';
  const payload = useMemo(() => (encoded ? parseHandoffQRPayload(encoded) : null), [encoded]);

  const [token, setToken] = useState('');
  const [tokenReady, setTokenReady] = useState(false);
  const [rejectedQueryToken, setRejectedQueryToken] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>(encoded ? 'preview' : 'invalid');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [useLocation, setUseLocation] = useState(false);
  const [r2Neighborhood, setR2Neighborhood] = useState('');
  const [locationWasSaved, setLocationWasSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [relay, setRelay] = useState<{ subject: string; recipient: string; currentCarrier: string } | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  // shortcut: blocks repeat submits in this tab only; cross-device replay needs server-backed claims.
  const submittingRef = useRef(false);

  useEffect(() => {
    const resolvedToken = resolveRelayToken(window.location.hash);
    setToken(resolvedToken);
    setRejectedQueryToken(hasQueryToken && !resolvedToken);
    setTokenReady(true);

    if (hasQueryToken) {
      const safeUrl = stripRelayTokenQuery(new URL(window.location.href));
      window.history.replaceState(window.history.state, '', safeUrl);
    }
  }, [hasQueryToken]);

  useEffect(() => {
    setName('');
    setNote('');
    setUseLocation(false);
    setR2Neighborhood('');
    setLocationWasSaved(false);
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
    if (submittingRef.current) return;
    const accountId = getLocalAccountId();

    if (!payload) {
      setPhase('invalid');
      return;
    }

    if (isHandoffQRExpired(payload.createdAt)) {
      setPhase('expired');
      return;
    }

    const qrReplayKey = replayKey(payload);
    if (hasBeenAccepted(qrReplayKey, accountId)) {
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

    submittingRef.current = true;
    setPhase('locating');
    setErrorMsg('');

    try {
      const position = await getConsentedCurrentPosition(useLocation);
      if (position && !isWithinHandoffRange({ lat: payload.lat, lng: payload.lng }, position)) {
        throw new Error('You are more than 50 m from the current carrier. Move closer and try again so the handoff can be verified.');
      }
      const area = r2Neighborhood.trim() || (position ? 'Nearby area' : 'Location not shared');
      if (!isCurrentLocalAccount(accountId)) throw new Error('Your account changed during this handoff. Start again in the active account.');
      setR2Neighborhood(area);
      setLocationWasSaved(Boolean(position));
      if (isHandoffQRExpired(payload.createdAt)) {
        setPhase('expired');
        return;
      }
      confirmHandoffFromQR(
        payload.letterId,
        {
          coords: { lat: payload.lat, lng: payload.lng },
          neighborhood: payload.neighborhood,
          pin: payload.pin,
        },
        {
          name: name.trim(),
          coords: position ?? undefined,
          neighborhood: area,
          note: note.trim() || undefined,
        },
        { subject: payload.subject, recipient: payload.destination },
      );
      markAccepted(qrReplayKey, accountId);
      setPhase('confirmed');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'The GPS handoff could not be completed.');
      setPhase('error');
      focusErrorSummary();
    } finally {
      submittingRef.current = false;
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

  if (!encoded && !token && !tokenReady) {
    return <main className="page-shell"><div className="page-container max-w-3xl"><p className="meta" role="status">Opening your secure carrier invite…</p></div></main>;
  }

  if (rejectedQueryToken && !token) {
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-3xl">
          <p className="eyebrow">Secure carrier invite</p>
          <h1 className="display-title mt-4">Ask for a fresh link.</h1>
          <p className="body-copy mt-5 max-w-2xl text-lg">This invite uses an older URL format. Drop no longer accepts carrier tokens in query parameters. Ask the current carrier to send a new invite link.</p>
          <Link href="/relay" className="button-quiet mt-8"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Relay passport</Link>
        </div>
      </main>
    );
  }

  if (token) {
    const backHref = tokenLetterId
      ? `/relay?letter=${encodeURIComponent(tokenLetterId)}`
      : '/relay?mode=carrier';
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-3xl">
          <header className="page-header flex-col gap-4 sm:flex-row sm:items-end">
            <Link href={backHref} className="button-quiet -ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Relay passport</Link>
            <p className="meta inline-flex items-center gap-2 sm:ml-auto"><QrCode className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> Secure carrier invite</p>
          </header>
          <div className="mt-7 rounded-3xl bg-[#2b45f7] p-5 text-white sm:p-8">
            <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-white/75">A sealed drop is on its way</p>
            <h1 className="mt-3 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">Carry it toward {tokenDestination}.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">The handoff is tied to this one-time invite. You’ll see the route details; the message and media stay private.</p>
          </div>
          <RelayTokenHandoff token={token} destination={tokenDestination} backHref={backHref} method="QR" />
        </div>
      </main>
    );
  }

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
              <h1 className="display-title mt-4">You are about to carry a drop.</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg">
                “<span className="text-ink-navy">{relay?.subject ?? payload.subject}</span>” is moving toward{' '}
                <span className="text-ink-navy">{relay?.recipient ?? payload.destination}</span>. Confirm your name to accept the QR. Location sharing is optional.
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
                  This legacy QR link contains the previous carrier&apos;s handoff coordinates in its URL. Opening it sends that URL to the Drop server. Your own location is separate and optional; if granted, it is used for the 50 m check and saved only in this browser after a successful handoff.
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
                  <label htmlFor="scan-carrier-neighborhood" className="field-label">
                    Neighborhood <span className="font-normal text-on-surface-variant">(optional)</span>
                    <input
                      id="scan-carrier-neighborhood"
                      maxLength={120}
                      value={r2Neighborhood}
                      onChange={(event) => setR2Neighborhood(event.target.value)}
                      className="input-field mt-2"
                      placeholder="Nearby area"
                    />
                  </label>
                  <label htmlFor="scan-use-location" className="flex min-h-12 items-start gap-3 rounded-2xl border border-[rgba(16,42,67,0.12)] bg-white/70 p-3 text-sm leading-relaxed text-on-surface-variant">
                    <input
                      id="scan-use-location"
                      type="checkbox"
                      checked={useLocation}
                      onChange={(event) => setUseLocation(event.target.checked)}
                      className="mt-1 h-5 w-5 shrink-0 accent-[#4f9d7a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2b45f7]"
                    />
                    <span><span className="block font-semibold text-ink-navy">Use my location for this handoff (optional)</span>If granted, your current location is checked here and saved in this browser&apos;s route history after a successful handoff. It is not sent to a geocoding service or the Drop server. You can accept without it.</span>
                  </label>
                </div>
                <button type="submit" disabled={!name.trim()} className="button-primary mt-6 w-full">
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  Accept handoff
                </button>
                <p className="field-help mt-4 inline-flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                  The QR confirms the handoff. Leave this unchecked to avoid a location request.
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
            <p className="eyebrow mt-6 text-[#4f9d7a]">Handoff confirmation</p>
            <h1 className="section-title mt-3">{useLocation ? 'Checking optional location.' : 'Confirming the QR handoff.'}</h1>
            <p className="body-copy mx-auto mt-3 max-w-md text-sm">{useLocation ? 'Your browser checks proximity. If the handoff succeeds, it saves the route point in this browser. If location is denied or unavailable, the QR still completes the handoff.' : 'The QR confirms the handoff. Your current device location is not requested or recorded.'}</p>
          </section>
        )}

        {phase === 'confirmed' && payload && (
          <section className="mt-12 max-w-3xl">
            <p className="sr-only" role="status" aria-live="polite">Handoff confirmed. {locationWasSaved ? 'Your current device location was saved on this device.' : 'Your current device location was not recorded.'}</p>
            <p className="eyebrow text-[#4f9d7a]">Transfer recorded</p>
            <h1 className="display-title mt-4">You have the drop.</h1>
            <p className="body-copy mt-5 max-w-2xl text-lg">
              You are now carrying “<span className="text-ink-navy">{relay?.subject ?? payload.subject}</span>”. The QR confirms the transfer, and the drop stays sealed as it travels toward {payload.destination}.
            </p>

            <div className="panel mt-8 p-5 sm:p-7">
              <div className="flex items-start gap-4">
                <CheckCircle2 className="mt-1 h-6 w-6 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                <div>
                  <h2 className="font-headline-md text-2xl text-ink-navy">Handoff confirmed.</h2>
                  <p className="body-copy mt-3 text-sm">
                    The route includes <span className="text-ink-navy">{payload.neighborhood}</span> and <span className="text-ink-navy">{r2Neighborhood || 'Location not shared'}</span>. {locationWasSaved ? 'Your current GPS point is stored only in this browser and was not sent to a geocoding service or the Drop server.' : 'Your current device location was not recorded.'} The drop remains sealed while it travels toward <span className="text-ink-navy">{payload.destination}</span>.
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
