export const DEMO_REACTION_EMOJIS = ['💜', '🔥', '😂', '🥹', '🫶'] as const;

const STORAGE_KEY = 'dear-exe:demo-reactions:v1';

function isDemoDropId(id: string) {
  return /^incoming-[a-z0-9-]+$/i.test(id);
}

export function getDemoReactions(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, unknown>;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([id, emoji]) =>
      isDemoDropId(id) && DEMO_REACTION_EMOJIS.includes(emoji as typeof DEMO_REACTION_EMOJIS[number])
    )) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveDemoReaction(id: string, emoji: string) {
  if (typeof window === 'undefined' || !isDemoDropId(id) || !DEMO_REACTION_EMOJIS.includes(emoji as typeof DEMO_REACTION_EMOJIS[number])) return false;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getDemoReactions(), [id]: emoji }));
    return true;
  } catch {
    return false;
  }
}
