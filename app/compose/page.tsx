'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ArrowLeft, ArrowRight, Minus, Plus, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLetterDraft, saveLetterDraft, startNewLetter } from '@/lib/letterStore';
import { LetterProgress } from '@/components/LetterProgress';

function Composer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('left');
  const [showToolbar, setShowToolbar] = useState(true);
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const initializedNewLetter = useRef(false);

  useEffect(() => {
    const draft = searchParams.get('new') === '1' && !initializedNewLetter.current
      ? startNewLetter()
      : getLetterDraft();
    initializedNewLetter.current = true;
    setContent(draft.content);
    setRecipient(draft.recipient);
    setSubject(draft.subject);
    setFontSize(draft.fontSize);
    setAlignment(draft.alignment);
    setReady(true);
  }, [searchParams]);

  useEffect(() => {
    if (!ready) return;

    const saveTimer = setTimeout(() => {
      saveLetterDraft({ content, recipient, subject, fontSize, alignment });
      setSaved(true);
    }, 450);
    const hideTimer = setTimeout(() => setSaved(false), 2600);

    return () => {
      clearTimeout(saveTimer);
      clearTimeout(hideTimer);
    };
  }, [alignment, content, fontSize, recipient, ready, subject]);

  const handleSealLetter = () => {
    if (!content.trim() || !recipient.trim() || !subject.trim()) return;
    saveLetterDraft({ content, recipient, subject, fontSize, alignment });
    router.push('/compose/address');
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 180));

  const handleScroll = () => {
    const currentScrollY = scrollRef.current?.scrollTop ?? 0;
    if (currentScrollY > lastScrollY.current && currentScrollY > 50) {
      setShowToolbar(false);
    } else {
      setShowToolbar(true);
    }
    lastScrollY.current = currentScrollY;
  };

  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  }[alignment];

  return (
    <div className="page-enter min-h-screen flex flex-col bg-background">
      {/* Minimal toolbar */}
      <div
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-transform duration-300 bg-surface/90 backdrop-blur-sm border-b border-outline-variant/30',
          showToolbar ? 'translate-y-0' : '-translate-y-full'
        )}
      >
        <div className="flex items-center justify-between px-margin-mobile md:px-margin-desktop py-sm">
          <div className="flex items-center gap-md">
            <Link
              href="/"
              className="flex items-center gap-sm text-on-surface-variant hover:text-primary transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="font-caption text-caption hidden sm:inline">Back to Desk</span>
            </Link>
          </div>

          <div className="flex items-center gap-sm">
            {/* Font size controls */}
            <div className="flex items-center gap-xs border border-outline-variant rounded-full px-sm py-xs">
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 2))}
                className="text-on-surface-variant hover:text-primary transition-colors"
                aria-label="Decrease font size"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="font-caption text-caption text-on-surface-variant min-w-[24px] text-center">
                {fontSize}
              </span>
              <button
                onClick={() => setFontSize((s) => Math.min(28, s + 2))}
                className="text-on-surface-variant hover:text-primary transition-colors"
                aria-label="Increase font size"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Alignment controls */}
            <div className="flex items-center gap-xs border border-outline-variant rounded-full px-sm py-xs">
              {([
                { value: 'left', icon: AlignLeft },
                { value: 'center', icon: AlignCenter },
                { value: 'right', icon: AlignRight },
              ] as const).map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setAlignment(value)}
                  className={cn(
                    'transition-colors',
                    alignment === value
                      ? 'text-primary'
                      : 'text-on-surface-variant hover:text-primary'
                  )}
                  aria-label={`Align ${value}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-outline-variant/20 px-margin-mobile py-2 md:px-margin-desktop">
          <LetterProgress current="write" />
        </div>
      </div>

      {/* Auto-save indicator */}
      <div className="fixed top-16 right-4 z-50">
        <div
          className={cn(
            'flex items-center gap-sm px-sm py-xs bg-surface-container-lowest border border-outline-variant rounded-full transition-all duration-500',
            saved ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
          <Check className="h-3 w-3 text-green-700" />
          <span className="font-caption text-caption text-on-surface-variant">
            Saved to desk...
          </span>
        </div>
      </div>

      {/* Writing area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-grow overflow-y-auto pt-20 pb-32"
      >
        <div className="relative w-full max-w-[800px] mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="relative bg-surface-container-lowest border border-outline-variant/30 flex flex-col p-lg md:p-xl shadow-[0_0_40px_rgba(0,0,0,0.02)] card-depth min-h-[70vh]">
            {/* Letter details */}
            <div className="mb-xl grid grid-cols-1 gap-md border-b border-outline-variant/30 pb-lg sm:grid-cols-2">
              <label className="font-caption text-caption text-on-surface-variant">
                To (Recipient Name)
                <input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  className="typewriter-input mt-xs text-base text-primary"
                  placeholder="Who is this for? (e.g. Eleanor)"
                  aria-label="Letter recipient"
                />
              </label>
              <label className="font-caption text-caption text-on-surface-variant">
                Subject (Envelope Title)
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="typewriter-input mt-xs text-base text-primary"
                  placeholder="Give it a title (e.g. Morning Light)"
                  aria-label="Letter subject"
                />
              </label>
            </div>

            {/* Metadata */}
            <div className="mb-lg flex items-center justify-between">
              <span className="font-caption text-caption text-on-surface-variant">
                {wordCount} {wordCount === 1 ? 'word' : 'words'} · about {readingMinutes} min read
              </span>
              <span className="font-caption text-caption text-on-surface-variant">
                {saved ? 'Saved to desk · private' : ready ? 'Saving…' : 'Loading draft…'}
              </span>
            </div>

            {/* Ruled-line writing canvas */}
            <div className="flex-grow relative ruled-lines">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={cn(
                  'composer-textarea font-body-lg text-on-surface leading-[32px] placeholder:text-outline-variant placeholder:font-caption placeholder:text-caption placeholder:tracking-widest',
                  alignClass
                )}
                style={{ fontSize: `${fontSize}px` }}
                placeholder="Write the words that deserve a journey…"
                aria-label="Letter contents"
                spellCheck={false}
                autoFocus
              />
            </div>

            {/* Decorative corner */}
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-outline-variant/20 m-1 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Seal Letter CTA */}
      <div className="fixed bottom-4 left-4 right-4 z-50 sm:bottom-6 sm:left-auto sm:right-6">
        <button
          onClick={handleSealLetter}
          disabled={!ready || !content.trim() || !recipient.trim() || !subject.trim()}
          className="flex w-full items-center justify-center gap-sm rounded-sm border border-primary/20 bg-secondary-container px-xl py-md font-label-md text-label-md uppercase tracking-widest text-on-secondary-container transition-all duration-300 hover:-translate-y-0.5 hover:bg-secondary-fixed hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          Next: Destination & Seal
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Composer />
    </Suspense>
  );
}
