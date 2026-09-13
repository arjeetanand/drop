'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Copy, Link2, LogIn, Sparkles } from 'lucide-react';
import { getSupabaseBrowserClient, isGoogleAuthConfigured } from '@/lib/supabaseBrowser';
import { defaultUserProfile, getUserProfile, profileUrl, saveUserProfile, type UserProfile } from '@/lib/userStore';
import { getRemoteProfile, saveRemoteProfile } from '@/lib/letterBackend';

function ProfileContent() {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const googleConfigured = isGoogleAuthConfigured();

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      const remoteProfile = await getRemoteProfile();
      if (active) setProfile(remoteProfile || getUserProfile());
    };
    void loadProfile();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const authError = searchParams.get('authError');
    if (authError) {
      setAccountNotice(`Google sign-in could not finish: ${authError}`);
      router.replace('/profile', { scroll: false });
    }
  }, [router, searchParams]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      setSignedInEmail(data.user?.email || '');
    });
  }, []);

  const update = (field: keyof UserProfile, value: string) => {
    const nextValue = field === 'username'
      ? value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24)
      : value;
    setProfile((current) => ({ ...current, [field]: nextValue }));
    setSaved(false);
  };

  const save = () => {
    const username = profile.username.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'your.story';
    const nextProfile = saveUserProfile({ ...profile, username });
    setProfile(nextProfile);
    void saveRemoteProfile(nextProfile);
    setSaved(true);
    setNotice('Your identity is ready to share.');
  };

  const connectGoogle = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setAccountNotice('Google sign-in is not connected yet. Add the Supabase values shown below, restart the app, and this button will start the real Google flow.');
      return;
    }
    setGoogleLoading(true);
    setAccountNotice('Opening Google sign-in…');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setGoogleLoading(false);
      setAccountNotice(error.message);
    }
  };

  const copyProfileLink = async () => {
    const link = `${window.location.origin}${profileUrl(profile.username)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(link);
    }
  };

  return (
    <main className="page-enter min-h-screen pb-24 lg:pb-12 bg-surface text-ink-navy">
      <div className="mx-auto max-w-[1120px] px-margin-mobile py-6 md:px-12 md:py-10 xl:px-16">
        {/* Header */}
        <header className="flex items-center justify-between pb-6 border-b border-[#102a43]/[0.08]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#102a43]/[0.1] bg-white/70 backdrop-blur-sm text-xs font-mono tracking-wider uppercase text-on-surface-variant hover:text-ink-navy hover:bg-white transition-all shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to desk
          </Link>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-on-surface-variant">
            Correspondent Identity
          </span>
        </header>

        <section className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] items-start">
          {/* Main Profile Editor Card */}
          <div className="refero-card rounded-2xl p-6 md:p-10 bg-white border border-[#102a43]/[0.08] shadow-[0_12px_40px_-8px_rgba(16,42,67,0.07)]">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-navy text-2xl font-serif text-white shadow-[0_4px_16px_rgba(16,42,67,0.2)]">
                {profile.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2)}
              </div>
              <div>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-accent font-semibold block">
                  Public Alias
                </span>
                <h2 className="font-headline-md text-2xl text-ink-navy font-bold">
                  {profile.displayName || 'Correspondent'}
                </h2>
              </div>
            </div>

            <h1 className="font-headline-lg text-[clamp(2rem,3.8vw,3.2rem)] leading-[1.05] tracking-[-0.03em] text-ink-navy">
              Give your relay a name.
            </h1>
            <p className="mt-3 font-body-md text-base leading-relaxed text-on-surface-variant">
              Your handle is the unique address fellow carriers use to route letters into your hands. Keep it warm, memorable, and unmistakably you.
            </p>

            <div className="mt-8 space-y-6">
              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 font-medium">
                  Display Name
                </label>
                <input
                  value={profile.displayName}
                  onChange={(event) => update('displayName', event.target.value)}
                  className="typewriter-input text-lg text-ink-navy bg-[#faf8f4] border border-[#102a43]/[0.12] rounded-xl p-3.5 w-full focus:bg-white focus:border-ink-navy transition-colors"
                  placeholder="e.g. Eleanor Vance"
                />
              </div>

              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 font-medium">
                  Relay Handle
                </label>
                <div className="flex items-center rounded-xl border border-[#102a43]/[0.12] bg-[#faf8f4] px-3.5 focus-within:bg-white focus-within:border-ink-navy transition-colors">
                  <span className="font-mono text-base text-amber-accent font-bold pr-1">@</span>
                  <input
                    value={profile.username}
                    onChange={(event) => update('username', event.target.value)}
                    className="typewriter-input text-lg text-ink-navy bg-transparent py-3.5 w-full outline-none"
                    aria-label="Username"
                    placeholder="eleanor"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-xs uppercase tracking-wider text-on-surface-variant mb-1.5 font-medium">
                  One-line Bio
                </label>
                <textarea
                  value={profile.bio}
                  onChange={(event) => update('bio', event.target.value)}
                  className="min-h-[90px] w-full resize-none rounded-xl border border-[#102a43]/[0.12] bg-[#faf8f4] p-3.5 font-body-md text-sm text-ink-navy outline-none focus:bg-white focus:border-ink-navy transition-colors"
                  placeholder="e.g. Architect living between old paper notebooks and new cities."
                />
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                className="inline-flex items-center gap-2 bg-ink-navy text-white px-6 py-3 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] hover:bg-ink-navy/90 active:scale-[0.99] transition-all shadow-[0_2px_8px_rgba(16,42,67,0.15)]"
              >
                {saved ? <Check className="h-4 w-4 text-mint-accent" /> : <Sparkles className="h-4 w-4 text-amber-accent" />}
                <span>{saved ? 'Identity Saved' : 'Save Identity'}</span>
              </button>
              <button
                type="button"
                onClick={copyProfileLink}
                className="inline-flex items-center gap-2 border border-[#102a43]/[0.15] bg-white px-5 py-3 rounded-xl font-label-md text-xs uppercase tracking-[0.14em] text-ink-navy hover:bg-[#faf8f4] transition-all"
              >
                {copied ? <Check className="h-4 w-4 text-mint-accent" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Link Copied' : 'Share Profile'}</span>
              </button>
            </div>
            {notice && (
              <p className="mt-3 font-mono text-xs text-mint-accent font-medium" aria-live="polite">
                {notice}
              </p>
            )}
          </div>

          {/* Aside Column */}
          <aside className="space-y-6">
            {/* Public Link Card */}
            <div className="refero-card rounded-2xl p-6 bg-white border border-[#102a43]/[0.08]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">
                Your Public Postbox
              </p>
              <p className="mt-2 break-all font-mono text-sm text-ink-navy font-semibold bg-[#faf8f4] p-3 rounded-lg border border-[#102a43]/[0.08]">
                dear.exe{profileUrl(profile.username)}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-[#102a43]/[0.08] pt-3">
                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-on-surface-variant">
                  <Link2 className="h-3.5 w-3.5 text-mint-accent" /> Shareable Link
                </span>
                <button
                  type="button"
                  onClick={copyProfileLink}
                  aria-label="Copy profile link"
                  className="font-mono text-xs text-ink-navy hover:text-amber-accent inline-flex items-center gap-1"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              </div>
            </div>

            {/* Account Sync Card */}
            <div className="refero-card rounded-2xl p-6 bg-white border border-[#102a43]/[0.08]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-amber-accent font-bold">
                    Account Sync
                  </p>
                  <h3 className="mt-1 font-headline-md text-xl text-ink-navy">
                    Keep your letters with you.
                  </h3>
                </div>
                <LogIn className="h-5 w-5 text-amber-accent shrink-0" />
              </div>
              <p className="mt-2 font-body-md text-xs leading-relaxed text-on-surface-variant">
                {signedInEmail
                  ? `Signed in as ${signedInEmail}. Your letters sync automatically across your devices.`
                  : googleConfigured
                  ? 'Connect Google to back up your written drafts and journey logbooks.'
                  : 'Google sign-in is optional for this local development build.'}
              </p>
              <button
                type="button"
                onClick={connectGoogle}
                disabled={googleLoading}
                className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#102a43]/[0.15] bg-[#faf8f4] px-4 py-2.5 text-center font-label-md text-xs uppercase tracking-[0.14em] text-ink-navy hover:bg-white transition-all disabled:cursor-wait disabled:opacity-60"
              >
                <span className="font-bold text-sm">G</span>
                <span>
                  {googleLoading
                    ? 'Opening Google…'
                    : googleConfigured
                    ? 'Continue with Google'
                    : 'Set up Google sign-in'}
                </span>
              </button>
              {accountNotice && (
                <p className="mt-3 font-mono text-xs text-on-surface-variant" aria-live="polite">
                  {accountNotice}
                </p>
              )}
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="refero-card rounded-2xl p-5 bg-white text-center">
                <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  Relays Started
                </p>
                <p className="mt-1 font-headline-md text-2xl text-ink-navy font-bold">
                  {profile.lettersSent}
                </p>
              </div>
              <div className="refero-card rounded-2xl p-5 bg-white text-center">
                <p className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                  Letters Held
                </p>
                <p className="mt-1 font-headline-md text-2xl text-ink-navy font-bold">
                  {profile.lettersReceived}
                </p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return <Suspense fallback={<main className="min-h-screen" />}><ProfileContent /></Suspense>;
}
