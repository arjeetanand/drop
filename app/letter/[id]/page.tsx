'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, MailOpen, Sparkles } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import type { MockLetter } from '@/data/mockData';
import { getRemoteLetterById, getRemoteLetters, saveRemoteReaction } from '@/lib/letterBackend';
import { getLetterById } from '@/lib/letterStore';
import { DEMO_REACTION_EMOJIS, saveDemoReaction } from '@/lib/demoReactionStore';
import { getSupabaseBrowserClient, isGoogleAuthConfigured } from '@/lib/supabaseBrowser';
import { getDraftAttachment } from '@/lib/letterMediaStore';
import { ReducedMotionGif } from '@/components/ReducedMotionGif';

function LoadingLetter() {
  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <div className="flex min-h-[70dvh] items-center justify-center">
          <p className="meta" role="status" aria-live="polite">
            Finding your drop…
          </p>
        </div>
      </div>
    </main>
  );
}

function MissingLetter({ signInHref }: { signInHref?: string }) {
  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[760px]">
        <header className="page-header">
          <Link
            href="/"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to desk
          </Link>
        </header>
        <section className="panel mt-12 p-7 sm:p-10">
          {signInHref ? (
            <>
              <p className="eyebrow">A private drop is waiting</p>
              <h1 className="section-title mt-3">Sign in to check this drop.</h1>
              <p className="body-copy mt-4 max-w-xl">
                Sign in with the account it was sent to. We’ll bring you back here when you’re done.
              </p>
              <Link
                href={signInHref}
                className="button-primary mt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                Sign in to check this drop
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          ) : (
            <>
              <p className="eyebrow">Drop not found</p>
              <h1 className="section-title mt-3">This drop isn’t available from this link.</h1>
              <p className="body-copy mt-4 max-w-xl">
                Check the address or ask the sender to share it again.
              </p>
              <Link
                href="/mailbox"
                className="button-primary mt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                Open mailbox
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default function LetterArrivalPage() {
  const params = useParams<{ id?: string | string[] }>();
  const searchParams = useSearchParams();
  const letterId = Array.isArray(params.id) ? params.id[0] : params.id;
  const senderView = searchParams.get('view') === 'sender';
  const [letter, setLetter] = useState<MockLetter | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [fullContentAvailable, setFullContentAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentNotice, setContentNotice] = useState('');
  const [reactionNotice, setReactionNotice] = useState('');
  const [savingReaction, setSavingReaction] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLetter(null);
    setSignInRequired(false);
    setFullContentAvailable(false);
    setRevealed(false);
    setOpened(false);
    setContentNotice('');
    setReactionNotice('');

    if (!letterId) {
      setLoading(false);
      return;
    }

    let active = true;
    let mediaObjectUrl = '';

    const loadLetter = async () => {
      let localLetter = getLetterById(letterId);
      if (localLetter) {
        if (localLetter.localDemo && localLetter.payloadKind !== 'text') {
          try {
            const attachment = await getDraftAttachment(localLetter.id);
            if (!active) return;
            if (attachment) {
              mediaObjectUrl = URL.createObjectURL(attachment);
              localLetter = { ...localLetter, mediaUrl: mediaObjectUrl };
            } else {
              setContentNotice('This attachment is no longer saved on this device. The rest of the demo is still available.');
            }
          } catch {
            if (active) setContentNotice('This attachment could not be opened on this device. The rest of the demo is still available.');
          }
        }
        if (active) {
          setLetter(localLetter);
          setFullContentAvailable(localLetter.localDemo === true || localLetter.status === 'draft');
          if (localLetter.localDemo && senderView) {
            setRevealed(true);
            setOpened(true);
          }
          setLoading(false);
        }
        return;
      }

      try {
        const remoteLetters = await getRemoteLetters();
        const remoteLetter = remoteLetters?.find((candidate) => candidate.id === letterId) || null;
        if (!remoteLetters && isGoogleAuthConfigured()) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            const { data, error } = await supabase.auth.getSession();
            if (active && !error && !data.session) setSignInRequired(true);
          }
        }
        if (active) {
          setLetter(remoteLetter);
          setFullContentAvailable(false);
        }
      } catch {
        if (active) {
          setLetter(null);
          setFullContentAvailable(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLetter();
    return () => {
      active = false;
      if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
    };
  }, [letterId, senderView]);

  const revealFragments = async () => {
    setContentNotice('');

    if (!fullContentAvailable && letterId) {
      setContentLoading(true);
      try {
        const remoteDetail = await getRemoteLetterById(letterId);
        if (remoteDetail) {
          setLetter(remoteDetail);
          setFullContentAvailable(true);
        } else {
          setContentNotice('The complete drop is available when you are signed in as its recipient. This view will keep the relay preview available.');
        }
      } catch {
        setContentNotice('The complete drop could not be loaded right now. This view will keep the relay preview available.');
      } finally {
        setContentLoading(false);
      }
    }

    setRevealed(true);
  };

  const react = async (emoji: string) => {
    if (!letter || savingReaction) return;
    setSavingReaction(true);
    setReactionNotice('');
    if (letter.localDemo || letter.id.startsWith('incoming-')) {
      if (saveDemoReaction(letter.id, emoji, letter.localDemo)) {
        setLetter({ ...letter, reaction: emoji });
        setReactionNotice(letter.localDemo ? 'Saved on this device. Open the sender view to see it.' : 'Saved on this device. The sender won’t be notified.');
      } else {
        setReactionNotice('Could not save that reaction on this device. Try again.');
      }
      setSavingReaction(false);
      return;
    }
    try {
      if (await saveRemoteReaction(letter.id, emoji)) {
        setLetter({ ...letter, reaction: emoji });
        setReactionNotice('Reaction sent.');
      } else {
        setReactionNotice('Could not save that reaction. Sign in as the recipient and try again.');
      }
    } catch {
      setReactionNotice('Could not save that reaction. Try again in a moment.');
    } finally {
      setSavingReaction(false);
    }
  };

  const teasers = useMemo(() => {
    if (!letter) return [];

    const savedTeasers = letter.teaser?.filter((teaser) => teaser.trim()) || [];
    if (savedTeasers.length) return savedTeasers;

    const excerpt = letter.excerpt.trim();
    return [
      'A little thought found its way to you.',
      excerpt ? `${excerpt.slice(0, 64)}${excerpt.length > 64 ? '…' : ''}` : 'Some words are waiting behind the seal.',
      'Open when you want the whole story.',
    ];
  }, [letter]);

  if (loading) return <LoadingLetter />;
  if (!letter) {
    const signInHref = signInRequired && letterId
      ? `/profile?next=${encodeURIComponent(`/letter/${encodeURIComponent(letterId)}`)}#account`
      : undefined;
    return <MissingLetter signInHref={signInHref} />;
  }

  const sender = letter.localDemo ? 'You' : letter.sender || 'A correspondent';
  const isReceived = letter.localDemo ? !senderView : letter.direction === 'received';
  const encodedLetterId = encodeURIComponent(letter.id);
  const dropBackHref = isReceived && letter.senderUsername
    ? `/compose?new=1&recipient=${encodeURIComponent(`@${letter.senderUsername}`)}`
    : null;

  return (
    <main className="page-shell page-enter">
      <div className="page-container">
        <header className="page-header flex-col gap-5 sm:flex-row sm:items-center">
          <Link
            href="/mailbox"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to mailbox
          </Link>
          <p className="meta">Drop {letter.id}</p>
        </header>

        {letter.localDemo && <p className="notice mt-5" role="status">Same-device demo · nothing was sent or shared.</p>}

        <section className="mt-12 max-w-[760px]">
          <p className="eyebrow">{letter.localDemo ? senderView ? 'Sender view' : 'Recipient demo' : isReceived ? 'A drop for you' : 'Drop preview'}</p>
          <h1 className="display-title mt-4 max-w-[12ch]">{letter.localDemo ? senderView ? 'Your demo copy.' : 'See your drop as the recipient.' : 'Something made its way to you.'}</h1>
          <p className="body-copy mt-5 max-w-2xl text-lg">
            {letter.localDemo
              ? senderView ? 'This copy is saved on this device for you to review. Your recipient has not received it.' : 'Open it as if you were the recipient, then try a reaction. Nothing leaves this browser.'
              : `${sender} left a message in your hands. Read the fragments first, then open the full drop when you are ready.`}
          </p>
        </section>

        <section className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(250px,0.7fr)]">
          <article className="paper-card p-6 sm:p-9">
            <div className="flex flex-col gap-5 border-b border-[rgba(16,42,67,0.13)] pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="eyebrow">Subject</p>
                <h2 className="section-title mt-2 break-words text-3xl">{letter.subject}</h2>
                <p className="meta mt-3">From {sender} · {letter.date}</p>
              </div>
              <span className="status-mark success self-start">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                {letter.localDemo ? senderView ? 'Demo copy' : 'Demo · not sent' : isReceived ? 'Received' : 'Ready to read'}
              </span>
            </div>

            <div id="letter-fragments" className="mt-6" aria-label="Drop fragments">
              <p className="meta">Three fragments, kept closed until you ask to see them.</p>
              <ol className="mt-3 divide-y divide-[rgba(16,42,67,0.1)] border-y border-[rgba(16,42,67,0.1)]">
                {teasers.map((teaser, index) => (
                  <li key={`${teaser}-${index}`} className="flex gap-4 py-5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[rgba(16,42,67,0.14)] bg-white text-[#b84b3a]">
                      {revealed ? <Check className="h-4 w-4" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <p className="font-literata text-base leading-relaxed text-ink-navy">
                      {revealed ? teaser : 'A confidential fragment is resting behind the seal.'}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <p className="sr-only" aria-live="polite">
              {revealed ? 'The drop fragments are now visible.' : ''}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-[rgba(16,42,67,0.1)] pt-6">
              {!revealed && (
                <button
                  type="button"
                  onClick={() => void revealFragments()}
                  disabled={contentLoading}
                  aria-controls="letter-fragments"
                  aria-expanded={revealed}
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  {contentLoading ? 'Loading the full drop…' : letter.localDemo ? 'Reveal demo fragments' : 'Reveal fragments'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {revealed && !opened && (
                <button
                  type="button"
                  onClick={() => setOpened(true)}
                  aria-controls="letter-body"
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  {letter.localDemo ? 'Open demo drop' : 'Open received drop'}
                  <MailOpen className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {opened && <p className="meta">The full drop is open below.</p>}
            </div>

            {contentNotice && <p className="notice mt-5" role="status" aria-live="polite">{contentNotice}</p>}

            {opened && (
              <section id="letter-body" className="mt-8 border-t border-[rgba(16,42,67,0.13)] pt-8" aria-live="polite">
                <p className="eyebrow text-[#b84b3a]">Unsealed</p>
                <div className="mt-4 border-l-2 border-[#b84b3a] bg-white px-6 py-7 sm:px-8">
                  {letter.mediaUrl && <div className="relative mb-5 aspect-[4/3] overflow-hidden rounded-xl bg-[#f1ede5]">
                    <ReducedMotionGif src={letter.mediaUrl} alt={fullContentAvailable && letter.excerpt.trim() ? '' : letter.subject ? `${letter.subject}, sent by ${sender}` : `Drop from ${sender}`} animated={letter.payloadKind === 'gif'} sizes="(max-width: 760px) 100vw, 700px" className="object-contain" />
                    <span className="absolute left-3 top-3 rounded-full bg-[#fffaf2]/90 px-3 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-ink-navy">{letter.payloadKind === 'gif' ? 'GIF' : 'Photo'}</span>
                  </div>}
                  {letter.localDemo && letter.payloadKind !== 'text' && !letter.mediaUrl && <p className="notice error-notice mb-5" role="status">The attachment is unavailable on this device. The rest of the demo is still available.</p>}
                  {letter.payloadKind && letter.payloadKind !== 'text' && letter.mediaPath && !letter.mediaUrl && <p className="notice error-notice mb-5" role="status">The private attachment could not load. Check your connection and open the drop again.</p>}
                  {letter.excerpt && letter.excerpt !== 'An empty letter, waiting for your words.' && <p className="body-copy text-lg text-ink-navy">{fullContentAvailable ? letter.excerpt : 'This drop is still available as a sealed preview. Sign in as its recipient to open it.'}</p>}
                  {!letter.mediaUrl && (!letter.excerpt || letter.excerpt === 'An empty letter, waiting for your words.') && <p className="body-copy text-lg text-ink-navy">This drop is still available as a sealed preview. Sign in as its recipient to open it.</p>}
                  <p className="meta mt-6 border-t border-[rgba(16,42,67,0.1)] pt-4">From {sender}</p>
                </div>
                {isReceived && <section className="mt-6 rounded-xl border border-[rgba(16,42,67,.1)] bg-white/60 p-4" aria-labelledby="drop-reaction-heading">
                  <h3 id="drop-reaction-heading" className="flex items-center gap-2 text-sm font-bold text-ink-navy"><Sparkles className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> Send a little reaction</h3>
                  <div className="mt-3 flex flex-wrap gap-2">{DEMO_REACTION_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => void react(emoji)} disabled={savingReaction} aria-label={`React ${emoji}`} aria-pressed={letter.reaction === emoji} className={`flex h-11 min-w-11 items-center justify-center rounded-xl border text-lg transition-colors ${letter.reaction === emoji ? 'border-[#2b45f7] bg-[#2b45f7]/10' : 'border-[rgba(16,42,67,.12)] bg-white hover:bg-[#f5f1e9]'}`}>{emoji}</button>)}</div>
                  {reactionNotice && <p className="mt-3 text-xs text-on-surface-variant" role="status" aria-live="polite">{reactionNotice}</p>}
                </section>}
                {letter.localDemo && <Link href={senderView ? `/letter/${encodedLetterId}` : `/letter/${encodedLetterId}?view=sender`} className="button-secondary mt-6 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]">
                  {senderView ? 'Open recipient demo' : letter.reaction ? 'See your sender copy' : 'Skip to sender copy'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>}
                {dropBackHref && <div className="mt-6">
                  <p className="meta mb-3">No rush — start a fresh drop back to {sender} whenever you want.</p>
                  <Link href={dropBackHref} className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]">
                    Drop back
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>}
                {!isReceived && letter.reaction && <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#f2eee5] px-4 py-2 text-sm text-ink-navy"><Sparkles className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> They reacted {letter.reaction}</p>}
                {(letter.deliveryMode === 'relay' || letter.status === 'dispatched') && <Link
                  href={`/journey?letter=${encodedLetterId}`}
                  className="button-secondary mt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  Follow the drop&apos;s journey
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>}
              </section>
            )}
          </article>

          <aside className="space-y-6">
            <section className="panel p-6">
              <p className="eyebrow">Before you open</p>
              <h2 className="section-title mt-3 text-2xl">Take your time.</h2>
              <p className="body-copy mt-3 text-sm">
                A sealed drop can wait. Opening it shows the message and keeps the route available for you to revisit.
              </p>
            </section>

            <section className="panel-muted p-6">
              <p className="eyebrow">Drop details</p>
              <dl className="mt-5 divide-y divide-[rgba(16,42,67,0.1)] border-y border-[rgba(16,42,67,0.1)]">
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="meta">From</dt>
                  <dd className="text-right text-sm font-semibold text-ink-navy">{sender}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="meta">Addressed to</dt>
                  <dd className="text-right text-sm font-semibold text-ink-navy">{letter.recipient || 'you'}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="meta">Privacy</dt>
                  <dd className="text-right text-sm font-semibold text-[#4f9d7a]">{letter.localDemo ? 'Only on this device' : letter.deliveryMode === 'relay' || letter.status === 'dispatched' ? 'Sealed during the journey' : 'Private to you two'}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
