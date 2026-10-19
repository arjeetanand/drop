'use client';

import { usePathname } from 'next/navigation';
import { usesPrivateShell } from '@/lib/navigation';

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className={usesPrivateShell(pathname) ? 'min-h-screen lg:pl-[240px]' : 'min-h-screen'}>{children}</div>;
}
