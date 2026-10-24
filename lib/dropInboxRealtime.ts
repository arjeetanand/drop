import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type DropInboxRealtimeClient = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'realtime'>;
type DropInboxBroadcast = { payload?: { drop_id?: unknown } };

export function dropInboxTopic(userId: string) {
  return `user:${userId}:drop-inbox`;
}

/** Listen on a private, account-scoped channel. The broadcast contains no drop content. */
export async function subscribeToDropInbox(
  client: DropInboxRealtimeClient,
  userId: string,
  onDropSignal: (dropId?: string) => void,
): Promise<() => void> {
  if (!userId) return () => {};

  let active = true;
  let channel: RealtimeChannel;
  try {
    await client.realtime.setAuth();
    channel = client
      .channel(dropInboxTopic(userId), { config: { private: true } })
      .on('broadcast', { event: 'drop_received' }, (message: DropInboxBroadcast) => {
        if (active) {
          const dropId = typeof message.payload?.drop_id === 'string' ? message.payload.drop_id : undefined;
          onDropSignal(dropId);
        }
      })
      .subscribe((status) => {
        // Refresh after reconnect so any signal missed while offline is recovered immediately.
        if (active && status === 'SUBSCRIBED') onDropSignal();
      });
  } catch {
    return () => {};
  }

  return () => {
    if (!active) return;
    active = false;
    void client.removeChannel(channel).catch(() => {});
  };
}
