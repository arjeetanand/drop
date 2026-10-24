import type { MockLetter } from '../data/mockData.ts';

export interface LiveReactionUpdate {
  reactions: MockLetter[];
  reactionMap: Map<string, string>;
  matchedSignalIds: Set<string>;
}

export interface SenderReactionReadUpdate {
  outcome: 'stale' | 'unavailable' | 'available';
  reaction: string | null;
  announce: boolean;
  baselinePending: boolean;
  consumedSignalGeneration: number;
}

export type InitialReactionDirection = 'sent' | 'received' | 'signed-out' | 'unavailable';
export type InitialReactionBaseline = { available: boolean; reaction: string | null };

/** Skip awaiting sender-only baseline data once a route is known not to be sent. */
export async function getInitialSenderReactionBaseline(
  direction: InitialReactionDirection,
  baselineRead: Promise<InitialReactionBaseline | null>,
): Promise<InitialReactionBaseline | null> {
  if (direction !== 'sent' && direction !== 'unavailable') return null;
  return baselineRead;
}

/** Discard stale reads, preserve baselines on failures, and announce only known changes. */
export function getSenderReactionReadUpdate(
  snapshot: { available: boolean; reaction: string | null },
  readSignalGeneration: number,
  currentSignalGeneration: number,
  previousReaction: string | null,
  baselinePending: boolean,
  consumedSignalGeneration: number,
  initialBaseline: { available: boolean; reaction: string | null } | null = null,
): SenderReactionReadUpdate {
  if (readSignalGeneration !== currentSignalGeneration) {
    return { outcome: 'stale', reaction: null, announce: false, baselinePending, consumedSignalGeneration };
  }
  if (!snapshot.available) {
    return { outcome: 'unavailable', reaction: null, announce: false, baselinePending, consumedSignalGeneration };
  }

  const signaledSinceBaseline = readSignalGeneration > consumedSignalGeneration;
  const changedDuringStartup = initialBaseline?.available === true
    && snapshot.reaction !== initialBaseline.reaction;
  const announce = Boolean(snapshot.reaction) && (baselinePending
    ? signaledSinceBaseline || changedDuringStartup
    : snapshot.reaction !== previousReaction);
  return {
    outcome: 'available',
    reaction: snapshot.reaction,
    announce,
    baselinePending: false,
    consumedSignalGeneration: readSignalGeneration,
  };
}

/** Baseline existing reactions, then report only changes; a matching signal can announce the first read. */
export function getLiveReactionUpdate(
  remoteLetters: MockLetter[],
  previousReactionMap: ReadonlyMap<string, string> | null,
  signaledDropIds: ReadonlySet<string> = new Set(),
  initialSignalWindowStart?: number,
): LiveReactionUpdate {
  const reactionMap = new Map<string, string>();
  const reactions: MockLetter[] = [];
  const matchedSignalIds = new Set<string>();

  for (const letter of remoteLetters) {
    if (letter.direction !== 'sent' || letter.sample || typeof letter.reaction !== 'string' || !letter.reaction) continue;

    reactionMap.set(letter.id, letter.reaction);
    if (signaledDropIds.has(letter.id)) matchedSignalIds.add(letter.id);

    const updatedAt = Date.parse(letter.reactionUpdatedAt || '');
    const recentInitialReaction = initialSignalWindowStart !== undefined
      && Number.isFinite(updatedAt)
      && updatedAt >= initialSignalWindowStart;
    const changed = previousReactionMap
      ? previousReactionMap.get(letter.id) !== letter.reaction
      : signaledDropIds.has(letter.id) || recentInitialReaction;
    if (changed) reactions.push(letter);
  }

  reactions.sort((a, b) => {
    const aTime = Date.parse(a.reactionUpdatedAt || '');
    const bTime = Date.parse(b.reactionUpdatedAt || '');
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  return { reactions, reactionMap, matchedSignalIds };
}
