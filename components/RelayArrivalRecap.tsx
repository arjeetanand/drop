'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, MailOpen } from 'lucide-react';

interface RelayArrivalRecapProps {
  handoffCount: number;
  onOpen: () => void | Promise<void>;
}

export function RelayArrivalRecap({ handoffCount, onOpen }: RelayArrivalRecapProps) {
  const headingId = useId();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const safeHandoffCount = Math.max(0, handoffCount);

  useEffect(() => {
    openButtonRef.current?.focus();
  }, []);

  const openDrop = async () => {
    if (opening) return;
    setOpening(true);
    setError('');
    try {
      await onOpen();
    } catch {
      setError('Your drop is collected, but it could not open yet. Try again.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="my-4 rounded-2xl border border-[rgba(16,42,67,.12)] bg-[#f4f8f4] p-4 shadow-[0_8px_24px_rgba(16,42,67,.04)] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#2b45f7]" aria-hidden="true">
          <MailOpen className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          <p className="eyebrow text-[#2b45f7]">It made it</p>
          <h2 id={headingId} className="mt-1 font-headline-md text-xl leading-tight text-ink-navy">Your drop made it to you.</h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            {safeHandoffCount > 0
              ? `It passed through ${safeHandoffCount} ${safeHandoffCount === 1 ? 'hand' : 'hands'} on the way here.`
              : 'It made its way straight to you. Open it whenever you’re ready.'}
          </p>
        </div>
      </div>

      {error && <p className="notice error-notice mt-3" role="alert" aria-live="assertive">{error}</p>}
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => void openDrop()}
        disabled={opening}
        aria-busy={opening}
        className="button-primary mt-4 min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7] focus-visible:ring-offset-2 disabled:opacity-55"
      >
        {opening ? 'Opening…' : error ? 'Try again' : <>Open your drop <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
      </button>
    </section>
  );
}
