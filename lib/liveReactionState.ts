import type { MockLetter } from '../data/mockData.ts';

export interface LiveReactionUpdate {
  reactions: MockLetter[];
  reactionMap: Map<string, string>;
  matchedSignalIds: Set<string>;
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
