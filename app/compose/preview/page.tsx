'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, Sparkles } from 'lucide-react';
import { getSealInfo } from '@/data/mockData';
import type { LetterDraftState } from '@/lib/letterStore';
import { getLetterDraftById, saveLocalDemoDrop } from '@/lib/letterStore';
import { getDraftAttachment } from '@/lib/letterMediaStore';
import { getUserProfileForCurrentAccount } from '@/lib/userStore';
import { normalizeDropRecipient } from '@/lib/dropValidation';
import { cn } from '@/lib/utils';
import { ReducedMotionGif } from '@/components/ReducedMotionGif';
import { getDropMediaAccessibleName } from '@/lib/dropMediaAccessibility';

function RecipientPreview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const letterId = searchParams.get('letter') || '';
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [ready, setReady] = useState(false);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [openingDemo, setOpeningDemo] = useState(false);
  const [demoError, setDemoError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setReady(false);
    setDraft(null);
    setMediaUrl('');
    setMediaUnavailable(false);
    const current = getLetterDraftById(letterId);

    if (current && !['dispatched', 'delivered'].includes(current.status)) {
      setDraft(current);
      if (current.payloadKind !== 'text') {
        void getDraftAttachment(current.id).then((file) => {
          if (!active) return;
          if (file) {
            objectUrl = URL.createObjectURL(file);
            setMediaUrl(objectUrl);
          } else {
            setMediaUnavailable(true);
          }
        }).catch(() => {
          if (active) setMediaUnavailable(true);
        }).finally(() => {
          if (active) setReady(true);
        });
      } else {
        setReady(true);
      }
    } else {
      setReady(true);
    }

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [letterId]);

  if (!ready) {
    return <main className="page-shell"><div className="page-container max-w-[760px]"><p className="meta" role="status">Preparing your preview…</p></div></main>;
  }

  if (!draft) {
    return <main className="page-shell"><div className="page-container max-w-[760px]"><p className="notice" role="status">This draft preview is not available on this device.</p><Link href="/compose?new=1" className="button-secondary mt-4 !min-h-12">Make a drop</Link></div></main>;
  }

  const recipient = draft.recipient.trim() || 'your person';
  const sender = getUserProfileForCurrentAccount().displayName.trim() || 'You';
  const seal = getSealInfo(draft.sealId, draft.sealMonogram, draft.sealColor);
  const payloadLabel = draft.payloadKind === 'gif' ? 'GIF' : draft.payloadKind === 'image' ? 'Photo or meme' : 'Note';
  const editHref = `/compose?letter=${encodeURIComponent(draft.id)}`;
  const alignmentClass = draft.alignment === 'center' ? 'text-center' : draft.alignment === 'right' ? 'text-right' : 'text-left';
  const canOpenDemo = draft.deliveryMode === 'instant'
    && normalizeDropRecipient(draft.recipient) !== null
    && (draft.payloadKind === 'text' ? Boolean(draft.content.trim()) : Boolean(mediaUrl) && !mediaUnavailable);

  const openDemo = () => {
    if (!canOpenDemo || openingDemo) return;
    setOpeningDemo(true);
    setDemoError('');
    const demo = saveLocalDemoDrop(draft.id);
    if (!demo) {
      setDemoError('This demo could not be saved on this device. Your draft is still here.');
      setOpeningDemo(false);
      return;
    }
    router.push(`/letter/${encodeURIComponent(demo.id)}`);
  };

  return (
    <main className="page-shell page-enter !pt-4 sm:!pt-8">
      <div className="page-container max-w-[760px]">
        <header className="flex items-center justify-between gap-3">
          <Link href={editHref} className="button-quiet -ml-2 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to editing</Link>
          <span className="meta inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Recipient preview</span>
        </header>

        <p className="notice mt-5" role="status">Preview only — on this device; not sent.</p>
        <section className="mt-8">
          <p className="eyebrow">A last little look</p>
          <h1 className="mt-2 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-5xl">This is what your person will see.</h1>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant sm:text-base">Make sure the moment feels right before you send it.</p>
        </section>

        <article className="paper-card mt-6 overflow-hidden p-5 sm:mt-8 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgba(16,42,67,0.13)] pb-5">
            <div className="min-w-0">
              <p className="eyebrow">{payloadLabel}</p>
              <h2 className="section-title mt-2 break-words text-2xl sm:text-3xl">{draft.subject || 'A little moment'}</h2>
              <p className="meta mt-3">From {sender} · To {recipient.startsWith('@') ? recipient : `@${recipient}`}</p>
            </div>
            <span className="rounded-full bg-[#f2eee5] px-3 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em] text-on-surface-variant">{payloadLabel}</span>
          </div>

          {mediaUrl && <div className="relative mt-5 aspect-[4/3] max-h-[520px] overflow-hidden rounded-xl bg-[#ede8df]">
            <ReducedMotionGif src={mediaUrl} alt={getDropMediaAccessibleName(draft.payloadKind === 'gif' ? 'gif' : 'image')} animated={draft.payloadKind === 'gif'} sizes="(max-width: 760px) 100vw, 700px" className="object-contain" />
          </div>}
          {mediaUnavailable && <p className="notice error-notice mt-5" role="status">The attachment is not saved on this device. Go back to editing and add it again to preview it.</p>}

          {draft.content.trim() && <p className={cn('body-copy mt-5 whitespace-pre-wrap break-words text-ink-navy', draft.payloadKind === 'text' && alignmentClass)} style={draft.payloadKind === 'text' ? { fontSize: `${draft.fontSize}px` } : undefined}>{draft.content}</p>}
          {!draft.content.trim() && draft.payloadKind === 'text' && <p className="body-copy mt-5 italic text-on-surface-variant">Your note will appear here.</p>}

          <footer className="mt-6 flex items-center gap-3 border-t border-[rgba(16,42,67,0.1)] pt-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg" style={{ backgroundColor: `${seal.color}18`, color: seal.color }}>{seal.displayMark}</span>
            <span><span className="block font-semibold text-ink-navy">A little sign-off</span><span className="meta">{seal.name}</span></span>
          </footer>
        </article>

        <section className="mt-5 rounded-2xl border border-[#d9e1ff] bg-[#f7f8ff] p-5 sm:p-6" aria-labelledby="local-demo-heading">
          <p className="eyebrow text-[#2b45f7]" id="local-demo-heading">Try it on this device</p>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            Open the recipient view and try a reaction. This demo stays in this browser; nothing is sent or shared.
          </p>
          {demoError && <p className="error-notice mt-3" role="alert">{demoError}</p>}
          {draft.deliveryMode === 'relay' && <p className="field-help mt-3">Local demos are for instant drops. A real relay needs a connected account.</p>}
          {draft.deliveryMode === 'instant' && !canOpenDemo && <p className="field-help mt-3">Add a valid handle and your note or attachment to try the demo.</p>}
          <button type="button" onClick={openDemo} disabled={!canOpenDemo || openingDemo} className="button-primary mt-4 w-full !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-45" aria-describedby="local-demo-hint">
            {openingDemo ? 'Opening demo…' : 'Try as recipient'}
            {openingDemo ? <Eye className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          </button>
          <span className="sr-only" id="local-demo-hint">Same-device demo only. It will not send or share this drop.</span>
        </section>

        <Link href={editHref} className="button-secondary mt-5 w-full !min-h-12">Back to editing <ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
    </main>
  );
}

export default function RecipientPreviewPage() {
  return <Suspense fallback={<main className="page-shell"><div className="page-container max-w-[760px]"><p className="meta">Preparing your preview…</p></div></main>}><RecipientPreview /></Suspense>;
}
