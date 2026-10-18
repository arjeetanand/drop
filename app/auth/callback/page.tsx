'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { safeInternalPath } from '@/lib/safeInternalPath';
import { copyGuestDraftAttachmentToAccount, deleteDraftAttachment } from '@/lib/letterMediaStore';
import { copyGuestDraftToAccount, getGuestDraftById } from '@/lib/letterStore';

const AUTH_RETURN_KEY = 'dear-exe:auth-return';

function AuthCallbackLoading() {
  return (
    <main className="page-shell">
      <div className="page-container max-w-[560px]">
        <p className="meta" role="status" aria-live="polite">Finishing sign-in…</p>
      </div>
    </main>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('Checking the sign-in return…');

  useEffect(() => {
    let active = true;

    const redirectWithError = (errorMessage: string) => {
      if (active) setMessage('Google sign-in could not finish. Returning to your profile…');
      let nextPath: string | null = null;
      try {
        nextPath = safeInternalPath(window.sessionStorage.getItem(AUTH_RETURN_KEY), window.location.origin);
      } catch { /* Storage may be disabled; return to the profile. */ }
      router.replace(`/profile?authError=${encodeURIComponent(errorMessage)}${nextPath ? `&next=${encodeURIComponent(nextPath)}` : ''}`);
    };

    const finishAuth = async () => {
      const providerError = searchParams.get('error_description') || searchParams.get('error');
      if (providerError) {
        redirectWithError(providerError);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        redirectWithError('Supabase is not configured for this app.');
        return;
      }

      const code = searchParams.get('code');
      let signedInUserId = '';
      try {
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error || !data.session) {
            redirectWithError(error?.message || 'The sign-in code could not be exchanged.');
            return;
          }
          signedInUserId = data.session.user.id;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) {
            redirectWithError('The sign-in return did not include a valid session.');
            return;
          }
          signedInUserId = data.session.user.id;
        }

        if (active) setMessage('Signed in. Opening your profile…');
        let nextPath: string | null = null;
        try {
          nextPath = safeInternalPath(window.sessionStorage.getItem(AUTH_RETURN_KEY), window.location.origin);
          window.sessionStorage.removeItem(AUTH_RETURN_KEY);
        } catch { /* Storage may be disabled; return to the profile. */ }
        if (nextPath && signedInUserId) {
          const returnUrl = new URL(nextPath, window.location.origin);
          const draftId = returnUrl.pathname === '/compose' ? returnUrl.searchParams.get('letter') : null;
          if (draftId && getGuestDraftById(draftId)) {
            const draft = await copyGuestDraftToAccount(
              draftId,
              signedInUserId,
              copyGuestDraftAttachmentToAccount,
              deleteDraftAttachment,
            );
            if (!draft) {
              if (active) setMessage('Your draft is still saved on this device, but it could not be copied into this account. Open your profile and sign out to return to it.');
              return;
            }
            if (draft.id !== draftId) {
              returnUrl.searchParams.set('letter', draft.id);
              nextPath = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
            }
          }
        }
        router.replace(nextPath || '/profile');
      } catch {
        redirectWithError('The sign-in return could not be verified. Please try again.');
      }
    };

    void finishAuth();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <main className="page-shell page-enter">
      <div className="page-container flex min-h-[70dvh] items-center justify-center">
        <section className="panel w-full max-w-[560px] p-7 sm:p-10" aria-live="polite" aria-busy={!message.startsWith('Signed in') && !message.startsWith('Google sign-in could not')}>
          <p className="eyebrow">Account handoff</p>
          <h1 className="section-title mt-3">Returning to your desk.</h1>
          <p className="body-copy mt-4">{message}</p>
          <Link
            href="/profile"
            className="button-quiet mt-6 -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to profile
          </Link>
        </section>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackLoading />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
