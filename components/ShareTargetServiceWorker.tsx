'use client';

import { useEffect } from 'react';
import { cleanupShareTargetHandoffs } from '@/lib/shareTargetHandoff';

export function ShareTargetServiceWorker() {
  useEffect(() => {
    void cleanupShareTargetHandoffs();

    if (!('serviceWorker' in navigator)) return;

    void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
      // The app remains usable through the regular photo/GIF picker when service workers are unavailable.
    });
  }, []);

  return null;
}
