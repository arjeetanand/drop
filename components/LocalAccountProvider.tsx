'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { setLocalAccountId } from '@/lib/localAccountScope';

export function LocalAccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authUnavailable, setAuthUnavailable] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLocalAccountId(null);
      setReady(true);
      return;
    }

    let active = true;
    let initialized = false;
    let accountId: string | null = null;
    const applySession = (session: { user: { id: string } } | null) => {
      if (!active) return;
      const nextAccountId = session?.user.id || null;
      if (!initialized) {
        initialized = true;
        accountId = nextAccountId;
        setLocalAccountId(nextAccountId);
        setAuthUnavailable(false);
        setReady(true);
        return;
      }
      if (accountId === nextAccountId) return;
      accountId = nextAccountId;
      setLocalAccountId(nextAccountId);
      if (window.location.pathname !== '/auth/callback') {
        setReady(false);
        window.location.reload();
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !initialized) {
        if (error) setAuthUnavailable(true);
        else applySession(data.session);
      }
    }).catch(() => {
      if (active && !initialized) setAuthUnavailable(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (authUnavailable) {
    return <main className="page-shell"><div className="page-container max-w-[560px]"><p className="notice" role="alert">Drop couldn’t verify this device’s account. Reload to try again before opening saved content.</p></div></main>;
  }
  if (!ready) {
    return <main className="page-shell"><div className="page-container max-w-[560px]"><p className="meta" role="status" aria-live="polite">Checking your account…</p></div></main>;
  }
  return children;
}
