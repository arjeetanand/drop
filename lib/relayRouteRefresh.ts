export const RELAY_ROUTE_REFRESH_INTERVAL_MS = 15_000;

export interface RelayRouteRefreshRuntime {
  isVisible(): boolean;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(interval: unknown): void;
  onVisibilityChange(listener: () => void): () => void;
  onFocus(listener: () => void): () => void;
}

interface RelayRouteRefreshOptions<T> {
  load: () => Promise<T | null | undefined>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
  runtime?: RelayRouteRefreshRuntime;
}

export interface RelayRouteRefreshController {
  refresh(): Promise<void>;
  stop(): void;
}

function getBrowserRuntime(): RelayRouteRefreshRuntime {
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

/** Refresh a caller-owned relay route while its page is visible. */
export function startRelayRouteRefresh<T>({
  load,
  onData,
  onError,
  runtime = getBrowserRuntime(),
}: RelayRouteRefreshOptions<T>): RelayRouteRefreshController {
  let active = true;
  let inFlight: Promise<void> | null = null;
  let interval: unknown | null = null;

  const stopInterval = () => {
    if (interval === null) return;
    const currentInterval = interval;
    interval = null;
    runtime.clearInterval(currentInterval);
  };

  const refresh = () => {
    if (!active || !runtime.isVisible()) return Promise.resolve();
    if (inFlight) return inFlight;

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
      if (inFlight === request) inFlight = null;
    };
    void request.then(clearInFlight, clearInFlight);
    return request;
  };

  const startInterval = () => {
    if (!active || interval !== null || !runtime.isVisible()) return;
    interval = runtime.setInterval(() => { void refresh(); }, RELAY_ROUTE_REFRESH_INTERVAL_MS);
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

  return {
    refresh: refreshWhenVisible,
    stop,
  };
}
