const reactionNames: Record<string, string> = {
  '💜': 'purple heart',
  '🔥': 'fire',
  '😂': 'face with tears of joy',
  '🥹': 'face holding back tears',
  '🫶': 'heart hands',
};

export function getReactionName(reaction?: string) {
  return reaction ? reactionNames[reaction] || 'a reaction' : 'a reaction';
}
