import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type DropReactionRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'realtime'>;
type DropReactionBroadcast = { payload?: { drop_id?: unknown } };
const SUBSCRIPTION_READY_TIMEOUT_MS = 8_000;

export function dropReactionTopic(userId: string) {
  return `user:${userId}:drop-reactions`;
}

/** Listen on the sender's private channel. Broadcasts carry only the changed drop id. */
export async function subscribeToDropReactions(
  client: DropReactionRealtimeClient,
  userId: string,
  onDropSignal: (dropId?: string) => void,
): Promise<() => void> {
  if (!userId) return () => {};

  let active = true;
  let channel: RealtimeChannel;
  let readyTimeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await client.realtime.setAuth();
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    readyTimeout = setTimeout(markReady, SUBSCRIPTION_READY_TIMEOUT_MS);
    channel = client
      .channel(dropReactionTopic(userId), { config: { private: true } })
      .on('broadcast', { event: 'drop_reaction_received' }, (message: DropReactionBroadcast) => {
        if (!active) return;
        const dropId = typeof message.payload?.drop_id === 'string' ? message.payload.drop_id : undefined;
        onDropSignal(dropId);
      })
      .subscribe((status) => {
        // Refresh on initial connection and reconnection to recover any missed signals.
        if (active && status === 'SUBSCRIBED') {
          onDropSignal();
          markReady();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          markReady();
        }
      });
    await ready;
  } catch {
    if (readyTimeout) clearTimeout(readyTimeout);
    return () => {};
  }
  if (readyTimeout) clearTimeout(readyTimeout);

  return () => {
    if (!active) return;
    active = false;
    void client.removeChannel(channel).catch(() => {});
  };
}
