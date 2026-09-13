import { LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/utils';

export function RelayEnvelope({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      aria-label="A sealed letter ready to travel"
      role="img"
      className={cn('relay-envelope relative aspect-[1.58] w-full max-w-[420px]', compact ? 'max-w-[250px]' : '', className)}
    >
      <div className="absolute inset-0 overflow-hidden border border-[#cbbda9] bg-[#fbf7f0] shadow-[0_24px_44px_rgba(16,42,67,0.16)]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_49.5%,rgba(184,75,58,0.14)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(16,42,67,0.11)_50%,transparent_50.5%)]" />
        <div className="absolute left-1/2 top-1/2 h-px w-[58%] -translate-x-1/2 bg-[#102a43]/15" />
        <div className="absolute left-5 top-4 font-caption text-[9px] uppercase tracking-[0.3em] text-[#102a43]/45">Dear.exe / relay</div>
        <div className="absolute bottom-4 right-5 flex items-center gap-1 font-caption text-[9px] uppercase tracking-[0.22em] text-[#102a43]/45">
          <LockKeyhole className="h-3 w-3" /> sealed
        </div>
      </div>
      <div className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[5px] border-[#b84b3a]/30 bg-[#b84b3a] text-[#fbf7f0] shadow-[0_12px_22px_rgba(184,75,58,0.28)] transition-transform duration-500 hover:scale-105">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#fbf7f0]/35 font-headline-md text-xl">D.</span>
      </div>
      <div className="absolute -bottom-4 left-1/2 h-8 w-[70%] -translate-x-1/2 rounded-[50%] bg-[#102a43]/10 blur-xl" />
    </div>
  );
}
