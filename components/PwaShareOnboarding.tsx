'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, Share2 } from 'lucide-react';

const STANDALONE_QUERY = '(display-mode: standalone)';

type InstallPromptChoice = {
  outcome: 'accepted' | 'dismissed';
  platform: string;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallPromptChoice>;
};

function getStandaloneSnapshot() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(STANDALONE_QUERY).matches;
}

function subscribeToStandaloneMode(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};

  const query = window.matchMedia(STANDALONE_QUERY);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }

  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

export function PwaShareOnboarding() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [appWasInstalled, setAppWasInstalled] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);
  const [status, setStatus] = useState('');
  const isStandalone = useSyncExternalStore(subscribeToStandaloneMode, getStandaloneSnapshot, () => false);

  const isInstalled = isStandalone || appWasInstalled;

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setAppWasInstalled(true);
      setInstallPrompt(null);
      setStatus('Drop is installed. Sharing from other apps still depends on browser support.');
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installDrop = async () => {
    if (!installPrompt || isPrompting) return;

    const promptEvent = installPrompt;
    setIsPrompting(true);
    setStatus('Opening your browser’s install prompt…');

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      setInstallPrompt(null);

      setStatus(choice.outcome === 'accepted'
        ? 'Your browser accepted the install. Share-to-Drop still depends on browser support.'
        : 'No problem. You can attach a photo or GIF in Compose anytime.');
    } catch {
      setInstallPrompt(null);
      setStatus('The install prompt could not open. You can attach a photo or GIF in Compose anytime.');
    } finally {
      setIsPrompting(false);
    }
  };

  return (
    <section
      aria-labelledby="pwa-share-onboarding-title"
      className="rounded-2xl border border-[#ead5c6] bg-[#fff7ed] p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f3d8c9] text-[#9a5037]">
          <Share2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-[#aa5f42]">A quicker way to share</p>
          <h2 id="pwa-share-onboarding-title" className="mt-1 font-headline-md text-xl font-semibold text-ink-navy">
            Send a photo or GIF from another app
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-navy/80">
            To send a photo or GIF from another app, Drop needs to be installed. It appears in the share menu only on supported browsers and devices. You can always attach a file in Compose.
          </p>
          {isInstalled && (
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
              Drop is installed. If this browser supports app sharing, choose Drop from the photo or GIF app’s share menu.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {installPrompt && !isInstalled && (
          <button
            type="button"
            onClick={() => void installDrop()}
            disabled={isPrompting}
            className="button-primary inline-flex min-h-11 w-full items-center justify-center gap-2 !rounded-xl sm:w-auto"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {isPrompting ? 'Opening install prompt…' : 'Install Drop'}
          </button>
        )}
        <Link
          href="/compose?new=1"
          className="button-secondary inline-flex min-h-11 w-full items-center justify-center gap-2 !rounded-xl sm:w-auto"
        >
          Attach in Compose <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {!isInstalled && !installPrompt && (
        <details className="mt-2 rounded-xl border border-[rgba(16,42,67,.1)] bg-white/55">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-ink-navy">
            How to install
          </summary>
          <p className="px-3 pb-3 text-xs leading-relaxed text-on-surface-variant">
            Open your browser menu and look for Install or Add to Home Screen, if offered. App sharing depends on browser and device support. You can always attach a photo or GIF in Compose.
          </p>
        </details>
      )}

      <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-sm leading-relaxed text-ink-navy/80">
        {status}
      </p>
    </section>
  );
}
