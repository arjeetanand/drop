'use client';

import { useEffect } from 'react';
import { installDropClaimHandoffPruning } from '@/lib/dropClaimHandoff';

export function DropClaimHandoffPruner() {
  useEffect(() => {
    try {
      return installDropClaimHandoffPruning(window.localStorage, window);
    } catch {
      // Storage may be blocked; claim-page handling keeps the invite usable.
      return undefined;
    }
  }, []);

  return null;
}
