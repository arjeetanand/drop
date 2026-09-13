'use client';

import type { TrackingEvent } from '@/data/mockData';
import { cn } from '@/lib/utils';

export function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  return (
    <ol className="relative ml-2 border-l border-[rgba(16,42,67,0.18)] pl-7" aria-label="Letter journey timeline">
      {events.map((event) => (
        <li key={event.id} className={cn('relative pb-8 last:pb-0', !event.done && 'opacity-50')}>
          <span
            className={cn(
              'absolute -left-[2.05rem] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-[#f7f4ee]',
              event.current ? 'border-[#b84b3a]' : event.done ? 'border-[#4f9d7a]' : 'border-[rgba(16,42,67,0.2)]'
            )}
            aria-hidden="true"
          >
            <span className={cn('h-2 w-2 rounded-full', event.current ? 'bg-[#b84b3a]' : event.done ? 'bg-[#4f9d7a]' : 'bg-[rgba(16,42,67,0.18)]')} />
          </span>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={cn('font-headline-md text-xl leading-tight', event.current ? 'text-[#8c3328]' : 'text-ink-navy')}>
              {event.status}
            </h3>
            <p className="meta">{event.date} · {event.time}</p>
          </div>
          <p className="mt-2 font-body-md text-sm leading-relaxed text-on-surface-variant">{event.note}</p>
        </li>
      ))}
    </ol>
  );
}
