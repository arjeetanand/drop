'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  const [tokenChecked, setTokenChecked] = useState(false);
  const [accountState, setAccountState] = useState<ClaimJourneyAccountState>('checking');
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState('');

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

    if (fragmentToken) {
      try {
        window.sessionStorage.setItem(CLAIM_TOKEN_KEY, fragmentToken);
        window.sessionStorage.removeItem(CLAIM_HANDOFF_SESSION_KEY);
      } catch {
        // Keep the current invite usable in memory when browser storage is disabled.
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

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65" aria-label="Drop home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-navy text-white"><MailCheck className="h-4 w-4" aria-hidden="true" /></span>
          <span className="font-headline-md text-lg">Drop</span>
        </Link>

        <section className="mt-8 overflow-hidden rounded-[1.75rem] border border-[rgba(16,42,67,.12)] bg-[#fffdf9] shadow-[0_16px_48px_rgba(16,42,67,.08)] sm:mt-14">
          <div className="bg-[#e9edff] px-6 py-9 sm:px-12 sm:py-12">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#2b45f7] shadow-sm"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span>
            <p className="eyebrow mt-6">Private claim invite</p>
            <h1 className="mt-3 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-6xl">A private drop is waiting.</h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:text-base">A friend left something private on Drop. Sign in or create an account, choose a handle, then claim it when you’re ready. Its contents stay sealed until you claim it.</p>
          </div>

          <div className="px-6 py-6 sm:px-12 sm:py-8">
            <div className="rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-4">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#26734f]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-ink-navy">Private until you claim it</p>
                  <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">The link does not reveal what was sent. Anyone holding it can claim the drop once, so share it with the person you trust.</p>
                </div>
              </div>
              <div role="group" aria-label="Claim link expiry" className="mt-4 grid gap-2 sm:grid-cols-2">
                <p className="rounded-lg bg-[#f5f1e9] px-3 py-2.5 text-sm leading-relaxed text-ink-navy"><span className="block font-semibold">Text link</span>Expires after 7 days.</p>
                <p className="rounded-lg bg-[#f5f1e9] px-3 py-2.5 text-sm leading-relaxed text-ink-navy"><span className="block font-semibold">Photo/GIF</span>Links last up to 7 days. If unclaimed, media access ends 30 days after it was sent.</p>
              </div>
              <details className="mt-3 rounded-lg border border-[rgba(16,42,67,.1)] bg-white/70 px-3 py-2.5">
                <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7]">About media deletion</summary>
                <p className="pb-1 text-xs leading-relaxed text-on-surface-variant">After the 30-day cutoff, Drop queues unclaimed media for deletion. Physical deletion can be delayed if the Free project is paused or unavailable.</p>
              </details>
            </div>

            {tokenChecked && token && claimSteps && <ol aria-label="Claim progress" className="mt-5 grid grid-cols-3 gap-2">
              {claimSteps.map((step, index) => (
                <li
                  key={step.id}
                  aria-current={step.status === 'current' ? 'step' : undefined}
                  data-status={step.status}
                  className={`min-w-0 rounded-xl border px-3 py-2.5 ${step.status === 'completed' ? 'border-[#cae6d5] bg-[#f0f9f3]' : step.status === 'current' ? 'border-[#2b45f7] bg-[#eef1ff]' : 'border-[rgba(16,42,67,.12)] bg-white/60'}`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.08em] text-on-surface-variant">Step {index + 1}</span>
                    <span className={`font-mono text-[0.55rem] font-bold uppercase tracking-[0.06em] ${step.status === 'completed' ? 'text-[#26734f]' : step.status === 'current' ? 'text-[#2b45f7]' : 'text-on-surface-variant'}`}>
                      {step.status === 'completed' ? 'Done' : step.status === 'current' ? 'Current' : 'Up next'}
                    </span>
                  </span>
                  <span className="mt-1 block break-words text-xs font-semibold leading-snug text-ink-navy sm:text-sm">{step.label}</span>
                </li>
              ))}
            </ol>}

            {!tokenChecked ? <p className="mt-5 text-sm text-on-surface-variant" role="status">Checking this invite…</p> : !token ? (
              <div className="mt-5 rounded-xl bg-[#f5f1e9] p-4">
                <p className="text-sm leading-relaxed text-ink-navy">This browser does not have the invite code. If your email opened in another tab, switch back to the original invite tab and refresh. If you signed in on a different browser or device, open the original link there again. The code stays out of the page address after you arrive.</p>
              </div>
            ) : (
              <div className="mt-5">
                {accountState === 'checking' && <p className="text-sm text-on-surface-variant" role="status" aria-live="polite">Checking your Drop account…</p>}
                {accountState === 'signed-out' && <Link href={profileHref} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Sign in or create your account <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
                {accountState === 'needs-profile' && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">You’re signed in. Choose a Drop handle first, then come back here to claim the drop.</p>
                  <Link href={profileHref} className="button-primary mt-4 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Choose a Drop handle <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                </div>}
                {accountState === 'ready' && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">Your Drop profile is ready. Claiming attaches this drop to your account so you can open it privately.</p>
                  <button type="button" onClick={() => void claim()} disabled={claiming} className="button-primary mt-4 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{claiming ? 'Claiming drop…' : 'Claim this drop'}</button>
                </div>}
                {(accountState === 'unavailable' || accountState === 'error') && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">Drop could not check your account right now. Your invite is still here; try again in a moment.</p>
                  <button type="button" onClick={() => void refreshAccount()} className="button-secondary mt-4 !min-h-12 !rounded-xl"><Link2 className="h-4 w-4" aria-hidden="true" />Check again</button>
                </div>}
              </div>
            )}

            {notice && <p className="notice error-notice mt-4" role="alert" aria-live="assertive">{notice}</p>}
            <p className="mt-6 border-t border-[rgba(16,42,67,.12)] pt-4 text-xs leading-relaxed text-on-surface-variant">The contents and any attachment stay private until you claim this link. {handoffId ? 'This browser can carry the invite across tabs for up to 10 minutes after opening it. If you switch browsers or devices, reopen the original link there.' : 'If email opens in another tab, return to the original invite tab and refresh after signing in.'}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
