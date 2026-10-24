'use client';

import Image from 'next/image';
import { ArrowRight, Check, LockKeyhole, PackageCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { advanceRelayDemo, isRelayDemoContentVisible, type RelayDemoStage } from '@/lib/relayDemo';

const routeStops = [
  { title: 'Ari → Jo', detail: 'Ari passes the sealed drop to Jo.' },
  { title: 'Jo → Sol', detail: 'Jo carries it to the next handoff.' },
  { title: 'Sol → you', detail: 'It is waiting for you to collect.' },
] as const;

const stageCopy: Record<RelayDemoStage, { status: string; button: string }> = {
  ready: {
    status: 'A fictional drop is ready for its first handoff.',
    button: 'Start the journey',
  },
  'first-handoff': {
    status: 'Handoff one of three: Ari passed a sealed drop to Jo.',
    button: 'Next handoff',
  },
  'second-handoff': {
    status: 'Handoff two of three: Jo passed the sealed drop to Sol.',
    button: 'Next handoff',
  },
  pickup: {
    status: 'Your drop is ready. Collect it to see what is inside.',
    button: 'Collect this drop',
  },
  collected: {
    status: 'You collected the sample. It is still only a demo on this device.',
    button: 'Play the journey again',
  },
};

const stageStopIndex: Record<RelayDemoStage, number> = {
  ready: -1,
  'first-handoff': 0,
  'second-handoff': 1,
  pickup: 2,
  collected: 3,
};

export function RelayDemoPreview() {
  const [stage, setStage] = useState<RelayDemoStage>('ready');
  const currentStopIndex = stageStopIndex[stage];

  return (
    <section className="mt-7 overflow-hidden rounded-[1.5rem] border border-[#d7defe] bg-[#eef1ff] p-5 sm:p-7" aria-labelledby="relay-demo-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-[#263ee0]">A more human route</p>
        <span className="rounded-full bg-white/80 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#263ee0]">Fictional demo · no account</span>
      </div>
      <h2 id="relay-demo-title" className="mt-2 max-w-[18ch] font-headline-md text-2xl font-semibold leading-tight text-ink-navy sm:text-3xl">See a drop travel hand to hand.</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
        Follow a made-up route with Ari, Jo, and Sol. The sample stays sealed until you collect it. This preview never uses your location or sends anything.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,.82fr)_minmax(0,1.18fr)]">
        <div className="flex min-h-44 flex-col justify-between rounded-[1.25rem] bg-[#172b53] p-5 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span>
          <div className="mt-7">
            <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/70">Sealed for you</p>
            <p className="mt-1 font-headline-md text-xl font-semibold">A little moment, on its way.</p>
            <p className="mt-2 text-sm leading-relaxed text-white/75">Carriers can pass it along. Only you get to open it.</p>
          </div>
        </div>

        <ol className="space-y-2" aria-label="Fictional Relay handoffs">
          {routeStops.map((stop, index) => {
            const completed = currentStopIndex > index;
            const current = currentStopIndex === index;

            return (
              <li
                key={stop.title}
                aria-current={current ? 'step' : undefined}
                className={`flex min-h-[4.1rem] items-start gap-3 rounded-xl border p-3 ${current ? 'border-[#aebaff] bg-white shadow-sm' : 'border-white/80 bg-white/65'}`}
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${completed ? 'bg-[#2b45f7] text-white' : current ? 'bg-[#e8ecff] text-[#263ee0]' : 'bg-[#152b43]/[0.07] text-ink-navy/65'}`} aria-hidden="true">
                  {completed ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span>
                  <span className="sr-only">{completed ? 'Completed. ' : current ? 'Current handoff. ' : 'Upcoming handoff. '}</span>
                  <span className="block text-sm font-bold text-ink-navy">{stop.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-on-surface-variant">{stop.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-h-5 text-sm font-medium text-ink-navy" role="status" aria-live="polite">{stageCopy[stage].status}</p>
        <button
          type="button"
          onClick={() => setStage(advanceRelayDemo(stage))}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2b45f7] px-5 text-sm font-bold text-white transition-colors hover:bg-[#2038db] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#263ee0] sm:w-auto"
        >
          {isRelayDemoContentVisible(stage) ? <Sparkles className="h-4 w-4" aria-hidden="true" /> : stage === 'pickup' ? <PackageCheck className="h-4 w-4" aria-hidden="true" /> : null}
          {stageCopy[stage].button}
          {!isRelayDemoContentVisible(stage) && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {isRelayDemoContentVisible(stage) && (
        <div className="mt-5 grid overflow-hidden rounded-[1.25rem] border border-white bg-white sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <div className="relative aspect-[4/3] bg-[#eee9df] sm:aspect-auto sm:min-h-[200px]">
            <Image src="/relay-blue-hour.svg" alt="An illustrated window over a quiet blue-hour city, with a cup on the sill" fill sizes="(max-width: 639px) 100vw, 35vw" unoptimized className="object-cover" />
          </div>
          <div className="p-5 sm:p-6">
            <p className="eyebrow text-[#aa5f42]">Collected · Sample drop</p>
            <h3 className="mt-2 font-headline-md text-xl font-semibold text-ink-navy">The blue hour</h3>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">“I kept this little moment for you.”</p>
            <p className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[#263ee0]"><Check className="h-4 w-4" aria-hidden="true" /> Only the recipient can open a real drop.</p>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-on-surface-variant">Fictional carriers and route. No GPS, sign-in, mailbox changes, or sharing in this preview.</p>
    </section>
  );
}
