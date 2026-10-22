'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Clock3, Copy, MapPin, QrCode, RefreshCw, Route as RouteIcon, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { LetterCard } from '@/components/LetterCard';
import { RelayChain } from '@/components/RelayChain';
import { RouteMap } from '@/components/RouteMap';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { currentFocusDraft, type MockLetter } from '@/data/mockData';
import { getRemoteJourney, getRemoteJourneyLetter, getRemoteJourneyLetters, saveRemoteJourneyNote } from '@/lib/letterBackend';
import { getJourneyLetters } from '@/lib/journeyView';
import { getJourneyNotes, getLetterDraft, getLettersWithDraft, saveJourneyNotes, type JourneyNote } from '@/lib/letterStore';
import { getInitialRelayState, getRelayState, getRelayStats, getRemoteRelayHandoffs, issueRelayHandoffToken, relayToTrackingEvents, type RelayState } from '@/lib/relayStore';
import { mergeRemoteRelayHandoffs } from '@/components/relayPresentation';
import { startRelayRouteRefresh, type RelayRouteRefreshController } from '@/lib/relayRouteRefresh';
import { buildRelayScanUrl } from '@/lib/relayInviteUrl';

interface SenderInvite {
  url: string;
  expiresAt: string;
}

function JourneyIndex() {
  const [journeys, setJourneys] = useState<MockLetter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadJourneys = async () => {
      const localLetters = getLettersWithDraft(getLetterDraft());
      try {
        const remoteLetters = await getRemoteJourneyLetters();
        if (active) setJourneys(getJourneyLetters(localLetters, remoteLetters));
      } catch {
        if (active) setJourneys(getJourneyLetters(localLetters, null));
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadJourneys();
    return () => { active = false; };
  }, []);

  const startRelayHref = '/compose?new=1&mode=relay';

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[1080px]">
        <header className="page-header flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Journey</p>
            <h1 className="display-title mt-4 max-w-3xl">Your drops in motion.</h1>
            <p className="body-copy mt-4 max-w-2xl text-base">Follow drops as they travel hand to hand. Their contents stay sealed.</p>
          </div>
          <Link href={startRelayHref} className="button-primary shrink-0 !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">
            <RouteIcon className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" /> Make a relay drop <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </header>

        <section className="mt-8" aria-label="Your sent relay drops" aria-busy={loading}>
          {loading ? <p className="meta py-8 text-center" role="status">Loading your journeys…</p> : journeys.length ? journeys.map((letter) => (
            <LetterCard key={letter.id} letter={letter} />
          )) : (
            <div className="panel-muted my-10 rounded-2xl p-8 text-center sm:p-10">
              <RouteIcon className="mx-auto h-7 w-7 text-[#2b45f7]" aria-hidden="true" />
              <h2 className="mt-4 font-headline-md text-2xl text-ink-navy">Nothing’s traveling yet.</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-on-surface-variant">Send a drop hand-to-hand when the route is part of the message.</p>
              <Link href={startRelayHref} className="button-primary mt-5 !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">Make a relay drop <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function JourneyDetail({ requestedLetterId }: { requestedLetterId: string }) {
  const [letterId, setLetterId] = useState(requestedLetterId);
  const [journeyLetter, setJourneyLetter] = useState<MockLetter | null>(null);
  const [loading, setLoading] = useState(true);
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [notes, setNotes] = useState<JourneyNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [invite, setInvite] = useState<SenderInvite | null>(null);
  const [now, setNow] = useState(Date.now());
  const [issuingInvite, setIssuingInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [routeCheckedAt, setRouteCheckedAt] = useState<number | null>(null);
  const [routeRefreshError, setRouteRefreshError] = useState(false);
  const [routeRefreshing, setRouteRefreshing] = useState(false);
  const [routeAnnouncement, setRouteAnnouncement] = useState('');
  const relayRef = useRef(relay);
  const routeHasLoadedRef = useRef(false);
  const routeRefreshRef = useRef<RelayRouteRefreshController | null>(null);

  useEffect(() => {
    let active = true;
    const loadJourney = async () => {
      const draft = getLetterDraft();
      const localLetters = getLettersWithDraft(draft);
      const remoteLetter = await getRemoteJourneyLetter(requestedLetterId).catch(() => null);
      if (!active) return;
      const selectedLetter = getJourneyLetters(localLetters, remoteLetter ? [remoteLetter] : null).find((letter) => letter.id === requestedLetterId);
      if (!selectedLetter) {
        setJourneyLetter(null);
        setLoading(false);
        return;
      }
      const remoteJourney = await getRemoteJourney(requestedLetterId).catch(() => null);
      if (!active) return;
      const initial = getRelayState(requestedLetterId, {
        subject: selectedLetter?.subject || draft.subject || currentFocusDraft.subject,
        recipient: selectedLetter?.recipient || draft.address.name || draft.recipient || 'Recipient',
      });
      setJourneyLetter(selectedLetter);
      setLetterId(requestedLetterId);
      setRelay(initial);
      relayRef.current = initial;
      setNotes(remoteJourney?.notes.length ? remoteJourney.notes : getJourneyNotes(requestedLetterId));
      setLoading(false);
    };
    void loadJourney();
    return () => { active = false; };
  }, [requestedLetterId]);

  useEffect(() => {
    if (!journeyLetter || journeyLetter.id !== letterId) return;

    routeHasLoadedRef.current = false;
    setRouteCheckedAt(null);
    setRouteRefreshError(false);
    setRouteRefreshing(false);
    setRouteAnnouncement('');

    const controller = startRelayRouteRefresh({
      load: async () => {
        const handoffs = await getRemoteRelayHandoffs(letterId);
        if (handoffs === null) throw new Error('Relay route updates are unavailable.');
        return handoffs;
      },
      onData: (remote) => {
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
  }, [journeyLetter, letterId]);

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

  useEffect(() => {
    if (!invite) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [invite]);

  const stats = getRelayStats(relay);
  const hasCarrier = relay.handoffs.some((handoff) => handoff.role === 'carrier');
  const lastRouteCheckTime = routeCheckedAt
    ? new Date(routeCheckedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : '';
  const events = relayToTrackingEvents(relay);
  const destination = relay.destinationNeighborhood || relay.recipient || 'Recipient area';
  const inviteRemainingMs = invite ? Math.max(0, Date.parse(invite.expiresAt) - now) : 0;
  const inviteExpired = Boolean(invite && inviteRemainingMs <= 0);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const handleAddNote = () => {
    const text = newNote.trim();
    if (!text) return;
    const nextNotes = [...notes, {
      id: `note-${Date.now()}`,
      date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date()),
      text,
    }];
    setNotes(nextNotes);
    saveJourneyNotes(nextNotes, letterId);
    void saveRemoteJourneyNote(letterId, text);
    setNewNote('');
    showNotice('Field note added to the journey.');
  };

  const handleInviteCarrier = async () => {
    setIssuingInvite(true);
    setError('');
    try {
      const issued = await issueRelayHandoffToken(letterId);
      const url = buildRelayScanUrl(window.location.origin, {
        token: issued.token,
        letterId,
        destination,
      });
      setInvite({ url, expiresAt: issued.expiresAt });
      setNow(Date.now());
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'A carrier invite could not be created. Try again.');
    } finally {
      setIssuingInvite(false);
    }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      showNotice('Secure carrier invite copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showNotice('Copy is unavailable here. The QR code is ready to scan.');
    }
  };

  if (loading || !journeyLetter) {
    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-[760px]">
          <Link href="/journey" className="button-quiet -ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to journeys</Link>
          <section className="panel-muted mt-8 rounded-2xl p-8 text-center sm:p-10">
            {loading ? <p className="text-sm text-on-surface-variant" role="status">Loading journey details…</p> : <>
              <h1 className="font-headline-md text-2xl text-ink-navy">This journey isn’t available.</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-on-surface-variant">It may be a draft or a relay you can’t access from this account.</p>
            </>}
            {!loading && <Link href="/journey" className="button-primary mt-5 !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">Back to journeys <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell page-enter !pt-4 sm:!pt-8">
      <div className="page-container max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/journey" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to journeys</Link>
          <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2b45f7]/[0.08] px-4 text-sm font-bold text-[#2b45f7]"><RouteIcon className="h-4 w-4" aria-hidden="true" /> Relay passport</Link>
        </header>

        <section className="mt-5 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:mt-8 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#2b45f7]/[0.08] px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#2b45f7]"><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />Journey tracker</span>
              <h1 className="mt-4 font-headline-md text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-navy sm:text-4xl">{hasCarrier ? 'A sealed drop, in motion.' : 'A sealed drop, ready to travel.'}</h1>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant sm:text-base">{hasCarrier ? `Follow the route of “${relay.subject}” toward ${relay.recipient}. Carriers can update the route without opening the drop.` : `“${relay.subject}” is waiting for its first carrier. Invite someone you trust; the drop stays sealed.`}</p>
            </div>
            <button type="button" onClick={() => void handleInviteCarrier()} disabled={issuingInvite} className="button-primary min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white sm:w-auto">
              <QrCode className="h-4 w-4" aria-hidden="true" />{issuingInvite ? 'Creating invite…' : 'Invite a carrier'}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {error && <p className="notice error-notice mt-5" role="alert" aria-live="assertive">{error}</p>}
          {notice && <p className="notice mt-5" role="status" aria-live="polite">{notice}</p>}
        </section>

        <section className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-4" aria-label="Journey summary">
          <div className="rounded-2xl border border-[rgba(16,42,67,.1)] bg-white/75 p-3 sm:p-5"><p className="font-headline-md text-2xl text-ink-navy sm:text-3xl">{stats.carriers}</p><p className="mt-1 text-[0.68rem] leading-tight text-on-surface-variant sm:text-xs">Carriers</p></div>
          <div className="rounded-2xl border border-[rgba(16,42,67,.1)] bg-white/75 p-3 sm:p-5"><p className="font-headline-md text-2xl text-ink-navy sm:text-3xl">{relay.gpsWaypoints?.length || stats.cities}</p><p className="mt-1 text-[0.68rem] leading-tight text-on-surface-variant sm:text-xs">Route stops</p></div>
          <div className="rounded-2xl border border-[rgba(16,42,67,.1)] bg-white/75 p-3 sm:p-5"><p className="font-headline-md text-2xl text-ink-navy sm:text-3xl">{stats.hours}h</p><p className="mt-1 text-[0.68rem] leading-tight text-on-surface-variant sm:text-xs">Journey age</p></div>
        </section>

        {invite && (
          <section className="mt-4 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:mt-5 sm:p-7">
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{inviteExpired ? 'Carrier invite expired. Make a new invite to continue.' : ''}</p>
            <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="eyebrow text-[#2b45f7]">Carrier invite</p>
                <h2 className="mt-2 font-headline-md text-2xl text-ink-navy">Share the next hand.</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-on-surface-variant">This one-time invite expires in ten minutes. It contains no drop content or media.</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold ${inviteExpired ? 'bg-[#f3efe7] text-on-surface-variant' : 'bg-[#2b45f7]/[0.08] text-[#2b45f7]'}`} aria-label={inviteExpired ? 'Invite expired' : `Invite expires in ${Math.floor(inviteRemainingMs / 60000)}:${String(Math.floor((inviteRemainingMs % 60000) / 1000)).padStart(2, '0')}`}><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{inviteExpired ? 'Invite expired' : `Expires in ${Math.floor(inviteRemainingMs / 60000)}:${String(Math.floor((inviteRemainingMs % 60000) / 1000)).padStart(2, '0')}`}</span>
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#f5f3ed] px-3 text-xs font-bold text-ink-navy"><ShieldCheck className="h-3.5 w-3.5 text-[#2b45f7]" aria-hidden="true" />Route only</span>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {!inviteExpired && <button type="button" onClick={() => void copyInvite()} className="button-secondary min-h-11 !rounded-xl"><Copy className="h-4 w-4" aria-hidden="true" />{copied ? 'Link copied' : 'Copy invite link'}</button>}
                  {inviteExpired && <button type="button" onClick={() => void handleInviteCarrier()} disabled={issuingInvite} className="button-quiet min-h-11"><QrCode className="h-4 w-4" aria-hidden="true" />Make a new invite</button>}
                </div>
              </div>
              {inviteExpired
                ? <div className="mx-auto flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-2xl border border-[rgba(16,42,67,.12)] bg-[#f5f3ed] p-4 text-center text-sm font-semibold text-on-surface-variant sm:mx-0"><Clock3 className="h-5 w-5" aria-hidden="true" />Invite expired</div>
                : <div className="mx-auto flex w-fit items-center justify-center rounded-2xl border border-[rgba(16,42,67,.12)] bg-white p-3 sm:mx-0" role="img" aria-label="One-time secure carrier invite QR code"><QRCodeSVG value={invite.url} size={180} level="M" includeMargin={false} /></div>}
            </div>
          </section>
        )}

        <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(290px,.65fr)] lg:items-start">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(16,42,67,.1)] bg-white px-4 py-3 lg:col-span-2">
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
          <div className="min-w-0 space-y-5">
            <section className="overflow-hidden rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-4 shadow-[0_12px_36px_rgba(16,42,67,.05)] sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Route map</p><h2 className="mt-1 font-headline-md text-2xl text-ink-navy">Every hand leaves a stop.</h2></div><span className="font-mono text-[0.62rem] text-on-surface-variant">{relay.gpsWaypoints?.length || 0} stops</span></div>
              <div className="mt-4 overflow-hidden rounded-2xl bg-[#f5f3ed] p-2 sm:p-4"><RouteMap waypoints={relay.gpsWaypoints ?? []} destinationNeighborhood={relay.destinationNeighborhood || relay.recipient} currentCarrierName={relay.currentCarrierName} /></div>
              <div className="mt-5 border-t border-[rgba(16,42,67,.1)] pt-5"><RelayChain relay={relay} /></div>
            </section>

            <section className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.05)] sm:p-6">
              <div className="flex items-end justify-between gap-4"><div><p className="eyebrow">Custody timeline</p><h2 className="mt-1 font-headline-md text-2xl text-ink-navy">The route so far.</h2></div><RouteIcon className="h-5 w-5 text-[#2b45f7]" aria-hidden="true" /></div>
              <div className="mt-4"><TrackingTimeline events={events} /></div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-5 sm:p-6">
              <p className="eyebrow">Privacy promise</p>
              <div className="mt-4 flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#2b45f7]" aria-hidden="true" /><p className="text-sm leading-relaxed text-on-surface-variant">Carriers see the destination and route details, never the words or media. Location is optional and can be kept at neighborhood level.</p></div>
              <p className="mt-5 inline-flex items-center gap-2 border-t border-[rgba(16,42,67,.1)] pt-4 text-xs text-on-surface-variant"><MapPin className="h-3.5 w-3.5 text-[#2b45f7]" aria-hidden="true" />{destination}</p>
            </section>

            <section className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 sm:p-6">
              <p className="eyebrow">Field notes</p>
              <div className="mt-4 space-y-4">{notes.length ? notes.map((note) => <div key={note.id} className="border-b border-[rgba(16,42,67,.1)] pb-4 last:border-0 last:pb-0"><p className="font-mono text-[0.62rem] text-on-surface-variant">{note.date}</p><p className="mt-2 font-literata text-sm leading-relaxed text-ink-navy">{note.text}</p></div>) : <p className="text-sm leading-relaxed text-on-surface-variant">A note will appear here as the journey unfolds.</p>}</div>
              <label htmlFor="new-note" className="field-label mt-5 block">Add a note<textarea id="new-note" value={newNote} onChange={(event) => setNewNote(event.target.value)} className="textarea-field mt-2 min-h-[6rem] !rounded-xl" placeholder="What did this part of the journey feel like?" maxLength={500} /></label>
              <button type="button" onClick={handleAddNote} disabled={!newNote.trim()} className="button-secondary mt-3 w-full !min-h-11 !rounded-xl disabled:opacity-45"><Check className="h-4 w-4" aria-hidden="true" />Save field note</button>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function JourneyContent() {
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter');
  return letterId ? <JourneyDetail key={letterId} requestedLetterId={letterId} /> : <JourneyIndex />;
}

export default function JourneyPage() {
  return <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading your journeys…</p></div></main>}><JourneyContent /></Suspense>;
}
