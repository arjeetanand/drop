import { normalizeDropRecipient } from './dropValidation.ts';
import { profileUrl } from './userStore.ts';

export interface ProfileSharePayload {
  title: string;
  text: string;
  url: string;
  copyText: string;
}

export function createProfileSharePayload(username: string, origin: string): ProfileSharePayload | null {
  const handle = normalizeDropRecipient(username);
  if (!handle) return null;

  const url = new URL(profileUrl(handle), origin).toString();
  const publicHandle = `@${handle}`;
  return {
    title: 'My Drop handle',
    text: publicHandle,
    url,
    copyText: `${publicHandle}\n${url}`,
  };
}

export async function copyProfileSharePayload(
  payload: ProfileSharePayload,
  writeText?: (text: string) => Promise<void>,
): Promise<'copied' | 'unavailable'> {
  if (!writeText) return 'unavailable';
  try {
    await writeText(payload.copyText);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}
