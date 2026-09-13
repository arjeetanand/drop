'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Check, Clock3, LockKeyhole, MapPin,
  Navigation, Package, Share2, ShieldCheck, UsersRound, Zap
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { RelayChain } from '@/components/RelayChain';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { Interactive3DEnvelope } from '@/components/Interactive3DEnvelope';
import { Card3DTilt } from '@/components/Card3DTilt';
import { Luminous3DMap } from '@/components/Luminous3DMap';
import { WaypointMap } from '@/components/WaypointMap';
import { currentFocusDraft } from '@/data/mockData';
import {
  addRelayHandoff, getInitialRelayState, getRelayState, getRelayStats,
  getNearbyLetters, type RelayState, type AvailableLetter
} from '@/lib/relayStore';
import { formatDistance } from '@/lib/gpsUtils';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

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
  const [nearbyLetters, setNearbyLetters] = useState<AvailableLetter[]>([]);

  useEffect(() => {
    setRelay(getRelayState(letterId, {
      subject: currentFocusDraft.subject,
      recipient: 'Eleanor',
    }));
    setShowHandoff(joinRequested);
    setNearbyLetters(getNearbyLetters());
  }, [joinRequested, letterId]);

  const stats = getRelayStats(relay);
  const completedHandoffs = relay.handoffs.filter((h) => !h.next);
  const shareLink = typeof window === 'undefined'
    ? `/relay?letter=${encodeURIComponent(letterId)}&join=1`
    : `${window.location.origin}/relay?letter=${encodeURIComponent(letterId)}&join=1`;

  const copyRelayLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setNotice('Relay passport copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(shareLink);
    }
  };

  const recordHandoff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !location.trim()) return;
    const next = addRelayHandoff(letterId, { name, location, note }, {
      subject: relay.subject,
      recipient: relay.recipient,
    });
    setRelay(next);
    setName('');
    setLocation('');
    setNote('');
    setShowHandoff(false);
    setNotice(`${name.trim()} is now part of the relay.`);
  };

  // Waypoints from relay (only those with coords)
  const waypoints = relay.gpsWaypoints ?? [];
  const destCoords = relay.handoffs.find((h) => h.role === 'recipient')?.coords;

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-12 bg-surface text-ink-navy">
      <div className="mx-auto max-w-[1240px] px-4 py-6 md:px-12 md:py-10 xl:px-16">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#102a43]/[0.08]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#102a43]/[0.1] bg-white/70 backdrop-blur-sm text-xs font-mono tracking-wider uppercase text-on-surface-variant hover:text-ink-navy hover:bg-white transition-all shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to desk
          </Link>

          {/* Sender / Carrier toggle */}
          <div className="flex items-center gap-1 p-1 rounded-full bg-[#102a43]/[0.05] border border-[#102a43]/[0.08]">
            <button
              onClick={() => setViewMode('sender')}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-wider transition-all',
                viewMode === 'sender'
                  ? 'bg-ink-navy text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-ink-navy'
              )}
            >
              <Package className="h-3 w-3" /> Sender view
            </button>
            <button
              onClick={() => setViewMode('carrier')}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-wider transition-all',
                viewMode === 'carrier'
                  ? 'bg-ink-navy text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-ink-navy'
              )}
            >
              <Navigation className="h-3 w-3" /> Carrier mode
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-on-surface-variant">
            <span className="h-2 w-2 rounded-full bg-mint-accent animate-pulse" />
            <span>Relay Active / {relay.passcode}</span>
          </div>
        </header>

        {/* ════════════════════════════════════════════
            SENDER VIEW
            ════════════════════════════════════════════ */}
        {viewMode === 'sender' && (
          <>
            {/* Hero */}
            <section className="grid min-w-0 items-start gap-10 border-b border-[#102a43]/[0.08] py-10 md:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] md:py-14">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-mint-accent/30 bg-mint-accent/10 font-mono text-[11px] uppercase tracking-[0.16em] text-mint-accent font-semibold mb-4">
                  <span className="h-1.5 w-1.5 rounded-full bg-mint-accent" />
                  Human Relay In Progress
                </div>
                <h1 className="font-headline-lg text-[clamp(2.2rem,4.5vw,4rem)] leading-[1.02] tracking-[-0.035em] text-ink-navy">
                  The story between here and there.
                </h1>
                <p className="mt-5 max-w-[570px] font-body-lg text-base md:text-lg leading-relaxed text-on-surface-variant">
                  <strong className="text-ink-navy font-semibold">{relay.subject}</strong> is traveling toward{' '}
                  <strong className="text-ink-navy font-semibold">{relay.recipient}</strong> through voluntary human hands. Currently with{' '}
                  <strong className="text-ink-navy">{relay.currentCarrierName ?? 'a carrier'}</strong> in{' '}
                  <strong className="text-ink-navy">{relay.gpsWaypoints?.at(-1)?.neighborhood ?? 'transit'}</strong>.
                </p>

                {/* Stats row */}
                <div className="mt-7 flex flex-wrap gap-5">
                  {[
                    { value: stats.carriers, label: 'People who carried it' },
                    { value: relay.gpsWaypoints?.length ?? 0, label: 'GPS waypoints' },
                    { value: `${stats.hours}h`, label: 'In transit' },
                  ].map(({ value, label }) => (
                    <div key={label} className="text-center">
                      <p className="font-headline-md text-2xl text-ink-navy font-bold">{value}</p>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => setShowHandoff((c) => !c)}
                    className="inline-flex items-center gap-2 bg-ink-navy text-white px-5 py-3 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-md"
                  >
                    <UsersRound className="h-4 w-4 text-mint-accent" />
                    {showHandoff ? 'Close handoff form' : 'I carried this letter forward'}
                  </button>
                  <Link
                    href={`/journey?letter=${encodeURIComponent(letterId)}`}
                    className="inline-flex items-center gap-2 border border-[#102a43]/[0.15] bg-white px-5 py-3 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] text-ink-navy hover:bg-[#faf8f4] active:scale-[0.99] transition-all"
                  >
                    Full timeline <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                {notice && (
                  <p className="mt-3 font-mono text-xs text-mint-accent font-medium" aria-live="polite">{notice}</p>
                )}

                {/* Handoff form */}
                {showHandoff && (
                  <form
                    onSubmit={recordHandoff}
                    className="mt-8 refero-card rounded-2xl p-6 md:p-8 bg-white border border-mint-accent/40 shadow-[0_8px_32px_rgba(43,138,107,0.08)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.18em] text-mint-accent font-semibold">Carrier Log</p>
                        <h3 className="mt-1 font-headline-md text-2xl text-ink-navy">Record your handoff</h3>
                      </div>
                      <LockKeyhole className="h-5 w-5 text-mint-accent shrink-0" />
                    </div>
                    <p className="mt-2 font-body-md text-sm leading-relaxed text-on-surface-variant">
                      You do not need to read the letter. Just record that you held it, where you were, and where you passed it next.
                    </p>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                        Your name
                        <input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="typewriter-input mt-1.5 text-base text-ink-navy bg-[#faf8f4] border border-[#102a43]/[0.12] rounded-lg p-3 w-full focus:bg-white transition-colors"
                          placeholder="e.g. Maya"
                        />
                      </label>
                      <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                        Your neighborhood / stop
                        <input
                          required
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          className="typewriter-input mt-1.5 text-base text-ink-navy bg-[#faf8f4] border border-[#102a43]/[0.12] rounded-lg p-3 w-full focus:bg-white transition-colors"
                          placeholder="e.g. Dadar, Mumbai"
                        />
                      </label>
                    </div>
                    <label className="mt-4 block font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                      A tiny memory or note (optional)
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="mt-1.5 min-h-[80px] w-full resize-none rounded-lg border border-[#102a43]/[0.12] bg-[#faf8f4] p-3 font-body-md text-sm text-ink-navy outline-none focus:bg-white focus:border-ink-navy transition-colors"
                        placeholder="What did the moment feel like?"
                      />
                    </label>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 bg-ink-navy text-white px-5 py-2.5 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] hover:bg-ink-navy/90 transition-all"
                      >
                        Confirm handoff <ArrowRight className="h-3.5 w-3.5 text-mint-accent" />
                      </button>
                      <span className="font-mono text-xs text-on-surface-variant">🔒 Contents remain sealed</span>
                    </div>
                  </form>
                )}
              </div>

              <div className="flex min-w-0 justify-center">
                <Interactive3DEnvelope
                  recipient={relay.recipient}
                  subject={relay.subject}
                  monogram={relay.recipient.charAt(0)}
                  waxColor="#991b1b"
                />
              </div>
            </section>

            {/* ── 3D Luminous City Route Map ── */}
            <section className="py-10 border-b border-slate-200/80">
              <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                <div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 font-mono text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live 3D City Route
                  </div>
                  <h2 className="font-headline-md text-3xl text-slate-900 font-bold">Proof of movement.</h2>
                  <p className="font-sans text-sm text-slate-500 mt-1">
                    Watch the letter travel across neighborhoods in 3D. Move your mouse to pan and tilt.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-slate-100 font-mono text-xs text-slate-600 font-medium">
                  {waypoints.length} verified stops
                </span>
              </div>
              <Luminous3DMap
                waypoints={waypoints}
                currentCarrier={relay.currentCarrierName || 'Priya'}
                currentNeighborhood={relay.gpsWaypoints?.at(-1)?.neighborhood || 'Worli'}
                destinationNeighborhood={relay.destinationNeighborhood || 'Colaba'}
                className="w-full"
              />
            </section>

            {/* Chain + Passport */}
            <section className="grid min-w-0 gap-8 py-10 md:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)] md:py-12 border-b border-[#102a43]/[0.08]">
              <div className="min-w-0 space-y-6">
                <div className="refero-card rounded-2xl p-6 md:p-8 bg-white">
                  <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#102a43]/[0.08] pb-5">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-accent font-semibold">Handoff chain</p>
                      <h2 className="mt-1 font-headline-md text-2xl text-ink-navy">Every hand leaves a mark.</h2>
                    </div>
                    <span className="refero-pill font-mono text-xs">{completedHandoffs.length} recorded</span>
                  </div>
                  <div className="mt-6">
                    <RelayChain relay={relay} />
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-6 mt-6 border-t border-[#102a43]/[0.08]">
                    {[
                      { value: stats.carriers, label: 'Carriers' },
                      { value: waypoints.length, label: 'GPS stops' },
                      { value: `${stats.hours}h`, label: 'In transit' },
                    ].map(({ value, label }) => (
                      <div key={label} className="refero-card p-4 rounded-xl text-center bg-[#faf8f4]">
                        <p className="font-headline-md text-2xl text-ink-navy font-bold">{value}</p>
                        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <aside className="min-w-0 flex flex-col gap-6">
                <Card3DTilt>
                  <div className="bg-white border border-slate-200/90 rounded-2xl p-6 md:p-7 shadow-xs relative overflow-hidden">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400 font-bold">Custody Document</p>
                        <p className="mt-0.5 font-headline-md text-lg text-slate-900 font-bold">Relay Passport</p>
                      </div>
                      <span className="font-mono text-xs font-bold text-slate-900 px-2.5 py-1 bg-slate-50 rounded border border-slate-200 shadow-2xs tracking-widest">
                        {relay.passcode}
                      </span>
                    </div>
                    <div className="mt-6 flex flex-col items-center">
                      <div className="flex h-32 w-32 items-center justify-center border border-slate-200 bg-white p-2 rounded-2xl shadow-xs">
                        <QRCodeSVG
                          value={shareLink}
                          size={112}
                          level="M"
                          includeMargin={false}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={copyRelayLink}
                        className="mt-5 w-full inline-flex items-center justify-center gap-2 border border-slate-200 bg-white py-2.5 px-4 rounded-xl font-sans text-xs uppercase tracking-wider font-semibold text-slate-800 hover:bg-slate-50 transition-all"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Share2 className="h-3.5 w-3.5" />}
                        {copied ? 'Link Copied!' : 'Copy Handoff Link'}
                      </button>
                    </div>
                    <div className="mt-6 space-y-4 border-t border-slate-100 pt-5">
                      {[
                        { icon: ShieldCheck, color: 'text-emerald-600', text: 'The envelope remains sealed until the designated recipient opens it.' },
                        { icon: MapPin, color: 'text-amber-600', text: 'Locations are recorded as neighborhoods, never exact addresses.' },
                        { icon: Clock3, color: 'text-amber-600', text: 'The deliberate pace becomes part of what the recipient holds.' },
                      ].map(({ icon: Icon, color, text }) => (
                        <div key={text} className="flex gap-3">
                          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                          <p className="font-sans text-xs leading-relaxed text-slate-600">{text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card3DTilt>
              </aside>
            </section>

            {/* Logbook */}
            <section className="py-10 md:py-12">
              <div className="flex items-end justify-between gap-4 border-b border-[#102a43]/[0.08] pb-5">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-accent font-semibold">Custody Log</p>
                  <h2 className="mt-1 font-headline-md text-2xl text-ink-navy">A quiet record of the journey.</h2>
                </div>
                <span className="font-mono text-xs text-on-surface-variant">{completedHandoffs.length} entries</span>
              </div>
              <div className="mt-6 space-y-3">
                {completedHandoffs.slice().reverse().map((handoff) => (
                  <article
                    key={handoff.id}
                    className="refero-card rounded-xl p-5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5">
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${handoff.role === 'sender' ? 'bg-amber-accent' : 'bg-mint-accent'}`} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-headline-md text-base text-ink-navy font-bold">{handoff.name}</h3>
                          <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-black/5 text-on-surface-variant">
                            {handoff.role === 'sender' ? 'Origin' : 'Carrier'}
                          </span>
                          {handoff.distanceClosedKm && (
                            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-mint-accent/10 text-mint-accent border border-mint-accent/20">
                              +{handoff.distanceClosedKm.toFixed(1)}km closer
                            </span>
                          )}
                        </div>
                        {handoff.note && (
                          <p className="mt-1 font-serif text-sm italic text-on-surface-variant">&ldquo;{handoff.note}&rdquo;</p>
                        )}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1.5 font-mono text-xs text-on-surface-variant shrink-0 bg-[#faf8f4] px-3 py-1.5 rounded-lg border border-[#102a43]/[0.08]">
                      <MapPin className="h-3.5 w-3.5 text-amber-accent" />
                      <span>{handoff.neighborhood ?? handoff.location}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ════════════════════════════════════════════
            CARRIER MODE VIEW
            ════════════════════════════════════════════ */}
        {viewMode === 'carrier' && (
          <>
            <section className="py-10 border-b border-[#102a43]/[0.08]">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-accent/10 border border-amber-accent/30 font-mono text-[11px] uppercase tracking-[0.16em] text-amber-accent font-semibold mb-5">
                <Zap className="h-3 w-3" /> Letters looking for a carrier
              </div>
              <h1 className="font-headline-lg text-[clamp(2rem,4vw,3.5rem)] leading-[1.05] tracking-[-0.03em] text-ink-navy">
                Be the person who carries it.
              </h1>
              <p className="mt-4 max-w-[560px] font-body-lg text-base md:text-lg leading-relaxed text-on-surface-variant">
                These letters are nearby and need a human carrier to move them closer to their destination. You carry it as far as you want — then pass it to the next person with a 4-digit PIN.
              </p>
            </section>

            {/* Nearby letters list */}
            <section className="py-8 space-y-4">
              {nearbyLetters.map((letter) => (
                <article
                  key={letter.letterId}
                  className="refero-card rounded-2xl p-6 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-5"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-headline-md text-xl text-ink-navy">&ldquo;{letter.subject}&rdquo;</h3>
                      <span className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-accent/10 border border-amber-accent/20 text-amber-accent">
                        Waiting {letter.waitingMinutes}m
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                        <span className="h-1.5 w-1.5 rounded-full bg-mint-accent" />
                        Currently in {letter.currentNeighborhood}
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                        <MapPin className="h-3 w-3 text-amber-accent" />
                        Heading to {letter.destinationNeighborhood}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-center">
                        <p className="font-headline-md text-lg text-ink-navy font-bold">{formatDistance(letter.distanceKm)}</p>
                        <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">From you</p>
                      </div>
                      <div className="text-center">
                        <p className="font-headline-md text-lg text-ink-navy font-bold">{formatDistance(letter.remainingKm)}</p>
                        <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">To destination</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <Link
                      href={`/relay/carry?letter=${encodeURIComponent(letter.letterId)}&subject=${encodeURIComponent(letter.subject)}&dest=${encodeURIComponent(letter.destinationNeighborhood)}`}
                      className="inline-flex items-center justify-center gap-2 bg-ink-navy text-white px-5 py-2.5 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-sm"
                    >
                      <Navigation className="h-3.5 w-3.5 text-mint-accent" />
                      Accept &amp; carry
                    </Link>
                    <Link
                      href={`/relay?letter=${encodeURIComponent(letter.letterId)}`}
                      className="inline-flex items-center justify-center gap-2 border border-[#102a43]/[0.12] bg-white px-5 py-2 rounded-xl font-label-md text-xs uppercase tracking-[0.12em] text-on-surface-variant hover:text-ink-navy hover:bg-[#faf8f4] transition-all"
                    >
                      View passport
                    </Link>
                  </div>
                </article>
              ))}

              {/* Enter PIN for existing handoff */}
              <div className="refero-card rounded-2xl p-6 bg-[#faf8f4] border border-[#102a43]/[0.08] border-dashed">
                <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-semibold mb-2">
                  Already have a letter?
                </p>
                <p className="font-body-md text-sm text-on-surface-variant mb-4">
                  If someone handed you a letter in person and gave you a PIN, verify it here to officially join the relay.
                </p>
                <Link
                  href="/relay/handoff"
                  className="inline-flex items-center gap-2 bg-ink-navy text-white px-5 py-2.5 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] hover:bg-ink-navy/90 transition-all"
                >
                  Enter handoff PIN <ArrowRight className="h-3.5 w-3.5 text-mint-accent" />
                </Link>
              </div>
            </section>

            {/* How it works */}
            <section className="py-8 border-t border-[#102a43]/[0.08]">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-accent font-semibold mb-6">How carrier mode works</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { num: '①', title: 'Accept a letter', body: 'Pick one nearby. Your GPS neighborhood is stamped as a waypoint.' },
                  { num: '②', title: 'Carry it forward', body: 'Walk, take a rickshaw, a train. The app watches you move closer.' },
                  { num: '③', title: 'Generate a PIN', body: 'When ready to hand off, show the 4-digit PIN to the next person.' },
                  { num: '④', title: 'They verify', body: 'They enter the PIN on their phone — handoff confirmed and logged.' },
                ].map(({ num, title, body }) => (
                  <div key={num} className="refero-card rounded-xl p-5 bg-white">
                    <span className="font-headline-lg text-2xl text-mint-accent">{num}</span>
                    <h3 className="mt-3 font-headline-md text-base text-ink-navy font-semibold">{title}</h3>
                    <p className="mt-1.5 font-body-md text-sm text-on-surface-variant leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

      </div>
    </main>
  );
}

export default function RelayPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><RelayContent /></Suspense>;
}
