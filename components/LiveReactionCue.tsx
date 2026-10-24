import Link from 'next/link';
import { ArrowUpRight, Sparkles, X } from 'lucide-react';
import type { MockLetter } from '@/data/mockData';
import { getReactionName } from '@/lib/reactionNames';

interface LiveReactionCueProps {
  letter: MockLetter | null;
  count: number;
  onDismiss: () => void;
}

function getReactionCopy(letter: MockLetter, count: number) {
  const subject = `“${letter.subject}”`;
  const recipient = letter.recipient.trim() || 'Your recipient';
  const reactionName = getReactionName(letter.reaction);

  if (count > 1) {
    return `${count} new reactions came in. Latest: ${recipient} reacted to ${subject} with ${reactionName}.`;
  }

  return `Your drop ${subject} got a reaction from ${recipient}: ${reactionName}.`;
}

export function LiveReactionCue({ letter, count, onDismiss }: LiveReactionCueProps) {
  const safeCount = letter ? Math.max(1, count) : 0;
  const reactionCopy = letter ? getReactionCopy(letter, safeCount) : '';
  const subject = letter?.subject.trim() || 'your drop';
  const recipient = letter?.recipient.trim() || 'Your recipient';

  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {reactionCopy}
      </p>
      {letter && <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#cbd2ff] bg-[#eef0ff] p-4 text-ink-navy shadow-[0_8px_24px_rgba(43,69,247,.08)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#2b45f7]" aria-hidden="true">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#2b45f7]">
              {safeCount > 1 ? `${safeCount} new reactions` : 'A little love back'}
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug">
              {recipient} reacted <span aria-hidden="true">{letter.reaction || '✨'}</span> to “{subject}”.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Link
            href={`/letter/${encodeURIComponent(letter.id)}`}
            aria-label={`View sent drop: ${subject}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2b45f7] px-4 text-xs font-bold text-white transition-colors hover:bg-[#2038de] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7] focus-visible:ring-offset-2"
          >
            View sent drop <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss reaction notice"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-navy/70 transition-colors hover:bg-white/70 hover:text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>}
    </>
  );
}
