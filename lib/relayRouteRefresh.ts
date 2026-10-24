export const VISIBLE_DATA_REFRESH_INTERVAL_MS = 15_000;
export const RELAY_ROUTE_REFRESH_INTERVAL_MS = VISIBLE_DATA_REFRESH_INTERVAL_MS;

export interface VisibleDataRefreshRuntime {
  isVisible(): boolean;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(interval: unknown): void;
  onVisibilityChange(listener: () => void): () => void;
  onFocus(listener: () => void): () => void;
}

interface VisibleDataRefreshOptions<T> {
  load: () => Promise<T | null | undefined>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
  runtime?: VisibleDataRefreshRuntime;
  intervalMs?: number;
  queueOneWhileInFlight?: boolean;
}

export interface VisibleDataRefreshController {
  refresh(): Promise<void>;
  stop(): void;
}

export type RelayRouteRefreshRuntime = VisibleDataRefreshRuntime;
export type RelayRouteRefreshController = VisibleDataRefreshController;

function getBrowserRuntime(): VisibleDataRefreshRuntime {
  return {
    isVisible: () => document.visibilityState === 'visible',
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (interval) => window.clearInterval(interval as number),
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    onFocus: (listener) => {
      window.addEventListener('focus', listener);
      return () => window.removeEventListener('focus', listener);
    },
  };
}

/** Refresh caller-owned data while the page is visible, without overlapping reads. */
export function startVisibleDataRefresh<T>({
  load,
  onData,
  onError,
  runtime = getBrowserRuntime(),
  intervalMs = VISIBLE_DATA_REFRESH_INTERVAL_MS,
  queueOneWhileInFlight = false,
}: VisibleDataRefreshOptions<T>): VisibleDataRefreshController {
  let active = true;
  let inFlight: Promise<void> | null = null;
  let refreshQueued = false;
  let interval: unknown | null = null;

  const stopInterval = () => {
    if (interval === null) return;
    const currentInterval = interval;
    interval = null;
    runtime.clearInterval(currentInterval);
  };

  const refresh = () => {
    if (!active || !runtime.isVisible()) return Promise.resolve();
    if (inFlight) {
      if (queueOneWhileInFlight) refreshQueued = true;
      return inFlight;
    }

    const request = (async () => {
      try {
        const data = await load();
        if (active && data !== null && data !== undefined) onData(data);
      } catch (error) {
        if (active) onError?.(error);
      }
    })();
    inFlight = request;
    const clearInFlight = () => {
      if (inFlight !== request) return;
      inFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        if (active && runtime.isVisible()) void refresh();
      }
    };
    void request.then(clearInFlight, clearInFlight);
    return request;
  };

  const startInterval = () => {
    if (!active || interval !== null || !runtime.isVisible()) return;
    interval = runtime.setInterval(() => { void refresh(); }, intervalMs);
  };

  const refreshWhenVisible = () => {
    if (!active || !runtime.isVisible()) return Promise.resolve();
    startInterval();
    return refresh();
  };

  const handleVisibilityChange = () => {
    if (!active) return;
    if (!runtime.isVisible()) {
      stopInterval();
      return;
    }
    refreshWhenVisible();
  };

  const removeVisibilityListener = runtime.onVisibilityChange(handleVisibilityChange);
  const removeFocusListener = runtime.onFocus(refreshWhenVisible);
  if (runtime.isVisible()) {
    startInterval();
    void refresh();
  }

  const stop = () => {
    if (!active) return;
    active = false;
    stopInterval();
    removeVisibilityListener();
    removeFocusListener();
  };

  return { refresh: refreshWhenVisible, stop };
}

// Keep the existing export stable for relay-route consumers while sharing the
// same visible-tab refresh primitive with the inbox.
export const startRelayRouteRefresh = startVisibleDataRefresh;
