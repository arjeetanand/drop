'use client';

import { usePathname } from 'next/navigation';

function usesPrivateShell(pathname: string | null) {
  return pathname === null || pathname === '/' || ['/mailbox', '/journey', '/profile', '/sent'].some((path) => pathname?.startsWith(path));
}

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className={usesPrivateShell(pathname) ? 'min-h-screen lg:pl-[240px]' : 'min-h-screen'}>{children}</div>;
}
