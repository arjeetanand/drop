'use client';

import { TrackingEvent } from '@/data/mockData';
import { cn } from '@/lib/utils';

export function TrackingTimeline({ events }: { events: TrackingEvent[] }) {
  return (
    <div className="flex flex-col gap-lg border-l border-outline ml-sm pl-lg py-sm relative">
      {events.map((event) => (
        <div
          key={event.id}
          className={cn('relative', !event.done && 'opacity-40')}
        >
          {/* Timeline dot */}
          {event.current ? (
            <div className="absolute -left-[35px] top-[16px] w-5 h-5 rounded-full bg-surface-container-lowest border border-primary flex items-center justify-center shadow-[0_0_0_4px_#f9f9f7]">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
            </div>
          ) : (
            <div
              className={cn(
                'absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-surface-bright border flex items-center justify-center',
                event.done ? 'border-outline' : 'border-outline-variant'
              )}
            >
              {event.done && <div className="w-1.5 h-1.5 rounded-full bg-outline" />}
            </div>
          )}

          {/* Event content */}
          <div className={cn('pt-sm', event.id === '1' && 'pt-0')}>
            <div
              className={cn(
                'font-caption text-caption mb-1',
                event.current
                  ? 'text-primary font-bold'
                  : 'text-on-surface-variant'
              )}
            >
              {event.time} • {event.status}
            </div>
            {event.current ? (
              <div className="font-handwriting text-[22px] italic text-primary leading-relaxed bg-surface-container-lowest p-md border border-outline-variant rounded-sm shadow-sm transform -rotate-1 inline-block mt-2 note-rotate">
                &ldquo;{event.note}&rdquo;
              </div>
            ) : event.done ? (
              <div className="font-handwriting text-headline-md italic text-on-surface leading-relaxed">
                &ldquo;{event.note}&rdquo;
              </div>
            ) : (
              <div className="font-body-lg text-body-lg text-on-surface">
                {event.note}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
