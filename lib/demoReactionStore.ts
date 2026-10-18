import { localAccountStorageKey } from './localAccountScope.ts';

export const DEMO_REACTION_EMOJIS = ['💜', '🔥', '😂', '🥹', '🫶'] as const;

const STORAGE_KEY = 'dear-exe:demo-reactions:v1';
const LOCAL_DEMO_PREFIX = 'local-demo:';

function isDemoDropId(id: string) {
  return /^incoming-[a-z0-9-]+$/i.test(id);
}

export function getDemoReactions(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  try {
    const stored = JSON.parse(window.localStorage.getItem(localAccountStorageKey(STORAGE_KEY)) || '{}') as Record<string, unknown>;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).flatMap(([key, emoji]) => {
      const localDemo = key.startsWith(LOCAL_DEMO_PREFIX);
      const id = localDemo ? key.slice(LOCAL_DEMO_PREFIX.length) : key;
      return (id && (localDemo || isDemoDropId(id)) && DEMO_REACTION_EMOJIS.includes(emoji as typeof DEMO_REACTION_EMOJIS[number]))
        ? [[id, emoji]]
        : [];
    })) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveDemoReaction(id: string, emoji: string, localDemo = false) {
  if (typeof window === 'undefined' || (!isDemoDropId(id) && !localDemo) || !DEMO_REACTION_EMOJIS.includes(emoji as typeof DEMO_REACTION_EMOJIS[number])) return false;

  try {
    const reactions = { ...getDemoReactions(), [id]: emoji };
    const stored = Object.fromEntries(Object.entries(reactions).map(([dropId, reaction]) => [
      isDemoDropId(dropId) ? dropId : `${LOCAL_DEMO_PREFIX}${dropId}`,
      reaction,
    ]));
    window.localStorage.setItem(localAccountStorageKey(STORAGE_KEY), JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}
