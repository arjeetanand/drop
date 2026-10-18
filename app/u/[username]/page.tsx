'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Copy, Mail } from 'lucide-react';
import { useParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { getUserProfile, profileUrl, type UserProfile } from '@/lib/userStore';

type PublicProfile = Pick<UserProfile, 'displayName' | 'username' | 'bio'>;

type PublicProfileRow = {
  username: string;
  display_name: string;
  bio: string;
};

type PublicProfileStatus = 'loading' | 'found' | 'local-only' | 'missing' | 'error';

function safeDecodeUsername(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 'your.story';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase() || 'your.story';
}

export default function PublicProfilePage() {
  const params = useParams<{ username?: string | string[] }>();
  const username = normalizeUsername(safeDecodeUsername(params.username));
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [status, setStatus] = useState<PublicProfileStatus>('loading');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const localProfile = getUserProfile();
    const localMatch = localProfile.username.toLowerCase() === username;
    const localPublicProfile = localMatch
      ? {
          displayName: localProfile.displayName,
          username: localProfile.username,
          bio: localProfile.bio,
        }
      : null;

    setProfile(localPublicProfile);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus(localPublicProfile ? 'local-only' : 'missing');
      return () => {
        active = false;
      };
    }

    const loadPublicProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username, display_name, bio')
          .eq('username', username)
          .maybeSingle<PublicProfileRow>();

        if (!active) return;
        if (error) {
          setStatus('error');
          return;
        }
        if (data) {
          setProfile({
            displayName: data.display_name,
            username: data.username,
            bio: data.bio,
          });
          setStatus('found');
        } else {
          setProfile(null);
          setStatus('missing');
        }
      } catch {
        if (active) setStatus('error');
      }
    };

    void loadPublicProfile();
    return () => {
      active = false;
    };
  }, [username]);

  const copyLink = async () => {
    if (status !== 'found') return;
    const link = `${window.location.origin}${profileUrl(username)}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setNotice('Public profile link copied.');
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice(`Copy is unavailable here. Your profile link is ${link}`);
    }
  };

  const displayName = profile?.displayName || username;
  const initials = displayName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'DE';
  const composePath = `/compose?new=1&recipient=${encodeURIComponent(`@${username}`)}`;
  const statusText = status === 'loading'
    ? 'Finding this profile…'
    : status === 'found'
      ? 'Open to drops'
      : status === 'local-only'
        ? 'Only saved on this device'
        : status === 'missing'
          ? 'No Drop account found'
          : 'Profile unavailable';

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[800px]">
        <header className="page-header flex-col gap-5 sm:flex-row sm:items-center">
          <Link
            href="/"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Dear.exe
          </Link>
          <Link
            href="/profile"
            className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            Make your own profile
          </Link>
        </header>

        <section className="paper-card mt-12 p-6 sm:p-10" aria-busy={status === 'loading'}>
          <div className="flex flex-col gap-5 border-b border-[rgba(16,42,67,0.13)] pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-ink-navy bg-ink-navy font-headline-md text-xl text-white" aria-hidden="true">
                {initials}
              </span>
              <div>
                <p className="eyebrow">Public postbox</p>
                <h1 className="display-title mt-3 max-w-[12ch]">@{username}</h1>
              </div>
            </div>
            <p className="meta sm:text-right" role="status" aria-live="polite">
              {statusText}
            </p>
          </div>

          {profile ? (
            <div className="mt-8 max-w-2xl">
              <p className="meta">{displayName}</p>
              {profile.bio && <p className="body-copy mt-4 text-lg text-ink-navy">{profile.bio}</p>}
              {status === 'local-only' && (
                <p className="notice mt-5" role="status">This profile is only saved on this device. Connect an account to make it available to friends.</p>
              )}
              {status === 'error' && (
                <p className="error-notice mt-5" role="alert">We could not reach this profile. Check your connection and try again.</p>
              )}
            </div>
          ) : status !== 'loading' ? (
            <div className="panel-muted mt-8 p-6">
              <p className="eyebrow">{status === 'missing' ? 'Not here yet' : 'Try again soon'}</p>
              <h2 className="section-title mt-3 text-2xl">
                {status === 'missing' ? 'This Drop address is not active.' : 'We could not load this profile.'}
              </h2>
              <p className="body-copy mt-3 text-sm">
                {status === 'missing'
                  ? 'Check the handle with your friend, or make your own Drop profile.'
                  : 'Your connection may be down. Come back in a moment.'}
              </p>
              <Link href="/profile" className="button-secondary mt-5">Make your profile</Link>
            </div>
          ) : null}

          {status === 'found' && (
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[rgba(16,42,67,0.1)] pt-6">
              <Link
                href={composePath}
                className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Send a drop
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? 'Link copied' : 'Share profile'}
              </button>
            </div>
          )}

          {notice && <p className="notice mt-5" role="status" aria-live="polite">{notice}</p>}
        </section>

        <p className="body-copy mt-10 max-w-xl text-sm">
          Dear.exe is a place for friends to send each other words, photos, and GIFs. Send a drop when you have something worth sharing.
        </p>
      </div>
    </main>
  );
}
