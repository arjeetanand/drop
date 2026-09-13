'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, MapPin, NotebookPen, UsersRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { RelayChain } from '@/components/RelayChain';
import { RelayEnvelope } from '@/components/RelayEnvelope';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { currentFocusDraft } from '@/data/mockData';
import { getJourneyNotes, getLetterDraft, getLettersWithDraft, saveJourneyNotes, type JourneyNote } from '@/lib/letterStore';
import { getRemoteJourney, saveRemoteJourneyNote } from '@/lib/letterBackend';
import { addRelayHandoff, getInitialRelayState, getRelayState, getRelayStats, relayToTrackingEvents, type RelayState } from '@/lib/relayStore';

function Journey() {
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<JourneyNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [letterId, setLetterId] = useState(currentFocusDraft.id);
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [showHandoff, setShowHandoff] = useState(false);
  const [carrierName, setCarrierName] = useState('');
  const [carrierLocation, setCarrierLocation] = useState('');
  const [carrierNote, setCarrierNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const loadJourney = async () => {
      const draft = getLetterDraft();
      const selectedId = searchParams.get('letter') || draft.id;
      const selectedLetter = getLettersWithDraft(draft).find((letter) => letter.id === selectedId);
      const nextRelay = getRelayState(selectedId, {
        subject: selectedLetter?.subject ?? draft.subject ?? currentFocusDraft.subject,
        recipient: selectedLetter?.recipient ?? draft.address.name ?? draft.recipient ?? 'Eleanor',
      });
      const remote = selectedId ? await getRemoteJourney(selectedId) : null;
      if (!active) return;
      setLetterId(selectedId);
      setRelay(nextRelay);
      setNotes(remote?.notes.length ? remote.notes : getJourneyNotes());
      if (searchParams.get('join') === '1') {
        setShowHandoff(true);
      }
    };
    void loadJourney();
    return () => { active = false; };
  }, [searchParams]);

  const trackingEvents = relayToTrackingEvents(relay);
  const stats = getRelayStats(relay);

  const handleAddNote = () => {
    const text = newNote.trim();
    if (!text) return;
    const nextNotes = [...notes, {
      id: String(notes.length + 1),
      date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date()),
      text,
    }];
    setNotes(nextNotes);
    saveJourneyNotes(nextNotes);
    if (letterId) void saveRemoteJourneyNote(letterId, text);
    setNewNote('');
  };

  const handleRecordHandoff = (event: React.FormEvent) => {
    event.preventDefault();
    if (!carrierName.trim() || !carrierLocation.trim()) return;
    const next = addRelayHandoff(
      letterId,
      { name: carrierName, location: carrierLocation, note: carrierNote },
      { subject: relay.subject, recipient: relay.recipient }
    );
    setRelay(next);
    setCarrierName('');
    setCarrierLocation('');
    setCarrierNote('');
    setShowHandoff(false);
    setNotice(`${carrierName.trim()} was recorded as the next carrier!`);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const shareLink = typeof window === 'undefined'
    ? `/journey?letter=${encodeURIComponent(letterId)}&join=1`
    : `${window.location.origin}/journey?letter=${encodeURIComponent(letterId)}&join=1`;

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setNotice('Carrier link copied to clipboard!');
      window.setTimeout(() => {
        setCopied(false);
        setNotice('');
      }, 2500);
    } catch {
      setNotice(shareLink);
    }
  };

  const currentEvent = trackingEvents.find((event) => event.current) || trackingEvents[trackingEvents.length - 1];

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[1180px] px-margin-mobile py-lg md:px-12 md:py-xl xl:px-16">
        <header className="flex items-center justify-between border-b border-outline-variant/70 pb-md">
          <Link href="/" className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant hover:text-ink-navy"><ArrowLeft className="h-4 w-4" /> Back to desk</Link>
          <span className="font-caption text-caption uppercase tracking-[0.22em] text-on-surface-variant">Relay journey</span>
        </header>

        <section className="grid min-w-0 items-center gap-10 border-b border-outline-variant/70 py-10 md:grid-cols-[minmax(0,1fr)_300px] md:py-14">
          <div className="min-w-0">
            <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">{currentEvent?.status || 'In motion'}</p>
            <h1 className="mt-3 max-w-[680px] font-headline-lg text-[clamp(2.8rem,5.4vw,5.2rem)] leading-[0.98] tracking-[-0.04em] text-ink-navy">A letter becomes a story in the hands of others.</h1>
            <p className="mt-6 max-w-[620px] font-body-lg text-body-lg leading-relaxed text-on-surface-variant">{relay.subject} is travelling to {relay.recipient}. Here is the part a delivery receipt can never show: who chose to carry it, and where they left it next.</p>
          </div>
          <div className="flex min-w-0 justify-center border-l border-outline-variant/70 pl-0 md:pl-10"><RelayEnvelope compact /></div>
        </section>

        <section className="grid min-w-0 gap-10 border-b border-outline-variant/70 py-10 md:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)] md:py-12">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-md border-b border-outline-variant/70 pb-md"><div><p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">The human route</p><h2 className="mt-2 font-headline-md text-headline-md text-ink-navy">Every hand leaves a mark.</h2></div><span className="font-caption text-caption text-on-surface-variant">{stats.carriers} people carried it</span></div>
            <div className="mt-8 border-y border-outline-variant/70 py-7"><RelayChain relay={relay} /></div>
            <div className="mt-10"><div className="mb-lg flex items-end justify-between gap-md"><div><h2 className="font-headline-md text-headline-md text-ink-navy">The logbook</h2><p className="mt-xs font-caption text-caption text-on-surface-variant">A quiet record of the route.</p></div><span className="font-caption text-caption text-on-surface-variant">{trackingEvents.filter((event) => event.done).length}/{trackingEvents.length} recorded</span></div><TrackingTimeline events={trackingEvents} /></div>
          </div>
          <aside className="min-w-0 border-l border-outline-variant/70 pl-0 md:pl-8 flex flex-col justify-between">
            <div>
              <p className="font-caption text-caption uppercase tracking-[0.18em] text-on-surface-variant">Relay Passport</p>
              <p className="mt-2 font-mono text-sm tracking-[0.14em] text-ink-navy">{relay.passcode}</p>

              <div className="mt-6 space-y-6">
                <div className="flex gap-sm"><UsersRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-accent" /><div><p className="font-headline-md text-[20px] leading-6 text-ink-navy">{stats.carriers} human links</p><p className="mt-1 font-body-md text-body-md leading-relaxed text-on-surface-variant">Real people who agreed to move the letter without reading it.</p></div></div>
                <div className="flex gap-sm"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-amber-accent" /><div><p className="font-headline-md text-[20px] leading-6 text-ink-navy">{stats.cities} places touched</p><p className="mt-1 font-body-md text-body-md leading-relaxed text-on-surface-variant">Only broad locations are saved to preserve personal privacy.</p></div></div>
                <div className="flex gap-sm"><span className="mt-1 h-4 w-4 shrink-0 rounded-full border border-mint-accent bg-mint-accent/40" /><div><p className="font-headline-md text-[20px] leading-6 text-ink-navy">{stats.hours} hours travelling</p><p className="mt-1 font-body-md text-body-md leading-relaxed text-on-surface-variant">The time in transit becomes part of what the recipient receives.</p></div></div>
              </div>
            </div>

            <div className="mt-8 space-y-3 pt-6 border-t border-outline-variant/60">
              <button
                type="button"
                onClick={() => setShowHandoff((prev) => !prev)}
                className="w-full inline-flex items-center justify-center gap-sm bg-ink-navy py-sm px-md font-label-md text-[11px] uppercase tracking-[0.12em] text-surface-bright hover:bg-ink-navy/90"
              >
                <UsersRound className="h-3.5 w-3.5" />
                {showHandoff ? 'Cancel Handoff' : 'I Carried This Letter'}
              </button>
              <button
                type="button"
                onClick={copyShareLink}
                className="w-full inline-flex items-center justify-center gap-sm border border-ink-navy py-sm px-md font-label-md text-[11px] uppercase tracking-[0.12em] text-ink-navy hover:bg-ink-navy/5"
              >
                {copied ? 'Link Copied!' : 'Share Carrier Passport'}
              </button>
              {notice && (
                <p className="text-center font-caption text-caption text-mint-accent" aria-live="polite">
                  {notice}
                </p>
              )}
            </div>
          </aside>
        </section>

        {/* Carrier Handoff Form Section (When active) */}
        {showHandoff && (
          <section className="border-b border-outline-variant/70 py-10 bg-surface-container-low p-6 md:p-8 rounded-sm my-8">
            <div className="max-w-xl mx-auto">
              <div className="flex items-center gap-sm font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">
                <UsersRound className="h-4 w-4" />
                Carrier Handoff
              </div>
              <h3 className="mt-2 font-headline-md text-headline-md text-ink-navy">
                Record that you carried this letter
              </h3>
              <p className="mt-2 font-body-md text-body-md text-on-surface-variant">
                You do not need to read the letter. Just record that you held it, your city, and where you passed it next.
              </p>

              <form onSubmit={handleRecordHandoff} className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block font-caption text-caption uppercase tracking-wider text-on-surface-variant">
                    Your Name
                    <input
                      required
                      value={carrierName}
                      onChange={(e) => setCarrierName(e.target.value)}
                      placeholder="e.g. Maya"
                      className="typewriter-input mt-1 text-base text-ink-navy"
                    />
                  </label>
                  <label className="block font-caption text-caption uppercase tracking-wider text-on-surface-variant">
                    City / Neighborhood
                    <input
                      required
                      value={carrierLocation}
                      onChange={(e) => setCarrierLocation(e.target.value)}
                      placeholder="e.g. Portland"
                      className="typewriter-input mt-1 text-base text-ink-navy"
                    />
                  </label>
                </div>
                <label className="block font-caption text-caption uppercase tracking-wider text-on-surface-variant">
                  A tiny memory or note (optional)
                  <textarea
                    value={carrierNote}
                    onChange={(e) => setCarrierNote(e.target.value)}
                    placeholder="e.g. Carried across the river on a rainy afternoon."
                    className="mt-1 min-h-[72px] w-full resize-none border border-outline-variant bg-transparent p-sm font-body-md text-sm text-ink-navy outline-none focus:border-ink-navy"
                  />
                </label>
                <div className="flex items-center gap-md pt-2">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-sm bg-mint-accent px-lg py-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-ink-navy hover:bg-mint-accent/80"
                  >
                    Confirm Handoff <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-caption text-caption text-on-surface-variant">
                    Envelope contents stay 100% sealed
                  </span>
                </div>
              </form>
            </div>
          </section>
        )}

        <section className="border-b border-outline-variant/70 py-10 md:py-12">
          <div className="flex items-center gap-sm"><NotebookPen className="h-4 w-4 text-amber-accent" /><h2 className="font-headline-md text-headline-md text-ink-navy">Field notes</h2></div>
          <p className="mt-xs font-caption text-caption text-on-surface-variant">Private thoughts, saved alongside this relay.</p>
          <div className="mt-8 grid min-w-0 gap-10 md:grid-cols-2">
            <div className="space-y-5">{notes.map((note) => <div key={note.id} className="border-l-2 border-amber-accent/50 pl-md"><p className="font-caption text-caption uppercase tracking-[0.12em] text-on-surface-variant">{note.date}</p><p className="mt-xs font-body-md text-body-md italic leading-relaxed text-ink-navy">“{note.text}”</p></div>)}</div>
            <div><textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="What do you want to remember about this journey?" className="min-h-[112px] w-full resize-none border border-outline-variant bg-transparent p-md font-body-md text-body-md text-ink-navy outline-none placeholder:text-on-surface-variant/70 focus:border-ink-navy" /><button type="button" onClick={handleAddNote} disabled={!newNote.trim()} className="mt-sm bg-ink-navy px-lg py-sm font-label-md text-[11px] uppercase tracking-[0.12em] text-surface-bright hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-40">Save field note</button></div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function JourneyPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><Journey /></Suspense>;
}
