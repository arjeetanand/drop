type ShareDetails = { title: string; text: string; url: string };
type ShareMessage = Pick<ShareDetails, 'title' | 'text'>;
export type ShareInviteResult = 'shared' | 'copied' | 'cancelled' | 'unavailable';

export async function shareInviteLink(
  url: string,
  share: ((details: ShareDetails) => Promise<void>) | undefined,
  copy: (url: string) => Promise<void>,
  message: ShareMessage = { title: 'A Drop to carry', text: 'Help carry this sealed Drop along its journey.' },
): Promise<ShareInviteResult> {
  if (share) {
    try {
      await share({ ...message, url });
      return 'shared';
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    await copy(url);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}
