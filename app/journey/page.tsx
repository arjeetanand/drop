'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bike, Clock, MapPin, Sparkles } from 'lucide-react';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { mockTrackingEvents, mockFieldNotes } from '@/data/mockData';
import { getJourneyNotes, getLetterDraft, getLettersWithDraft, saveJourneyNotes } from '@/lib/letterStore';

export default function Journey() {
  const searchParams = useSearchParams();
  const [secondsToNextScan, setSecondsToNextScan] = useState(48 * 3600 + 15 * 60 + 22);
  const [notes, setNotes] = useState(mockFieldNotes);
  const [newNote, setNewNote] = useState('');
  const [recipient, setRecipient] = useState('the valley');
  const [subject, setSubject] = useState('Your letter');
  const [trackingEvents, setTrackingEvents] = useState(mockTrackingEvents);

  useEffect(() => {
    const draft = getLetterDraft();
    const selectedLetterId = searchParams.get('letter');
    const selectedLetter = getLettersWithDraft(draft).find((letter) => letter.id === selectedLetterId);
    const selectedStatus = selectedLetter?.status ?? draft.status;
    const selectedRecipient = selectedLetter?.recipient ?? draft.address.name ?? draft.recipient;

    setRecipient(selectedRecipient || 'the valley');
    setSubject(selectedLetter?.subject ?? draft.subject ?? 'Your letter');
    setNotes(getJourneyNotes());
    const activeIndex = { draft: 0, sealed: 0, dispatched: 2, delivered: 4 }[selectedStatus];
    setTrackingEvents(
      mockTrackingEvents.map((event, index) => ({
        ...event,
        done: index <= activeIndex,
        current: index === activeIndex,
        note:
          index === 4 && selectedStatus === 'delivered'
            ? `Delivered safely to ${selectedRecipient}. The envelope made it through.`
            : event.note,
      }))
    );
  }, [searchParams]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsToNextScan((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    const nextNotes = [
      ...notes,
      {
        id: String(notes.length + 1),
        date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date()),
        text: newNote.trim(),
      },
    ];
    setNotes(nextNotes);
    saveJourneyNotes(nextNotes);
    setNewNote('');
  };

  const hours = Math.floor(secondsToNextScan / 3600);
  const minutes = Math.floor((secondsToNextScan % 3600) / 60);
  const seconds = secondsToNextScan % 60;
  const formatTime = (n: number) => String(n).padStart(2, '0');

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="max-w-[1140px] mx-auto px-margin-mobile md:px-margin-desktop pt-xl md:pt-xxl pb-xxl flex flex-col gap-xl">
        {/* Header & Timer */}
        <header className="text-center">
          <h1 className="font-headline-lg text-headline-lg md:text-display-lg text-primary italic mb-xs">
            A letter in motion
          </h1>
          <p className="font-body-md text-on-surface-variant mb-md">
            &ldquo;{subject}&rdquo; is travelling to {recipient}.
          </p>
          <div className="inline-flex items-center gap-sm border border-outline-variant bg-surface-container-lowest px-md py-sm">
            <Clock className="h-4 w-4 text-primary" />
            <span className="font-caption text-caption text-primary">
              Next scan in {formatTime(hours)}:{formatTime(minutes)}:{formatTime(seconds)}
            </span>
          </div>
        </header>

        {/* Journey map */}
        <section className="relative h-[280px] w-full overflow-hidden border border-outline-variant bg-[#e8d5b0] shadow-sm card-depth md:h-[360px]">
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.7),transparent_28%),radial-gradient(circle_at_85%_70%,rgba(139,45,45,0.13),transparent_30%)]" />
          <div className="absolute left-[12%] right-[12%] top-1/2 h-px border-t border-dashed border-ink-navy/40" />
          <div className="absolute left-[12%] top-1/2 -translate-y-1/2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-navy text-parchment shadow-md">
              <MapPin className="h-5 w-5" />
            </div>
            <p className="mt-sm font-caption text-caption text-ink-navy">Your desk</p>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-wax-red">
            <div className="journey-bike flex h-14 w-14 items-center justify-center rounded-full border border-wax-red/40 bg-parchment shadow-lg">
              <Bike className="h-7 w-7" />
            </div>
            <p className="mt-sm text-center font-caption text-caption text-ink-navy">On the way</p>
          </div>
          <div className="absolute right-[12%] top-1/2 -translate-y-1/2 text-right">
            <div className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-wax-red text-parchment shadow-md">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="mt-sm font-caption text-caption text-ink-navy">{recipient}</p>
          </div>
          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 font-caption text-caption uppercase tracking-[0.25em] text-ink-navy/60">
            Every mile carries a little of you
          </p>
        </section>

        {/* Journey Log / Field Notes Timeline */}
        <section className="max-w-[700px] mx-auto w-full">
          <h2 className="font-label-md text-label-md uppercase tracking-widest text-primary mb-lg text-center opacity-70">
            Journey log
          </h2>
          <TrackingTimeline events={trackingEvents} />
        </section>

        {/* Field Notes Journal Entry Area */}
        <section className="max-w-[700px] mx-auto w-full mt-xl">
          <h2 className="font-label-md text-label-md uppercase tracking-widest text-primary mb-lg text-center opacity-70">
            Your private notes
          </h2>
          <div className="paper-layer p-lg card-depth space-y-md">
            {notes.map((note) => (
              <div key={note.id} className="border-l-2 border-amber-accent/40 pl-md">
                <p className="font-caption text-caption text-on-surface-variant mb-1">
                  {note.date}
                </p>
                <p className="font-body-md text-on-surface italic leading-relaxed">
                  &ldquo;{note.text}&rdquo;
                </p>
              </div>
            ))}
            <div className="pt-md border-t border-outline-variant/30">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Write a private note about this letter..."
                className="w-full bg-transparent border border-outline-variant rounded-sm p-md font-body-md text-on-surface placeholder:text-outline-variant focus:outline-none focus:border-primary transition-colors resize-none min-h-[80px]"
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="mt-sm px-lg py-sm bg-ink-navy text-surface-bright font-label-md text-label-md uppercase tracking-widest rounded-sm hover:bg-ink-navy/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add Note
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
