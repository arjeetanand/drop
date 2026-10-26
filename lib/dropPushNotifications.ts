import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

const MANAGE_FUNCTION = 'manage-drop-push-subscription';

type DropPushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type ManageRequest =
  | { action: 'status'; endpoint?: string }
  | { action: 'enable'; subscription: DropPushSubscriptionPayload }
  | { action: 'disable'; endpoint: string };

export type DisableDropPushResult = { ok: true } | { ok: false };

function getBrowserPushSupport() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function supportsDropPushNotifications() {
  return getBrowserPushSupport();
}

export function hasDropPushVapidKey() {
  return Boolean(process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim());
}

export async function getDropPushServiceWorkerRegistration() {
  if (!getBrowserPushSupport()) throw new Error('Drop alerts are unavailable in this browser.');
  await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

async function sendManageRequest(expectedUserId: string, body: ManageRequest): Promise<boolean | null> {
  const client = getSupabaseBrowserClient();
  if (!client || !expectedUserId) return null;

  try {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session || session.user.id !== expectedUserId) return null;

    const { data, error } = await client.functions.invoke(MANAGE_FUNCTION, {
      body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error || !data || typeof data.enabled !== 'boolean') return null;
    return data.enabled;
  } catch {
    return null;
  }
}

export function isDropPushEnabledForAccount(userId: string, endpoint?: string) {
  return sendManageRequest(userId, { action: 'status', endpoint });
}

export async function enableDropPushForAccount(userId: string, subscription: PushSubscription) {
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return false;

  return (await sendManageRequest(userId, {
    action: 'enable',
    subscription: { endpoint, keys: { p256dh, auth } },
  })) === true;
}

async function disableLocalSubscriptionForAccount(userId: string): Promise<DisableDropPushResult> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) return { ok: true };

  let registration: ServiceWorkerRegistration | undefined;
  let subscription: PushSubscription | null = null;
  try {
    registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return { ok: true };
    subscription = await registration.pushManager.getSubscription();
  } catch {
    return { ok: false };
  }
  if (!subscription) return { ok: true };

  const remoteDisabled = userId
    ? (await sendManageRequest(userId, { action: 'disable', endpoint: subscription.endpoint })) === false
    : false;

  let localDisabled = false;
  try {
    localDisabled = await subscription.unsubscribe();
  } catch {
    // The sign-out flow can retry if the backend and browser both retain the subscription.
  }

  return remoteDisabled || localDisabled ? { ok: true } : { ok: false };
}

export function disableDropPushForAccount(userId: string): Promise<DisableDropPushResult> {
  return disableLocalSubscriptionForAccount(userId);
}

export async function disableDropPushForCurrentAccount(): Promise<DisableDropPushResult> {
  let userId = '';
  try {
    const client = getSupabaseBrowserClient();
    if (client) {
      const { data, error } = await client.auth.getSession();
      if (!error) userId = data.session?.user.id ?? '';
    }
  } catch {
    // Local unsubscribe is still attempted even when the current account cannot be read.
  }

  return disableLocalSubscriptionForAccount(userId);
}

export function decodeDropPushApplicationServerKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}${padding}`;
  const decoded = window.atob(base64);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) output[index] = decoded.charCodeAt(index);
  return output;
}
