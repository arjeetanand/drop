'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  const refreshControllerRef = useRef<VisibleDataRefreshController | null>(null);

  const refreshInbox = useCallback(() => {
    return refreshControllerRef.current?.refresh() ?? Promise.resolve();
  }, []);

  useEffect(() => {
    let active = true;
    let stopRealtime = () => {};
    let stopReactionRealtime = () => {};
    const signaledDropIds = new Set<string>();
    const signaledReactionDropIds = new Set<string>();

    setLetters(getLettersWithDraft(getLetterDraft()));
    void subscribeToSenderDropReactions((dropId) => {
      if (dropId) signaledReactionDropIds.add(dropId);
      void refreshControllerRef.current?.refresh();
    }).then((stop) => {
      if (!active) stop();
      else stopReactionRealtime = stop;
    });
    void subscribeToIncomingDropInbox((dropId) => {
      if (dropId) signaledDropIds.add(dropId);
      void refreshControllerRef.current?.refresh();
    }).then((stop) => {
      if (!active) stop();
      else {
        stopRealtime = stop;
        const refreshController = startVisibleDataRefresh({
          load: getRemoteLetters,
          intervalMs: LIVE_INBOX_RECOVERY_INTERVAL_MS,
          queueOneWhileInFlight: true,
          onData: (mailbox) => {
            if (!active) return;

            const remoteLetters = mailbox.letters;
            const pendingRelayIds = new Set(remoteLetters
              .filter((letter) => letter.direction === 'received'
                && letter.status === 'dispatched'
                && !letter.sample
                && !letter.localDemo)
              .map((letter) => letter.id));
            const arrivalEligibleLetters = remoteLetters.filter((letter) => !pendingRelayIds.has(letter.id));
            const update = getLiveInboxUpdate(arrivalEligibleLetters, seenIncomingIds.current, signaledDropIds);
            pendingRelayIds.forEach((dropId) => update.receivedIds.add(dropId));
            const reactionUpdate = mailbox.reactionsHydrated
              ? getLiveReactionUpdate(
                  remoteLetters,
                  seenReactions.current,
                  signaledReactionDropIds,
                  initialReactionSignalWindowStart,
                )
              : null;
            seenIncomingIds.current = update.receivedIds;
            if (reactionUpdate) seenReactions.current = reactionUpdate.reactionMap;
            remoteLetters.forEach((letter) => signaledDropIds.delete(letter.id));
            reactionUpdate?.matchedSignalIds.forEach((dropId) => signaledReactionDropIds.delete(dropId));
            if (update.arrival) {
              setArrival(update.arrival);
              setArrivalCount((count) => count + update.newCount);
            }
            if (reactionUpdate?.reactions.length) {
              setReaction(reactionUpdate.reactions[0]);
              setReactionCount((count) => count + reactionUpdate.reactions.length);
            }

            const displayLetters = reactionUpdate
              ? remoteLetters
              : remoteLetters.map((letter) => {
                  const knownReaction = seenReactions.current?.get(letter.id);
                  return knownReaction ? { ...letter, reaction: knownReaction } : letter;
                });
            const localLetters = getLettersWithDraft(getLetterDraft());
            setLetters((current) => mergeInboxLetters(
              localLetters,
              displayLetters,
              mailbox.claimStatusHydrated ? [] : current,
            ));
          },
        });
        refreshControllerRef.current = refreshController;
      }
    });

    return () => {
      active = false;
      refreshControllerRef.current?.stop();
      refreshControllerRef.current = null;
      stopRealtime();
      stopReactionRealtime();
    };
  }, [initialReactionSignalWindowStart]);

  return {
    letters,
    refreshInbox,
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
