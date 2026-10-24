'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, LoaderCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { DropPayloadKind } from '@/data/mockData';
import { createLocalDemoDrop, type LetterDraftState } from '@/lib/letterStore';
import { deleteDraftAttachment, saveDraftAttachment } from '@/lib/letterMediaStore';
import { validateDropMedia } from '@/lib/dropValidation';
import { getLocalAccountId } from '@/lib/localAccountScope';
import { RelayDemoPreview } from '@/components/RelayDemoPreview';

const demoOptions: Array<{
  kind: Exclude<DropPayloadKind, 'text'>;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  fileName: string;
  mimeType: string;
  subject: string;
  note: string;
}> = [
  {
    kind: 'image',
    label: 'Try a photo drop',
    eyebrow: 'A still little moment',
    title: 'The blue hour',
    description: 'A tiny photo drop to open, react to, and send back to yourself.',
    image: '/demo-cat.png',
    fileName: 'drop-demo-photo.png',
    mimeType: 'image/png',
    subject: 'The blue hour',
    note: 'I kept this little moment for you.',
  },
  {
    kind: 'gif',
    label: 'Try a GIF drop',
    eyebrow: 'A moment on loop',
    title: 'The world doing its thing',
    description: 'A tiny loop from the walk home. This made me think of you.',
    image: '/demo-cat.gif',
    fileName: 'drop-demo-loop.gif',
    mimeType: 'image/gif',
    subject: 'The world doing its thing',
    note: 'A tiny loop from the walk home. This made me think of you.',
  },
];

function makeDemoDraft(kind: Exclude<DropPayloadKind, 'text'>, subject: string, note: string, file: File): LetterDraftState {
  return {
    id: `draft-local-demo-${crypto.randomUUID()}`,
    recipient: 'demo.friend',
    subject,
    content: note,
    fontSize: 18,
    alignment: 'left',
    address: { name: 'Your person', street: '', city: '', postcode: '', country: '' },
    sealId: 'celestial',
    sealColor: '#102a43',
    sealMonogram: '',
    payloadKind: kind,
    deliveryMode: 'instant',
    mediaMimeType: file.type,
    mediaSizeBytes: file.size,
    status: 'draft',
    updatedAt: new Date().toISOString(),
    localDemo: true,
  };
}

export default function DemoPage() {
  const router = useRouter();
  const [startingKind, setStartingKind] = useState<DropPayloadKind | null>(null);
  const [error, setError] = useState('');

  const startDemo = async (option: (typeof demoOptions)[number]) => {
    if (startingKind) return;
    setStartingKind(option.kind);
    setError('');
    let attachmentSaved = false;
    let demoCreated = false;
    let draftId = '';
    const demoAccountId = getLocalAccountId();

    try {
      const response = await fetch(option.image, { cache: 'force-cache' });
      if (!response.ok) throw new Error('The sample file could not be loaded.');
      const blob = await response.blob();
      const file = new File([blob], option.fileName, { type: option.mimeType, lastModified: Date.now() });
      const validation = validateDropMedia(file);
      if (validation) throw new Error(validation);

      const draft = makeDemoDraft(option.kind, option.subject, option.note, file);
      draftId = draft.id;
      // The IndexedDB write can commit before its account-switch guard throws.
      // Mark it for rollback first, then delete only from the captured account.
      attachmentSaved = true;
      await saveDraftAttachment(draft.id, file, demoAccountId);

      const completed = createLocalDemoDrop(draft, demoAccountId);
      if (!completed) throw new Error('This demo could not be saved on this device.');

      demoCreated = true;
      router.push(`/letter/${encodeURIComponent(completed.id)}`);
    } catch {
      if (attachmentSaved && !demoCreated && draftId) {
        await deleteDraftAttachment(draftId, demoAccountId).catch(() => undefined);
      }
      setError('This sample could not open. Your saved draft is still here; please try again.');
      setStartingKind(null);
    }
  };

  return (
    <main className="page-shell page-enter !pt-4 sm:!pt-8">
      <div className="page-container max-w-[900px]">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="button-quiet -ml-2 min-h-11"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to desk</Link>
          <span className="rounded-full bg-[#e8ecff] px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[#263ee0]">No account needed</span>
        </header>

        <section className="mt-7 rounded-[1.75rem] border border-[#ead5c6] bg-[#fffaf2] p-5 shadow-[0_18px_45px_rgba(16,42,67,.07)] sm:mt-10 sm:p-8">
          <p className="eyebrow text-[#aa5f42]">A little preview, just for you</p>
          <h1 className="mt-3 max-w-[12ch] font-headline-md text-4xl font-semibold leading-[1.03] tracking-[-0.04em] text-ink-navy sm:text-5xl">See how a drop feels.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-on-surface-variant sm:text-base">
            Pick a sample and open it as the recipient. React to it, then peek at your sender copy. It stays on this device; nothing is sent or shared.
          </p>

          {error && <p className="error-notice mt-5" role="alert">{error}</p>}

          <div className="mt-7 grid gap-4 sm:grid-cols-2 sm:gap-5" aria-busy={startingKind !== null}>
            {demoOptions.map((option) => (
              <article key={option.kind} className="overflow-hidden rounded-[1.4rem] border border-[rgba(16,42,67,.12)] bg-white shadow-[0_9px_24px_rgba(16,42,67,.06)]">
                <div className="relative aspect-[4/3] overflow-hidden bg-[#eee9df]">
                  <Image src={option.image} alt="A tiny cat taking a curious look at the camera" fill sizes="(max-width: 639px) 100vw, 50vw" unoptimized className="object-cover" />
                  <span className="absolute left-3 top-3 rounded-full bg-[#fffaf2]/95 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-ink-navy">{option.kind === 'gif' ? 'GIF loop' : 'Photo drop'}</span>
                </div>
                <div className="p-5 sm:p-6">
                  <p className="eyebrow text-[#aa5f42]">{option.eyebrow}</p>
                  <h2 className="mt-2 font-headline-md text-xl font-semibold text-ink-navy">{option.title}</h2>
                  <p className="mt-2 min-h-10 text-sm leading-relaxed text-on-surface-variant">{option.description}</p>
                  <button
                    type="button"
                    onClick={() => void startDemo(option)}
                    disabled={startingKind !== null}
                    className="button-primary mt-5 w-full !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:cursor-wait disabled:opacity-65"
                  >
                    {startingKind === option.kind ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening your demo…</> : <><Sparkles className="h-4 w-4" aria-hidden="true" /> {option.label} <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <RelayDemoPreview />
          {startingKind && <p className="mt-5 text-center text-sm text-on-surface-variant" role="status" aria-live="polite">Saving this sample only in your browser…</p>}
        </section>

        <p className="mx-auto mt-5 max-w-xl text-center text-xs leading-relaxed text-on-surface-variant">Your unfinished drop stays where it is. This sample uses a bundled image and never uploads it.</p>
      </div>
    </main>
  );
}
