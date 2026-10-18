'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Copy, LogIn } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getRemoteProfile, saveRemoteProfile } from '@/lib/letterBackend';
import { normalizeDropRecipient } from '@/lib/dropValidation';
import { getSupabaseBrowserClient, isGoogleAuthConfigured } from '@/lib/supabaseBrowser';
import { safeInternalPath } from '@/lib/safeInternalPath';
import { defaultUserProfile, getUserProfile, profileUrl, saveUserProfile, type UserProfile } from '@/lib/userStore';

type AccountStatus = 'checking' | 'signed-out' | 'signed-in' | 'unavailable' | 'error';

function ProfileLoading() {
  return (
    <main className="page-shell">
      <div className="page-container max-w-[1080px]">
        <p className="meta" role="status" aria-live="polite">Loading your profile…</p>
      </div>
    </main>
  );
}

function ProfileContent() {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [profileError, setProfileError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [accountNoticeIsError, setAccountNoticeIsError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState('');
  const [remoteProfileAvailable, setRemoteProfileAvailable] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('checking');
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = searchParams.get('authError');
  const nextPath = safeInternalPath(searchParams.get('next'), typeof window === 'undefined' ? 'https://drop.invalid' : window.location.origin);
  const googleConfigured = isGoogleAuthConfigured();

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      try {
        const remoteProfile = await getRemoteProfile();
        if (!active) return;
        const nextProfile = remoteProfile || getUserProfile();
        if (remoteProfile) {
          saveUserProfile(remoteProfile);
          setRemoteProfileAvailable(true);
        } else {
          setRemoteProfileAvailable(false);
        }
        setProfile(nextProfile);
      } catch {
        if (active) {
          setRemoteProfileAvailable(false);
          setProfile(getUserProfile());
        }
      }
    };

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authError) return;
    setAccountStatus('error');
    setAccountNotice(`Google sign-in could not finish: ${authError}`);
    setAccountNoticeIsError(true);
    router.replace(`/profile${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`, { scroll: false });
  }, [authError, nextPath, router]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setAccountStatus('unavailable');
      return;
    }

    let active = true;
    void supabase.auth.getUser()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setAccountStatus('error');
          setAccountNotice('We could not check the Google connection. You can keep using the profile locally.');
          setAccountNoticeIsError(true);
          return;
        }
        const email = data.user?.email || '';
        setSignedInEmail(email);
        setAccountStatus(email ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (!active) return;
        setAccountStatus('error');
        setAccountNotice('We could not check the Google connection. You can keep using the profile locally.');
        setAccountNoticeIsError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const update = (field: keyof Pick<UserProfile, 'displayName' | 'username' | 'bio'>, value: string) => {
    const nextValue = field === 'username'
      ? value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24)
      : value;
    setProfile((current) => ({ ...current, [field]: nextValue }));
    setSaved(false);
    setRemoteProfileAvailable(false);
    setNotice('');
    setProfileError('');
  };

  const save = async () => {
    const username = normalizeDropRecipient(profile.username);
    if (!username) {
      setProfileError('Use 2–24 letters, numbers, periods, underscores, or hyphens.');
      return;
    }

    setSaving(true);
    setSaved(false);
    setProfileError('');
    setNotice('');
    const nextProfile = saveUserProfile({ ...profile, username });
    setProfile(nextProfile);

    let synced = false;
    try {
      synced = await saveRemoteProfile(nextProfile);
    } catch {
      synced = false;
    }

    setSaved(true);
    setSaving(false);
    setRemoteProfileAvailable(synced);
    setNotice(synced
      ? 'Saved on this device and synced to your account.'
      : signedInEmail
        ? 'Saved on this device. Account sync did not finish; check your connection or handle.'
        : 'Saved on this device. Sign in to send private drops and sync across devices.');
  };

  const connectGoogle = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !googleConfigured) {
      setAccountNotice('Google sign-in is optional. Add the Supabase values to enable the real sign-in flow.');
      setAccountNoticeIsError(false);
      setAccountStatus('unavailable');
      return;
    }

    setGoogleLoading(true);
    setAccountNotice('Opening Google sign-in…');
    setAccountNoticeIsError(false);
    try {
      window.sessionStorage.removeItem('dear-exe:auth-return');
      if (nextPath) window.sessionStorage.setItem('dear-exe:auth-return', nextPath);
    } catch { /* Sign-in can continue without a return path when storage is disabled. */ }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        window.sessionStorage.removeItem('dear-exe:auth-return');
        setGoogleLoading(false);
        setAccountStatus('error');
        setAccountNotice(error.message || 'Google sign-in could not start.');
        setAccountNoticeIsError(true);
      }
    } catch {
      window.sessionStorage.removeItem('dear-exe:auth-return');
      setGoogleLoading(false);
      setAccountStatus('error');
      setAccountNotice('Google sign-in could not start. Please try again.');
      setAccountNoticeIsError(true);
    }
  };

  const copyProfileLink = async () => {
    const username = normalizeDropRecipient(profile.username);
    if (!username) {
      setProfileError('Choose a valid Drop handle before copying your profile link.');
      return;
    }
    const link = `${window.location.origin}${profileUrl(username)}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setNotice('Public profile link copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(`Copy is unavailable here. Your profile link is ${link}`);
    }
  };

  const username = normalizeDropRecipient(profile.username);
  const publicPath = username ? profileUrl(username) : null;
  const initials = profile.displayName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'DE';
  const accountStatusText = signedInEmail
    ? `Connected as ${signedInEmail}.`
    : accountStatus === 'checking'
      ? 'Checking your account connection…'
      : accountStatus === 'unavailable' || !googleConfigured
        ? 'Sign-in is not available in this preview.'
        : accountStatus === 'error'
          ? 'Account status needs attention.'
          : 'Not connected. Your profile still works on this device.';

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[1080px]">
        <header className="page-header flex-col gap-5 sm:flex-row sm:items-center">
          <Link
            href="/"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to desk
          </Link>
          <div className="sm:text-right">
            <p className="eyebrow">Correspondent profile</p>
            <p className="meta mt-1">Local-first identity</p>
          </div>
        </header>

        <section className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <article className="paper-card p-6 sm:p-9">
            <div className="flex items-center gap-4 border-b border-[rgba(16,42,67,0.13)] pb-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-ink-navy bg-ink-navy font-headline-md text-xl text-white" aria-hidden="true">
                {initials}
              </span>
              <div>
                <p className="eyebrow">Your Drop profile</p>
                <p className="mt-1 font-literata text-lg text-ink-navy">{profile.displayName || 'Correspondent'}</p>
              </div>
            </div>

            <div className="mt-8">
              <p className="eyebrow">Make it yours</p>
              <h1 className="display-title mt-4 max-w-[11ch]">Pick your Drop handle.</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg">
                Make it easy for friends to find you and send a little something your way.
              </p>
            </div>

            <form
              className="mt-8 space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div>
                <label htmlFor="display-name" className="field-label">Display name</label>
                <input
                  id="display-name"
                  value={profile.displayName}
                  onChange={(event) => update('displayName', event.target.value)}
                  className="input-field mt-2"
                  placeholder="Eleanor Vance"
                  autoComplete="name"
                />
              </div>

              <div>
                <label htmlFor="username" className="field-label">Drop handle</label>
                <input
                  id="username"
                  value={profile.username}
                  onChange={(event) => update('username', event.target.value)}
                  className="input-field mt-2"
                  placeholder="eleanor"
                  autoComplete="username"
                  spellCheck={false}
                  aria-describedby={profileError ? 'username-help username-error' : 'username-help'}
                  aria-invalid={Boolean(profileError)}
                />
                <p id="username-help" className="field-help mt-2">Lowercase letters, numbers, periods, underscores, or hyphens. 2–24 characters.</p>
                {profileError && <p id="username-error" className="error-notice mt-2" role="alert">{profileError}</p>}
              </div>

              <div>
                <label htmlFor="bio" className="field-label">One-line bio</label>
                <textarea
                  id="bio"
                  value={profile.bio}
                  onChange={(event) => update('bio', event.target.value)}
                  className="textarea-field mt-2"
                  placeholder="Collecting small moments and sending them forward."
                  rows={4}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(16,42,67,0.1)] pt-6">
                <button
                  type="submit"
                  disabled={saving}
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6] disabled:opacity-60"
                >
                  {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                  {saving ? 'Saving…' : saved ? 'Identity saved' : 'Save identity'}
                </button>
                  <button
                  type="button"
                  onClick={() => void copyProfileLink()}
                    disabled={!remoteProfileAvailable}
                  className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  {copied ? 'Link copied' : 'Copy public link'}
                </button>
              </div>
            </form>

            {notice && <p className="notice mt-5" role="status" aria-live="polite">{notice}</p>}
          </article>

          <aside className="space-y-6">
            <section className="panel p-6">
              <p className="eyebrow">Public profile</p>
              <h2 className="section-title mt-3 text-2xl">A simple address for people who know you.</h2>
              <p className="body-copy mt-3 text-sm">Share your profile so friends can send a private drop to your handle.</p>
              {publicPath && remoteProfileAvailable ? (
                <>
                  <Link
                    href={publicPath}
                    className="meta mt-5 block break-all border-y border-[rgba(16,42,67,0.1)] py-4 text-ink-navy underline decoration-[#b84b3a] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a]"
                  >
                    dear.exe{publicPath}
                  </Link>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void copyProfileLink()}
                      className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      Copy link
                    </button>
                    <Link
                      href={publicPath}
                      className="button-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      View page
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </>
              ) : publicPath ? (
                <div className="mt-5 border-y border-[rgba(16,42,67,0.1)] py-4">
                  <p className="meta break-all text-ink-navy">dear.exe{publicPath}</p>
                  <p className="field-help mt-2">Preview link · only available on this device until your profile syncs.</p>
                </div>
              ) : (
                <p className="field-help mt-5">Choose a valid 2–24 character handle to create your profile link.</p>
              )}
            </section>

            <section id="account" className="panel-muted scroll-mt-5 p-6">
              <div className="flex items-start gap-3">
                <LogIn className="mt-0.5 h-5 w-5 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                <div>
                  <p className="eyebrow">Your account</p>
                  <h2 className="section-title mt-3 text-2xl">Keep your letters with you.</h2>
                </div>
              </div>
              <p className="body-copy mt-4 text-sm">
                Drafts save on this device. Sign in with Google to send and receive private drops and keep your profile across devices.
              </p>
              <p className="meta mt-5" role="status" aria-live="polite">{accountStatusText}</p>
              {googleConfigured && accountStatus !== 'unavailable' ? (
                <button
                  type="button"
                  onClick={() => void connectGoogle()}
                  disabled={googleLoading || accountStatus === 'signed-in'}
                  className="button-secondary mt-5 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span aria-hidden="true" className="font-sans text-base font-bold">G</span>
                  {googleLoading ? 'Opening Google…' : accountStatus === 'signed-in' ? 'Google connected' : 'Continue with Google'}
                </button>
              ) : (
                <p className="notice mt-5" role="status">Sign-in isn’t available in this preview. Drafts stay on this device.</p>
              )}
              {nextPath && <Link href={nextPath} className="button-secondary mt-3 w-full">Back to your draft</Link>}
              {accountNotice && (
                <p className={`notice mt-4 ${accountNoticeIsError ? 'error-notice' : ''}`} role={accountNoticeIsError ? 'alert' : 'status'} aria-live="polite">
                  {accountNotice}
                </p>
              )}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfileContent />
    </Suspense>
  );
}
