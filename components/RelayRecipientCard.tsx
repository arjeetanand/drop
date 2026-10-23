'use client';

import { useId, useState } from 'react';
import { Check, Clock3, MapPin, MessageCircle, PackageCheck, Route } from 'lucide-react';
import type { MockLetter, RelayRecipientProgress } from '@/data/mockData';
import { collectRemoteRelayDrop } from '@/lib/letterBackend';

type RelayRecipientLetter = MockLetter & { relayProgress?: RelayRecipientProgress };

interface RelayRecipientCardProps {
  letter: RelayRecipientLetter;
  onRefresh: () => Promise<void>;
}

function formatHandoffTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function RelayRecipientCard({ letter, onRefresh }: RelayRecipientCardProps) {
  const headingId = useId();
  const progress = letter.relayProgress;
  const [collecting, setCollecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [collected, setCollected] = useState(false);
  const [error, setError] = useState('');

  const refreshMailbox = async () => {
    setRefreshing(true);
    setError('');
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const collectDrop = async () => {
    if (collecting || refreshing) return;
    if (collected) {
      await refreshMailbox();
      return;
    }

    setCollecting(true);
    setError('');
    try {
      const result = await collectRemoteRelayDrop(letter.id);
      if (!result.ok) {
        setError(result.error || 'This drop could not be collected yet. Try again.');
        return;
      }

      setCollected(true);
      await refreshMailbox();
    } catch {
      setError('This drop could not be collected yet. Check your connection and try again.');
    } finally {
      setCollecting(false);
    }
  };

  const handoffCount = Math.max(0, progress?.handoffCount ?? 0);
  const latestHandoffTime = formatHandoffTime(progress?.latestHandoffAt ?? null);
  const routeStatus = handoffCount === 0
    ? 'Waiting for its first carrier.'
    : `This drop has passed through ${handoffCount} ${handoffCount === 1 ? 'hand' : 'hands'}.`;
  const actionStatus = refreshing
    ? 'Checking your mailbox…'
    : collecting
      ? 'Collecting your drop…'
      : collected
        ? 'Collection confirmed. Check your mailbox for the open drop.'
        : '';

  return (
    <article
      aria-labelledby={headingId}
      className="my-4 rounded-2xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-4 shadow-[0_8px_24px_rgba(16,42,67,.04)] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true">
          <PackageCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[#2b45f7]">A sealed drop is traveling to you</p>
          <h2 id={headingId} className="mt-1 font-headline-md text-xl leading-tight text-ink-navy">Your drop is on its way.</h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            Carriers can follow its route, but the words and media stay sealed until you collect it.
          </p>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-[rgba(16,42,67,.1)] bg-white/75 p-3 sm:p-4" aria-label="Route progress">
        <div className="flex items-start gap-2.5">
          <Route className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" />
          <p className="text-sm font-semibold text-ink-navy">{routeStatus}</p>
        </div>

        {handoffCount > 0 && (
          <div className="mt-3 space-y-2 border-t border-[rgba(16,42,67,.08)] pt-3">
            {(progress?.latestCarrier || progress?.latestNeighborhood) && (
              <p className="flex items-start gap-2 text-sm leading-relaxed text-on-surface-variant">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" />
                <span className="break-words">
                  {progress.latestCarrier && <span className="font-semibold text-ink-navy">{progress.latestCarrier}</span>}
                  {progress.latestCarrier && progress.latestNeighborhood ? ' · ' : ''}
                  {progress.latestNeighborhood}
                </span>
              </p>
            )}
            {progress?.latestNote && (
              <p className="flex items-start gap-2 text-sm leading-relaxed text-on-surface-variant">
                <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b88938]" aria-hidden="true" />
                <span className="line-clamp-2 break-words">{progress.latestNote}</span>
              </p>
            )}
            {latestHandoffTime && (
              <p className="flex items-center gap-2 text-xs text-on-surface-variant">
                <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Latest handoff {latestHandoffTime} UTC
              </p>
            )}
          </div>
        )}
      </section>

      {actionStatus && <p className="mt-3 text-sm text-on-surface-variant" role="status" aria-live="polite" aria-atomic="true">{actionStatus}</p>}
      {error && <p className="notice error-notice mt-3" role="alert" aria-live="assertive">{error}</p>}

      <button
        type="button"
        onClick={() => void collectDrop()}
        disabled={collecting || refreshing}
        aria-busy={collecting || refreshing}
        className="button-primary mt-4 min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-55"
      >
        {refreshing
          ? 'Checking mailbox…'
          : collecting
            ? 'Collecting…'
            : collected
              ? <><Check className="h-4 w-4" aria-hidden="true" /> Check mailbox</>
              : error
                ? 'Try again'
                : 'I got this drop'}
      </button>
    </article>
  );
}
