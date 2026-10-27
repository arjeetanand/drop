'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Mail, PenLine, Plus, Route, Sparkles, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLetterDraft } from '@/lib/letterStore';
import { defaultUserProfile, getUserProfileForCurrentAccount } from '@/lib/userStore';
import { getRemoteLetters, getRemoteProfile } from '@/lib/letterBackend';
import type { MockLetter } from '@/data/mockData';
import { applyRecipientDropRead, applyRecipientDropReadEvents, mergeInboxLetters } from '@/lib/liveInboxState';
import { getUnreadReceivedCount } from '@/lib/mailboxView';
import { startVisibleDataRefresh } from '@/lib/relayRouteRefresh';
import { isRecipientDropReadForAccount, subscribeToRecipientDropReads, type RecipientDropReadEventDetail } from '@/lib/recipientDropReadEvent';
import { getLocalAccountId } from '@/lib/localAccountScope';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { SoundToggle } from '@/components/SoundToggle';
import { getActiveNavigationHref, usesPrivateShell } from '@/lib/navigation';

const navItems = [
  { href: '/', label: 'Desk', icon: PenLine },
  { href: '/mailbox', label: 'Inbox', icon: Mail },
  { href: '/journey', label: 'Relay', icon: Route },
  { href: '/profile', label: 'You', icon: UserRound },
];

