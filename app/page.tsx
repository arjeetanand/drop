'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Camera, Mail, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { LiveDropStatus } from '@/components/LiveDropCue';
import { LiveReactionCue } from '@/components/LiveReactionCue';
import { LetterCard } from '@/components/LetterCard';
import { writingPrompts } from '@/data/mockData';
import { getRemoteProfile } from '@/lib/letterBackend';
import { defaultUserProfile, getUserProfileForCurrentAccount, type UserProfile } from '@/lib/userStore';
import { useLiveInbox } from '@/lib/useLiveInbox';

export default function HomeDesk() {
  const { letters, arrival, arrivalCount, dismissArrival, reaction, reactionCount, dismissReaction } = useLiveInbox();
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [promptIndex, setPromptIndex] = useState(0);

  useEffect(() => {
    setPromptIndex(Math.floor(Date.now() / 86_400_000) % writingPrompts.length);
    let active = true;
    void getRemoteProfile().then((remoteProfile) => {
      if (active) setProfile(remoteProfile || getUserProfileForCurrentAccount());
    }).catch(() => {
      if (active) setProfile(getUserProfileForCurrentAccount());
    });
    return () => { active = false; };
  }, []);

  const incoming = letters.filter((letter) => letter.direction === 'received' && !letter.sample).slice(0, 2);
  const featured = arrival ?? incoming[0];
  const isNewArrival = Boolean(arrival && featured?.id === arrival.id);
  const arrivalLabel = arrivalCount > 1 ? `${arrivalCount} new drops` : 'Just landed';

  return (
    <main className="page-shell page-enter !pt-5 sm:!pt-8">
      <div className="page-container max-w-[1080px]">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex min-h-11 items-center gap-3" aria-label="Drop desk">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2b45f7] text-white shadow-[0_5px_14px_rgba(43,69,247,.2)]"><Mail className="h-5 w-5" aria-hidden="true" /></span>
            <span><span className="block font-headline-md text-xl font-semibold leading-none text-ink-navy">Drop</span><span className="mt-1 block font-mono text-[0.58rem] uppercase tracking-[0.2em] text-on-surface-variant">small things, sent</span></span>
          </Link>
          <Link href="/profile" className="flex min-h-11 items-center gap-2 rounded-full border border-[rgba(16,42,67,.12)] bg-white/70 py-1 pl-1 pr-3 text-xs font-semibold text-ink-navy" aria-label={`Your profile, ${profile.displayName}`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3d8c9] font-mono text-[0.65rem] font-bold text-ink-navy">{profile.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
            <span className="max-w-24 truncate">@{profile.username}</span>
          </Link>
        </header>

        <LiveDropStatus letter={arrival} count={arrivalCount} />
        <LiveReactionCue letter={reaction} count={reactionCount} onDismiss={dismissReaction} />

        <section className="mt-7 grid gap-4 md:mt-12 md:grid-cols-[minmax(0,1fr)_minmax(250px,.72fr)] md:gap-5">
          <div className="overflow-hidden rounded-[1.5rem] bg-[#2b45f7] p-6 text-white shadow-[0_16px_36px_rgba(43,69,247,.15)] sm:p-9">
            <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/70">Your little corner of the internet</p>
            <h1 className="mt-4 max-w-[12ch] font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">Drop a little something.</h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">A photo, a note, the meme that explains everything. Pick one person and make their day.</p>
            <Link href="/compose?new=1" className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#fffaf2] px-5 text-sm font-bold text-[#223bdc] shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-white">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Make a drop <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <p className="mt-6 flex items-center gap-2 text-xs text-white/70"><Zap className="h-3.5 w-3.5" aria-hidden="true" /> Instant by default · private between you two</p>
          </div>

          {featured ? (
            <Link href={`/letter/${encodeURIComponent(featured.id)}`} onClick={() => { if (isNewArrival) dismissArrival(); }} aria-label={`Open drop from ${featured.sender || 'a correspondent'}: ${featured.subject}`} className="group relative flex min-h-[250px] flex-col overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-[#e1e7ff] via-[#f5e5d7] to-[#fff7ed] p-5 text-ink-navy shadow-[0_12px_30px_rgba(16,42,67,.07)] sm:min-h-[300px] md:min-h-0">
              <span className="absolute -right-8 -top-10 h-44 w-44 rounded-full bg-white/35 blur-2xl" aria-hidden="true" />
              <span className="relative flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em]"><Mail className="h-3.5 w-3.5" aria-hidden="true" />{isNewArrival ? arrivalLabel : 'In your inbox'}</span>
                <span className="rounded-full bg-[#152b43]/[0.07] px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em]">{featured.payloadKind === 'image' ? 'Photo' : featured.payloadKind || 'Note'}</span>
              </span>
              <span className="relative mt-auto block pt-10">
                <span className="block font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-navy/65">From {featured.sender || 'a correspondent'}</span>
                <span className="mt-1 block font-headline-md text-2xl font-semibold">{featured.subject}</span>
                <span className="mt-2 block line-clamp-3 text-sm leading-relaxed text-ink-navy/75">{featured.excerpt}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold">Open your drop <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" /></span>
              </span>
            </Link>
          ) : (
            <Link href="/letter/incoming-1" className="group relative min-h-[250px] overflow-hidden rounded-[1.5rem] bg-[#f1d5c5] p-5 text-ink-navy shadow-[0_12px_30px_rgba(16,42,67,.07)] sm:min-h-[300px] md:min-h-0">
              <Image src="/demo-cat.png" alt="A tiny cat taking a curious look at the camera" fill sizes="(max-width: 767px) 100vw, 34vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" priority />
              <span className="absolute left-4 top-4 rounded-full bg-[#fffaf2]/95 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-ink-navy">Sample drop · not received</span>
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#15213f]/75 via-[#15213f]/25 to-transparent px-5 pb-5 pt-20 text-white">
                <span className="block font-mono text-[0.62rem] uppercase tracking-[0.12em] text-white/75">Example from Mina Vale · nothing sent</span>
                <span className="mt-1 block font-headline-md text-2xl font-semibold">The blue hour</span>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold">Open this example <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
              </span>
            </Link>
          )}
        </section>

        <section className="mt-8 grid gap-7 md:mt-10 md:grid-cols-[minmax(0,1fr)_300px] md:gap-10">
          <div>
            <div className="flex items-end justify-between gap-4">
              <div><p className="eyebrow">Fresh from the mailbox</p><h2 className="mt-2 font-headline-md text-2xl font-semibold text-ink-navy">Little things from your people</h2></div>
              <Link href="/mailbox" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[#2b45f7]">See all <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
            <div className="mt-3 rounded-2xl border border-[rgba(16,42,67,.1)] bg-white/55 px-4 sm:px-6">
              {incoming.length ? incoming.map((letter) => <LetterCard key={letter.id} letter={letter} showExcerpt />) : <p className="py-7 text-sm text-on-surface-variant">When someone sends you a drop, it will land here.</p>}
            </div>
          </div>

          <aside className="rounded-2xl border border-[#ead5c6] bg-[#fff7ed] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><p className="eyebrow text-[#aa5f42]">A tiny writing spark</p><Camera className="h-4 w-4 text-[#df7951]" aria-hidden="true" /></div>
            <p className="mt-3 font-literata text-lg leading-relaxed text-ink-navy" aria-live="polite">{writingPrompts[promptIndex]}</p>
            <Link href={`/compose?new=1&prompt=${encodeURIComponent(writingPrompts[promptIndex])}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#152b43] px-4 text-xs font-bold text-white">Use this thought <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <button type="button" className="mt-1 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold text-ink-navy hover:bg-black/5" onClick={() => setPromptIndex((index) => (index + 1) % writingPrompts.length)}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Another one</button>
          </aside>
        </section>
      </div>
    </main>
  );
}
