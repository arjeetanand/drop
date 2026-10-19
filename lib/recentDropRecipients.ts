import { normalizeDropRecipient } from './dropValidation.ts';

export type RecentDropRecipientRow = { recipient_username: string | null; recipient_name: string | null };
export type RecentDropRecipient = { username: string; displayName: string };

const MAX_RECENT_DROP_RECIPIENTS = 5;

export function uniqueRecentDropRecipients(rows: RecentDropRecipientRow[]): RecentDropRecipient[] {
  const usernames = new Set<string>();
  const recipients: RecentDropRecipient[] = [];

  for (const row of rows) {
    const username = normalizeDropRecipient(row.recipient_username || '');
    if (!username || usernames.has(username)) continue;
    usernames.add(username);
    recipients.push({ username, displayName: row.recipient_name?.trim() || username });
    if (recipients.length === MAX_RECENT_DROP_RECIPIENTS) break;
  }

  return recipients;
}
