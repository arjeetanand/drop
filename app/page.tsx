'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Inbox, PenLine, Sparkles } from 'lucide-react';
import { LetterCard } from '@/components/LetterCard';
import { mockLetters, currentFocusDraft } from '@/data/mockData';
import { getLetterDraft, getLettersWithDraft, type LetterDraftState } from '@/lib/letterStore';

export default function HomeDesk() {
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [letters, setLetters] = useState(mockLetters);

  useEffect(() => {
    const activeDraft = getLetterDraft();
    setDraft(activeDraft);
    setLetters(getLettersWithDraft(activeDraft));
  }, []);

  const focusDraft = draft ?? {
    ...currentFocusDraft,
    content: currentFocusDraft.excerpt,
    status: 'draft' as const,
  };
  const focusRecipient = focusDraft.recipient || 'someone special';
  const focusSubject = focusDraft.subject || 'Untitled letter';

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="max-w-[1140px] mx-auto px-margin-mobile md:px-margin-desktop py-xl md:py-xxl">
        {/* Hero / Greeting */}
        <section className="mb-xxl text-center md:text-left">
          <h2 className="font-headline-lg text-headline-lg md:font-headline-lg md:text-display-lg text-primary mb-md font-headline-lg">
            Write something worth keeping.
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl leading-relaxed">
            Pick up where you left off, or give a thought a place to land. Your letters stay here until you are ready to send them.
          </p>
        </section>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
          {/* Current Focus */}
          <article className="md:col-span-8 paper-layer p-xl flex flex-col justify-between min-h-[400px] relative group card-depth">
            <div className="absolute top-0 right-0 p-md opacity-10 pointer-events-none">
              <PenLine className="h-[120px] w-[120px] text-primary" />
            </div>
            <div className="relative z-10">
              <span className="inline-block px-sm py-xs border border-outline-variant font-caption text-caption text-on-surface-variant mb-lg uppercase tracking-wider">
                In progress
              </span>
              <p className="font-caption text-caption text-on-surface-variant mb-sm uppercase tracking-widest">
                To {focusRecipient}
              </p>
              <h3 className="font-headline-lg text-headline-lg text-primary mb-md">
                {focusSubject}
              </h3>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-md leading-relaxed line-clamp-4">
                {focusDraft.content.trim() ? <>&ldquo;{focusDraft.content}&rdquo;</> : 'Your next thought starts here.'}
              </p>
              <p className="font-caption text-caption text-outline mt-md">
                Last edited {draft ? new Date(draft.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : currentFocusDraft.lastEdited} · {focusDraft.content.trim() ? focusDraft.content.trim().split(/\s+/).length : 0} words
              </p>
            </div>
            <div className="relative z-10 flex justify-end mt-xl">
              <Link
                href={focusDraft.status === 'draft' ? '/compose' : '/journey'}
                className="flex items-center gap-sm px-lg py-sm border border-primary text-primary font-label-md text-label-md hover:bg-secondary-container hover:border-transparent transition-all duration-300"
              >
                {focusDraft.status === 'draft' ? 'Continue Writing' : 'Follow the Journey'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </article>

          {/* Right Column */}
          <div className="md:col-span-4 flex flex-col gap-gutter">
            {/* Mailbox Status */}
            <Link
              href="/mailbox"
              className="paper-layer p-lg flex flex-col items-center justify-center text-center h-full min-h-[188px] hover:bg-secondary-container/10 transition-colors card-depth"
            >
              <Inbox className="h-8 w-8 text-primary mb-sm" />
              <h4 className="font-headline-md text-headline-md text-primary">{letters.length} Letters</h4>
              <p className="font-caption text-caption text-on-surface-variant mt-xs">
                Open your correspondence
              </p>
            </Link>

            {/* Ambient Detail */}
            <div className="paper-layer p-lg h-full min-h-[188px] relative overflow-hidden flex flex-col justify-end group card-depth">
              <div
                className="absolute inset-0 z-0 opacity-40 grayscale group-hover:opacity-60 transition-opacity duration-700 bg-cover bg-center mix-blend-multiply"
                style={{
                  backgroundImage:
                    "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBJMAduuy5EbxaOmTgsJGScXZq7QO9NZ3JS0s61CE_DIGAINabQXi6MfWrHFUFIA6GH_rE--VcB7OzPiRBzSHffz9V-co8IFaPOZAqRlcOE5_Rfr_9JVOrdhh68r_rU7uY7cmY6bdud0I4ZO3ZmaavtDbsnpoYDaqnSHG78jQShppn8kaesHp9ZrBMWVCuqXyc49SFe4YY2Ghv34Hk14wHTcLwfq5F-hknXIXRfyzJ9ifEjgQV9AhzfCw')",
                }}
              />
              <div className="relative z-10 bg-surface/90 backdrop-blur-sm p-sm border border-outline-variant self-start flex items-center gap-sm">
                <Sparkles className="h-3 w-3 text-primary" />
                <p className="font-caption text-caption text-primary">Inspiration</p>
              </div>
            </div>
          </div>
        </div>

        <hr className="thin-rule my-xxl" />

        {/* Recent Artifacts */}
        <section>
          <div className="flex justify-between items-baseline mb-lg">
            <h3 className="font-headline-md text-headline-md text-primary">
              Recent Artifacts
            </h3>
            <Link
              href="/mailbox"
              className="font-caption text-caption text-on-surface-variant hover:text-primary transition-colors border-b border-transparent hover:border-primary"
            >
              View Ledger
            </Link>
          </div>
          <div className="flex flex-col">
            {letters.map((letter) => (
              <LetterCard key={letter.id} letter={letter} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
