'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MapPin,
  Navigation,
  Package,
  QrCode,
  Route,
  Share2,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { currentFocusDraft } from '@/data/mockData';
import { RouteMap } from '@/components/RouteMap';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import {
  addRelayHandoff,
  getInitialRelayState,
  getNearbyLetters,
  getRelayState,
  getRelayStats,
  relayToTrackingEvents,
  type AvailableLetter,
  type RelayState,
} from '@/lib/relayStore';
import { formatDistance } from '@/lib/gpsUtils';
import { getLetterDraftById } from '@/lib/letterStore';

type ViewMode = 'sender' | 'carrier';

function RelayContent() {
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter') || currentFocusDraft.id;
  const joinRequested = searchParams.get('join') === '1';
  const carrierMode = searchParams.get('mode') === 'carrier';

  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [viewMode, setViewMode] = useState<ViewMode>(carrierMode ? 'carrier' : 'sender');
  const [showHandoff, setShowHandoff] = useState(joinRequested);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [origin, setOrigin] = useState('');
  const [nearbyLetters, setNearbyLetters] = useState<AvailableLetter[]>([]);

  useEffect(() => {
    const draft = getLetterDraftById(letterId);
    setRelay(getRelayState(letterId, {
      subject: draft?.subject || currentFocusDraft.subject,
      recipient: draft?.address.name || draft?.recipient || 'Eleanor',
    }));
    setViewMode(carrierMode ? 'carrier' : 'sender');
    setShowHandoff(joinRequested);
    setNearbyLetters(getNearbyLetters());
  }, [carrierMode, joinRequested, letterId]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const stats = getRelayStats(relay);
  const waypoints = relay.gpsWaypoints ?? [];
  const shareLink = `${origin}/relay?letter=${encodeURIComponent(letterId)}&join=1`;
  const completedHandoffs = relay.handoffs.filter((handoff) => !handoff.next);

  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4200);
  };

  const copyRelayLink = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      announce('Carrier link copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      announce(`Copy is unavailable here. Share this link: ${shareLink}`);
    }
  };

  const recordHandoff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();

    if (!trimmedName || !trimmedLocation) {
      setFormError('Add a name and neighborhood before recording the handoff.');
      return;
    }

    try {
      const next = addRelayHandoff(
        letterId,
        { name: trimmedName, location: trimmedLocation, note },
        { subject: relay.subject, recipient: relay.recipient },
      );
      setRelay(next);
      setName('');
      setLocation('');
      setNote('');
      setFormError('');
      setShowHandoff(false);
      announce(`${trimmedName} is now part of the relay.`);
    } catch {
      setFormError('The handoff could not be saved. Check the details and try again.');
    }
  };

  return (
    <main className="page-shell page-enter">
      <div className="page-container">
        <header className="page-header flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="button-quiet -ml-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to desk
            </Link>
            <p className="meta">Relay passport / {relay.passcode}</p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Choose a view</p>
              <p className="body-copy mt-2 max-w-xl text-sm">
                Keep the passport open to follow the route, or switch to carrier mode to find a letter nearby.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Relay view">
              <button
                type="button"
                onClick={() => setViewMode('sender')}
                aria-pressed={viewMode === 'sender'}
                className={viewMode === 'sender' ? 'button-primary' : 'button-secondary'}
              >
                <Package className="h-4 w-4" aria-hidden="true" />
                Sender view
              </button>
              <button
                type="button"
                onClick={() => setViewMode('carrier')}
                aria-pressed={viewMode === 'carrier'}
                className={viewMode === 'carrier' ? 'button-primary' : 'button-secondary'}
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Carrier mode
              </button>
            </div>
          </div>
        </header>

        {notice && (
          <p className="notice mt-5" role="status" aria-live="polite">
            {notice}
          </p>
        )}

        {viewMode === 'sender' ? (
          <>
            <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
              <div className="min-w-0">
                <p className="eyebrow text-[#4f9d7a]">Human relay / in progress</p>
                <h1 className="display-title mt-4 max-w-3xl">The story between here and there.</h1>
                <p className="body-copy mt-5 max-w-2xl text-lg">
                  <span className="text-ink-navy">“{relay.subject}”</span> is traveling toward{' '}
                  <span className="text-ink-navy">{relay.recipient}</span> through willing hands. Follow the route without opening the letter.
                </p>

                <div className="mt-8 grid gap-5 border-y border-[rgba(16,42,67,0.13)] py-5 sm:grid-cols-3">
                  <div>
                    <p className="font-headline-md text-3xl text-ink-navy">{stats.carriers}</p>
                    <p className="meta mt-1">People recorded</p>
                  </div>
                  <div className="border-t border-[rgba(16,42,67,0.12)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                    <p className="font-headline-md text-3xl text-ink-navy">{waypoints.length}</p>
                    <p className="meta mt-1">GPS waypoints</p>
                  </div>
                  <div className="border-t border-[rgba(16,42,67,0.12)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                    <p className="font-headline-md text-3xl text-ink-navy">{stats.hours}h</p>
                    <p className="meta mt-1">Journey logged</p>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowHandoff((current) => !current);
                      setFormError('');
                    }}
                    className="button-primary"
                    aria-expanded={showHandoff}
                    aria-controls="manual-handoff"
                  >
                    <UsersRound className="h-4 w-4" aria-hidden="true" />
                    {showHandoff ? 'Close handoff form' : 'Record a handoff'}
                  </button>
                  <Link href={`/journey?letter=${encodeURIComponent(letterId)}`} className="button-secondary">
                    <Route className="h-4 w-4" aria-hidden="true" />
                    Open full journey
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>

                {showHandoff && (
                  <form id="manual-handoff" onSubmit={recordHandoff} className="panel mt-8 p-5 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow text-[#4f9d7a]">Carrier log</p>
                        <h2 className="section-title mt-2 text-3xl">Record the next handoff.</h2>
                        <p className="body-copy mt-3 max-w-xl text-sm">
                          Add the person and neighborhood that move the sealed letter forward. The route is recorded; the words remain private.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowHandoff(false)}
                        className="button-quiet -mr-2 -mt-2 shrink-0"
                        aria-label="Close handoff form"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>

                    {formError && (
                      <p className="notice error-notice mt-5" role="alert" aria-live="assertive">
                        {formError}
                      </p>
                    )}

                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <label htmlFor="relay-carrier-name" className="field-label">
                        Carrier name <span className="text-[#b84b3a]">*</span>
                        <input
                          id="relay-carrier-name"
                          required
                          value={name}
                          onChange={(event) => {
                            setName(event.target.value);
                            setFormError('');
                          }}
                          className="input-field mt-2"
                          placeholder="Maya"
                          autoComplete="name"
                        />
                      </label>
                      <label htmlFor="relay-carrier-location" className="field-label">
                        Neighborhood or stop <span className="text-[#b84b3a]">*</span>
                        <input
                          id="relay-carrier-location"
                          required
                          value={location}
                          onChange={(event) => {
                            setLocation(event.target.value);
                            setFormError('');
                          }}
                          className="input-field mt-2"
                          placeholder="Dadar"
                        />
                      </label>
                      <label htmlFor="relay-carrier-note" className="field-label sm:col-span-2">
                        Field note <span className="font-normal text-on-surface-variant">(optional)</span>
                        <textarea
                          id="relay-carrier-note"
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          className="textarea-field mt-2 min-h-[6rem]"
                          placeholder="A small detail from this part of the route…"
                        />
                      </label>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                      <p className="field-help inline-flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-[#4f9d7a]" aria-hidden="true" />
                        Only the route is recorded.
                      </p>
                      <button type="submit" className="button-primary">
                        Save handoff
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <aside className="paper-card p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4 border-b border-[rgba(16,42,67,0.13)] pb-4">
                  <div>
                    <p className="eyebrow">Custody document</p>
                    <h2 className="section-title mt-2 text-3xl">Relay passport.</h2>
                  </div>
                  <QrCode className="h-5 w-5 text-[#4f9d7a]" aria-hidden="true" />
                </div>

                <div className="mt-6 flex flex-col items-center">
                  <div
                    className="flex h-56 w-56 max-w-full items-center justify-center border border-[rgba(16,42,67,0.16)] bg-white p-3"
                    role="img"
                    aria-label={`QR code for the ${relay.subject} carrier link`}
                  >
                    {origin ? (
                      <QRCodeSVG value={shareLink} size={200} level="M" includeMargin={false} />
                    ) : (
                      <p className="meta text-center">Preparing the share code…</p>
                    )}
                  </div>
                  <p className="meta mt-5 w-full">Share URL</p>
                  <p className="mt-1 w-full break-all font-mono text-xs leading-relaxed text-ink-navy">{shareLink}</p>
                  <button type="button" onClick={() => void copyRelayLink()} className="button-secondary mt-5 w-full">
                    {copied ? <Check className="h-4 w-4 text-[#4f9d7a]" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                    {copied ? 'Link copied' : 'Copy carrier link'}
                  </button>
                </div>

                <div className="mt-6 space-y-4 border-t border-[rgba(16,42,67,0.13)] pt-5">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                    <p className="body-copy text-sm">The envelope stays sealed while it travels.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#b84b3a]" aria-hidden="true" />
                    <p className="body-copy text-sm">Only neighborhood-level locations appear in the passport.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Route className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                    <p className="body-copy text-sm">Share this page when someone is ready to carry it forward.</p>
                  </div>
                </div>
              </aside>
            </section>

            <section className="mt-16 grid gap-10 border-t border-[rgba(16,42,67,0.13)] pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="eyebrow">Recorded route</p>
                    <h2 className="section-title mt-2">Every hand leaves a stop.</h2>
                  </div>
                  <span className="meta">{waypoints.length} GPS waypoints</span>
                </div>
                <div className="panel mt-5 overflow-hidden p-0">
                  <RouteMap
                    waypoints={waypoints}
                    destinationNeighborhood={relay.destinationNeighborhood || relay.recipient}
                    currentCarrierName={relay.currentCarrierName}
                  />
                </div>

                <div className="mt-10">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="eyebrow">Custody timeline</p>
                      <h2 className="section-title mt-2">A record of the route.</h2>
                    </div>
                  </div>
                  <div className="panel mt-5 p-6 sm:p-8">
                    <TrackingTimeline events={relayToTrackingEvents(relay)} />
                  </div>
                </div>
              </div>

              <aside className="space-y-8">
                <div className="panel p-5 sm:p-6">
                  <p className="eyebrow">At a glance</p>
                  <dl className="mt-5 space-y-4">
                    <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(16,42,67,0.12)] pb-4">
                      <dt className="body-copy text-sm">People in the chain</dt>
                      <dd className="font-headline-md text-2xl text-ink-navy">{stats.carriers}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(16,42,67,0.12)] pb-4">
                      <dt className="body-copy text-sm">Route stops</dt>
                      <dd className="font-headline-md text-2xl text-ink-navy">{stats.cities}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="body-copy text-sm">Time logged</dt>
                      <dd className="font-headline-md text-2xl text-ink-navy">{stats.hours}h</dd>
                    </div>
                  </dl>
                </div>

                <div className="panel-muted p-5 sm:p-6">
                  <p className="eyebrow">Custody log</p>
                  <div className="mt-5 space-y-4">
                    {completedHandoffs.slice().reverse().map((handoff) => (
                      <div key={handoff.id} className="border-b border-[rgba(16,42,67,0.12)] pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-headline-md text-lg text-ink-navy">{handoff.name}</p>
                          <span className="meta">{handoff.role === 'sender' ? 'Origin' : 'Carrier'}</span>
                        </div>
                        <p className="body-copy mt-1 text-sm">{handoff.note}</p>
                        <p className="meta mt-2 inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          {handoff.neighborhood || handoff.location}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </section>
          </>
        ) : (
          <section className="mt-12">
            <div className="max-w-3xl">
              <p className="eyebrow text-[#b84b3a]">Carrier mode</p>
              <h1 className="display-title mt-4">Be the person who carries it.</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg">
                Choose a nearby letter, accept it with your GPS, and carry it as far as you can. When you are ready, pass it on with a QR code or a four-digit PIN.
              </p>
            </div>

            <div className="mt-8 grid gap-5">
              {nearbyLetters.map((letter) => (
                <article key={letter.letterId} className="panel p-5 sm:p-7">
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                        <h2 className="section-title text-3xl">“{letter.subject}”</h2>
                        <span className="status-mark pending">Available nearby</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                        <p className="meta inline-flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-[#b84b3a]" aria-hidden="true" />
                          From {letter.currentNeighborhood}
                        </p>
                        <p className="meta inline-flex items-center gap-2">
                          <Navigation className="h-3.5 w-3.5 text-[#4f9d7a]" aria-hidden="true" />
                          Toward {letter.destinationNeighborhood}
                        </p>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-6 border-t border-[rgba(16,42,67,0.12)] pt-4">
                        <div>
                          <p className="font-headline-md text-2xl text-ink-navy">{formatDistance(letter.distanceKm)}</p>
                          <p className="meta mt-1">Approx. to pickup</p>
                        </div>
                        <div>
                          <p className="font-headline-md text-2xl text-ink-navy">{formatDistance(letter.remainingKm)}</p>
                          <p className="meta mt-1">Approx. to destination</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                      <Link
                        href={`/relay/carry?letter=${encodeURIComponent(letter.letterId)}&subject=${encodeURIComponent(letter.subject)}&dest=${encodeURIComponent(letter.destinationNeighborhood)}`}
                        className="button-primary"
                      >
                        <Navigation className="h-4 w-4" aria-hidden="true" />
                        Accept and carry
                      </Link>
                      <Link href={`/relay?letter=${encodeURIComponent(letter.letterId)}`} className="button-secondary">
                        View passport
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="panel-muted mt-6 p-5 sm:p-6">
              <p className="eyebrow">Already holding a letter?</p>
              <p className="body-copy mt-3 max-w-2xl text-sm">
                Use the manual handoff page when someone has given you the letter and a four-digit PIN in person.
              </p>
              <Link href="/relay/handoff" className="button-secondary mt-5">
                Enter handoff PIN
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-16 border-t border-[rgba(16,42,67,0.13)] pt-10">
              <p className="eyebrow">The carrier loop</p>
              <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['01', 'Accept', 'Stamp your neighborhood and start carrying.'],
                  ['02', 'Carry', 'Move the sealed letter as far as your route allows.'],
                  ['03', 'Pass on', 'Generate a fresh QR code or share the PIN.'],
                  ['04', 'Confirm', 'The next carrier accepts and the passport updates.'],
                ].map(([number, title, text]) => (
                  <li key={number} className="border-t border-[rgba(16,42,67,0.13)] pt-4">
                    <span className="meta text-[#b84b3a]">{number}</span>
                    <h2 className="mt-3 font-headline-md text-2xl text-ink-navy">{title}</h2>
                    <p className="body-copy mt-2 text-sm">{text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function RelayPage() {
  return (
    <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading the relay passport…</p></div></main>}>
      <RelayContent />
    </Suspense>
  );
}
