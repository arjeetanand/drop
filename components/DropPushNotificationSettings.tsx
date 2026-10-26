'use client';

import { useEffect, useRef, useState } from 'react';
import {
  decodeDropPushApplicationServerKey,
  disableDropPushForAccount,
  enableDropPushForAccount,
  getDropPushServiceWorkerRegistration,
  hasDropPushVapidKey,
  isDropPushEnabledForAccount,
  supportsDropPushNotifications,
} from '@/lib/dropPushNotifications';

type PushView = 'checking' | 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'enabled' | 'error';

type DropPushNotificationSettingsProps = {
  userId: string;
};

export function DropPushNotificationSettings({ userId }: DropPushNotificationSettingsProps) {
  const [view, setView] = useState<PushView>('checking');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Checking alert settings…');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const currentUserId = useRef(userId);

  useEffect(() => {
    currentUserId.current = userId;
    let active = true;
    const update = (nextView: PushView, message: string) => {
      if (!active) return;
      setView(nextView);
      setStatus(message);
    };

    setView('checking');
    setBusy(false);
    setStatus('Checking alert settings…');

    const checkCurrentDevice = async () => {
      if (!supportsDropPushNotifications()) {
        update('unsupported', 'Alerts aren’t available in this browser. Your Inbox still catches up when you return.');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (!active) return;
        if (subscription) {
          const enabled = await isDropPushEnabledForAccount(userId, subscription.endpoint);
          if (!active) return;
          if (enabled === null) {
            update('error', 'Couldn’t check alert settings. Try again. Your Inbox remains available.');
            return;
          }
          if (enabled) {
            update('enabled', Notification.permission === 'denied'
              ? 'Alerts are on for this device, but browser settings currently block them. Your Inbox remains available.'
              : 'On for this device. Alerts stay generic; open Drop to see your Inbox.');
            return;
          }
        }

        if (Notification.permission === 'denied') {
          update('denied', 'Alerts are blocked in browser settings. Your Inbox still catches up when you return.');
        } else if (!hasDropPushVapidKey()) {
          update('unconfigured', 'Alerts aren’t set up in this preview yet. Your Inbox still catches up when you return.');
        } else {
          update('off', 'Off on this device. Your Inbox still catches up when you return.');
        }
      } catch {
        update('error', 'Couldn’t check alert settings. Try again. Your Inbox remains available.');
      }
    };

    void checkCurrentDevice();
    return () => {
      active = false;
    };
  }, [userId, refreshVersion]);

  const enableAlerts = async () => {
    if (busy || !userId || !supportsDropPushNotifications() || !hasDropPushVapidKey()) return;
    const actionUserId = userId;

    const permissionRequest = Notification.permission === 'default'
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);

    setBusy(true);
    setStatus('Waiting for browser permission…');
    try {
      const permission = await permissionRequest;
      if (currentUserId.current !== actionUserId) return;
      if (permission !== 'granted') {
        setView(permission === 'denied' ? 'denied' : 'off');
        setStatus(permission === 'denied'
          ? 'Alerts are blocked in browser settings. Your Inbox still catches up when you return.'
          : 'Alerts are off. Your Inbox still catches up when you return.');
        return;
      }

      setStatus('Turning alerts on…');
      const applicationServerKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
      if (!applicationServerKey) {
        setView('unconfigured');
        setStatus('Alerts aren’t set up in this preview yet. Your Inbox still catches up when you return.');
        return;
      }

      const registration = await getDropPushServiceWorkerRegistration();
      if (currentUserId.current !== actionUserId) return;
      let subscription = await registration.pushManager.getSubscription();
      const createdHere = !subscription;
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeDropPushApplicationServerKey(applicationServerKey),
        });
      }
      if (currentUserId.current !== actionUserId) {
        if (createdHere) await subscription.unsubscribe().catch(() => false);
        return;
      }

      const enabled = await enableDropPushForAccount(actionUserId, subscription);
      if (!enabled) {
        if (createdHere) await subscription.unsubscribe().catch(() => false);
        if (currentUserId.current !== actionUserId) return;
        setView('error');
        setStatus('Couldn’t enable alerts. Try again. Your Inbox remains available.');
        return;
      }

      if (currentUserId.current !== actionUserId) return;
      setView('enabled');
      setStatus('On for this device. Alerts stay generic; open Drop to see your Inbox.');
    } catch {
      if (currentUserId.current !== actionUserId) return;
      setView('error');
      setStatus('Couldn’t enable alerts. Try again. Your Inbox remains available.');
    } finally {
      setBusy(false);
    }
  };

  const disableAlerts = async () => {
    if (busy) return;
    const actionUserId = userId;
    setBusy(true);
    setStatus('Turning alerts off…');
    try {
      const result = await disableDropPushForAccount(actionUserId);
      if (currentUserId.current !== actionUserId) return;
      if (!result.ok) {
        setView('enabled');
        setStatus('Couldn’t turn alerts off. Try again. Your Inbox remains available.');
        return;
      }
      setView('off');
      setStatus('Off on this device. Your Inbox still catches up when you return.');
    } catch {
      if (currentUserId.current !== actionUserId) return;
      setView('enabled');
      setStatus('Couldn’t turn alerts off. Try again. Your Inbox remains available.');
    } finally {
      setBusy(false);
    }
  };

  const retryStatusCheck = () => {
    setView('checking');
    setStatus('Checking alert settings…');
    setRefreshVersion((version) => version + 1);
  };

  return (
    <section
      aria-labelledby="drop-push-settings-title"
      aria-busy={busy}
      className="mt-5 rounded-2xl border border-[rgba(16,42,67,0.12)] bg-white/70 p-4 sm:p-5"
    >
      <h3 id="drop-push-settings-title" className="section-title text-lg">New-drop alerts</h3>
      <p className="body-copy mt-2 text-sm">
        Get a quiet heads-up when a drop reaches your Inbox. Alerts never show who sent it or what’s inside.
      </p>
      <p className="field-help mt-3" role="status" aria-live="polite" aria-atomic="true">{status}</p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        {view === 'off' && (
          <button
            type="button"
            onClick={() => void enableAlerts()}
            disabled={busy}
            className="button-primary min-h-11 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {busy ? 'Turning alerts on…' : 'Turn on new-drop alerts'}
          </button>
        )}
        {view === 'enabled' && (
          <button
            type="button"
            onClick={() => void disableAlerts()}
            disabled={busy}
            className="button-secondary min-h-11 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {busy ? 'Turning alerts off…' : 'Turn off alerts'}
          </button>
        )}
        {view === 'error' && (
          <button
            type="button"
            onClick={retryStatusCheck}
            disabled={busy}
            className="button-secondary min-h-11 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            Check again
          </button>
        )}
      </div>
    </section>
  );
}
