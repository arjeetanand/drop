'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, MailOpen, Share2, Sparkles } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import type { MockLetter } from '@/data/mockData';
import { getRemoteDropDirection, getRemoteLetterById, getRemoteLetters, getRemoteReactionSnapshot, reissueDropClaimInvite, saveRemoteReaction, subscribeToSenderDropReactions } from '@/lib/letterBackend';
import { getLetterById } from '@/lib/letterStore';
import { getInitialSenderReactionBaseline, getSenderReactionReadUpdate } from '@/lib/liveReactionState';
import { DEMO_REACTION_EMOJIS, saveDemoReaction } from '@/lib/demoReactionStore';
import { getDraftAttachment } from '@/lib/letterMediaStore';
import { withFallbackTimeout } from '@/lib/withFallbackTimeout';
import { ReducedMotionGif } from '@/components/ReducedMotionGif';
import { getReactionName } from '@/components/LiveReactionCue';
import { RelayRecipientCard } from '@/components/RelayRecipientCard';
import { startVisibleDataRefresh, type VisibleDataRefreshController } from '@/lib/relayRouteRefresh';
import { buildDropClaimUrl, createDropClaimSharePayload, createDropClaimToken } from '@/lib/dropClaim';
import { getLocalAccountId, isCurrentLocalAccount } from '@/lib/localAccountScope';
import { shareInviteLink } from '@/lib/shareInvite';

