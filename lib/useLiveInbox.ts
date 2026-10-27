'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mockLetters, type MockLetter } from '@/data/mockData';
import { getRemoteLetters, subscribeToIncomingDropInbox, subscribeToSenderDropReactions } from '@/lib/letterBackend';
import { getLetterDraft, getLettersWithDraft } from '@/lib/letterStore';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { applyRecipientDropRead, applyRecipientDropReadEvents, getLiveInboxUpdate, mergeInboxLetters } from '@/lib/liveInboxState';
import { getLiveReactionUpdate } from '@/lib/liveReactionState';
import { startVisibleDataRefresh, type VisibleDataRefreshController } from '@/lib/relayRouteRefresh';
import { isRecipientDropReadForAccount, subscribeToRecipientDropReads, type RecipientDropReadEventDetail } from '@/lib/recipientDropReadEvent';
import { getLocalAccountId } from '@/lib/localAccountScope';

export const LIVE_INBOX_RECOVERY_INTERVAL_MS = 60_000;

export function useLiveInbox(initialLetters: MockLetter[] = mockLetters) {
  const [initialReactionSignalWindowStart] = useState(() => Date.now() - 60_000);
  const [letters, setLetters] = useState<MockLetter[]>(initialLetters);
  const [recipientReadStatesHydrated, setRecipientReadStatesHydrated] = useState(false);
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
    let observedAccountId: string | null = null;
    let authInitialized = false;
    let accountGeneration = 0;
    const pendingReadEvents = new Map<string, RecipientDropReadEventDetail>();
    const stopRecipientDropReadEvents = subscribeToRecipientDropReads((detail) => {
      if (!isRecipientDropReadForAccount(detail, getLocalAccountId())) return;
      pendingReadEvents.set(detail.letterId, detail);
      setLetters((current) => applyRecipientDropRead(current, detail));
    });
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
          load: async () => {
            const generation = accountGeneration;
            return { mailbox: await getRemoteLetters(), generation };
          },
          intervalMs: LIVE_INBOX_RECOVERY_INTERVAL_MS,
          queueOneWhileInFlight: true,
          onData: ({ mailbox, generation }) => {
            if (!active) return;
            if (generation !== accountGeneration) return;
            if (!mailbox) {
              seenIncomingIds.current = null;
              seenReactions.current = null;
              setRecipientReadStatesHydrated(false);
              setLetters(initialLetters);
              return;
            }

            const serverReadIds = mailbox.letters
              .filter((letter) => typeof letter.recipientReadAt === 'string')
              .map((letter) => letter.id);
            serverReadIds.forEach((id) => pendingReadEvents.delete(id));
            const remoteLetters = applyRecipientDropReadEvents(mailbox.letters, pendingReadEvents.values());
            setRecipientReadStatesHydrated(mailbox.recipientReadStatesHydrated === true);
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
              current,
            ));
          },
        });
        refreshControllerRef.current = refreshController;
      }
    });

    const authSubscription = getSupabaseBrowserClient()?.auth.onAuthStateChange((_event, session) => {
      const nextAccountId = session?.user.id ?? null;
      if (!authInitialized) {
        authInitialized = true;
        observedAccountId = nextAccountId;
        return;
      }
      if (observedAccountId === nextAccountId) return;

      observedAccountId = nextAccountId;
      accountGeneration += 1;
      pendingReadEvents.clear();
      seenIncomingIds.current = null;
      seenReactions.current = null;
      setRecipientReadStatesHydrated(false);
      setLetters(initialLetters);
      setArrival(null);
      setArrivalCount(0);
      setReaction(null);
      setReactionCount(0);
      void refreshControllerRef.current?.refresh();
    }).data.subscription;

    return () => {
      active = false;
      refreshControllerRef.current?.stop();
      refreshControllerRef.current = null;
      stopRealtime();
      stopReactionRealtime();
      stopRecipientDropReadEvents();
      authSubscription?.unsubscribe();
    };
  }, [initialLetters, initialReactionSignalWindowStart]);

  return {
    letters,
    recipientReadStatesHydrated,
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
