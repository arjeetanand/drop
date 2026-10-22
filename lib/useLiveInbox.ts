'use client';

import { useEffect, useRef, useState } from 'react';
import { mockLetters, type MockLetter } from '@/data/mockData';
import { getRemoteLetters, subscribeToIncomingDropInbox } from '@/lib/letterBackend';
import { getLetterDraft, getLettersWithDraft } from '@/lib/letterStore';
import { getLiveInboxUpdate, mergeInboxLetters } from '@/lib/liveInboxState';
import { startVisibleDataRefresh, type VisibleDataRefreshController } from '@/lib/relayRouteRefresh';

export const LIVE_INBOX_RECOVERY_INTERVAL_MS = 60_000;

export function useLiveInbox(initialLetters: MockLetter[] = mockLetters) {
  const [letters, setLetters] = useState<MockLetter[]>(initialLetters);
  const [arrival, setArrival] = useState<MockLetter | null>(null);
  const [arrivalCount, setArrivalCount] = useState(0);
  const seenIncomingIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    let stopRealtime = () => {};
    let refresh: VisibleDataRefreshController | null = null;
    const signaledDropIds = new Set<string>();

    setLetters(getLettersWithDraft(getLetterDraft()));
    void subscribeToIncomingDropInbox((dropId) => {
      if (dropId) signaledDropIds.add(dropId);
      void refresh?.refresh();
    }).then((stop) => {
      if (!active) stop();
      else {
        stopRealtime = stop;
        refresh = startVisibleDataRefresh({
          load: getRemoteLetters,
          intervalMs: LIVE_INBOX_RECOVERY_INTERVAL_MS,
          queueOneWhileInFlight: true,
          onData: (remoteLetters) => {
            if (!active) return;

            const update = getLiveInboxUpdate(remoteLetters, seenIncomingIds.current, signaledDropIds);
            seenIncomingIds.current = update.receivedIds;
            remoteLetters.forEach((letter) => signaledDropIds.delete(letter.id));
            if (update.arrival) {
              setArrival(update.arrival);
              setArrivalCount((count) => count + update.newCount);
            }

            const localLetters = getLettersWithDraft(getLetterDraft());
            setLetters(mergeInboxLetters(localLetters, remoteLetters));
          },
        });
      }
    });

    return () => {
      active = false;
      refresh?.stop();
      stopRealtime();
    };
  }, []);

  return {
    letters,
    arrival,
    arrivalCount,
    dismissArrival: () => {
      setArrival(null);
      setArrivalCount(0);
    },
  };
}
