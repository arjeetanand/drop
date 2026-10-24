const reactionNames: Record<string, string> = {
  '💜': 'a purple heart',
  '🔥': 'fire',
  '😂': 'a face with tears of joy',
  '🥹': 'a face holding back tears',
  '🫶': 'heart hands',
};

export function getReactionName(reaction?: string) {
  return reaction ? reactionNames[reaction] || 'a reaction' : 'a reaction';
}
