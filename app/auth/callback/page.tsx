'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const finishAuth = async () => {
      const oauthError = searchParams.get('error_description') || searchParams.get('error');
      if (oauthError) {
        router.replace(`/profile?authError=${encodeURIComponent(oauthError)}`);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const code = searchParams.get('code');
      if (supabase && code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace(`/profile?authError=${encodeURIComponent(error.message)}`);
          return;
        }
      }
      router.replace('/profile');
    };
    void finishAuth();
  }, [router, searchParams]);

  return <main className="flex min-h-screen items-center justify-center p-margin-mobile"><p className="font-body-md text-body-md text-on-surface-variant">Finishing Google sign-in…</p></main>;
}

export default function AuthCallbackPage() {
  return <Suspense fallback={<main className="min-h-screen" />}><AuthCallbackContent /></Suspense>;
}
