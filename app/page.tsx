'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Inbox, PenLine } from 'lucide-react';
import { EnvelopeOrbit } from '@/components/EnvelopeOrbit';
import { IncomingLetterCard } from '@/components/IncomingLetterCard';
import { LetterCard } from '@/components/LetterCard';
import { currentFocusDraft, mockLetters } from '@/data/mockData';
import { getLetterDraft, getLettersWithDraft, type LetterDraftState } from '@/lib/letterStore';
import { getRemoteLetters, getRemoteProfile } from '@/lib/letterBackend';
import { defaultUserProfile, getUserProfile, type UserProfile } from '@/lib/userStore';

export default function HomeDesk() {
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [letters, setLetters] = useState(mockLetters);
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);

  useEffect(() => {
    let active = true;
    const loadDesk = async () => {
      const localDraft = getLetterDraft();
      const [remoteLetters, remoteProfile] = await Promise.all([getRemoteLetters(), getRemoteProfile()]);
      if (!active) return;
      setDraft(localDraft);
      setLetters(remoteLetters?.length ? remoteLetters : getLettersWithDraft(localDraft));
      setProfile(remoteProfile || getUserProfile());
    };
    void loadDesk();
    return () => { active = false; };
  }, []);

  const focusDraft = draft ?? { ...currentFocusDraft, content: currentFocusDraft.excerpt, status: 'draft' as const };
  const focusRecipient = focusDraft.recipient || 'someone special';
  const focusSubject = focusDraft.subject || 'Untitled letter';
  const incoming = letters.find((letter) => letter.direction === 'received') || mockLetters.find((letter) => letter.direction === 'received');
  const recentLetters = letters.filter((letter) => letter.id !== focusDraft.id && letter.id !== incoming?.id).slice(0, 5);

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[980px] px-margin-mobile py-xl md:px-margin-desktop md:py-xxl">
        <section className="grid items-center gap-xl border-b border-outline-variant pb-xl md:grid-cols-[1fr_300px]">
          <div>
            <h1 className="max-w-xl font-headline-lg text-headline-lg text-primary md:text-display-lg">Write something worth keeping.</h1>
            <p className="mt-md max-w-xl font-body-lg text-body-lg leading-relaxed text-on-surface-variant">A quiet place for letters, small updates, and the people you do not want to lose touch with.</p>
            <div className="mt-lg flex flex-wrap items-center gap-md">
              <Link href="/compose?new=1" className="inline-flex items-center gap-sm bg-ink-navy px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-surface-bright transition-transform hover:-translate-y-0.5"><PenLine className="h-4 w-4" /> Write a letter</Link>
              <Link href="/mailbox" className="inline-flex items-center gap-sm border border-primary px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-primary hover:bg-secondary-container/30"><Inbox className="h-4 w-4" /> Open mailbox</Link>
            </div>
          </div>
          <EnvelopeOrbit />
        </section>

        {incoming && <section className="mt-xl"><IncomingLetterCard letter={incoming} /></section>}

        <section className="mt-xxl">
          <div className="flex items-end justify-between gap-md border-b border-outline-variant pb-md">
            <div><p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">On your desk</p><h2 className="mt-xs font-headline-md text-headline-md text-primary">{focusSubject}</h2></div>
            <span className="font-caption text-caption text-on-surface-variant">@{profile.username}</span>
          </div>
          <div className="flex flex-col gap-md border-b border-outline-variant py-lg md:flex-row md:items-end md:justify-between">
            <div><p className="font-caption text-caption text-on-surface-variant">To {focusRecipient}</p><p className="mt-sm max-w-2xl font-body-md text-body-md leading-relaxed text-primary">{focusDraft.content.trim() ? `“${focusDraft.content}”` : 'Your next thought starts here.'}</p><p className="mt-md font-caption text-caption text-on-surface-variant">{focusDraft.content.trim() ? `${focusDraft.content.trim().split(/\s+/).length} words` : 'Draft saved locally'}</p></div>
            <Link href={focusDraft.status === 'draft' ? '/compose' : '/journey'} className="inline-flex shrink-0 items-center gap-sm border border-primary px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-primary hover:bg-secondary-container/30">{focusDraft.status === 'draft' ? 'Continue writing' : 'Follow journey'} <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </section>

        <section className="mt-xxl">
          <div className="flex items-end justify-between border-b border-outline-variant pb-md"><h2 className="font-headline-md text-headline-md text-primary">Recent letters</h2><Link href="/mailbox" className="font-caption text-caption text-on-surface-variant hover:text-primary">View all</Link></div>
          <div>{recentLetters.map((letter) => <LetterCard key={letter.id} letter={letter} />)}</div>
          {!recentLetters.length && <p className="py-xl font-body-md text-body-md text-on-surface-variant">Your sent letters will appear here.</p>}
        </section>
      </div>
    </main>
  );
}
