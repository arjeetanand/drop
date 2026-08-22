'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, Inbox } from 'lucide-react';
import { mockLetters } from '@/data/mockData';
import { LetterCard } from '@/components/LetterCard';
import { getLetterDraft, getLettersWithDraft } from '@/lib/letterStore';

export default function Mailbox() {
  const [all, setAll] = useState(mockLetters);

  useEffect(() => {
    setAll(getLettersWithDraft(getLetterDraft()));
  }, []);

  const needsAttention = all.filter((letter) => letter.status === 'draft' || letter.status === 'sealed').slice(0, 3);

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="max-w-[1140px] mx-auto px-margin-mobile md:px-margin-desktop py-xl md:py-xxl">
        <header className="mb-xxl text-center md:text-left">
          <div className="flex items-center gap-md mb-md">
            <Inbox className="h-8 w-8 text-primary" />
            <h2 className="font-headline-lg text-headline-lg text-primary">
              The Mailbox
            </h2>
          </div>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl leading-relaxed">
            Letters waiting for your attention, and those you have sent into the world.
          </p>
        </header>

        {/* Needs attention section */}
        <section className="mb-xxl">
          <h3 className="font-label-md text-label-md uppercase tracking-widest text-primary mb-lg opacity-70">
            Needs attention
          </h3>
          {needsAttention.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
              {needsAttention.map((letter) => (
              <Link
                key={letter.id}
                href={letter.status === 'draft' ? '/compose' : `/compose/address`}
                className="paper-layer p-lg card-depth hover:bg-secondary-container/5 transition-colors group"
              >
                <div className="flex items-start justify-between mb-sm">
                  <Mail className="h-5 w-5 text-amber-accent" />
                  <span className="font-caption text-caption text-on-surface-variant">
                    {letter.date}
                  </span>
                </div>
                <h4 className="font-headline-md text-headline-md text-primary mb-xs">
                  {letter.subject}
                </h4>
                <p className="font-caption text-caption text-on-surface-variant mb-sm">
                  From: {letter.recipient}
                </p>
                <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed line-clamp-2">
                  {letter.excerpt}
                </p>
              </Link>
              ))}
            </div>
          ) : (
            <div className="border border-outline-variant/60 bg-surface-container-lowest p-lg text-center">
              <p className="font-body-md text-body-md text-on-surface-variant">Everything is caught up for now.</p>
            </div>
          )}
        </section>

        <hr className="thin-rule my-xxl" />

        {/* All letters */}
        <section>
          <div className="flex justify-between items-baseline mb-lg">
            <h3 className="font-headline-md text-headline-md text-primary">
              All Correspondence
            </h3>
            <Link
              href="/"
              className="font-caption text-caption text-on-surface-variant hover:text-primary transition-colors border-b border-transparent hover:border-primary"
            >
              Back to Desk
            </Link>
          </div>
          <div className="flex flex-col">
            {all.map((letter) => (
              <LetterCard key={letter.id} letter={letter} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
