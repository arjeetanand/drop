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
    <div className="page-enter min-h-screen flex flex-col bg-[#f7f4ee]">
      {/* Floating Zen Control Dock */}
      <div
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-transform duration-300 border-b border-[#102a43]/[0.08] bg-[#fbf9f4]/95 backdrop-blur-md',
          showToolbar ? 'translate-y-0' : '-translate-y-full'
        )}
      >
        <div className="max-w-[1080px] mx-auto flex items-center justify-between px-4 sm:px-8 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 font-caption text-xs uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back to Desk</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto-save status pill */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#102a43]/5 text-on-surface-variant font-mono text-[10px] tracking-wider">
              {saved ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span>Saved to desk</span>
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>Autosaving…</span>
                </>
              )}
            </div>

            {/* Font size controls */}
            <div className="flex items-center gap-1 border border-[#102a43]/15 bg-white rounded-full px-2 py-0.5 shadow-2xs">
              <button
                onClick={() => setFontSize((s) => Math.max(14, s - 2))}
                className="p-1 text-on-surface-variant hover:text-primary transition-colors"
                aria-label="Decrease font size"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="font-mono text-xs text-on-surface-variant min-w-[20px] text-center font-medium">
                {fontSize}
              </span>
              <button
                onClick={() => setFontSize((s) => Math.min(28, s + 2))}
                className="p-1 text-on-surface-variant hover:text-primary transition-colors"
                aria-label="Increase font size"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>

            {/* Alignment controls */}
            <div className="flex items-center gap-0.5 border border-[#102a43]/15 bg-white rounded-full p-0.5 shadow-2xs">
              {([
                { value: 'left', icon: AlignLeft },
                { value: 'center', icon: AlignCenter },
                { value: 'right', icon: AlignRight },
              ] as const).map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setAlignment(value)}
                  className={cn(
                    'p-1.5 rounded-full transition-colors',
                    alignment === value
                      ? 'bg-ink-navy text-surface-bright shadow-xs'
                      : 'text-on-surface-variant hover:text-primary'
                  )}
                  aria-label={`Align ${value}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-[#102a43]/[0.06] px-4 py-2 sm:px-8 max-w-[1080px] mx-auto">
          <LetterProgress current="write" />
        </div>
      </div>

      {/* Writing area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-grow overflow-y-auto pt-28 pb-32"
      >
        <div className="relative w-full max-w-[820px] mx-auto px-4 sm:px-6">
          <div className="relative bg-white border border-[#102a43]/[0.08] flex flex-col p-8 sm:p-12 md:p-16 rounded-md shadow-[0_2px_8px_rgba(16,42,67,0.03),0_16px_36px_rgba(16,42,67,0.06)] min-h-[75vh]">
            {/* Letter Header Fields */}
            <div className="mb-8 grid grid-cols-1 gap-6 border-b border-[#102a43]/10 pb-6 sm:grid-cols-2">
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70 mb-1 font-medium">
                  To (Recipient Name) <span className="text-red-600">*</span>
                </label>
                <input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  className="typewriter-input text-lg font-medium text-ink-navy placeholder:text-ink-navy/30"
                  placeholder="e.g. Eleanor Hartwell"
                  aria-label="Letter recipient"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70 mb-1 font-medium">
                  Subject (Envelope Title) <span className="text-red-600">*</span>
                </label>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="typewriter-input text-lg font-medium text-ink-navy placeholder:text-ink-navy/30"
                  placeholder="e.g. Morning Light"
                  aria-label="Letter subject"
                />
              </div>
            </div>

            {/* Reading metadata badge */}
            <div className="mb-6 flex items-center justify-between border-b border-[#102a43]/5 pb-3 font-mono text-[11px] text-on-surface-variant/70">
              <span>
                {wordCount} {wordCount === 1 ? 'word' : 'words'} · ~{readingMinutes} min read
              </span>
              <span className="text-amber-accent font-medium">
                Cotton Parchment · Heavyweight
              </span>
            </div>

            {/* Ruled-line writing canvas */}
            <div className="flex-grow relative ruled-lines">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={cn(
                  'composer-textarea font-body-lg text-ink-navy leading-[32px] placeholder:text-[#102a43]/30 placeholder:font-caption placeholder:text-xs placeholder:tracking-widest',
                  alignClass
                )}
                style={{ fontSize: `${fontSize}px` }}
                placeholder="Write the words that deserve a journey through human hands…"
                aria-label="Letter contents"
                spellCheck={false}
                autoFocus
              />
            </div>
          </div>
        </div>
      </div>

      {/* Seal Letter Primary Action Dock */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={handleSealLetter}
          disabled={!ready || !content.trim() || !recipient.trim() || !subject.trim()}
          className="flex items-center gap-2 rounded-md bg-ink-navy px-6 py-3.5 font-label-md text-xs uppercase tracking-widest text-surface-bright shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span>Next: Destination & Seal</span>
          <ArrowRight className="h-4 w-4 text-surface-bright" />
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
