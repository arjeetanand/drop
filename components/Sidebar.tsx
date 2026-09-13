'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, PenLine, UserRound, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLetterDraft } from '@/lib/letterStore';
import { defaultUserProfile, getUserProfile } from '@/lib/userStore';
import { getRemoteProfile } from '@/lib/letterBackend';
import { SoundToggle } from '@/components/SoundToggle';

const navItems = [
  { href: '/', label: 'Desk', icon: PenLine },
  { href: '/mailbox', label: 'Mailbox', icon: Mail },
  { href: '/journey', label: 'Journey', icon: UsersRound },
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
      setWriteLabel('Write a Letter');
    }
  }, []);

  // Hide sidebar on compose and dispatch routes for focus
  const hideNav = pathname?.startsWith('/compose') || pathname === '/sent';

  if (hideNav) return null;

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[216px] flex-col border-r border-outline-variant/70 bg-[#f6f2ea]/85 backdrop-blur-sm lg:flex">
        <div className="flex items-center gap-3 px-6 py-8">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-wax-red/35 bg-wax-red text-surface-bright shadow-[0_6px_14px_rgba(184,75,58,0.2)]">
            <PenLine className="h-4 w-4" />
          </div>
          <div>
            <p className="font-headline-lg text-[19px] text-ink-navy">Dear.exe</p>
            <p className="font-caption text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">
              human relay
            </p>
          </div>
        </div>

        <div className="px-4 py-2">
          <Link
            href={writeHref}
            className="flex items-center justify-center gap-2 border border-ink-navy bg-ink-navy px-3 py-3 text-center font-label-md text-[11px] uppercase tracking-[0.12em] text-surface-bright transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <PenLine className="h-4 w-4" />
            {writeLabel}
          </Link>
        </div>

        <nav className="flex-1 px-4 py-4">
          <p className="px-3 py-2 font-label-md text-[10px] tracking-[0.16em] text-on-surface-variant uppercase">Menu</p>
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
                      'flex items-center gap-3 border-l-2 px-3 py-3 text-sm transition-all',
                      isActive
                        ? 'border-mint-accent bg-mint-accent/20 font-medium text-ink-navy'
                        : 'border-transparent text-on-surface-variant hover:border-outline hover:bg-surface-container-high/60'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        isActive ? 'text-ink-navy' : 'text-on-surface-variant'
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-outline-variant/70 px-4 py-4">
          <div className="flex items-center gap-2">
            <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-full px-3 py-2 transition-colors hover:bg-surface-container-high/60">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-xs font-semibold text-ink-navy">
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
              className={cn('flex flex-col items-center gap-1 px-4 py-1.5 transition-all', isActive ? 'text-ink-navy' : 'text-on-surface-variant')}
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
