'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { EnvelopeOrbit } from '@/components/EnvelopeOrbit';
import { mockFieldNotes, mockTrackingEvents } from '@/data/mockData';
import { getJourneyNotes, getLetterDraft, getLettersWithDraft, saveJourneyNotes, type JourneyNote } from '@/lib/letterStore';
import { getRemoteJourney, saveRemoteJourneyNote } from '@/lib/letterBackend';

function Journey() {
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<JourneyNote[]>(mockFieldNotes);
  const [newNote, setNewNote] = useState('');
  const [recipient, setRecipient] = useState('your correspondent');
  const [subject, setSubject] = useState('Your letter');
  const [letterId, setLetterId] = useState('');
  const [trackingEvents, setTrackingEvents] = useState(mockTrackingEvents);

  useEffect(() => {
    let active = true;
    const loadJourney = async () => {
      const draft = getLetterDraft();
      const selectedId = searchParams.get('letter') || draft.id;
      const selectedLetter = getLettersWithDraft(draft).find((letter) => letter.id === selectedId);
      const status = selectedLetter?.status ?? draft.status;
      const selectedRecipient = selectedLetter?.recipient ?? draft.address.name ?? draft.recipient;
      const localEvents = mockTrackingEvents.map((event, index) => {
        const activeIndex = status === 'delivered' ? 4 : status === 'dispatched' ? 3 : status === 'sealed' ? 1 : 0;
        return {
          ...event,
          done: index <= activeIndex,
          current: index === activeIndex,
          note: index === 4 && status === 'delivered' ? `Delivered safely to ${selectedRecipient}.` : event.note,
        };
      });
      const remote = selectedId ? await getRemoteJourney(selectedId) : null;
      if (!active) return;
      setLetterId(selectedId);
      setRecipient(selectedRecipient || 'your correspondent');
      setSubject(selectedLetter?.subject ?? draft.subject ?? 'Your letter');
      setTrackingEvents(remote?.events.length ? remote.events : localEvents);
      setNotes(remote?.notes.length ? remote.notes : getJourneyNotes());
    };
    void loadJourney();
    return () => { active = false; };
  }, [searchParams]);

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

  const currentEvent = trackingEvents.find((event) => event.current) || trackingEvents[trackingEvents.length - 1];

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[900px] px-margin-mobile py-xl md:px-margin-desktop md:py-xxl">
        <header className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant hover:text-primary"><ArrowLeft className="h-4 w-4" /> Back to desk</Link>
          <span className="font-caption text-caption uppercase tracking-[0.2em] text-on-surface-variant">Letter journey</span>
        </header>

        <section className="mt-xl grid items-center gap-lg border-b border-outline-variant pb-xl md:grid-cols-[1fr_220px]">
          <div>
            <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">{currentEvent?.status || 'In progress'}</p>
            <h1 className="mt-sm max-w-xl font-headline-lg text-headline-lg text-primary md:text-display-lg">Your letter is on the way.</h1>
            <p className="mt-md max-w-xl font-body-lg text-body-lg leading-relaxed text-on-surface-variant">&ldquo;{subject}&rdquo; is travelling to {recipient}. Here is the whole story, one small update at a time.</p>
          </div>
          <EnvelopeOrbit compact />
        </section>

        <section className="mt-xl grid gap-xl md:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <div className="mb-lg flex items-end justify-between gap-md">
              <div><h2 className="font-headline-md text-headline-md text-primary">From your desk to theirs</h2><p className="mt-xs font-caption text-caption text-on-surface-variant">A quiet record of the trip.</p></div>
              <span className="font-caption text-caption text-on-surface-variant">{trackingEvents.filter((event) => event.done).length}/{trackingEvents.length} stops</span>
            </div>
            <TrackingTimeline events={trackingEvents} />
          </div>
          <aside className="h-fit border border-outline-variant bg-surface-container-lowest p-lg">
            <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">Next update</p>
            <p className="mt-sm font-headline-md text-headline-md text-primary">{currentEvent?.status || 'Soon'}</p>
            <p className="mt-sm font-body-md text-body-md leading-relaxed text-on-surface-variant">No frantic tracking. We will keep the little story here when something changes.</p>
          </aside>
        </section>

        <section className="mt-xxl border-t border-outline-variant pt-xl">
          <div className="flex items-center gap-sm"><NotebookPen className="h-4 w-4 text-amber-accent" /><h2 className="font-headline-md text-headline-md text-primary">A note to yourself</h2></div>
          <p className="mt-xs font-caption text-caption text-on-surface-variant">Private thoughts, saved with this letter.</p>
          <div className="mt-lg grid gap-md md:grid-cols-2">
            <div className="space-y-md">
              {notes.map((note) => <div key={note.id} className="border-l-2 border-amber-accent/40 pl-md"><p className="font-caption text-caption text-on-surface-variant">{note.date}</p><p className="mt-xs font-body-md text-body-md italic leading-relaxed text-primary">&ldquo;{note.text}&rdquo;</p></div>)}
            </div>
            <div><textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Write a private note…" className="min-h-[104px] w-full resize-none border border-outline-variant bg-transparent p-md font-body-md text-body-md text-primary outline-none placeholder:text-outline focus:border-primary" /><button type="button" onClick={handleAddNote} disabled={!newNote.trim()} className="mt-sm bg-ink-navy px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-surface-bright transition-colors hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-40">Save note</button></div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function JourneyPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><Journey /></Suspense>;
}
