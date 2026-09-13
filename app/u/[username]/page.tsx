'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Copy, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';

function safeDecodeUsername(raw: string | undefined) {
  const value = raw || 'your.story';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const [copied, setCopied] = useState(false);
  const username = safeDecodeUsername(params.username);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  return (
    <main className="min-h-screen pb-24">
      <div className="mx-auto max-w-[720px] px-margin-mobile py-xl md:px-margin-desktop md:py-xxl">
        <Link href="/" className="inline-flex items-center gap-sm font-caption text-caption text-on-surface-variant hover:text-primary"><ArrowLeft className="h-4 w-4" /> Back to Dear.exe</Link>
        <section className="mt-xl paper-layer p-xl text-center card-depth md:p-xxl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink-navy text-surface-bright"><Mail className="h-7 w-7" /></div>
          <p className="mt-lg font-caption text-caption uppercase tracking-[0.22em] text-amber-accent">A place to hand something real</p>
          <h1 className="mt-sm font-headline-lg text-headline-lg text-primary md:text-display-lg">@{username}</h1>
          <p className="mx-auto mt-md max-w-md font-body-lg text-body-lg leading-relaxed text-on-surface-variant">Collecting small moments and letting people carry them forward.</p>
          <div className="mt-xl flex flex-wrap items-center justify-center gap-md">
            <Link href="/compose?new=1" className="inline-flex items-center gap-sm rounded-sm bg-secondary-container px-xl py-md font-label-md text-label-md uppercase tracking-widest text-on-secondary-container hover:bg-secondary-fixed"><Sparkles className="h-4 w-4" /> Start a relay</Link>
            <button type="button" onClick={copyLink} className="inline-flex items-center gap-sm border border-primary px-lg py-md font-label-md text-label-md uppercase tracking-widest text-primary hover:bg-secondary-container/30"><Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Share'}</button>
          </div>
        </section>
      </div>
    </main>
  );
}
