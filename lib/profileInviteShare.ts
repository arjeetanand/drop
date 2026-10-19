import { normalizeDropRecipient } from './dropValidation.ts';
import { profileUrl } from './userStore.ts';

export function createProfileSharePayload(username: string, origin: string) {
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
