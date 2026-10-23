'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Link2, LockKeyhole, MailCheck, ShieldCheck } from 'lucide-react';
import { claimDropInvite } from '@/lib/letterBackend';
import { profileRoute } from '@/lib/inviteOnboarding';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isDropClaimToken, readDropClaimTokenFromFragment } from '@/lib/dropClaim';

const CLAIM_TOKEN_KEY = 'drop:claim-token:v1';

type AccountState = 'checking' | 'signed-out' | 'needs-profile' | 'ready' | 'unavailable' | 'error';

export default function ClaimPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [accountState, setAccountState] = useState<AccountState>('checking');
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
    const fragmentToken = readDropClaimTokenFromFragment(window.location.hash);
    let restoredToken: string | null = fragmentToken;
    try {
      if (fragmentToken) window.sessionStorage.setItem(CLAIM_TOKEN_KEY, fragmentToken);
      const savedToken = window.sessionStorage.getItem(CLAIM_TOKEN_KEY);
      if (!restoredToken && isDropClaimToken(savedToken)) restoredToken = savedToken;
    } catch {
      // The current page can still use a token held in memory if session storage is disabled.
    }
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    } catch {
      // The fragment is never sent to the server; keep the invite usable if history is unavailable.
    }
    setToken(restoredToken);
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
    setToken(null);
    router.replace(`/letter/${encodeURIComponent(result.letterId)}`);
  };

  const profileHref = `${profileRoute(true, '/claim')}#account`;

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
            <h1 className="mt-3 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-6xl">A drop is waiting.</h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:text-base">A friend left a private note on Drop. Sign in or create an account, choose a handle, then claim it when you’re ready. The note stays sealed until you claim it.</p>
          </div>

          <div className="px-6 py-6 sm:px-12 sm:py-8">
            <div className="flex gap-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#26734f]" aria-hidden="true" />
              <p className="text-sm leading-relaxed text-ink-navy">Anyone holding this link can claim the note, and only one Drop account can claim it. The link does not show the note itself.</p>
            </div>

            {!tokenChecked ? <p className="mt-5 text-sm text-on-surface-variant" role="status">Checking this invite…</p> : !token ? (
              <div className="mt-5 rounded-xl bg-[#f5f1e9] p-4">
                <p className="text-sm leading-relaxed text-ink-navy">This browser does not have the invite code. Open the original link again to continue; the code is kept out of the page address after you arrive.</p>
              </div>
            ) : (
              <div className="mt-5">
                {accountState === 'checking' && <p className="text-sm text-on-surface-variant" role="status" aria-live="polite">Checking your Drop account…</p>}
                {accountState === 'signed-out' && <Link href={profileHref} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Sign in or create your account <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
                {accountState === 'needs-profile' && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">You’re signed in. Choose a Drop handle first, then come back here to claim the note.</p>
                  <Link href={profileHref} className="button-primary mt-4 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Choose a Drop handle <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                </div>}
                {accountState === 'ready' && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">Your Drop profile is ready. Claiming attaches this note to your account so you can open it privately.</p>
                  <button type="button" onClick={() => void claim()} disabled={claiming} className="button-primary mt-4 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{claiming ? 'Claiming note…' : 'Claim this drop'}</button>
                </div>}
                {(accountState === 'unavailable' || accountState === 'error') && <div>
                  <p className="text-sm leading-relaxed text-on-surface-variant">Drop could not check your account right now. Your invite is still here; try again in a moment.</p>
                  <button type="button" onClick={() => void refreshAccount()} className="button-secondary mt-4 !min-h-12 !rounded-xl"><Link2 className="h-4 w-4" aria-hidden="true" />Check again</button>
                </div>}
              </div>
            )}

            {notice && <p className="notice error-notice mt-4" role="alert" aria-live="assertive">{notice}</p>}
            <p className="mt-6 border-t border-[rgba(16,42,67,.12)] pt-4 text-xs leading-relaxed text-on-surface-variant">Your note and its attachments stay private until you claim this link. If you opened the invite on another device, use the original link there after signing in.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
