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
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[228px] flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur-md lg:flex">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 pt-7 pb-5">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs transition-transform group-hover:scale-105">
              <span className="font-sans text-xs select-none font-bold text-emerald-400">♥</span>
            </div>
            <div>
              <p className="font-sans text-[15px] font-bold tracking-tight text-slate-900 leading-none">Dear.exe</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400 mt-1">
                human relay
              </p>
            </div>
          </Link>
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" title="Relay network online" />
        </div>

        {/* Primary Action Button */}
        <div className="px-3.5 py-2">
          <Link
            href={writeHref}
            className="flex items-center justify-between rounded-xl bg-slate-900 px-3.5 py-2.5 font-sans text-xs font-semibold tracking-wide text-white shadow-xs transition-all duration-200 hover:bg-slate-800 active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <PenLine className="h-3.5 w-3.5 text-emerald-400" />
              <span>{writeLabel}</span>
            </span>
            <kbd className="rounded-md border border-white/20 px-1.5 py-0.5 font-mono text-[9px] text-white/70">N</kbd>
          </Link>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-3">
          <p className="px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-slate-400 font-semibold">
            Postal Desk
          </p>
          <ul className="space-y-1 mt-1">
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
                      'flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150',
                      isActive
                        ? 'bg-slate-100 text-slate-900 font-semibold shadow-2xs'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon
                        className={cn(
                          'h-4 w-4 transition-colors',
                          isActive ? 'text-slate-900' : 'text-slate-400'
                        )}
                      />
                      <span>{item.label}</span>
                    </span>
                    {isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Profile & Settings Footer */}
        <div className="border-t border-slate-100 p-3.5">
          <div className="flex items-center gap-2">
            <Link
              href="/profile"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-slate-50"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-[11px] font-semibold text-slate-700 shadow-2xs">
                {profile.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900 leading-tight">{profile.displayName}</p>
                <p className="truncate font-mono text-[9px] text-slate-400">@{profile.username}</p>
              </div>
            </Link>
            <SoundToggle />
          </div>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-200/80 bg-white/95 px-3 py-2 backdrop-blur-md lg:hidden">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-3 py-1 text-[11px] font-medium transition-colors',
                isActive ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-700'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
