'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Link2, LockKeyhole, MailCheck, ShieldCheck } from 'lucide-react';
import { claimDropInvite } from '@/lib/letterBackend';
import { profileRoute } from '@/lib/inviteOnboarding';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isDropClaimToken, readDropClaimTokenFromFragment } from '@/lib/dropClaim';
import { getClaimJourneySteps, type ClaimJourneyAccountState } from '@/lib/claimJourney';
import {
  clearDropClaimHandoff,
  canUseDropClaimSessionToken,
  DROP_CLAIM_HANDOFF_TTL_MS,
  isDropClaimHandoffId,
  dropClaimReturnPath,
  pruneDropClaimHandoffs,
  takeDropClaimHandoff,
  storeDropClaimHandoff,
} from '@/lib/dropClaimHandoff';

const CLAIM_TOKEN_KEY = 'drop:claim-token:v1';
const CLAIM_HANDOFF_SESSION_KEY = 'drop:claim-handoff-id:v1';

export default function ClaimPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [canContinueToProfile, setCanContinueToProfile] = useState(false);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [accountState, setAccountState] = useState<ClaimJourneyAccountState>('checking');
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState('');
  const claimActionRef = useRef<HTMLButtonElement>(null);

  const refreshAccount = async () => {
    setAccountState('checking');
    setNotice('');
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setAccountState('unavailable');
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError && authError.name !== 'AuthSessionMissingError') {
        setAccountState('error');
        return;
      }
      if (!authData.user) {
        setAccountState('signed-out');
        return;
      }
      const { data: profile, error: profileError } = await supabase.from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .maybeSingle<{ id: string }>();
      if (profileError) {
        setAccountState('error');
        return;
      }
      setAccountState(profile ? 'ready' : 'needs-profile');
    } catch {
      setAccountState('error');
    }
  };

  useEffect(() => {
    try { pruneDropClaimHandoffs(window.localStorage); } catch {
      // Storage can be blocked; the URL fragment and current page state still work.
    }
    const fragmentToken = readDropClaimTokenFromFragment(window.location.hash);
    let restoredToken: string | null = fragmentToken;
    const url = new URL(window.location.href);
    const requestedHandoffId = url.searchParams.get('handoff');
    const handoffParameterPresent = url.searchParams.has('handoff');
    let activeHandoffId: string | null = null;
    let sessionTokenPersisted = false;

    if (fragmentToken) {
      try {
        window.sessionStorage.setItem(CLAIM_TOKEN_KEY, fragmentToken);
        window.sessionStorage.removeItem(CLAIM_HANDOFF_SESSION_KEY);
        sessionTokenPersisted = true;
      } catch {
        try { window.sessionStorage.removeItem(CLAIM_TOKEN_KEY); } catch {
          // A same-tab invite still works in memory; profile setup must stay on this page.
        }
      }
      try { activeHandoffId = storeDropClaimHandoff(fragmentToken, window.localStorage); } catch {
        // A same-tab invite still works when cross-tab storage is unavailable.
      }
      if (activeHandoffId) {
        try { window.sessionStorage.setItem(CLAIM_HANDOFF_SESSION_KEY, activeHandoffId); } catch {
          // The localStorage handoff remains usable in another tab.
        }
        url.searchParams.set('handoff', activeHandoffId);
        const idToExpire = activeHandoffId;
        window.setTimeout(() => {
          try { clearDropClaimHandoff(idToExpire, window.localStorage); } catch {
            // Expiry is checked again when another claim page reads local storage.
          }
        }, DROP_CLAIM_HANDOFF_TTL_MS);
      }
    } else if (isDropClaimHandoffId(requestedHandoffId)) {
      restoredToken = takeDropClaimHandoff(requestedHandoffId, window.localStorage, Date.now(), (handoffToken) => {
        try {
          window.sessionStorage.setItem(CLAIM_TOKEN_KEY, handoffToken);
          window.sessionStorage.setItem(CLAIM_HANDOFF_SESSION_KEY, requestedHandoffId);
          return true;
        } catch {
          try {
            window.sessionStorage.removeItem(CLAIM_TOKEN_KEY);
            window.sessionStorage.removeItem(CLAIM_HANDOFF_SESSION_KEY);
          } catch { /* The shared record remains available for a later retry. */ }
          // Keep the shared handoff if the receiving tab cannot persist its session copy.
          return false;
        }
      });
      if (restoredToken) activeHandoffId = requestedHandoffId;
    }

    try {
      const savedToken = window.sessionStorage.getItem(CLAIM_TOKEN_KEY);
      const savedHandoffId = window.sessionStorage.getItem(CLAIM_HANDOFF_SESSION_KEY);
      if (!restoredToken && isDropClaimToken(savedToken) && canUseDropClaimSessionToken(
        requestedHandoffId,
        savedHandoffId,
        handoffParameterPresent,
      )) {
        restoredToken = savedToken;
        sessionTokenPersisted = true;
        if (isDropClaimHandoffId(requestedHandoffId)) activeHandoffId = requestedHandoffId;
      }
    } catch {
      // The current page can still use a token held in memory if session storage is disabled.
    }
    if (!activeHandoffId) url.searchParams.delete('handoff');
    url.hash = '';
    try {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
    } catch {
      // The fragment is never sent to the server; keep the invite usable if history is unavailable.
    }
    setToken(restoredToken);
    setHandoffId(activeHandoffId);
    setCanContinueToProfile(Boolean(restoredToken && (sessionTokenPersisted || activeHandoffId)));
    setTokenChecked(true);
    void refreshAccount();
    // The invite token is captured once per page visit; auth can be refreshed with the visible button.
  }, []);

  const claim = async () => {
    if (!token || accountState !== 'ready' || claiming) return;
    setClaiming(true);
    setNotice('');
    const result = await claimDropInvite(token);
    if (!result.ok || !result.letterId) {
      setNotice(result.error || 'This invite could not be claimed. Ask the sender to share a fresh link.');
      setClaiming(false);
      return;
    }
    try { window.sessionStorage.removeItem(CLAIM_TOKEN_KEY); } catch { /* The database claim is already complete. */ }
    try { window.sessionStorage.removeItem(CLAIM_HANDOFF_SESSION_KEY); } catch { /* The database claim is already complete. */ }
    try { clearDropClaimHandoff(handoffId, window.localStorage); } catch { /* The database claim is already complete. */ }
    setToken(null);
    router.replace(`/letter/${encodeURIComponent(result.letterId)}`);
  };

  const claimReturnPath = dropClaimReturnPath(handoffId);
  const profileHref = `${profileRoute(true, claimReturnPath)}#account`;
  const claimSteps = getClaimJourneySteps(accountState);
  const currentClaimStepIndex = claimSteps?.findIndex((step) => step.status === 'current') ?? -1;
  const currentClaimStep = currentClaimStepIndex >= 0 ? claimSteps?.[currentClaimStepIndex] : null;

  useEffect(() => {
    if (token && accountState === 'ready' && !claiming) claimActionRef.current?.focus();
  }, [accountState, claiming, token]);

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65" aria-label="Drop home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-navy text-white"><MailCheck className="h-4 w-4" aria-hidden="true" /></span>
          <span className="font-headline-md text-lg">Drop</span>
        </Link>

        <section className="mt-3 overflow-hidden rounded-[1.5rem] border border-[rgba(16,42,67,.12)] bg-[#fffdf9] shadow-[0_16px_48px_rgba(16,42,67,.08)] sm:mt-14 sm:rounded-[1.75rem]">
          <div className="bg-[#e9edff] px-5 py-5 sm:px-12 sm:py-12">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#2b45f7] shadow-sm"><LockKeyhole className="h-4 w-4" aria-hidden="true" /></span>
            <p className="eyebrow mt-3">Private claim invite</p>
            <h1 className="mt-2 font-headline-md text-3xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-6xl">A private drop is waiting.</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:mt-5 sm:text-base">Sign in or create an account, choose a handle, then claim it when you’re ready. Its contents stay sealed until you claim it.</p>
          </div>

          <div className="px-4 py-4 sm:px-12 sm:py-8">
            {tokenChecked && token && claimSteps && currentClaimStep && <div className="mt-1">
              <ol aria-label="Claim progress" className="flex gap-1.5">
                {claimSteps.map((step, index) => (
                  <li key={step.id} aria-current={step.status === 'current' ? 'step' : undefined} className="min-w-0 flex-1">
                    <span aria-hidden="true" className={`block h-1 rounded-full ${step.status === 'completed' ? 'bg-[#4f9d7a]' : step.status === 'current' ? 'bg-[#2b45f7]' : 'bg-[rgba(16,42,67,.14)]'}`} />
                    <span className="sr-only">Step {index + 1} of {claimSteps.length}: {step.label}, {step.status === 'completed' ? 'completed' : step.status === 'current' ? 'current' : 'up next'}</span>
                  </li>
                ))}
              </ol>
              <p aria-hidden="true" className="mt-1 font-mono text-xs font-semibold text-ink-navy">Step {currentClaimStepIndex + 1} of {claimSteps.length}<span className="px-1 text-on-surface-variant">·</span>{currentClaimStep.label}</p>
            </div>}

            <div className="mt-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-3">
              <div className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#26734f]" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-on-surface-variant">The link never reveals what was sent. Anyone holding it can claim the drop once, so share it only with someone you trust.</p>
              </div>
              <p className="mt-2 border-t border-[rgba(16,42,67,.1)] pt-2 text-xs leading-relaxed text-ink-navy">Text links expire after 7 days. Photo/GIF links last up to 7 days; if unclaimed, media access ends 30 days after it was sent.</p>
              <details className="mt-1 rounded-lg border border-[rgba(16,42,67,.1)] bg-white/70 px-2.5 py-1.5">
                <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7]">About media deletion</summary>
                <p className="pb-1 text-xs leading-relaxed text-on-surface-variant">After the 30-day cutoff, Drop queues unclaimed media for deletion. Physical deletion can be delayed if the Free project is paused or unavailable.</p>
              </details>
            </div>

            {!tokenChecked ? <p className="mt-5 text-sm text-on-surface-variant" role="status">Checking this invite…</p> : !token ? (
              <div className="mt-3 rounded-xl bg-[#f5f1e9] p-3">
                <p className="text-sm leading-relaxed text-ink-navy">This browser does not have the invite code. If your email opened in another tab, switch back to the original invite tab and refresh. If you signed in on a different browser or device, open the original link there again. The code stays out of the page address after you arrive.</p>
              </div>
            ) : (
              <div className="mt-3">
                {accountState === 'checking' && <p className="text-sm text-on-surface-variant" role="status" aria-live="polite">Checking your Drop account…</p>}
                {accountState === 'signed-out' && (canContinueToProfile
                  ? <Link href={profileHref} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Sign in or create your account <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                  : <p className="rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-3 text-sm leading-relaxed text-ink-navy" role="status" aria-live="polite">This browser is blocking the storage needed to keep your invite open during sign-in. Enable site storage, then open the original invite link again, or open that link in a browser that allows storage.</p>)}
                {accountState === 'needs-profile' && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">You’re signed in. Choose a Drop handle first, then come back here to claim the drop.</p>
                  {canContinueToProfile
                    ? <Link href={profileHref} className="button-primary mt-4 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Choose a Drop handle <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                    : <p className="mt-3 rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-3 text-sm leading-relaxed text-ink-navy" role="status" aria-live="polite">This browser is blocking the storage needed to keep your invite open during handle setup. Enable site storage, then open the original invite link again, or open that link in a browser that allows storage.</p>}
                </div>}
                {accountState === 'ready' && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">Your Drop profile is ready. Claiming attaches this drop to your account so you can open it privately.</p>
                  <button ref={claimActionRef} type="button" onClick={() => void claim()} disabled={claiming} className="button-primary mt-3 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{claiming ? 'Claiming drop…' : 'Claim this drop'}</button>
                </div>}
                {(accountState === 'unavailable' || accountState === 'error') && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">Drop could not check your account right now. Your invite is still here; try again in a moment.</p>
                  <button type="button" onClick={() => void refreshAccount()} className="button-secondary mt-4 !min-h-12 !rounded-xl"><Link2 className="h-4 w-4" aria-hidden="true" />Check again</button>
                </div>}
              </div>
            )}

            {notice && <p className="notice error-notice mt-3" role="alert" aria-live="assertive">{notice}</p>}
            <p className="mt-4 border-t border-[rgba(16,42,67,.12)] pt-3 text-xs leading-relaxed text-on-surface-variant">The contents and any attachment stay private until you claim this link. {handoffId ? 'This browser can carry the invite across tabs for up to 10 minutes after opening it. If you switch browsers or devices, reopen the original link there.' : 'If email opens in another tab, return to the original invite tab and refresh after signing in.'}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
