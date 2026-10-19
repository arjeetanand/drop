type ShareDetails = { title: string; text: string; url: string };

export async function shareInviteLink(
  url: string,
  share: ((details: ShareDetails) => Promise<void>) | undefined,
  copy: (url: string) => Promise<void>,
): Promise<'shared' | 'copied' | 'cancelled' | 'unavailable'> {
  if (share) {
    try {
      await share({ title: 'A Drop to carry', text: 'Help carry this sealed Drop along its journey.', url });
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
