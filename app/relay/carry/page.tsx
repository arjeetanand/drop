'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  ArrowLeft, ArrowRight, MapPin, Navigation, Package,
  Zap, Clock, AlertCircle, CheckCircle2, QrCode, RotateCcw,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import {
  getCurrentPosition, watchPosition, reverseGeocode, formatDistance,
  haversineDistanceKm, generateHandoffPin, storeHandoffPin, clearActiveCarry,
  saveActiveCarry, getActiveCarry,
  buildHandoffQRPayload, type HandoffQRPayload,
  type LatLng,
} from '@/lib/gpsUtils';
import { acceptCarry, getInitialRelayState, getRelayState } from '@/lib/relayStore';

type CarryPhase = 'accepting' | 'locating' | 'carrying' | 'pass-on';

function CarryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter') ?? '3';
  const subjectParam = searchParams.get('subject') ?? 'A letter';
  const destParam = searchParams.get('dest') ?? 'Destination';
  const nameParam = searchParams.get('name') ?? '';

  const [phase, setPhase] = useState<CarryPhase>('accepting');
  const [name, setName] = useState(nameParam);
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [distanceToDestKm, setDistanceToDestKm] = useState<number | null>(null);
  const [movingStatus, setMovingStatus] = useState<'moving' | 'stationary' | 'unknown'>('unknown');
  const [stationaryMinutes, setStationaryMinutes] = useState(0);
  const [pin, setPin] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(600);
  const [transferredTo, setTransferredTo] = useState<string | null>(null);
  const [showManualPin, setShowManualPin] = useState(false);
  const [carryStartTime] = useState(Date.now());

  // Simulated destination coords (Colaba for demo)
  const destCoords: LatLng = { lat: 18.9220, lng: 72.8347 };

  const updateDistance = useCallback((pos: LatLng) => {
    const dist = haversineDistanceKm(pos, destCoords);
    setDistanceToDestKm(dist);
  }, []);

  // Get GPS on accept
  const handleAccept = async () => {
    if (!name.trim()) return;
    setPhase('locating');
    setGpsError('');

    try {
      const pos = await getCurrentPosition();
      setCoords(pos);
      const area = await reverseGeocode(pos);
      setNeighborhood(area);
      updateDistance(pos);

      // Register in relayStore
      acceptCarry(letterId, { name: name.trim(), neighborhood: area, coords: pos, note: note.trim() || undefined });

      // Save active carry to localStorage
      const relay = getRelayState(letterId);
      saveActiveCarry({
        letterId,
        subject: relay.subject,
        recipient: relay.recipient,
        acceptedAt: new Date().toISOString(),
        waypoints: relay.gpsWaypoints ?? [],
        destinationNeighborhood: destParam,
      });

      setPhase('carrying');
    } catch (err) {
      setGpsError(err instanceof Error ? err.message : 'Location error.');
      setPhase('accepting');
    }
  };

  // Watch position while carrying
  useEffect(() => {
    if (phase !== 'carrying') return;

    let lastPos: LatLng | null = null;
    let stationaryTimer: ReturnType<typeof setInterval> | null = null;
    let stationaryCount = 0;

    const stopWatch = watchPosition(
      (pos) => {
        setCoords(pos);
        updateDistance(pos);

        if (lastPos) {
          const moved = haversineDistanceKm(lastPos, pos);
          if (moved > 0.02) {
            setMovingStatus('moving');
            stationaryCount = 0;
            setStationaryMinutes(0);
          } else {
            setMovingStatus('stationary');
          }
        }
        lastPos = pos;
      },
      (err) => setGpsError(err)
    );

    stationaryTimer = setInterval(() => {
      setMovingStatus((prev) => {
        if (prev === 'stationary') {
          stationaryCount++;
          setStationaryMinutes(stationaryCount * 2);
        }
        return prev;
      });
    }, 120000); // every 2 min

    return () => {
      stopWatch();
      if (stationaryTimer) clearInterval(stationaryTimer);
    };
  }, [phase, updateDistance]);

  const generateQrHandoff = useCallback(() => {
    const newPin = generateHandoffPin();
    setPin(newPin);
    const curCoords = coords ?? { lat: 18.9897, lng: 72.8307 };
    const curNeighborhood = neighborhood || 'Transit area';

    storeHandoffPin({
      letterId,
      pin: newPin,
      carrierCoords: curCoords,
      neighborhood: curNeighborhood,
      createdAt: new Date().toISOString(),
    });

    const payload: HandoffQRPayload = {
      letterId,
      pin: newPin,
      lat: curCoords.lat,
      lng: curCoords.lng,
      neighborhood: curNeighborhood,
      subject: subjectParam,
      destination: destParam,
      createdAt: new Date().toISOString(),
    };

    const encoded = buildHandoffQRPayload(payload);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    setQrUrl(`${origin}/relay/scan?d=${encoded}`);
    setQrTimeLeft(600);
    setTransferredTo(null);
  }, [coords, neighborhood, letterId, subjectParam, destParam]);

  const handlePassOn = () => {
    generateQrHandoff();
    setPhase('pass-on');
  };

  // Monitor handoff when in pass-on phase
  useEffect(() => {
    if (phase !== 'pass-on') return;

    const timer = setInterval(() => {
      setQrTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    const poll = setInterval(() => {
      const relay = getRelayState(letterId);
      if (relay.currentCarrierName && relay.currentCarrierName !== name) {
        setTransferredTo(relay.currentCarrierName);
      }
    }, 2500);

    return () => {
      clearInterval(timer);
      clearInterval(poll);
    };
  }, [phase, letterId, name]);

  const handleHandedOff = () => {
    clearActiveCarry();
    router.push(`/relay?letter=${encodeURIComponent(letterId)}`);
  };

  const elapsedMinutes = Math.floor((Date.now() - carryStartTime) / 60000);

  return (
    <main className="page-enter min-h-screen bg-[#f7f4ee]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#102a43]/[0.08] bg-[#fbf9f4]/95 backdrop-blur-md">
        <div className="mx-auto max-w-[640px] flex items-center justify-between px-4 py-3">
          <Link
            href={`/relay?letter=${encodeURIComponent(letterId)}`}
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-on-surface-variant hover:text-ink-navy transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Relay page
          </Link>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
            <span className={cn(
              'h-2 w-2 rounded-full',
              phase === 'carrying' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            )} />
            {phase === 'carrying' ? 'In Transit' : phase === 'pass-on' ? 'Passing On' : 'Carrier Setup'}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[640px] px-4 py-8 space-y-6">

        {/* ── Phase: ACCEPTING ── */}
        {phase === 'accepting' && (
          <>
            <div>
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-mint-accent/10 border border-mint-accent/30 font-mono text-[10px] uppercase tracking-wider text-mint-accent font-semibold">
                <Package className="h-3 w-3" /> You are about to carry a letter
              </span>
              <h1 className="mt-4 font-headline-lg text-3xl md:text-4xl text-ink-navy leading-tight">
                &ldquo;{subjectParam}&rdquo;
              </h1>
              <p className="mt-3 font-body-md text-base text-on-surface-variant leading-relaxed">
                This letter is trying to reach <strong className="text-ink-navy">{destParam}</strong>. You don&apos;t need to go all the way — just carry it as far as you can, then pass it to the next person.
              </p>
            </div>

            <div className="refero-card rounded-2xl p-6 bg-white space-y-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-accent font-semibold mb-3">
                  Carrier Log
                </p>
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
                  className="w-full resize-none rounded-lg border border-[#102a43]/[0.12] bg-[#faf8f4] p-3 font-body-md text-sm text-ink-navy outline-none focus:bg-white focus:border-ink-navy transition-colors min-h-[72px]"
                  placeholder="What were you doing when you agreed to carry this?"
                />
              </div>

              {gpsError && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="font-body-md text-sm text-red-700">{gpsError}</p>
                </div>
              )}

              <button
                onClick={handleAccept}
                disabled={!name.trim()}
                className="w-full flex items-center justify-center gap-2 bg-ink-navy text-white px-6 py-3.5 rounded-xl font-label-md text-xs uppercase tracking-widest hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Navigation className="h-4 w-4 text-mint-accent" />
                Accept — stamp my GPS &amp; start carrying
              </button>
              <p className="font-mono text-[10px] text-on-surface-variant/60 text-center">
                Your neighborhood will be recorded, never your exact address.
              </p>
            </div>

            {/* What happens next */}
            <div className="refero-card rounded-2xl p-5 bg-white/60 border border-[#102a43]/[0.06] space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">What happens next</p>
              {[
                ['GPS stamps your current neighborhood as a waypoint', '①'],
                ['You carry the letter as far as you want — on foot, by auto, or train', '②'],
                ['When ready, generate a 4-digit PIN and give it to the next carrier', '③'],
                ['They enter the PIN in the app — handoff confirmed ✓', '④'],
              ].map(([text, num]) => (
                <div key={num} className="flex items-start gap-3">
                  <span className="font-mono text-xs text-mint-accent shrink-0 mt-0.5">{num}</span>
                  <p className="font-body-md text-sm text-on-surface-variant">{text}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Phase: LOCATING ── */}
        {phase === 'locating' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
            <div className="h-14 w-14 rounded-full border-2 border-mint-accent/30 border-t-mint-accent animate-spin" />
            <div>
              <p className="font-headline-md text-xl text-ink-navy">Finding your location…</p>
              <p className="mt-2 font-body-md text-sm text-on-surface-variant">
                Please allow location access when your browser asks.
              </p>
            </div>
          </div>
        )}

        {/* ── Phase: CARRYING ── */}
        {phase === 'carrying' && (
          <>
            {/* Status card */}
            <div className="refero-card rounded-2xl p-6 bg-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-mint-accent font-semibold">
                    You are carrying
                  </p>
                  <h1 className="mt-1 font-headline-lg text-2xl text-ink-navy">&ldquo;{subjectParam}&rdquo;</h1>
                </div>
                <div className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] uppercase tracking-wider shrink-0',
                  movingStatus === 'moving'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : movingStatus === 'stationary'
                    ? 'bg-amber-50 border border-amber-200 text-amber-700'
                    : 'bg-[#102a43]/5 border border-[#102a43]/10 text-on-surface-variant'
                )}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', movingStatus === 'moving' ? 'bg-emerald-500 animate-pulse' : movingStatus === 'stationary' ? 'bg-amber-500' : 'bg-gray-400')} />
                  {movingStatus === 'moving' ? 'Moving' : movingStatus === 'stationary' ? 'Stationary' : 'GPS watch on'}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-[#faf8f4] p-3.5 text-center">
                  <p className="font-headline-md text-xl text-ink-navy font-bold">
                    {neighborhood || '—'}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">You are in</p>
                </div>
                <div className="rounded-xl bg-[#faf8f4] p-3.5 text-center">
                  <p className="font-headline-md text-xl text-ink-navy font-bold">
                    {distanceToDestKm !== null ? formatDistance(distanceToDestKm) : '—'}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">To {destParam}</p>
                </div>
                <div className="rounded-xl bg-[#faf8f4] p-3.5 text-center">
                  <p className="font-headline-md text-xl text-ink-navy font-bold">
                    {elapsedMinutes}m
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Carrying</p>
                </div>
              </div>

              {/* Direction nudge */}
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-mint-accent/5 border border-mint-accent/20 p-3">
                <Navigation className="h-4 w-4 text-mint-accent shrink-0" />
                <p className="font-body-md text-sm text-on-surface-variant">
                  Head towards <strong className="text-ink-navy">{destParam}</strong>. When you can&apos;t go further, pass it on.
                </p>
              </div>

              {/* Stationary warning */}
              {stationaryMinutes >= 30 && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="font-body-md text-sm text-amber-800">
                    You&apos;ve been stationary for {stationaryMinutes} min. Ready to pass it on to the next carrier?
                  </p>
                </div>
              )}

              {gpsError && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="font-body-md text-sm text-red-700">{gpsError}</p>
                </div>
              )}
            </div>

            {/* Privacy reminder */}
            <div className="refero-card rounded-xl p-4 bg-white/60 border border-[#102a43]/[0.06]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant/60 mb-2">Privacy</p>
              <p className="font-body-md text-sm text-on-surface-variant leading-relaxed">
                Only your <strong className="text-ink-navy">neighborhood name</strong> is logged — never your exact location. The letter contents are sealed; you are only carrying the physical envelope.
              </p>
            </div>

            {/* Pass on CTA */}
            <div className="fixed bottom-6 left-0 right-0 px-4 flex flex-col gap-3 max-w-[640px] mx-auto">
              <button
                onClick={handlePassOn}
                className="w-full flex items-center justify-center gap-2.5 bg-ink-navy text-white px-6 py-4 rounded-2xl font-label-md text-sm uppercase tracking-widest hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-xl"
              >
                <Zap className="h-4 w-4 text-mint-accent" />
                I&apos;m ready to pass it on →
              </button>
            </div>
          </>
        )}

        {/* ── Phase: PASS-ON ── */}
        {phase === 'pass-on' && (
          <>
            {transferredTo ? (
              <div className="flex flex-col items-center text-center py-10 gap-5">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 border-2 border-emerald-500/30 text-emerald-600 shadow-sm animate-bounce">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-mono text-[11px] uppercase tracking-wider font-semibold mb-3">
                    Handoff Confirmed
                  </span>
                  <h1 className="font-headline-lg text-3xl md:text-4xl text-ink-navy">
                    Passed to {transferredTo}!
                  </h1>
                  <p className="mt-2 font-body-md text-base text-on-surface-variant max-w-md mx-auto">
                    Your GPS pinpoint and neighborhood ({neighborhood || 'your area'}) were locked as a completed waypoint. The letter is on its way.
                  </p>
                </div>

                <div className="refero-card rounded-2xl p-6 bg-white w-full max-w-md text-left space-y-3 border border-emerald-100">
                  <div className="flex items-center gap-2 font-mono text-xs text-emerald-700 font-semibold uppercase tracking-wider">
                    <CheckCircle2 className="h-4 w-4" /> Custody Transfer Logged
                  </div>
                  <p className="font-body-md text-sm text-on-surface-variant">
                    Thank you for carrying &ldquo;{subjectParam}&rdquo; closer to {destParam}. Your custody entry is sealed into the passport.
                  </p>
                </div>

                <button
                  onClick={handleHandedOff}
                  className="w-full max-w-md flex items-center justify-center gap-2.5 bg-ink-navy text-white px-6 py-4 rounded-2xl font-label-md text-sm uppercase tracking-widest hover:bg-ink-navy/90 transition-all shadow-xl"
                >
                  View relay passport →
                </button>
              </div>
            ) : (
              <>
                <div>
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-mint-accent/10 border border-mint-accent/30 font-mono text-[10px] uppercase tracking-wider text-mint-accent font-semibold">
                    <QrCode className="h-3 w-3" /> Seamless Handoff
                  </span>
                  <h1 className="mt-4 font-headline-lg text-3xl md:text-4xl text-ink-navy leading-tight">
                    Scan to take the letter
                  </h1>
                  <p className="mt-3 font-body-md text-base text-on-surface-variant">
                    Show this QR code to the next person. When they scan it with their phone camera, both of your GPS pinpoints are captured and the letter transfers seamlessly.
                  </p>
                </div>

                {/* GPS Pinpoint Banner */}
                <div className="refero-card rounded-2xl p-4 bg-white border border-[#102a43]/[0.08] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-accent/10 text-amber-accent shrink-0">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                        Your GPS locked at
                      </p>
                      <p className="font-headline-md text-base text-ink-navy font-bold">
                        {neighborhood || 'Current location'}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-mint-accent/10 text-mint-accent border border-mint-accent/20">
                    Stamped ✓
                  </span>
                </div>

                {/* QR Code Container */}
                <div className="refero-card rounded-3xl p-8 bg-white border border-[#102a43]/[0.1] text-center shadow-lg relative overflow-hidden flex flex-col items-center">
                  <div className="p-4 rounded-2xl bg-[#faf8f4] border border-[#102a43]/[0.08] shadow-inner inline-block">
                    {qrUrl ? (
                      <QRCodeSVG
                        value={qrUrl}
                        size={230}
                        level="M"
                        includeMargin={true}
                        className="rounded-lg"
                      />
                    ) : (
                      <div className="h-[230px] w-[230px] flex items-center justify-center text-xs text-on-surface-variant font-mono">
                        Generating QR...
                      </div>
                    )}
                  </div>

                  {/* Status & Expiry */}
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
                    <div className="inline-flex items-center gap-2 font-mono text-xs text-on-surface-variant">
                      <Clock className="h-3.5 w-3.5 text-amber-accent" />
                      <span>
                        {qrTimeLeft > 0 ? (
                          <>Expires in <strong className="text-ink-navy font-bold">{Math.floor(qrTimeLeft / 60)}:{(qrTimeLeft % 60).toString().padStart(2, '0')}</strong></>
                        ) : (
                          <span className="text-red-500 font-semibold">Expired</span>
                        )}
                      </span>
                    </div>

                    <div className="inline-flex items-center gap-1.5 font-mono text-xs text-mint-accent font-medium">
                      <span className="h-2 w-2 rounded-full bg-mint-accent animate-ping" />
                      <span>Awaiting scan</span>
                    </div>
                  </div>

                  {qrTimeLeft === 0 && (
                    <button
                      onClick={generateQrHandoff}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-ink-navy text-white text-xs font-mono uppercase tracking-wider hover:bg-ink-navy/90 transition-all"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Refresh QR Code
                    </button>
                  )}

                  <p className="mt-4 font-body-md text-xs text-on-surface-variant/70 max-w-xs leading-relaxed">
                    The next carrier does not need to install anything. Their camera app will open the acceptance screen.
                  </p>
                </div>

                {/* Manual Fallback Accordion */}
                <div className="refero-card rounded-2xl p-5 bg-white/70 border border-[#102a43]/[0.06] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold">
                      Camera not working?
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowManualPin((s) => !s)}
                      className="font-mono text-xs text-ink-navy underline underline-offset-2 hover:text-mint-accent"
                    >
                      {showManualPin ? 'Hide PIN fallback' : 'Show manual PIN'}
                    </button>
                  </div>

                  {showManualPin && (
                    <div className="pt-2 border-t border-[#102a43]/[0.06] text-xs text-on-surface-variant space-y-1.5">
                      <p>Tell the carrier to visit <strong className="text-ink-navy font-mono">/relay/handoff</strong></p>
                      <p>Letter ID: <strong className="text-ink-navy font-mono">{letterId}</strong> &bull; PIN: <strong className="text-ink-navy font-mono text-base font-bold text-amber-accent ml-1">{pin}</strong></p>
                    </div>
                  )}
                </div>

                {/* Actions Footer */}
                <div className="pt-4 flex flex-col gap-3 pb-8">
                  <button
                    onClick={handleHandedOff}
                    className="w-full flex items-center justify-center gap-2.5 bg-mint-accent text-white px-6 py-4 rounded-2xl font-label-md text-sm uppercase tracking-widest hover:bg-mint-accent/90 active:scale-[0.99] transition-all shadow-xl"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    They scanned it — I&apos;m done
                  </button>
                  <button
                    onClick={() => setPhase('carrying')}
                    className="w-full text-center font-mono text-xs uppercase tracking-wider text-on-surface-variant/70 hover:text-ink-navy py-2 transition-colors"
                  >
                    ← Actually I&apos;ll keep carrying it
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function CarryPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f7f4ee]" />}>
      <CarryContent />
    </Suspense>
  );
}
