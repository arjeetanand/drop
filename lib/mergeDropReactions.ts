export interface DropReactionRow {
  letter_id: string;
  emoji: string;
  updated_at?: string;
}

export function mergeDropReactions<T extends { id: string; reaction?: string; reactionUpdatedAt?: string }>(
  letters: T[],
  reactions: DropReactionRow[]
): T[] {
  const byLetterId = new Map(reactions.map((reaction) => [reaction.letter_id, reaction]));
  return letters.map((letter) => {
    const reaction = byLetterId.get(letter.id);
    return reaction ? {
      ...letter,
      reaction: reaction.emoji,
      ...(reaction.updated_at ? { reactionUpdatedAt: reaction.updated_at } : {}),
    } : letter;
  });
}
