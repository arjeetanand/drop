'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, MapPin, Plus, Route as RouteIcon, Share2, ShieldCheck, X } from 'lucide-react';
import { RelayChain } from '@/components/RelayChain';
import { RouteMap } from '@/components/RouteMap';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { currentFocusDraft } from '@/data/mockData';
import { getRemoteJourney, saveRemoteJourneyNote } from '@/lib/letterBackend';
import { getJourneyNotes, getLetterDraft, getLettersWithDraft, saveJourneyNotes, type JourneyNote } from '@/lib/letterStore';
import { addRelayHandoff, getInitialRelayState, getRelayState, getRelayStats, relayToTrackingEvents, type RelayState } from '@/lib/relayStore';

function JourneyContent() {
  const searchParams = useSearchParams();
  const [letterId, setLetterId] = useState(currentFocusDraft.id);
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [notes, setNotes] = useState<JourneyNote[]>([]);
  const [newNote, setNewNote] = useState('');
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
        subject: selectedLetter?.subject || draft.subject || currentFocusDraft.subject,
        recipient: selectedLetter?.recipient || draft.address.name || draft.recipient || 'Eleanor',
      });
      const remote = await getRemoteJourney(selectedId);
      if (!active) return;
      setLetterId(selectedId);
      setRelay(nextRelay);
      setNotes(remote?.notes.length ? remote.notes : getJourneyNotes(selectedId));
      if (searchParams.get('join') === '1') setShowHandoff(true);
    };
    void loadJourney();
    return () => {
      active = false;
    };
  }, [searchParams]);

  const stats = getRelayStats(relay);
  const events = relayToTrackingEvents(relay);
  const shareLink = typeof window === 'undefined'
    ? `/journey?letter=${encodeURIComponent(letterId)}&join=1`
    : `${window.location.origin}/journey?letter=${encodeURIComponent(letterId)}&join=1`;

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

  const handleRecordHandoff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!carrierName.trim() || !carrierLocation.trim()) return;
    const name = carrierName.trim();
    const next = addRelayHandoff(letterId, { name, location: carrierLocation, note: carrierNote }, { subject: relay.subject, recipient: relay.recipient });
    setRelay(next);
    setCarrierName('');
    setCarrierLocation('');
    setCarrierNote('');
    setShowHandoff(false);
    showNotice(`${name} was added to the relay.`);
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      showNotice('Carrier link copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showNotice(shareLink);
    }
  };

  return (
    <main className="page-shell page-enter">
      <div className="page-container">
        <header className="page-header flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="button-quiet -ml-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to desk</Link>
            <div className="meta inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#4f9d7a]" aria-hidden="true" /> {relay.passcode}</div>
          </div>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Journey tracker</p>
              <h1 className="display-title mt-4 max-w-3xl">The story between here and there.</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg"><span className="text-ink-navy">“{relay.subject}”</span> is moving toward <span className="text-ink-navy">{relay.recipient}</span> through willing hands. Follow the route without opening the letter.</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <button type="button" onClick={() => void copyShareLink()} className="button-primary"><Share2 className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" /> {copied ? 'Link copied' : 'Share carrier link'}</button>
              <button type="button" onClick={() => setShowHandoff((value) => !value)} className="button-secondary"><Plus className="h-4 w-4" aria-hidden="true" /> Record a handoff</button>
            </div>
          </div>
        </header>

        {notice && <p className="notice mt-5" aria-live="polite">{notice}</p>}

        <section className="mt-12 grid gap-6 border-b border-[rgba(16,42,67,0.13)] pb-8 sm:grid-cols-3">
          <div><p className="font-headline-md text-3xl text-ink-navy">{stats.carriers}</p><p className="mt-1 text-xs text-on-surface-variant">People who have carried it</p></div>
          <div className="border-l border-[rgba(16,42,67,0.12)] pl-5 sm:pl-7"><p className="font-headline-md text-3xl text-ink-navy">{relay.gpsWaypoints?.length || stats.cities}</p><p className="mt-1 text-xs text-on-surface-variant">Route stops recorded</p></div>
          <div className="border-l border-[rgba(16,42,67,0.12)] pl-5 sm:pl-7"><p className="font-headline-md text-3xl text-ink-navy">{stats.hours}h</p><p className="mt-1 text-xs text-on-surface-variant">Journey age</p></div>
        </section>

        {showHandoff && (
          <form onSubmit={handleRecordHandoff} className="panel mt-8 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div><p className="eyebrow">Carrier log</p><h2 className="mt-2 font-headline-md text-2xl text-ink-navy">Record the next handoff.</h2><p className="mt-2 text-sm leading-relaxed text-on-surface-variant">Add the person and neighborhood that move the letter forward. The contents stay sealed.</p></div>
              <button type="button" onClick={() => setShowHandoff(false)} className="button-quiet -mr-2 -mt-2" aria-label="Close handoff form"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="field-label" htmlFor="carrier-name">Carrier name <span className="text-[#b84b3a]">*</span><input id="carrier-name" required value={carrierName} onChange={(event) => setCarrierName(event.target.value)} className="input-field mt-2" placeholder="Maya" autoComplete="name" /></label>
              <label className="field-label" htmlFor="carrier-location">Neighborhood or stop <span className="text-[#b84b3a]">*</span><input id="carrier-location" required value={carrierLocation} onChange={(event) => setCarrierLocation(event.target.value)} className="input-field mt-2" placeholder="Dadar" /></label>
              <label className="field-label md:col-span-2" htmlFor="carrier-note">Field note <span className="font-normal text-on-surface-variant">(optional)</span><textarea id="carrier-note" value={carrierNote} onChange={(event) => setCarrierNote(event.target.value)} className="textarea-field mt-2 min-h-[5rem]" placeholder="A small detail from this part of the route…" /></label>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="field-help inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#4f9d7a]" aria-hidden="true" /> Only the route is recorded.</p><button type="submit" className="button-primary">Add to relay <ArrowRight className="h-4 w-4" aria-hidden="true" /></button></div>
          </form>
        )}

        <section className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Route map</p><h2 className="section-title mt-2">Every hand leaves a stop.</h2></div><span className="meta">{relay.gpsWaypoints?.length || 0} GPS waypoints</span></div>
            <div className="panel mt-5 p-5 sm:p-7">
              <RouteMap waypoints={relay.gpsWaypoints ?? []} destinationNeighborhood={relay.destinationNeighborhood || relay.recipient} currentCarrierName={relay.currentCarrierName} />
              <div className="mt-7 border-t border-[rgba(16,42,67,0.1)] pt-6"><RelayChain relay={relay} /></div>
            </div>

            <div className="mt-10">
              <div className="flex items-end justify-between gap-4"><div><p className="eyebrow">Custody timeline</p><h2 className="section-title mt-2">A record of the route.</h2></div><RouteIcon className="h-5 w-5 text-[#4f9d7a]" aria-hidden="true" /></div>
              <div className="mt-5 panel p-6 sm:p-8"><TrackingTimeline events={events} /></div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="panel p-5 sm:p-6"><p className="eyebrow">Privacy promise</p><div className="mt-4 flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#4f9d7a]" aria-hidden="true" /><p className="text-sm leading-relaxed text-on-surface-variant">Carriers see the destination, never the words. Locations are kept at neighborhood level rather than exact address.</p></div></div>
            <div className="panel-muted p-5 sm:p-6"><p className="eyebrow text-[#b88938]">Field notes</p><div className="mt-5 space-y-4">{notes.length ? notes.map((note) => <div key={note.id} className="border-b border-[rgba(16,42,67,0.12)] pb-4 last:border-0 last:pb-0"><p className="meta">{note.date}</p><p className="mt-2 font-literata text-base leading-relaxed text-ink-navy">{note.text}</p></div>) : <p className="text-sm leading-relaxed text-on-surface-variant">The first note will appear here as the letter moves.</p>}</div><label htmlFor="new-note" className="field-label mt-6 block">Add a field note<textarea id="new-note" value={newNote} onChange={(event) => setNewNote(event.target.value)} className="textarea-field mt-2 min-h-[6rem]" placeholder="What did this part of the journey feel like?" /></label><button type="button" onClick={handleAddNote} disabled={!newNote.trim()} className="button-secondary mt-3 w-full disabled:opacity-45">Save field note</button></div>
            <div className="border-t border-[rgba(16,42,67,0.12)] pt-5"><p className="eyebrow">Route identity</p><p className="mt-2 font-mono text-sm font-bold text-ink-navy">{relay.passcode}</p><p className="mt-2 inline-flex items-center gap-2 text-xs text-on-surface-variant"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {relay.destinationNeighborhood || relay.recipient}</p></div>
          </aside>
        </section>
      </div>
    </main>
  );
}

export default function JourneyPage() {
  return <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading the journey…</p></div></main>}><JourneyContent /></Suspense>;
}
