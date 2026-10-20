import Link from 'next/link';
import { ArrowRight, Mail, Sparkles } from 'lucide-react';

export default function InvitePage() {
  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65" aria-label="Drop home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-navy text-white"><Mail className="h-4 w-4" aria-hidden="true" /></span>
          <span className="font-headline-md text-lg">Drop</span>
        </Link>

        <section className="mt-10 overflow-hidden rounded-[1.75rem] border border-[rgba(16,42,67,.12)] bg-[#fffdf9] shadow-[0_16px_48px_rgba(16,42,67,.08)] sm:mt-16">
          <div className="bg-[#e9edff] px-6 py-10 sm:px-12 sm:py-14">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#2b45f7] shadow-sm"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
            <p className="eyebrow mt-7">A friend sent you an invite</p>
            <h1 className="mt-3 max-w-[13ch] font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-6xl">Small moments travel better together.</h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:text-base">Someone would like to send you a private Drop: a note, photo, or GIF made for one person. Connect your account, choose your handle, and share it back so they can send it to the right place.</p>
            <Link href="/profile?invite=1#account" className="button-primary mt-7 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">
              Connect account & choose handle <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <p className="px-6 py-5 text-xs leading-relaxed text-on-surface-variant sm:px-12">The invite contains no message or photo. Nothing arrives until your friend confirms your handle and sends it.</p>
        </section>
      </div>
    </main>
  );
}
