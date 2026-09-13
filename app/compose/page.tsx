'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, ArrowRight, Check, Minus, Plus } from 'lucide-react';
import { LetterProgress } from '@/components/LetterProgress';
import { getLetterDraft, saveLetterDraft, startNewLetter } from '@/lib/letterStore';
import { cn } from '@/lib/utils';

function Composer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('left');
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const draft = searchParams.get('new') === '1' ? startNewLetter() : getLetterDraft();
    setContent(draft.content);
    setRecipient(searchParams.get('recipient') || draft.recipient);
    setSubject(draft.subject);
    setFontSize(draft.fontSize);
    setAlignment(draft.alignment);
    setReady(true);
  }, [searchParams]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      saveLetterDraft({ content, recipient, subject, fontSize, alignment });
      setSaved(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [alignment, content, fontSize, recipient, ready, subject]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 180));
  const isComplete = Boolean(content.trim() && recipient.trim() && subject.trim());

  const handleNext = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isComplete) {
      setError('Add a recipient, subject, and a few words before moving to the address.');
      return;
    }
    setError('');
    saveLetterDraft({ content, recipient, subject, fontSize, alignment });
    router.push('/compose/address');
  };

  const alignClass = alignment === 'center' ? 'text-center' : alignment === 'right' ? 'text-right' : 'text-left';

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[980px]">
        <header className="page-header flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="button-quiet -ml-2">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to desk
            </Link>
            <div className="meta inline-flex items-center gap-2" aria-live="polite">
              {saved ? <Check className="h-3.5 w-3.5 text-[#4f9d7a]" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#b88938]" aria-hidden="true" />}
              {saved ? 'Saved to your desk' : ready ? 'Saving as you write' : 'Loading draft'}
            </div>
          </div>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Write a letter</p>
              <h1 className="section-title mt-3">Give the words a little room.</h1>
              <p className="body-copy mt-3 max-w-xl">Everything saves to your desk as you write. When it feels ready, add a destination and choose the mark that closes the envelope.</p>
            </div>
            <LetterProgress current="write" />
          </div>
        </header>

        <form onSubmit={handleNext} className="mt-10">
          <section className="paper-card overflow-hidden">
            <div className="grid gap-6 border-b border-[rgba(16,42,67,0.13)] px-5 py-6 sm:grid-cols-2 sm:px-9">
              <div>
                <label htmlFor="recipient" className="field-label">To <span className="text-[#b84b3a]">*</span></label>
                <input id="recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} className="input-field mt-2" placeholder="Eleanor Hartwell" autoComplete="name" />
              </div>
              <div>
                <label htmlFor="subject" className="field-label">Subject <span className="text-[#b84b3a]">*</span></label>
                <input id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="input-field mt-2" placeholder="Morning light" />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(16,42,67,0.1)] px-5 py-4 sm:px-9">
              <p className="meta">{wordCount} {wordCount === 1 ? 'word' : 'words'} · about {readingMinutes} min read</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center border border-[rgba(16,42,67,0.16)] bg-white/60" aria-label="Letter size">
                  <button type="button" className="flex h-11 w-11 items-center justify-center text-on-surface-variant hover:bg-white hover:text-ink-navy" onClick={() => setFontSize((size) => Math.max(16, size - 1))} aria-label="Decrease letter size"><Minus className="h-4 w-4" aria-hidden="true" /></button>
                  <span className="meta min-w-[2rem] text-center text-ink-navy">{fontSize}</span>
                  <button type="button" className="flex h-11 w-11 items-center justify-center text-on-surface-variant hover:bg-white hover:text-ink-navy" onClick={() => setFontSize((size) => Math.min(26, size + 1))} aria-label="Increase letter size"><Plus className="h-4 w-4" aria-hidden="true" /></button>
                </div>
                <div className="flex items-center gap-1 border border-[rgba(16,42,67,0.16)] bg-white/60 p-0.5" aria-label="Letter alignment">
                  {([
                    ['left', AlignLeft],
                    ['center', AlignCenter],
                    ['right', AlignRight],
                  ] as const).map(([value, Icon]) => (
                    <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={alignment === value} onClick={() => setAlignment(value)} className={cn('flex h-11 w-11 items-center justify-center text-on-surface-variant hover:bg-white hover:text-ink-navy', alignment === value && 'bg-ink-navy text-white hover:bg-ink-navy hover:text-white')}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="paper-lines min-h-[52vh] px-5 py-8 sm:px-9 sm:py-10">
              <label htmlFor="letter-content" className="sr-only">Letter contents</label>
              <textarea
                id="letter-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className={cn('min-h-[46vh] w-full resize-y border-0 bg-transparent font-literata leading-[2.2rem] text-ink-navy outline-none placeholder:text-on-surface-variant/60 focus:ring-0', alignClass)}
                style={{ fontSize: `${fontSize}px` }}
                placeholder="Write the words that deserve a journey through human hands…"
                spellCheck
                autoFocus
              />
            </div>
          </section>

          {error && <p className="notice error-notice mt-4" role="alert">{error}</p>}
          <div className="mt-6 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <p className="field-help">A recipient, subject, and message are needed before the letter can travel.</p>
            <button type="submit" disabled={!ready} className="button-primary shrink-0">
              Next: address & seal <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function ComposePage() {
  return <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading your desk…</p></div></main>}><Composer /></Suspense>;
}
