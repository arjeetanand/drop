'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isClaimReturnPath, profileRoute, resolveAuthReturnPath } from '@/lib/inviteOnboarding';
import { isAuthAccountCurrent, resolveGuestDraftAuthReturn, resolveStoredDraftAuthReturn } from '@/lib/guestDraftAuthReturn';
import { copyGuestDraftAttachmentToAccount, deleteDraftAttachment } from '@/lib/letterMediaStore';
import { copyGuestDraftToAccount, getGuestDraftById, getStoredLetterDraftById } from '@/lib/letterStore';

const AUTH_RETURN_KEY = 'dear-exe:auth-return';

async function isSignedInAs(accountId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;
  return isAuthAccountCurrent(accountId, () => supabase.auth.getSession());
}

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
  const inviteContext = searchParams.get('invite') === '1';
  const [message, setMessage] = useState('Checking the sign-in return…');
  const [returnPath, setReturnPath] = useState('/profile');
  const [claimReturn, setClaimReturn] = useState(false);
  const [isBusy, setIsBusy] = useState(true);
  const [pendingTransfer, setPendingTransfer] = useState<{
    draftId: string;
    accountId: string;
    nextPath: string;
    kind: 'transfer' | 'verify' | 'session';
  } | null>(null);
  const [retryingTransfer, setRetryingTransfer] = useState(false);

  const retryGuestDraftTransfer = async () => {
    if (!pendingTransfer || retryingTransfer) return;
    setRetryingTransfer(true);
    setIsBusy(true);
    setMessage('Retrying your draft transfer…');
    if (!(await isSignedInAs(pendingTransfer.accountId))) {
      setRetryingTransfer(false);
      setIsBusy(false);
      setMessage('Your sign-in changed during this step. The draft is still safe; return to your profile and sign in to the same account before checking again.');
      return;
    }
    const guestDraft = getGuestDraftById(pendingTransfer.draftId);
    const result = guestDraft
      ? await resolveGuestDraftAuthReturn(
        pendingTransfer.nextPath,
        pendingTransfer.draftId,
        pendingTransfer.accountId,
        (draftId, accountId) => copyGuestDraftToAccount(
          draftId,
          accountId,
          copyGuestDraftAttachmentToAccount,
          deleteDraftAttachment,
        ),
        (draftId, accountId) => getStoredLetterDraftById(draftId, accountId),
      )
      : resolveStoredDraftAuthReturn(
        pendingTransfer.nextPath,
        pendingTransfer.draftId,
        pendingTransfer.accountId,
        getStoredLetterDraftById,
      );
    setRetryingTransfer(false);
    if (result.status === 'retry') {
      setIsBusy(false);
      setReturnPath(profileRoute(inviteContext));
      setMessage(guestDraft
        ? 'Your draft is still saved on this device, but it could not be copied into this account. Try again, or return to your profile and sign out to continue on this device.'
        : 'This draft could not be verified on this device or in this account. Check again, or return to your profile and sign out to inspect your device drafts.');
      return;
    }
    if (!(await isSignedInAs(pendingTransfer.accountId))) {
      setPendingTransfer({ ...pendingTransfer, kind: 'session' });
      setIsBusy(false);
      setReturnPath(profileRoute(inviteContext));
      setMessage('Your sign-in changed while this draft was being checked. The draft is still safe; return to your profile and sign in to the same account before continuing.');
      return;
    }
    setPendingTransfer(null);
    router.replace(result.nextPath);
  };

  useEffect(() => {
    let active = true;
    setIsBusy(true);

    const getReturnPath = () => {
      const fromEmailLink = searchParams.get('next');
      try {
        return resolveAuthReturnPath(fromEmailLink, window.sessionStorage.getItem(AUTH_RETURN_KEY), window.location.origin);
      } catch { return resolveAuthReturnPath(fromEmailLink, null, window.location.origin); }
    };

    const redirectWithError = (errorMessage: string) => {
      const nextPath = getReturnPath();
      if (active) {
        setReturnPath(nextPath || '/profile');
        setClaimReturn(isClaimReturnPath(nextPath));
        setIsBusy(false);
        setMessage(isClaimReturnPath(nextPath)
          ? 'Sign-in could not finish. Returning to your private drop…'
          : 'Sign-in could not finish. Returning to your profile…');
      }
      const errorUrl = new URL(profileRoute(inviteContext, nextPath), window.location.origin);
      errorUrl.searchParams.set('authError', errorMessage);
      router.replace(`${errorUrl.pathname}${errorUrl.search}`);
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

        let nextPath = getReturnPath();
        let pendingDraftReturn: { draftId: string; nextPath: string; kind: 'transfer' | 'verify' } | null = null;
        if (active) {
          setReturnPath(nextPath || '/profile');
          setClaimReturn(isClaimReturnPath(nextPath));
          setMessage(isClaimReturnPath(nextPath)
            ? 'Signed in. Opening your private drop…'
            : 'Signed in. Opening your profile…');
        }
        try { window.sessionStorage.removeItem(AUTH_RETURN_KEY); } catch { /* Storage may be disabled. */ }
        if (nextPath && signedInUserId) {
          const returnUrl = new URL(nextPath, window.location.origin);
          const draftId = returnUrl.pathname === '/compose' ? returnUrl.searchParams.get('letter') : null;
          const guestDraft = draftId ? getGuestDraftById(draftId) : null;
          if (draftId && guestDraft) {
            pendingDraftReturn = { draftId, nextPath, kind: 'transfer' };
            const transfer = await resolveGuestDraftAuthReturn(
              nextPath,
              draftId,
              signedInUserId,
              (guestDraftId, accountId) => copyGuestDraftToAccount(
                guestDraftId,
                accountId,
                copyGuestDraftAttachmentToAccount,
                deleteDraftAttachment,
              ),
              (accountDraftId, accountId) => getStoredLetterDraftById(accountDraftId, accountId),
            );
            if (transfer.status === 'retry') {
              if (active) {
                setPendingTransfer({ draftId, accountId: signedInUserId, nextPath, kind: 'transfer' });
                setReturnPath(profileRoute(inviteContext));
                setClaimReturn(false);
                setIsBusy(false);
                setMessage('Your draft is still saved on this device, but it could not be copied into this account. Try again, or return to your profile and sign out to continue on this device.');
              }
              return;
            }
            nextPath = transfer.nextPath;
          } else if (draftId) {
            pendingDraftReturn = { draftId, nextPath, kind: 'verify' };
            const storedDraftReturn = resolveStoredDraftAuthReturn(
              nextPath,
              draftId,
              signedInUserId,
              getStoredLetterDraftById,
            );
            if (storedDraftReturn.status === 'retry') {
              if (active) {
                setPendingTransfer({ draftId, accountId: signedInUserId, nextPath, kind: 'verify' });
                setReturnPath(profileRoute(inviteContext));
                setClaimReturn(false);
                setIsBusy(false);
                setMessage('This draft could not be verified on this device or in this account. Check again, or return to your profile and sign out to inspect your device drafts.');
              }
              return;
            }
            nextPath = storedDraftReturn.nextPath;
          }
          if (pendingDraftReturn && !(await isSignedInAs(signedInUserId))) {
            if (active) {
              setPendingTransfer({ ...pendingDraftReturn, accountId: signedInUserId, kind: 'session' });
              setReturnPath(profileRoute(inviteContext));
              setClaimReturn(false);
              setIsBusy(false);
              setMessage('Your sign-in changed while this draft was being checked. The draft is still safe; return to your profile and sign in to the same account before continuing.');
            }
            return;
          }
        }
        router.replace(nextPath || profileRoute(inviteContext));
      } catch {
        redirectWithError('The sign-in return could not be verified. Please try again.');
      }
    };

    void finishAuth();
    return () => {
      active = false;
    };
  }, [inviteContext, router, searchParams]);

  return (
    <main className="page-shell page-enter">
      <div className="page-container flex min-h-[70dvh] items-center justify-center">
        <section className="panel w-full max-w-[560px] p-7 sm:p-10" aria-busy={isBusy}>
          <p className="eyebrow">Account handoff</p>
          <h1 className="section-title mt-3">{claimReturn ? 'Returning to your drop.' : 'Returning to your desk.'}</h1>
          <p className="body-copy mt-4" role="status" aria-live="polite">{message}</p>
          {pendingTransfer && (
            <button
              type="button"
              onClick={() => void retryGuestDraftTransfer()}
              disabled={retryingTransfer}
              className="button-primary mt-5 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              {retryingTransfer ? 'Checking…' : pendingTransfer.kind === 'verify' ? 'Check for draft again' : pendingTransfer.kind === 'session' ? 'Check account and draft again' : 'Retry draft transfer'}
            </button>
          )}
          <Link
            href={returnPath}
            className="button-quiet mt-6 -ml-2 min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {claimReturn ? 'Back to this drop' : 'Back to profile'}
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
