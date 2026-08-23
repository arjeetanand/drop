'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PenLine, Mail, MapPin, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLetterDraft } from '@/lib/letterStore';
import { defaultUserProfile, getUserProfile } from '@/lib/userStore';
import { getRemoteProfile } from '@/lib/letterBackend';
import { SoundToggle } from '@/components/SoundToggle';

const navItems = [
  { href: '/', label: 'Desk', icon: PenLine },
  { href: '/mailbox', label: 'Mailbox', icon: Mail },
  { href: '/journey', label: 'Journey', icon: MapPin },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const [writeHref, setWriteHref] = useState('/compose');
  const [writeLabel, setWriteLabel] = useState('Write a Letter');
  const [profile, setProfile] = useState(defaultUserProfile);

  useEffect(() => {
    const draft = getLetterDraft();
    setProfile(getUserProfile());
    void getRemoteProfile().then((remoteProfile) => {
      if (remoteProfile) setProfile(remoteProfile);
    });
    if (draft.status === 'dispatched' || draft.status === 'delivered') {
      setWriteHref('/compose?new=1');
      setWriteLabel('Write another Letter');
    }
  }, []);

  // Hide sidebar on compose and dispatch routes for focus
  const hideNav = pathname?.startsWith('/compose') || pathname === '/sent';

  if (hideNav) return null;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-parchment-deep/20 bg-surface-container-lowest/80 backdrop-blur-sm lg:flex">
        <div className="flex items-center gap-2 px-6 py-8">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-navy text-surface-bright">
            <PenLine className="h-4 w-4" />
          </div>
          <div>
            <p className="font-headline-lg text-base text-ink-navy">Dear.exe</p>
            <p className="font-caption text-[10px] tracking-[0.15em] text-on-surface-variant uppercase">
              Sun-Drenched Stationery
            </p>
          </div>
        </div>

        <div className="px-4 py-2">
          <Link
            href={writeHref}
            className="flex items-center justify-center gap-2 rounded-full bg-ink-navy px-4 py-2.5 text-sm font-medium text-surface-bright transition-all hover:bg-ink-navy/90 hover:shadow-md"
          >
            <PenLine className="h-4 w-4" />
            {writeLabel}
          </Link>
        </div>

        <nav className="flex-1 px-4 py-4">
          <p className="px-3 py-2 font-label-md text-[11px] tracking-[0.12em] text-on-surface-variant uppercase">
            Navigation
          </p>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-full px-3 py-2.5 text-sm transition-all',
                      isActive
                        ? 'bg-secondary-container/40 font-medium text-ink-navy'
                        : 'text-on-surface-variant hover:bg-surface-container-high/60'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        isActive ? 'text-amber-accent' : 'text-on-surface-variant'
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-parchment-deep/20 px-4 py-4">
          <div className="flex items-center gap-2">
            <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-full px-3 py-2 transition-colors hover:bg-surface-container-high/60">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-parchment-warm text-xs font-semibold text-ink-navy">
                {profile.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-navy">{profile.displayName}</p>
                <p className="truncate font-caption text-[10px] text-on-surface-variant">@{profile.username}</p>
              </div>
            </Link>
            <SoundToggle />
          </div>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-parchment-deep/20 bg-surface-container-lowest/95 px-2 py-2 backdrop-blur-sm lg:hidden">
        {navItems.map((item) => {
          const isActive =
            item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-4 py-1.5 transition-all',
                isActive ? 'text-amber-accent' : 'text-on-surface-variant'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