const inFlightClaimReissues = new Set<string>();

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
  const [reactionAnnouncement, setReactionAnnouncement] = useState('');
  const [savingReaction, setSavingReaction] = useState(false);
  const [sharingClaimLink, setSharingClaimLink] = useState(false);
  const [claimLinkUrl, setClaimLinkUrl] = useState('');
  const [claimLinkNotice, setClaimLinkNotice] = useState('');
  const currentReactionRef = useRef<string | undefined>(undefined);
  const baselineReactionOnDirectReadRef = useRef(false);
  const initialReactionBaselineRef = useRef<{ available: boolean; reaction: string | null } | null>(null);
  const reactionSignalGenerationRef = useRef(0);
  const consumedReactionSignalGenerationRef = useRef(0);
  const reactionRefreshRef = useRef<VisibleDataRefreshController | null>(null);

  useEffect(() => {
    setLoading(true);
    setLetter(null);
    setSignInRequired(false);
    setFullContentAvailable(false);
    setRevealed(false);
    setOpened(false);
    setContentNotice('');
    setReactionNotice('');
    setReactionAnnouncement('');
    setClaimLinkUrl('');
    setClaimLinkNotice('');
    setSharingClaimLink(false);
    baselineReactionOnDirectReadRef.current = false;
    initialReactionBaselineRef.current = null;
    reactionSignalGenerationRef.current = 0;
    consumedReactionSignalGenerationRef.current = 0;

    if (!letterId) {
      setLoading(false);
      return;
    }

    let active = true;
    let mediaObjectUrl = '';
    let stopReactionRealtime = () => {};

    const loadLetter = async () => {
      let localLetter = getLetterById(letterId);
      if (localLetter && (localLetter.localDemo || localLetter.sample || localLetter.status === 'draft')) {
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
          setFullContentAvailable(localLetter.localDemo === true || localLetter.sample === true || localLetter.status === 'draft');
          if (localLetter.localDemo && senderView) {
            setRevealed(true);
            setOpened(true);
          }
          setLoading(false);
        }
        return;
      }

      try {
        const startReactionRealtime = async () => {
          const stopRealtime = await subscribeToSenderDropReactions((dropId) => {
            if (!active) return;
            if (!dropId) {
              void reactionRefreshRef.current?.refresh();
              return;
            }
            if (dropId !== letterId) return;
            reactionSignalGenerationRef.current += 1;
            void reactionRefreshRef.current?.refresh();
          });
          if (!active) {
            stopRealtime();
            return;
          }
          stopReactionRealtime = stopRealtime;
        };

        // Capture the reaction state before opening the channel. Comparing the
        // first ready read with this baseline catches changes during startup
        // without relying on clock timestamps from two devices.
        const directionRead = withFallbackTimeout(getRemoteDropDirection(letterId), 8_000, 'unavailable' as const);
        const mailboxRead = withFallbackTimeout(getRemoteLetters(), 15_000, null).catch(() => null);
        const reactionBaselineRead = withFallbackTimeout(getRemoteReactionSnapshot(letterId), 8_000, null).catch(() => null);
        const direction = await directionRead;
        if (!active) return;
        const initialReactionBaseline = await getInitialSenderReactionBaseline(direction, reactionBaselineRead);
        if (!active) return;
        initialReactionBaselineRef.current = initialReactionBaseline;
        baselineReactionOnDirectReadRef.current = true;
        if (direction === 'sent' || direction === 'unavailable') {
          await startReactionRealtime();
          if (!active) return;
        }

        // Auth and PostgREST reads above are bounded independently of channel setup.
        const mailbox = await mailboxRead;
        const remoteLetter = mailbox?.letters.find((candidate) => candidate.id === letterId) || null;
        if (remoteLetter?.direction === 'sent'
          && initialReactionBaselineRef.current?.available !== true
          && mailbox?.reactionsHydrated) {
          initialReactionBaselineRef.current = {
            available: true,
            reaction: remoteLetter.reaction ?? null,
          };
        }
        if (remoteLetter?.direction !== 'sent') {
          stopReactionRealtime();
          stopReactionRealtime = () => {};
        }
        if (active && !mailbox && direction === 'signed-out') setSignInRequired(true);
        if (active) {
          setLetter(remoteLetter || localLetter || null);
          setFullContentAvailable(false);
        }
      } catch {
        if (active) {
          setLetter(localLetter || null);
          setFullContentAvailable(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLetter();
    return () => {
      active = false;
      stopReactionRealtime();
      if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
    };
  }, [letterId, senderView]);

  const senderDropId = letter && letter.direction === 'sent' && !letter.sample && !letter.localDemo ? letter.id : null;

  useEffect(() => {
    currentReactionRef.current = letter?.reaction;
  }, [letter?.id, letter?.reaction]);

  useEffect(() => {
    if (!senderDropId) return;

    let active = true;
    const refresh = startVisibleDataRefresh({
      load: async () => {
        const signalGeneration = reactionSignalGenerationRef.current;
        const snapshot = await getRemoteReactionSnapshot(senderDropId);
        return snapshot ? { snapshot, signalGeneration } : null;
      },
      intervalMs: 60_000,
      queueOneWhileInFlight: true,
      onData: (read) => {
        if (!active) return;
        const establishingBaseline = baselineReactionOnDirectReadRef.current;
        const previousReaction = currentReactionRef.current ?? null;
        const update = getSenderReactionReadUpdate(
          read.snapshot,
          read.signalGeneration,
          reactionSignalGenerationRef.current,
          previousReaction,
          establishingBaseline,
          consumedReactionSignalGenerationRef.current,
          initialReactionBaselineRef.current,
        );
        if (update.outcome !== 'available') return;
        baselineReactionOnDirectReadRef.current = update.baselinePending;
        if (!update.baselinePending) initialReactionBaselineRef.current = null;
        consumedReactionSignalGenerationRef.current = update.consumedSignalGeneration;
        currentReactionRef.current = update.reaction ?? undefined;
        if (establishingBaseline || update.reaction !== previousReaction) {
          setLetter((current) => current?.id === senderDropId ? { ...current, reaction: update.reaction ?? undefined } : current);
        }
        if (!update.announce || !update.reaction) return;
        const who = letter?.recipient?.trim() || 'Your recipient';
        const subject = letter?.subject?.trim() || 'your drop';
        setReactionAnnouncement(`${who} reacted to “${subject}” with ${getReactionName(update.reaction)}.`);
      },
    });
    reactionRefreshRef.current = refresh;

    return () => {
      active = false;
      if (reactionRefreshRef.current === refresh) reactionRefreshRef.current = null;
      refresh.stop();
    };
  }, [letter?.recipient, letter?.subject, senderDropId]);

  const revealFragments = () => {
    setRevealed(true);
  };

  const openDrop = async () => {
    setContentNotice('');
    if (!fullContentAvailable && letterId) {
      setContentLoading(true);
      try {
        const remoteDetail = await getRemoteLetterById(letterId);
        if (!remoteDetail) {
          setContentNotice('The full drop could not load. Sign in as the recipient or check your connection, then try again.');
          return;
        }
        setLetter(remoteDetail);
        if (remoteDetail.mediaPath && !remoteDetail.mediaUrl) {
          setContentNotice('The private attachment could not load. Check your connection, then try opening again.');
          return;
        }
        setFullContentAvailable(true);
      } catch {
        setContentNotice('The full drop could not load. Check your connection, then try opening again.');
        return;
      } finally {
        setContentLoading(false);
      }
    }
    setOpened(true);
  };

  const shareFreshClaimLink = async () => {
    if (!letter || letter.status !== 'claim_pending' || letter.direction !== 'sent'
      || sharingClaimLink || inFlightClaimReissues.has(letter.id)) return;
    inFlightClaimReissues.add(letter.id);
    const accountId = getLocalAccountId();
    setSharingClaimLink(true);
    setClaimLinkUrl('');
    setClaimLinkNotice('');
    try {
      const performReissue = async () => {
        const detail = await getRemoteLetterById(letter.id);
        if (!isCurrentLocalAccount(accountId)) return;
        if (!detail || detail.direction !== 'sent' || detail.status !== 'claim_pending'
          || (detail.payloadKind || 'text') !== 'text' || (detail.deliveryMode || 'instant') !== 'instant'
          || !detail.excerpt.trim()) {
          setClaimLinkNotice('A fresh link could not be prepared. Check your connection and try again.');
          return;
        }
        const token = createDropClaimToken();
        const url = buildDropClaimUrl(window.location.origin, token);
        if (!url) {
          setClaimLinkNotice('This browser could not prepare a private link. Try again from the original device.');
          return;
        }
        const issued = await reissueDropClaimInvite(detail.id, accountId, token);
        if (!isCurrentLocalAccount(accountId)) return;
        if (!issued.ok) {
          setClaimLinkNotice(issued.error || 'A fresh link could not be saved. Try again.');
          return;
        }
        const payload = createDropClaimSharePayload(url);
        const result = await shareInviteLink(
          url,
          navigator.share ? (details) => navigator.share(details) : undefined,
          async (shareUrl) => {
            if (!navigator.clipboard) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(shareUrl);
          },
          payload,
        );
        if (!isCurrentLocalAccount(accountId)) return;
        if (result === 'shared' || result === 'copied') {
          setClaimLinkNotice('Fresh private link sent. The older link has been replaced.');
        } else {
          setClaimLinkUrl(url);
          setClaimLinkNotice(result === 'cancelled'
            ? 'Nothing was shared yet. Copy the fresh link when you’re ready; the older link has been replaced.'
            : 'Sharing is unavailable. Copy the fresh link to send it yourself; the older link has been replaced.');
        }
      };

      if (navigator.locks?.request) {
        let acquired = false;
        await navigator.locks.request(`drop-claim-reissue:${letter.id}`, { ifAvailable: true }, async (lock) => {
          if (!lock) return;
          acquired = true;
          await performReissue();
        });
        if (!acquired && isCurrentLocalAccount(accountId)) {
          setClaimLinkNotice('A fresh link is already being shared in another tab. Wait for it to finish before trying again.');
        }
      } else {
        await performReissue();
      }
    } catch {
      if (isCurrentLocalAccount(accountId)) setClaimLinkNotice('A fresh private link could not be prepared. Try again.');
    } finally {
      inFlightClaimReissues.delete(letter.id);
      setSharingClaimLink(false);
    }
  };

  const copyFreshClaimLink = async () => {
    if (!claimLinkUrl) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(claimLinkUrl);
      setClaimLinkNotice('Fresh private link copied. The older link has been replaced.');
    } catch {
      setClaimLinkNotice('Copy is unavailable here. Select the fresh link above and copy it manually.');
    }
  };

  const react = async (emoji: string) => {
    if (!letter || savingReaction) return;
    setSavingReaction(true);
    setReactionNotice('');
    if (letter.localDemo || letter.sample) {
      if (saveDemoReaction(letter.id, emoji, letter.localDemo || letter.sample)) {
        setLetter({ ...letter, reaction: emoji });
        setReactionNotice(letter.sample ? 'Saved on this device. This sample won’t notify a sender.' : letter.localDemo ? 'Saved on this device. Open the sender view to see it.' : 'Saved on this device. The sender won’t be notified.');
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
  const relayInTransit = isReceived
    && !letter.sample
    && !letter.localDemo
    && letter.status === 'dispatched';
  const encodedLetterId = encodeURIComponent(letter.id);
  const dropBackHref = isReceived && !letter.sample && letter.senderUsername
    ? `/compose?new=1&recipient=${encodeURIComponent(`@${letter.senderUsername}`)}`
    : null;

  if (relayInTransit) {
    const refreshCollectedRelay = async () => {
      const mailbox = await getRemoteLetters();
      const collectedLetter = mailbox?.letters.find((candidate) => candidate.id === letter.id
        && candidate.direction === 'received'
        && candidate.status === 'delivered');
      if (!collectedLetter) throw new Error('The collected drop could not be reloaded yet.');
      setLetter(collectedLetter);
    };

    return (
      <main className="page-shell page-enter">
        <div className="page-container max-w-[760px]">
          <header className="page-header">
            <Link
              href="/mailbox"
              className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to mailbox
            </Link>
          </header>
          <section className="mt-8">
            <p className="eyebrow">On its way</p>
            <h1 className="display-title mt-3 max-w-[12ch]">This drop is still traveling.</h1>
            <RelayRecipientCard letter={letter} onRefresh={refreshCollectedRelay} />
          </section>
        </div>
      </main>
    );
  }

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

        {letter.sample && <p className="notice mt-5" role="status">{letter.direction === 'received' ? 'Sample drop · this is an example, not a message you received. Reactions stay on this device.' : 'Sample drop · an example only. Nothing was sent or delivered.'}</p>}
        {letter.localDemo && <p className="notice mt-5" role="status">Same-device demo · nothing was sent or shared.</p>}
        {letter.direction === 'sent' && letter.status === 'claim_pending' && <section className="mt-6 max-w-[760px] rounded-2xl border border-[#e9d6c7] bg-[#fff6ec] p-4 sm:p-5" aria-labelledby="claim-link-heading">
          <p className="eyebrow">Private claim link</p>
          <h2 id="claim-link-heading" className="mt-2 font-headline-md text-2xl text-ink-navy">Waiting for them to claim.</h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">If their link expired or got lost, share a fresh one. Anyone holding the current link can claim the note; making a fresh link replaces the old one.</p>
          <button type="button" onClick={() => void shareFreshClaimLink()} disabled={sharingClaimLink} className="button-primary mt-4 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">
            <Share2 className="h-4 w-4" aria-hidden="true" />{sharingClaimLink ? 'Preparing fresh link…' : 'Share a fresh private link'}
          </button>
          {claimLinkNotice && <p className="field-help mt-3 break-words" role="status" aria-live="polite">{claimLinkNotice}</p>}
          {claimLinkUrl && <>
            <code tabIndex={0} aria-label="Select and copy the fresh private note link" className="mt-3 block select-all break-all rounded-lg bg-white/80 px-2 py-2 font-mono text-[0.68rem] text-ink-navy">{claimLinkUrl}</code>
            <button type="button" onClick={() => void copyFreshClaimLink()} className="button-secondary mt-2 !min-h-11 !rounded-xl">Copy fresh private link</button>
          </>}
        </section>}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{reactionAnnouncement}</p>

        <section className="mt-12 max-w-[760px]">
          <p className="eyebrow">{letter.sample ? 'Sample drop' : letter.localDemo ? senderView ? 'Sender view' : 'Recipient demo' : letter.direction === 'sent' ? 'Your sent drop' : isReceived ? 'A drop for you' : 'Drop preview'}</p>
          <h1 className="display-title mt-4 max-w-[12ch]">{letter.sample ? 'See how a drop opens.' : letter.localDemo ? senderView ? 'Your demo copy.' : 'See your drop as the recipient.' : letter.direction === 'sent' ? 'Your sent drop.' : 'Something made its way to you.'}</h1>
          <p className="body-copy mt-5 max-w-2xl text-lg">
            {letter.sample
              ? letter.direction === 'received' ? 'Explore this example, then try a reaction. Nothing was sent and no one will be notified.' : 'Explore this example. It is seeded content, not a drop you sent or received.'
              : letter.localDemo
              ? senderView ? 'This copy is saved on this device for you to review. Your recipient has not received it.' : 'Open it as if you were the recipient, then try a reaction. Nothing leaves this browser.'
              : letter.direction === 'sent'
              ? `You sent this drop to ${letter.recipient || 'your recipient'}. Open your copy to see the message and any reaction.`
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
                {letter.sample ? 'Sample · not sent' : letter.localDemo ? senderView ? 'Demo copy' : 'Demo · not sent' : letter.status === 'claim_pending' ? 'Waiting to be claimed' : letter.direction === 'sent' ? 'Sent' : 'Received'}
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
                  {contentLoading ? 'Loading the full drop…' : letter.sample ? 'Reveal sample fragments' : letter.localDemo ? 'Reveal demo fragments' : 'Reveal fragments'}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {revealed && !opened && (
                <button
                  type="button"
                  onClick={() => void openDrop()}
                  disabled={contentLoading}
                  aria-controls="letter-body"
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                >
                  {contentLoading ? 'Opening the full drop…' : contentNotice ? 'Try again' : letter.sample ? 'Open sample drop' : letter.localDemo ? 'Open demo drop' : letter.direction === 'sent' ? 'Open your copy' : 'Open received drop'}
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
                  {letter.excerpt && letter.excerpt !== 'An empty drop, waiting for your words.' && letter.excerpt !== 'An empty letter, waiting for your words.' && <p className="body-copy text-lg text-ink-navy">{fullContentAvailable ? letter.excerpt : 'This drop is still available as a sealed preview. Sign in as its recipient to open it.'}</p>}
                  {!letter.mediaUrl && (!letter.excerpt || letter.excerpt === 'An empty drop, waiting for your words.' || letter.excerpt === 'An empty letter, waiting for your words.') && <p className="body-copy text-lg text-ink-navy">This drop is still available as a sealed preview. Sign in as its recipient to open it.</p>}
                  <p className="meta mt-6 border-t border-[rgba(16,42,67,0.1)] pt-4">From {sender}</p>
                </div>
                {isReceived && <section className="mt-6 rounded-xl border border-[rgba(16,42,67,.1)] bg-white/60 p-4" aria-labelledby="drop-reaction-heading">
                  <h3 id="drop-reaction-heading" className="flex items-center gap-2 text-sm font-bold text-ink-navy"><Sparkles className="h-4 w-4 text-[#2b45f7]" aria-hidden="true" /> Send a little reaction</h3>
                  <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                    {letter.sample
                      ? 'This sample stays on your device; no sender is notified.'
                      : letter.localDemo
                        ? 'This demo reaction stays on this device; no one is notified.'
                        : 'Only you and ' + sender + ' can see this reaction.'}
                  </p>
                  <div className="mt-3 -mx-1 grid w-[calc(100%+0.5rem)] grid-cols-5 gap-2">{DEMO_REACTION_EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => void react(emoji)} disabled={savingReaction} aria-label={`React ${emoji}`} aria-pressed={letter.reaction === emoji} className={`flex h-11 min-w-11 items-center justify-center rounded-xl border text-lg transition-colors ${letter.reaction === emoji ? 'border-[#2b45f7] bg-[#2b45f7]/10' : 'border-[rgba(16,42,67,.12)] bg-white hover:bg-[#f5f1e9]'}`}>{emoji}</button>)}</div>
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
                  <dd className="text-right text-sm font-semibold text-[#4f9d7a]">{letter.sample ? 'Example · no recipient' : letter.localDemo ? 'Only on this device' : letter.status === 'claim_pending' ? 'Private claim link' : letter.deliveryMode === 'relay' || letter.status === 'dispatched' ? 'Sealed during the journey' : 'Private to you two'}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
