'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Mail, PenLine, Route, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLetterDraft } from '@/lib/letterStore';
import { defaultUserProfile, getUserProfile } from '@/lib/userStore';
import { getRemoteProfile } from '@/lib/letterBackend';
import { SoundToggle } from '@/components/SoundToggle';

const navItems = [
  { href: '/', label: 'Desk', icon: PenLine },
  { href: '/mailbox', label: 'Mailbox', icon: Mail },
  { href: '/journey', label: 'Journey', icon: Route },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

function isActivePath(pathname: string | null, href: string) {
  return href === '/' ? pathname === '/' : Boolean(pathname?.startsWith(href));
}

function usesPrivateShell(pathname: string | null) {
  return pathname === null || pathname === '/' || ['/mailbox', '/journey', '/profile', '/sent'].some((path) => pathname?.startsWith(path));
}

export function Sidebar() {
  const pathname = usePathname();
  const [profile, setProfile] = useState(defaultUserProfile);

  useEffect(() => {
    let active = true;
    setProfile(getUserProfile());
    void getRemoteProfile().then((remoteProfile) => {
      if (active && remoteProfile) setProfile(remoteProfile);
    });
    // Read the current draft once so a new-letter link always has a valid destination.
    getLetterDraft();
    return () => {
      active = false;
    };
  }, []);

  if (pathname && !usesPrivateShell(pathname)) return null;

  const initials = profile.displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[240px] flex-col border-r border-[rgba(16,42,67,0.1)] bg-[#f7f4ee] px-5 py-7 lg:flex">
        <Link href="/" className="group inline-flex items-center gap-3" aria-label="Dear.exe home">
          <span className="flex h-10 w-10 items-center justify-center border border-ink-navy bg-ink-navy text-white transition-transform duration-200 group-hover:-translate-y-0.5">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-headline-md text-[1.55rem] leading-none tracking-[-0.04em] text-ink-navy">Dear.exe</span>
            <span className="mt-1 block font-mono text-[0.62rem] uppercase tracking-[0.2em] text-on-surface-variant">Human relay</span>
          </span>
        </Link>

        <Link href="/compose?new=1" className="button-primary mt-10 w-full justify-between">
          <span className="inline-flex items-center gap-2">
            <PenLine className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" />
            <span>Write a letter</span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-[#8fd1ad]" aria-hidden="true" />
        </Link>

        <nav aria-label="Primary navigation" className="mt-10">
          <p className="eyebrow px-3">Your desk</p>
          <ul className="mt-3 space-y-1">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);
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

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-[rgba(16,42,67,0.12)] bg-[#f7f4ee]/95 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden" aria-label="Primary navigation">
        {navItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 min-w-[62px] flex-col items-center justify-center gap-1 px-2 text-[0.68rem] font-semibold transition-colors',
                active ? 'text-ink-navy' : 'text-on-surface-variant hover:text-ink-navy'
              )}
            >
              <Icon className={cn('h-[18px] w-[18px]', active && 'text-[#4f9d7a]')} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
