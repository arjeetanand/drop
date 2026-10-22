'use client';

import { useEffect, useRef, useState } from 'react';
import { mockLetters, type MockLetter } from '@/data/mockData';
import { getRemoteLetters, subscribeToIncomingDropInbox, subscribeToSenderDropReactions } from '@/lib/letterBackend';
import { getLetterDraft, getLettersWithDraft } from '@/lib/letterStore';
import { getLiveInboxUpdate, mergeInboxLetters } from '@/lib/liveInboxState';
import { getLiveReactionUpdate } from '@/lib/liveReactionState';
import { startVisibleDataRefresh, type VisibleDataRefreshController } from '@/lib/relayRouteRefresh';

export const LIVE_INBOX_RECOVERY_INTERVAL_MS = 60_000;

export function useLiveInbox(initialLetters: MockLetter[] = mockLetters) {
  const [initialReactionSignalWindowStart] = useState(() => Date.now() - 60_000);
  const [letters, setLetters] = useState<MockLetter[]>(initialLetters);
  const [arrival, setArrival] = useState<MockLetter | null>(null);
  const [arrivalCount, setArrivalCount] = useState(0);
  const [reaction, setReaction] = useState<MockLetter | null>(null);
  const [reactionCount, setReactionCount] = useState(0);
  const seenIncomingIds = useRef<Set<string> | null>(null);
  const seenReactions = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    let active = true;
    let stopRealtime = () => {};
    let stopReactionRealtime = () => {};
    let refresh: VisibleDataRefreshController | null = null;
    const signaledDropIds = new Set<string>();
    const signaledReactionDropIds = new Set<string>();

    setLetters(getLettersWithDraft(getLetterDraft()));
    void subscribeToSenderDropReactions((dropId) => {
      if (dropId) signaledReactionDropIds.add(dropId);
      void refresh?.refresh();
    }).then((stop) => {
      if (!active) stop();
      else stopReactionRealtime = stop;
    });
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
            const reactionUpdate = getLiveReactionUpdate(
              remoteLetters,
              seenReactions.current,
              signaledReactionDropIds,
              initialReactionSignalWindowStart,
            );
            seenIncomingIds.current = update.receivedIds;
            seenReactions.current = reactionUpdate.reactionMap;
            remoteLetters.forEach((letter) => signaledDropIds.delete(letter.id));
            reactionUpdate.matchedSignalIds.forEach((dropId) => signaledReactionDropIds.delete(dropId));
            if (update.arrival) {
              setArrival(update.arrival);
              setArrivalCount((count) => count + update.newCount);
            }
            if (reactionUpdate.reactions.length) {
              setReaction(reactionUpdate.reactions[0]);
              setReactionCount((count) => count + reactionUpdate.reactions.length);
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
      stopReactionRealtime();
    };
  }, [initialReactionSignalWindowStart]);

  return {
    letters,
    arrival,
    arrivalCount,
    reaction,
    reactionCount,
    dismissArrival: () => {
      setArrival(null);
      setArrivalCount(0);
    },
    dismissReaction: () => {
      setReaction(null);
      setReactionCount(0);
    },
  };
}
