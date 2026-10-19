import type { DropPayloadKind } from '../data/mockData';

export const MAX_DROP_MEDIA_BYTES = 8 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function normalizeDropRecipient(value: string): string | null {
  const username = value.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._-]{2,24}$/.test(username) ? username : null;
}

export function isDropRecipientConfirmed(confirmation: { id: string; username: string } | null, value: string): boolean {
  return Boolean(confirmation?.id && confirmation.username === normalizeDropRecipient(value));
}

export function isDropPayloadKindCompatibleWithMedia(kind: DropPayloadKind, file: Pick<File, 'type'> | null): boolean {
  return !file || kind === (file.type === 'image/gif' ? 'gif' : 'image');
}

// shortcut: browser MIME is declarative; add server-side decoding before accepting untrusted media beyond private image serving.
export function validateDropMedia(file: Pick<File, 'type' | 'size'> | null): string | null {
  if (!file) return 'Choose a photo or GIF to attach.';
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) return 'Use a JPG, PNG, WebP, or GIF image.';
  if (file.size <= 0 || file.size > MAX_DROP_MEDIA_BYTES) return 'Keep images under 8 MB.';
  return null;
}
