'use client';

import { TrackingEvent } from '@/data/mockData';
import { cn } from '@/lib/utils';

export function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  return <div className="relative pl-10">
    <div className="absolute bottom-5 left-[11px] top-5 w-px bg-outline-variant" aria-hidden="true" />
    {events.map((event) => (
      <div key={event.id} className={cn('relative flex gap-md pb-xl last:pb-0', !event.done && 'opacity-40')}>
        <div className={cn(
          'absolute -left-10 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-surface',
          event.current ? 'border-wax-red shadow-[0_0_0_5px_rgba(186,73,56,0.12)]' : event.done ? 'border-mint-accent' : 'border-outline-variant'
        )}>
          <span className={cn('h-2 w-2 rounded-full', event.current ? 'bg-wax-red animate-pulse' : event.done ? 'bg-mint-accent' : 'bg-outline-variant')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-sm">
            <h3 className={cn('font-headline-md text-headline-md', event.current ? 'text-wax-red' : 'text-primary')}>{event.status}</h3>
            <p className="font-caption text-caption text-on-surface-variant">{event.date} · {event.time}</p>
          </div>
          <p className={cn('mt-xs font-body-md text-body-md leading-relaxed', event.current ? 'text-primary' : 'text-on-surface-variant')}>{event.note}</p>
        </div>
      </div>
    ))}
  </div>;
}
