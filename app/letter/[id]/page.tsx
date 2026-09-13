'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, MailOpen } from 'lucide-react';
import { useParams } from 'next/navigation';
import type { MockLetter } from '@/data/mockData';
import { getRemoteLetterById, getRemoteLetters } from '@/lib/letterBackend';
import { getLetterById } from '@/lib/letterStore';

function LoadingLetter() {
  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <div className="flex min-h-[70dvh] items-center justify-center">
          <p className="meta" role="status" aria-live="polite">
            Finding the letter…
          </p>
        </div>
      </div>
    </main>
  );
}

function MissingLetter() {
  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <header className="page-header">
          <Link
            href="/"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to desk
          </Link>
        </header>
        <section className="panel mt-12 p-7 sm:p-10">
          <p className="eyebrow">Letter not found</p>
          <h1 className="section-title mt-3">This letter has not reached this desk.</h1>
          <p className="body-copy mt-4 max-w-xl">
            The address may be out of date, or the letter may still be finding its way through the relay.
          </p>
          <Link
            href="/mailbox"
            className="button-primary mt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            Open mailbox
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </div>
    </main>
  );
}

export default function LetterArrivalPage() {
  const params = useParams<{ id?: string | string[] }>();
  const letterId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [letter, setLetter] = useState<MockLetter | null>(null);
  const [fullContentAvailable, setFullContentAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentNotice, setContentNotice] = useState('');

  useEffect(() => {
    if (!letterId) {
      setLoading(false);
      return;
    }

    let active = true;

    const loadLetter = async () => {
      const localLetter = getLetterById(letterId);
      if (localLetter) {
        if (active) {
          setLetter(localLetter);
          setFullContentAvailable(true);
          setLoading(false);
        }
        return;
      }

      try {
        const remoteLetters = await getRemoteLetters();
        const remoteLetter = remoteLetters?.find((candidate) => candidate.id === letterId) || null;
        if (active) {
          setLetter(remoteLetter);
          setFullContentAvailable(false);
        }
      } catch {
        if (active) {
          setLetter(null);
          setFullContentAvailable(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLetter();
    return () => {
      active = false;
    };
  }, [letterId]);

  const revealFragments = async () => {
    setContentNotice('');

    if (!fullContentAvailable && letterId) {
      setContentLoading(true);
      try {
        const remoteDetail = await getRemoteLetterById(letterId);
        if (remoteDetail) {
          setLetter(remoteDetail);
          setFullContentAvailable(true);
        } else {
          setContentNotice('The complete letter is available when you are signed in as its recipient. This view will keep the relay preview available.');
        }
      } catch {
        setContentNotice('The complete letter could not be loaded right now. This view will keep the relay preview available.');
      } finally {
        setContentLoading(false);
      }
    }

    setRevealed(true);
  };

  const teasers = useMemo(() => {
    if (!letter) return [];

    const savedTeasers = letter.teaser?.filter((teaser) => teaser.trim()) || [];
    if (savedTeasers.length) return savedTeasers;

    const excerpt = letter.excerpt.trim();
    return [
      'A little thought found its way to you.',
      excerpt ? `${excerpt.slice(0, 64)}${excerpt.length > 64 ? '…' : ''}` : 'Some words are waiting behind the seal.',
      'Open when you want the whole story.',
    ];
  }, [letter]);

  if (loading) return <LoadingLetter />;
  if (!letter) return <MissingLetter />;

  const sender = letter.sender || 'A correspondent';
  const isReceived = letter.direction === 'received';
  const encodedLetterId = encodeURIComponent(letter.id);

  return (
    <main className="page-shell page-enter">
      <div className="page-container">
        <header className="page-header flex-col gap-5 sm:flex-row sm:items-center">
          <Link
            href="/mailbox"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to mailbox
          </Link>
          <p className="meta">Letter {letter.id}</p>
        </header>

        <section className="mt-12 max-w-[760px]">
          <p className="eyebrow">{isReceived ? 'A letter for you' : 'Letter preview'}</p>
          <h1 className="display-title mt-4 max-w-[12ch]">Something made its way to you.</h1>
          <p className="body-copy mt-5 max-w-2xl text-lg">
            {sender} left a message in your hands. Read the fragments first, then open the full letter when you are ready.
          </p>
        </section>

        <section className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(250px,0.7fr)]">
          <article className="paper-card p-6 sm:p-9">
            <div className="flex flex-col gap-5 border-b border-[rgba(16,42,67,0.13)] pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="eyebrow">Subject</p>
                <h2 className="section-title mt-2 text-3xl">{letter.subject}</h2>
                <p className="meta mt-3">From {sender} · {letter.date}</p>
              </div>
              <span className="status-mark success self-start">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                {isReceived ? 'Received' : 'Ready to read'}
              </span>
            </div>

            <div id="letter-fragments" className="mt-6" aria-label="Letter fragments">
              <p className="meta">Three fragments, kept closed until you ask to see them.</p>
              <ol className="mt-3 divide-y divide-[rgba(16,42,67,0.1)] border-y border-[rgba(16,42,67,0.1)]">
                {teasers.map((teaser, index) => (
                  <li key={`${teaser}-${index}`} className="flex gap-4 py-5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[rgba(16,42,67,0.14)] bg-white text-[#b84b3a]">
                      {revealed ? <Check className="h-4 w-4" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <p className="font-literata text-base leading-relaxed text-ink-navy">
                      {revealed ? teaser : 'A confidential fragment is resting behind the seal.'}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <p className="sr-only" aria-live="polite">
              {revealed ? 'The letter fragments are now visible.' : ''}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-[rgba(16,42,67,0.1)] pt-6">
              {!revealed && (
                <button
                  type="button"
                  onClick={() => void revealFragments()}
                  disabled={contentLoading}
                  aria-controls="letter-fragments"
                  aria-expanded={revealed}
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  {contentLoading ? 'Loading the full letter…' : 'Reveal fragments'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {revealed && !opened && (
                <button
                  type="button"
                  onClick={() => setOpened(true)}
                  aria-controls="letter-body"
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  Open received letter
                  <MailOpen className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {opened && <p className="meta">The full letter is open below.</p>}
            </div>

            {contentNotice && <p className="notice mt-5" role="status" aria-live="polite">{contentNotice}</p>}

            {opened && (
              <section id="letter-body" className="mt-8 border-t border-[rgba(16,42,67,0.13)] pt-8" aria-live="polite">
                <p className="eyebrow text-[#b84b3a]">Unsealed</p>
                <div className="mt-4 border-l-2 border-[#b84b3a] bg-white px-6 py-7 sm:px-8">
                  <p className="body-copy text-lg text-ink-navy">
                    {fullContentAvailable
                      ? letter.excerpt
                      : 'This letter is still available as a sealed preview. Sign in as its recipient to read the full words.'}
                  </p>
                  <p className="meta mt-6 border-t border-[rgba(16,42,67,0.1)] pt-4">From {sender}</p>
                </div>
                <Link
                  href={`/journey?letter=${encodedLetterId}`}
                  className="button-secondary mt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  Follow the letter&apos;s journey
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </section>
            )}
          </article>

          <aside className="space-y-6">
            <section className="panel p-6">
              <p className="eyebrow">Before you open</p>
              <h2 className="section-title mt-3 text-2xl">Take your time.</h2>
              <p className="body-copy mt-3 text-sm">
                A sealed letter can wait. Opening it shows the message and keeps the route available for you to revisit.
              </p>
            </section>

            <section className="panel-muted p-6">
              <p className="eyebrow">Letter details</p>
              <dl className="mt-5 divide-y divide-[rgba(16,42,67,0.1)] border-y border-[rgba(16,42,67,0.1)]">
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="meta">From</dt>
                  <dd className="text-right text-sm font-semibold text-ink-navy">{sender}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="meta">Addressed to</dt>
                  <dd className="text-right text-sm font-semibold text-ink-navy">{letter.recipient || 'you'}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="meta">Privacy</dt>
                  <dd className="text-right text-sm font-semibold text-[#4f9d7a]">Words stay sealed in transit</dd>
                </div>
              </dl>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