function InboxUnreadBadge({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <span
      role="status"
      aria-label={`${count} new ${count === 1 ? 'drop' : 'drops'}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e7f3eb] px-1.5 py-0.5 font-mono text-[0.56rem] font-bold uppercase tracking-[0.06em] text-[#276a4d]"
    >
      <span aria-hidden="true">New</span>
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const privateShellVisible = usesPrivateShell(pathname);
  const activeNavigationHref = getActiveNavigationHref(pathname);
  const [profile, setProfile] = useState(defaultUserProfile);
  const [inboxLetters, setInboxLetters] = useState<MockLetter[]>([]);
  const [recipientReadStatesHydrated, setRecipientReadStatesHydrated] = useState(false);
  const inboxLettersRef = useRef<MockLetter[]>([]);

  useEffect(() => {
    if (!privateShellVisible) return;

    let active = true;
    let observedAccountId: string | null = null;
    let authInitialized = false;
    let accountGeneration = 0;
    const pendingReadEvents = new Map<string, RecipientDropReadEventDetail>();
    const stopRecipientDropReadEvents = subscribeToRecipientDropReads((detail) => {
      if (!isRecipientDropReadForAccount(detail, getLocalAccountId())) return;
      pendingReadEvents.set(detail.letterId, detail);
      inboxLettersRef.current = applyRecipientDropRead(inboxLettersRef.current, detail);
      setInboxLetters(inboxLettersRef.current);
    });
    const refresh = startVisibleDataRefresh({
      load: async () => {
        const generation = accountGeneration;
        return { mailbox: await getRemoteLetters(), generation };
      },
      intervalMs: 60_000,
      queueOneWhileInFlight: true,
      onData: ({ mailbox, generation }) => {
        if (!active) return;
        if (generation !== accountGeneration) return;
        if (!mailbox) {
          inboxLettersRef.current = [];
          setInboxLetters([]);
          setRecipientReadStatesHydrated(false);
          return;
        }
        mailbox.letters
          .filter((letter) => typeof letter.recipientReadAt === 'string')
          .forEach((letter) => pendingReadEvents.delete(letter.id));
        const remoteLetters = applyRecipientDropReadEvents(mailbox.letters, pendingReadEvents.values());
        inboxLettersRef.current = mergeInboxLetters([], remoteLetters, [], inboxLettersRef.current);
        setInboxLetters(inboxLettersRef.current);
        setRecipientReadStatesHydrated(mailbox.recipientReadStatesHydrated === true);
      },
    });
    const authSubscription = getSupabaseBrowserClient()?.auth.onAuthStateChange((_event, session) => {
      const nextAccountId = session?.user.id ?? null;
      if (!authInitialized) {
        authInitialized = true;
        observedAccountId = nextAccountId;
        return;
      }
      if (observedAccountId === nextAccountId) return;

      observedAccountId = nextAccountId;
      accountGeneration += 1;
      pendingReadEvents.clear();
      inboxLettersRef.current = [];
      setInboxLetters([]);
      setRecipientReadStatesHydrated(false);
      void refresh.refresh();
    }).data.subscription;

    return () => {
      active = false;
      refresh.stop();
      stopRecipientDropReadEvents();
      authSubscription?.unsubscribe();
    };
  }, [privateShellVisible]);

  useEffect(() => {
    let active = true;
    setProfile(getUserProfileForCurrentAccount());
    void getRemoteProfile().then((remoteProfile) => {
      if (active && remoteProfile) setProfile(remoteProfile);
    });
    // Read the current draft once so a new-letter link always has a valid destination.
    getLetterDraft();
    return () => {
      active = false;
    };
  }, []);

  if (pathname && !privateShellVisible) return null;

  const initials = profile.displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const unreadReceivedCount = getUnreadReceivedCount(inboxLetters, recipientReadStatesHydrated);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-[rgba(16,42,67,0.1)] bg-[#f7f4ee] px-5 py-7 lg:flex">
        <Link href="/" className="group inline-flex items-center gap-3" aria-label="Drop home">
          <span className="flex h-10 w-10 items-center justify-center border border-ink-navy bg-ink-navy text-white transition-transform duration-200 group-hover:-translate-y-0.5">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-headline-md text-[1.55rem] leading-none tracking-[-0.04em] text-ink-navy">Drop</span>
            <span className="mt-1 block font-mono text-[0.62rem] uppercase tracking-[0.2em] text-on-surface-variant">Small things, sent</span>
          </span>
        </Link>

        <Link href="/compose?new=1" className="button-primary mt-10 w-full justify-between !rounded-xl !bg-[#2b45f7] !text-white !border-[#2b45f7]">
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>Make a drop</span>
          </span>
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>

        <nav aria-label="Primary navigation" className="mt-10">
          <p className="eyebrow px-3">Your desk</p>
          <ul className="mt-3 space-y-1">
            {navItems.map((item) => {
              const active = activeNavigationHref === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 border-l-2 px-3 text-sm font-semibold transition-colors duration-180',
                      active
                        ? 'border-[#4f9d7a] bg-white/55 text-ink-navy'
                        : 'border-transparent text-on-surface-variant hover:border-[rgba(16,42,67,0.2)] hover:bg-white/45 hover:text-ink-navy'
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.href === '/mailbox' && <InboxUnreadBadge count={unreadReceivedCount} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto border-t border-[rgba(16,42,67,0.1)] pt-5">
          <div className="flex items-center gap-3">
            <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-3" aria-label={`Open profile for ${profile.displayName}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(16,42,67,0.18)] bg-white font-mono text-xs font-bold text-ink-navy">
                {initials || 'DE'}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink-navy">{profile.displayName}</span>
                <span className="mt-0.5 block truncate font-mono text-[0.65rem] text-on-surface-variant">@{profile.username}</span>
              </span>
            </Link>
            <SoundToggle />
          </div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-[rgba(16,42,67,0.12)] bg-[#fffaf2]/95 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom,0px))] pt-2 backdrop-blur-md lg:hidden" aria-label="Primary navigation">
        {[navItems[0], navItems[1]].map((item) => {
          const active = activeNavigationHref === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 min-w-[62px] flex-col items-center justify-center gap-1 px-2 text-xs font-semibold transition-colors',
                active ? 'text-ink-navy' : 'text-on-surface-variant hover:text-ink-navy'
              )}
            >
              <Icon className={cn('h-[18px] w-[18px]', active && 'text-[#4f9d7a]')} aria-hidden="true" />
              <span className="inline-flex items-center gap-1.5">
                {item.label}
                {item.href === '/mailbox' && <InboxUnreadBadge count={unreadReceivedCount} />}
              </span>
            </Link>
          );
        })}
        <Link href="/compose?new=1" aria-label="Make a drop" className="-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7] text-white shadow-[0_7px_16px_rgba(43,69,247,.28)] transition-transform hover:-translate-y-0.5">
          <Plus className="h-6 w-6" aria-hidden="true" />
        </Link>
        {navItems.slice(2).map((item) => {
          const active = activeNavigationHref === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-11 min-w-[54px] flex-col items-center justify-center gap-1 px-1 text-[0.66rem] font-semibold transition-colors', active ? 'text-[#2b45f7]' : 'text-on-surface-variant hover:text-ink-navy')}>
              <Icon className={cn('h-[18px] w-[18px]', active && 'text-[#2b45f7]')} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
