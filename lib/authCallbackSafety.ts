export type AuthCodeExchangeSlot<T> = {
  current: { code: string; promise: Promise<T> } | null;
};

export type ActiveAuthCallbackResult<T> =
  | { active: true; value: T }
  | { active: false };

export function exchangeAuthCodeOnce<T>(
  slot: AuthCodeExchangeSlot<T>,
  code: string,
  exchange: (code: string) => Promise<T>,
): Promise<T> {
  if (slot.current?.code === code) return slot.current.promise;

  const promise = Promise.resolve().then(() => exchange(code));
  slot.current = { code, promise };
  return promise;
}

export async function exchangeAuthCodeWhileActive<T>(
  slot: AuthCodeExchangeSlot<T>,
  activity: ReturnType<typeof createAuthCallbackActivity>,
  code: string,
  exchange: (code: string) => Promise<T>,
): Promise<ActiveAuthCallbackResult<T>> {
  const value = await exchangeAuthCodeOnce(slot, code, exchange);
  return activity.whileActive(() => ({ active: true as const, value })) ?? { active: false };
}

export function createAuthCallbackActivity() {
  let active = true;

  return {
    isActive: () => active,
    whileActive<T>(callback: () => T): T | undefined {
      if (!active) return undefined;
      return callback();
    },
    dispose() {
      active = false;
    },
  };
}
