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
    <main className="page-enter min-h-screen pb-24 lg:pb-0">
      <div className="mx-auto max-w-[980px] px-margin-mobile py-xl md:px-margin-desktop md:py-xxl">
        <header className="mb-xl flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Back to desk
          </Link>
          <span className="font-caption text-caption uppercase tracking-[0.2em] text-on-surface-variant">Your identity</span>
        </header>

        <section className="grid gap-xl md:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
          <div className="paper-layer p-xl card-depth md:p-xxl">
            <div className="mb-lg flex h-14 w-14 items-center justify-center rounded-full bg-ink-navy text-xl text-surface-bright">
              {profile.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2)}
            </div>
            <p className="font-caption text-caption uppercase tracking-[0.2em] text-amber-accent">Make it yours</p>
            <h1 className="mt-sm font-headline-lg text-headline-lg text-primary md:text-display-lg">A name people remember.</h1>
            <p className="mt-md max-w-xl font-body-md text-body-md leading-relaxed text-on-surface-variant">
              Your username is the tiny address people use to send you a moment. Keep it short, warm, and unmistakably you.
            </p>

            <div className="mt-xl space-y-lg">
              <label className="block font-caption text-caption uppercase tracking-widest text-on-surface-variant">
                Display name
                <input value={profile.displayName} onChange={(event) => update('displayName', event.target.value)} className="typewriter-input mt-xs text-lg text-primary" />
              </label>
              <label className="block font-caption text-caption uppercase tracking-widest text-on-surface-variant">
                Username
                <div className="mt-xs flex items-center gap-sm border-b border-parchment-deep/50">
                  <span className="font-body-md text-body-md text-amber-accent">@</span>
                  <input value={profile.username} onChange={(event) => update('username', event.target.value)} className="typewriter-input text-lg text-primary" aria-label="Username" />
                </div>
              </label>
              <label className="block font-caption text-caption uppercase tracking-widest text-on-surface-variant">
                One-line bio
                <textarea value={profile.bio} onChange={(event) => update('bio', event.target.value)} className="mt-xs min-h-[84px] w-full resize-none border border-outline-variant bg-transparent p-md font-body-md text-body-md text-primary outline-none focus:border-primary" />
              </label>
            </div>

            <div className="mt-xl flex flex-wrap items-center gap-md">
              <button type="button" onClick={save} className="inline-flex items-center gap-sm rounded-sm bg-secondary-container px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-on-secondary-container hover:bg-secondary-fixed">
                {saved ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {saved ? 'Saved' : 'Save identity'}
              </button>
              <button type="button" onClick={copyProfileLink} className="inline-flex items-center gap-sm border border-primary px-lg py-sm font-label-md text-label-md uppercase tracking-widest text-primary hover:bg-secondary-container/30">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Share profile'}
              </button>
            </div>
            {notice && <p className="mt-md font-caption text-caption text-on-surface-variant" aria-live="polite">{notice}</p>}
          </div>

          <aside className="flex flex-col gap-lg">
            <div className="paper-layer p-lg card-depth">
              <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">Your public link</p>
              <p className="mt-sm break-all font-body-md text-body-md text-primary">dear.exe{profileUrl(profile.username)}</p>
              <div className="mt-lg flex items-center justify-between border-t border-outline-variant/40 pt-md">
                <span className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant"><Link2 className="h-4 w-4" /> Shareable by design</span>
                <button type="button" onClick={copyProfileLink} aria-label="Copy profile link" className="text-primary hover:text-amber-accent"><Copy className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="paper-layer p-lg card-depth">
              <div className="flex items-start justify-between gap-md">
                <div>
                  <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">Account access</p>
                  <h2 className="mt-xs font-headline-md text-headline-md text-primary">Keep your letters with you.</h2>
                </div>
                <LogIn className="h-5 w-5 text-amber-accent" />
              </div>
              <p className="mt-md break-words font-body-md text-body-md leading-relaxed text-on-surface-variant">{signedInEmail ? `Signed in as ${signedInEmail}. Your letters can follow you across devices.` : googleConfigured ? 'Use Google to keep your letters with you across devices.' : 'Google sign-in is not connected in this local build yet.'}</p>
              <button type="button" onClick={connectGoogle} disabled={googleLoading} className="mt-lg flex min-h-12 w-full items-center justify-center gap-sm border border-primary px-lg py-sm text-center font-label-md text-label-md uppercase tracking-widest text-primary transition-colors hover:bg-secondary-container/30 disabled:cursor-wait disabled:opacity-60">
                <span className="font-bold">G</span>
                {googleLoading ? 'Opening Google…' : googleConfigured ? 'Continue with Google' : 'Set up Google sign-in'}
              </button>
              {!googleConfigured && <div className="mt-md space-y-xs border border-outline-variant bg-surface p-md"><p className="break-words font-caption text-caption font-semibold text-primary">To activate it</p><p className="break-words font-caption text-caption leading-relaxed text-on-surface-variant">Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, run the SQL migration, enable Google in Supabase, then restart Next.js.</p></div>}
              {accountNotice && <p className="mt-md break-words font-caption text-caption leading-relaxed text-on-surface-variant" aria-live="polite">{accountNotice}</p>}
            </div>
            <div className="grid grid-cols-2 gap-md">
              <div className="border border-outline-variant/60 bg-surface-container-lowest p-md"><p className="font-caption text-caption text-on-surface-variant">Letters sent</p><p className="mt-xs font-headline-md text-headline-md text-primary">{profile.lettersSent}</p></div>
              <div className="border border-outline-variant/60 bg-surface-container-lowest p-md"><p className="font-caption text-caption text-on-surface-variant">Received</p><p className="mt-xs font-headline-md text-headline-md text-primary">{profile.lettersReceived}</p></div>
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
