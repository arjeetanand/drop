export interface DropReactionRow {
  letter_id: string;
  emoji: string;
}

export function mergeDropReactions<T extends { id: string; reaction?: string }>(
  letters: T[],
  reactions: DropReactionRow[]
): T[] {
  const byLetterId = new Map(reactions.map(({ letter_id, emoji }) => [letter_id, emoji]));
  return letters.map((letter) => {
    const reaction = byLetterId.get(letter.id);
    return reaction ? { ...letter, reaction } : letter;
  });
}
