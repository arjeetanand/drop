'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideSidebar =
    pathname?.startsWith('/compose') || pathname === '/sent';

  return (
    <div className={cn(!hideSidebar && 'lg:pl-[228px]')}>
      {children}
    </div>
  );
}
