'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
  RefreshCw,
  Route,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { currentFocusDraft } from '@/data/mockData';
import { getRemoteJourneyLetter } from '@/lib/letterBackend';
import { RouteMap } from '@/components/RouteMap';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { mergeRemoteRelayHandoffs } from '@/components/relayPresentation';
import { startRelayRouteRefresh, type RelayRouteRefreshController } from '@/lib/relayRouteRefresh';
import {
  getInitialRelayState,
  getRemoteRelayHandoffs,
  getRelayState,
  getRelayStats,
  issueRelayHandoffToken,
  mergeRelayRecipientCollectionState,
  relayToTrackingEvents,
  type RelayRecipientCollectionState,
  type RelayState,
} from '@/lib/relayStore';
import { getLetterDraft, getLetterDraftById } from '@/lib/letterStore';
import { buildRelayScanUrl } from '@/lib/relayInviteUrl';
import { shareInviteLink } from '@/lib/shareInvite';

type ViewMode = 'sender' | 'carrier';

function RelayContent() {
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter') || currentFocusDraft.id;
  const joinRequested = searchParams.get('join') === '1';
  const carrierMode = searchParams.get('mode') === 'carrier';

  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [destination, setDestination] = useState('Recipient area');
  const [viewMode, setViewMode] = useState<ViewMode>(carrierMode ? 'carrier' : 'sender');
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteExpiresAt, setInviteExpiresAt] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [routeCheckedAt, setRouteCheckedAt] = useState<number | null>(null);
  const [routeRefreshError, setRouteRefreshError] = useState(false);
  const [routeRefreshing, setRouteRefreshing] = useState(false);
  const [routeAnnouncement, setRouteAnnouncement] = useState('');
  const [senderCollectionState, setSenderCollectionState] = useState<RelayRecipientCollectionState | null>(null);
  const relayRef = useRef(relay);
  const senderCollectionRef = useRef<RelayRecipientCollectionState | null>(null);
  const routeHasLoadedRef = useRef(false);
  const routeRefreshRef = useRef<RelayRouteRefreshController | null>(null);

  useEffect(() => {
    const draft = getLetterDraftById(letterId) || (getLetterDraft().id === letterId ? getLetterDraft() : null);
    const localRelay = getRelayState(letterId, {
      subject: draft?.subject || currentFocusDraft.subject,
      recipient: draft?.address.name || draft?.recipient || 'your correspondent',
    });
    setRelay(localRelay);
    relayRef.current = localRelay;
    senderCollectionRef.current = null;
    setSenderCollectionState(null);
    setInviteUrl('');
    setInviteExpiresAt('');
    setCopied(false);
    setDestination(
      localRelay.destinationNeighborhood
      || draft?.address.city
      || 'Recipient area',
    );
    setViewMode(carrierMode ? 'carrier' : 'sender');
    if (joinRequested) {
      setNotice('This older carrier link is no longer active. Create a fresh invite from the sender passport.');
    } else {
      setNotice('');
    }

  }, [carrierMode, joinRequested, letterId]);

  useEffect(() => {
    if (viewMode !== 'sender') return;

    routeHasLoadedRef.current = false;
    setRouteCheckedAt(null);
    setRouteRefreshError(false);
    setRouteRefreshing(false);
    setRouteAnnouncement('');

    const controller = startRelayRouteRefresh({
      load: async () => {
        const [routeResult, letterResult] = await Promise.allSettled([
          getRemoteRelayHandoffs(letterId),
          getRemoteJourneyLetter(letterId),
        ]);
        return {
          handoffs: routeResult.status === 'fulfilled' ? routeResult.value : null,
          letter: letterResult.status === 'fulfilled' ? letterResult.value : null,
        };
      },
      onData: ({ handoffs: remote, letter }) => {
        const nextState = mergeRelayRecipientCollectionState(senderCollectionRef.current, letterId, letter);
        senderCollectionRef.current = nextState;
        setSenderCollectionState(nextState);
        if (nextState?.collection?.isCollected) {
          setInviteUrl('');
          setInviteExpiresAt('');
          setCopied(false);
          setNotice('');
          setError('');
        }

        if (remote === null) {
          setRouteRefreshError(true);
          setRouteAnnouncement('');
          return;
        }

        const previousIds = new Set(relayRef.current.handoffs.map((handoff) => handoff.id));
        const newHandoff = routeHasLoadedRef.current
          ? remote.find((handoff) => !previousIds.has(handoff.id))
          : undefined;
        routeHasLoadedRef.current = true;
        setRouteCheckedAt(Date.now());
        setRouteRefreshError(false);
        setRouteAnnouncement(newHandoff
          ? `New handoff recorded: ${newHandoff.name}${newHandoff.neighborhood ? ` in ${newHandoff.neighborhood}` : ''}.`
          : '');
        const merged = mergeRemoteRelayHandoffs(relayRef.current, remote);
        relayRef.current = merged;
        setRelay(merged);
      },
      onError: () => {
        setRouteRefreshError(true);
        setRouteAnnouncement('');
      },
    });

    routeRefreshRef.current = controller;
    return () => {
      controller.stop();
      if (routeRefreshRef.current === controller) routeRefreshRef.current = null;
    };
  }, [letterId, viewMode]);

  const refreshRoute = () => {
    const controller = routeRefreshRef.current;
    if (!controller) return;
    setRouteRefreshing(true);
    setRouteRefreshError(false);
    void controller.refresh().finally(() => {
      if (routeRefreshRef.current === controller) setRouteRefreshing(false);
    });
  };

  useEffect(() => {
    relayRef.current = relay;
  }, [relay]);

  const stats = getRelayStats(relay);
  const hasCarrier = relay.handoffs.some((handoff) => handoff.role === 'carrier');
  const collectionStatusKnown = senderCollectionState?.letterId === letterId;
  const isCheckingCollection = viewMode === 'sender' && !collectionStatusKnown;
  const recipientCollection = viewMode === 'sender' && collectionStatusKnown
    ? senderCollectionState?.collection
    : undefined;
  const isCollected = recipientCollection?.isCollected === true;
  const lastRouteCheckTime = routeCheckedAt
    ? new Date(routeCheckedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : '';
  const waypoints = relay.gpsWaypoints ?? [];
  const completedHandoffs = relay.handoffs.filter((handoff) => !handoff.next || (isCollected && handoff.role === 'recipient'));

  const createInvite = async () => {
    if (isCollected || isCheckingCollection) return;
    setCreatingInvite(true);
    setError('');
    setNotice('');
    setInviteUrl('');
    try {
      const issued = await issueRelayHandoffToken(letterId);
      if (senderCollectionRef.current?.letterId !== letterId || senderCollectionRef.current.collection?.isCollected) return;
      const url = buildRelayScanUrl(window.location.origin, {
        token: issued.token,
        letterId,
        destination,
      });
      setInviteUrl(url);
      setInviteExpiresAt(issued.expiresAt);
      setNotice('Carrier invite ready. It expires in 10 minutes.');
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'A carrier invite could not be created. Try again.');
    } finally {
      setCreatingInvite(false);
    }
  };

  const shareInvite = async () => {
    if (!inviteUrl || isCollected) return;

    const result = await shareInviteLink(
      inviteUrl,
      navigator.share ? (details) => navigator.share(details) : undefined,
      async (url) => {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
      },
    );
    setError('');
    if (result === 'shared') {
      setCopied(false);
      setNotice('Carrier invite shared. The drop stays sealed.');
    } else if (result === 'copied') {
      setCopied(true);
      setNotice('Carrier invite copied. Share it with the person who will carry this drop.');
      window.setTimeout(() => setCopied(false), 1800);
    } else if (result === 'unavailable') setNotice('Sharing is unavailable. The carrier invite is shown below so you can select it.');
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
              <p className="eyebrow">Your relay</p>
              <p className="body-copy mt-2 max-w-xl text-sm">
                Follow a drop you sent, or open a carrier invite someone shared with you.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:w-auto" role="group" aria-label="Relay view">
              <button
                type="button"
                onClick={() => setViewMode('sender')}
                aria-pressed={viewMode === 'sender'}
                className={viewMode === 'sender'
                  ? 'button-primary !min-h-11 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white'
                  : 'button-secondary !min-h-11 !rounded-xl'}
              >
                <Package className="h-4 w-4" aria-hidden="true" />
                Follow my drop
              </button>
              <button
                type="button"
                onClick={() => setViewMode('carrier')}
                aria-pressed={viewMode === 'carrier'}
                className={viewMode === 'carrier'
                  ? 'button-primary !min-h-11 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white'
                  : 'button-secondary !min-h-11 !rounded-xl'}
              >
                <Navigation className="h-4 w-4" aria-hidden="true" />
                Carry a drop
              </button>
            </div>
          </div>
        </header>

        {notice && <p className="notice mt-5" role="status" aria-live="polite">{notice}</p>}
        {error && <p className="notice error-notice mt-5" role="alert" aria-live="assertive">{error}</p>}

        {viewMode === 'sender' ? (
          <>
            <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
              <div className="min-w-0 rounded-3xl bg-[#2b45f7] p-5 text-white shadow-[0_20px_50px_rgba(43,69,247,.18)] sm:p-8">
                <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-white/80">{isCollected ? 'Human relay · collected' : hasCarrier ? 'Human relay · in progress' : 'Human relay · waiting for its first carrier'}</p>
                <h1 className="mt-4 max-w-3xl font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
                  {isCollected ? 'Your drop reached its recipient.' : hasCarrier ? 'Your drop is on a journey.' : 'Your drop is ready to travel.'}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/85 sm:text-lg">
                  {isCollected
                    ? `“${relay.subject}” reached ${relay.recipient}, who confirmed collection. The drop stays sealed until they open it.`
                    : hasCarrier
                    ? `“${relay.subject}” is traveling toward ${relay.recipient}. Carriers can see the route and handoff details; the drop stays sealed.`
                    : `“${relay.subject}” is ready to travel toward ${relay.recipient}. Invite someone you trust to carry it; the drop stays sealed.`}
                </p>

                <div className="mt-7 grid grid-cols-3 border-y border-white/20 py-4">
                  <div>
                    <p className="font-headline-md text-2xl sm:text-3xl">{stats.carriers}</p>
                    <p className="mt-1 text-[0.65rem] text-white/80 sm:text-xs">People</p>
                  </div>
                  <div className="border-l border-white/20 pl-3 sm:pl-5">
                    <p className="font-headline-md text-2xl sm:text-3xl">{stats.cities}</p>
                    <p className="mt-1 text-[0.65rem] text-white/80 sm:text-xs">Stops</p>
                  </div>
                  <div className="border-l border-white/20 pl-3 sm:pl-5">
                    <p className="font-headline-md text-2xl sm:text-3xl">{stats.hours}h</p>
                    <p className="mt-1 text-[0.65rem] text-white/80 sm:text-xs">Journey time</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  {isCollected
                    ? <span className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white/15 px-4 py-3 text-sm font-bold" role="status"><Check className="h-4 w-4" aria-hidden="true" /> Drop collected</span>
                    : isCheckingCollection
                      ? <span className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white/15 px-4 py-3 text-sm font-semibold" role="status">Checking collection status…</span>
                      : <button
                        type="button"
                        onClick={() => void createInvite()}
                        disabled={creatingInvite}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#2b45f7] disabled:opacity-60"
                      >
                        <Share2 className="h-4 w-4" aria-hidden="true" />
                        {creatingInvite ? 'Creating invite…' : inviteUrl ? 'Create a fresh invite' : 'Invite a carrier'}
                      </button>}
                  <Link href={`/journey?letter=${encodeURIComponent(letterId)}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15">
                    <Route className="h-4 w-4" aria-hidden="true" />
                    Open journey <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              {isCollected ? (
                <aside className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-6">
                  <p className="eyebrow text-[#2b45f7]">Recipient collection</p>
                  <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{relay.recipient} collected the drop. No more carrier invites are needed.</p>
                </aside>
              ) : isCheckingCollection ? (
                <aside className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-6">
                  <p className="eyebrow text-[#2b45f7]">Recipient collection</p>
                  <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">Checking whether the recipient has collected this drop…</p>
                </aside>
              ) : <aside className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true"><QrCode className="h-5 w-5" /></span>
                  <div>
                    <p className="eyebrow text-[#2b45f7]">Carrier invite</p>
                    <h2 className="mt-1 font-headline-md text-xl text-ink-navy">Pass it on safely.</h2>
                  </div>
                </div>
                {inviteUrl ? (
                  <>
                    <div className="mx-auto mt-5 flex h-48 w-48 items-center justify-center rounded-2xl border border-[rgba(16,42,67,.1)] bg-white p-3" role="img" aria-label="Secure carrier invite QR code">
                      <QRCodeSVG value={inviteUrl} size={168} level="M" includeMargin={false} />
                    </div>
                    <p className="mt-4 break-all rounded-xl bg-[#f5f1e9] p-3 font-mono text-[0.65rem] leading-relaxed text-ink-navy">{inviteUrl}</p>
                    <p className="mt-3 text-xs text-on-surface-variant">Expires {inviteExpiresAt ? new Date(inviteExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'in 10 minutes'}.</p>
                    <button type="button" onClick={() => void shareInvite()} className="button-secondary mt-4 w-full !min-h-12 !rounded-xl">
                      {copied ? <Check className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> : <Share2 className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" />}
                      {copied ? 'Invite copied' : 'Share carrier invite'}
                    </button>
                  </>
                ) : (
                  <div className="mt-5 rounded-2xl bg-[#f5f1e9] p-4">
                    <p className="text-sm leading-relaxed text-on-surface-variant">Create a one-time invite when someone is ready to carry this drop. It works for 10 minutes and reveals only route details.</p>
                    <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-ink-navy"><ShieldCheck className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> Text and media stay private.</p>
                  </div>
                )}
              </aside>}
            </section>

            <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)] lg:items-start">
              <div className="min-w-0">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(16,42,67,.1)] bg-white px-4 py-3">
                  <div>
                    <p className="eyebrow text-[#2b45f7]">Live route</p>
                    <p className={`mt-1 text-xs ${routeRefreshError ? 'text-[#9d392e]' : 'text-on-surface-variant'}`} role="status" aria-live="polite" aria-atomic="true">
                      {routeRefreshing
                        ? 'Checking route updates…'
                        : routeRefreshError
                        ? routeCheckedAt ? `Updates unavailable. Showing the route last checked at ${lastRouteCheckTime}.` : 'Could not load shared route updates. Your saved route is still available.'
                        : routeAnnouncement || (routeCheckedAt ? 'No new handoffs. Checked just now.' : 'Checking for route updates…')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={refreshRoute}
                    disabled={routeRefreshing}
                    aria-busy={routeRefreshing}
                    className="button-secondary !min-h-11 !rounded-xl"
                  >
                    <RefreshCw className={`h-4 w-4 text-[#2b45f7] ${routeRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {routeRefreshing ? 'Checking…' : routeRefreshError ? 'Try again' : 'Refresh route'}
                  </button>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div><p className="eyebrow text-[#2b45f7]">Route map</p><h2 className="section-title mt-2">Every hand leaves a stop.</h2></div>
                  <span className="meta">{waypoints.length} mapped stops</span>
                </div>
                <div className="mt-4 overflow-hidden rounded-3xl border border-[rgba(16,42,67,.1)] bg-white shadow-[0_12px_36px_rgba(16,42,67,.05)]">
                  <RouteMap waypoints={waypoints} destinationNeighborhood={relay.destinationNeighborhood || destination} currentCarrierName={relay.currentCarrierName} destinationReached={isCollected} />
                </div>
                <div className="mt-9">
                  <p className="eyebrow text-[#2b45f7]">Handoff history</p>
                  <h2 className="section-title mt-2">A record of the route.</h2>
                  <div className="mt-4 rounded-3xl border border-[rgba(16,42,67,.1)] bg-white p-5 sm:p-7">
                    <TrackingTimeline events={relayToTrackingEvents(relay, recipientCollection)} />
                  </div>
                </div>
              </div>

              <aside className="space-y-5">
                <div className="rounded-3xl border border-[rgba(16,42,67,.1)] bg-white p-5 sm:p-6">
                  <p className="eyebrow text-[#2b45f7]">Route privacy</p>
                  <div className="mt-4 space-y-4">
                    <p className="flex items-start gap-3 text-sm leading-relaxed text-on-surface-variant"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" /> Carriers never see the drop’s text or media.</p>
                    <p className="flex items-start gap-3 text-sm leading-relaxed text-on-surface-variant"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" /> Route stops use neighborhood labels. Precise location is optional.</p>
                  </div>
                </div>
                <div className="rounded-3xl border border-[rgba(16,42,67,.1)] bg-[#fff8ee] p-5 sm:p-6">
                  <p className="eyebrow text-[#b84b3a]">The route so far</p>
                  <div className="mt-4 space-y-4">
                    {completedHandoffs.slice().reverse().map((handoff) => (
                      <div key={handoff.id} className="border-b border-[rgba(16,42,67,.1)] pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink-navy">{handoff.name}</p><span className="rounded-full bg-white px-2 py-1 font-mono text-[0.58rem] font-bold uppercase tracking-[.08em] text-on-surface-variant">{handoff.role === 'sender' ? 'Origin' : handoff.role === 'recipient' ? 'Recipient' : 'Carrier'}</span></div>
                        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{handoff.role === 'recipient' && isCollected ? `${handoff.name} collected this drop.` : handoff.note}</p>
                        <p className="meta mt-2 inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{handoff.neighborhood || handoff.location}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </section>
          </>
        ) : (
          <section className="mt-8 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-8">
            <div className="mx-auto max-w-2xl">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true"><Navigation className="h-5 w-5" /></span>
              <p className="eyebrow mt-5 text-[#2b45f7]">Carry a drop</p>
              <h1 className="display-title mt-3">A friend’s invite is your starting point.</h1>
              <p className="body-copy mt-4 text-base sm:text-lg">
                Open the secure link or scan the QR they shared with you. Add your name and, if you want, a neighborhood. The drop stays sealed in your hands.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  ['01', 'Open the invite', 'The sender’s link names the route, not the message.'],
                  ['02', 'Join the route', 'Use a neighborhood label or skip location.'],
                  ['03', 'Pass it on', 'Create a fresh QR when the next person is ready.'],
                ].map(([number, title, copy]) => (
                  <article key={number} className="rounded-2xl bg-[#f5f1e9] p-4">
                    <span className="font-mono text-xs font-bold text-[#2b45f7]">{number}</span>
                    <h2 className="mt-2 text-sm font-bold text-ink-navy">{title}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{copy}</p>
                  </article>
                ))}
              </div>
              <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="button-secondary mt-6 !min-h-12 !rounded-xl">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to my passport
              </Link>
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
