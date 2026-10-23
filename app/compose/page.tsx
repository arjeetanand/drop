'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Check, Eye, FileImage, ImagePlus, Minus, Plus, Send, Share2, Trash2, Type, X } from 'lucide-react';
import { getSealInfo, mockSeals, waxColors, writingPrompts, type DropDeliveryMode, type DropPayloadKind } from '@/data/mockData';
import { canDeleteLocalDraft, clearRecipientInviteProgressForDraft, completeSuccessfulSend, deleteLocalDraft, getLetterDraft, getLetterDraftById, isLetterDraftPersisted, recordRecipientInviteProgress, restoreDeletedDraft, saveLetterDraft, setActiveLetterDraft, startNewLetter, type LetterDraftState, type LetterAlignment } from '@/lib/letterStore';
import { getRemoteRecentDropRecipients, issueDropClaimInvite, lookupDropRecipient, syncDropToBackend } from '@/lib/letterBackend';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isDropPayloadKindCompatibleWithMedia, isDropRecipientConfirmed, normalizeDropRecipient, validateDropMedia } from '@/lib/dropValidation';
import { deleteDraftAttachment, getDraftAttachment, saveDraftAttachment } from '@/lib/letterMediaStore';
import { getLocalAccountId, isCurrentLocalAccount } from '@/lib/localAccountScope';
import { ReducedMotionGif } from '@/components/ReducedMotionGif';
import { cn } from '@/lib/utils';
import { shareInviteLink } from '@/lib/shareInvite';
import { buildDropClaimUrl, createDropClaimSharePayload, createDropClaimToken } from '@/lib/dropClaim';
import type { RecentDropRecipient } from '@/lib/recentDropRecipients';

type RecipientCheck =
  | { status: 'idle' | 'checking' | 'not-found' | 'error'; username: string | null }
  | { status: 'found'; username: string; id: string; displayName: string };

function Composer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [payloadKind, setPayloadKind] = useState<DropPayloadKind>('text');
  const [deliveryMode, setDeliveryMode] = useState<DropDeliveryMode>('instant');
  const [file, setFile] = useState<File | null>(null);
  const [attachmentSaved, setAttachmentSaved] = useState(false);
  const [attachmentSaving, setAttachmentSaving] = useState(false);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentFormatError, setAttachmentFormatError] = useState('');
  const attachmentChosenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [content, setContent] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientCheck, setRecipientCheck] = useState<RecipientCheck>({ status: 'idle', username: null });
  const [recentRecipients, setRecentRecipients] = useState<RecentDropRecipient[]>([]);
  const recipientCheckRequest = useRef(0);
  const [subject, setSubject] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [alignment, setAlignment] = useState<LetterAlignment>('left');
  const [sealId, setSealId] = useState('heart');
  const [sealColor, setSealColor] = useState('#991b1b');
  const [sealMonogram, setSealMonogram] = useState('');
  const [writingPrompt, setWritingPrompt] = useState('');
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accountState, setAccountState] = useState<'checking' | 'connected' | 'signed-out' | 'unavailable'>('checking');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [manualInviteUrl, setManualInviteUrl] = useState('');
  const [privateClaimUrl, setPrivateClaimUrl] = useState('');
  const [sharingInvite, setSharingInvite] = useState(false);

  useEffect(() => {
    let active = true;
    deletingRef.current = false;
    setDeleting(false);
    setReady(false);
    const requestedId = searchParams.get('letter');
    const selected = requestedId ? getLetterDraftById(requestedId) : null;
    const activeDraft = selected
      ? setActiveLetterDraft(selected)
      : searchParams.get('new') === '1' ? startNewLetter() : getLetterDraft();
    const requestedRecipient = searchParams.get('recipient') || activeDraft.recipient;
    const accountId = getLocalAccountId();
    const current = activeDraft.recipientInviteProgress
      && normalizeDropRecipient(requestedRecipient) !== activeDraft.recipientInviteProgress.username
      ? clearRecipientInviteProgressForDraft(activeDraft.id, accountId, activeDraft.recipientInviteProgress.username) ?? { ...activeDraft, recipientInviteProgress: undefined }
      : activeDraft;
    setDraft(current);
    setInviteNotice('');
    setManualInviteUrl(current.recipientInviteProgress?.manualLinkAvailable ? `${window.location.origin}/invite` : '');
    setPrivateClaimUrl('');
    setContent(current.content);
    setRecipient(requestedRecipient);
    recipientCheckRequest.current += 1;
    setRecipientCheck({ status: 'idle', username: null });
    setRecentRecipients([]);
    void getRemoteRecentDropRecipients().then((recipients) => {
      if (active && recipients && isCurrentLocalAccount(accountId)) setRecentRecipients(recipients);
    });
    setSubject(current.subject);
    setFontSize(current.fontSize);
    setAlignment(current.alignment);
    setPayloadKind(current.payloadKind || 'text');
    setDeliveryMode(searchParams.get('mode') === 'relay' ? 'relay' : current.deliveryMode || 'instant');
    setSealId(current.sealId || 'heart');
    setSealColor(current.sealColor || '#991b1b');
    setSealMonogram(current.sealMonogram || '');
    setWritingPrompt(searchParams.get('prompt') || '');
    setFile(null);
    setAttachmentSaved(false);
    setAttachmentLoading(true);
    attachmentChosenRef.current = false;
    const attachmentLoadTimeout = window.setTimeout(() => {
      if (active) setReady(true);
    }, 1500);
    void getDraftAttachment(current.id).then((savedFile) => {
      if (!active || attachmentChosenRef.current) return;
      if (savedFile && !validateDropMedia(savedFile)) {
        setFile(savedFile);
        setPayloadKind(savedFile.type === 'image/gif' ? 'gif' : 'image');
        setAttachmentSaved(true);
      } else if (savedFile) {
        void deleteDraftAttachment(current.id).catch(() => undefined);
      }
    }).catch(() => undefined).finally(() => {
      if (active) {
        setAttachmentLoading(false);
        window.clearTimeout(attachmentLoadTimeout);
        setReady(true);
      }
    });
    return () => {
      active = false;
      window.clearTimeout(attachmentLoadTimeout);
    };
  }, [searchParams]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setAccountState('unavailable');
      return;
    }
    let active = true;
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      setAccountState(!authError && data.user ? 'connected' : 'signed-out');
    }).catch(() => {
      if (active) setAccountState('signed-out');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || !draft || deletingRef.current) return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      if (!deletingRef.current) {
        saveLetterDraft({ content, recipient, subject, fontSize, alignment, payloadKind, deliveryMode, sealId, sealColor, sealMonogram });
        setSaved(true);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [alignment, content, deliveryMode, draft, fontSize, payloadKind, ready, recipient, sealColor, sealId, sealMonogram, subject]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const recipientUsername = normalizeDropRecipient(recipient);
  const confirmedRecipient = recipientCheck.status === 'found' && isDropRecipientConfirmed(recipientCheck, recipient) ? recipientCheck : null;
  const recipientHasValue = recipient.replace(/^@/, '').trim().length > 0;
  const complete = Boolean(confirmedRecipient && recipientUsername && (payloadKind === 'text' ? content.trim() : file));
  const currentSeal = getSealInfo(sealId, sealMonogram, sealColor);
  const profileHref = draft ? `/profile?next=${encodeURIComponent(`/compose?letter=${encodeURIComponent(draft.id)}`)}#account` : '/profile#account';
  const canSendPrivateClaim = Boolean(
    accountState === 'connected'
      && recipientCheck.status === 'not-found'
      && recipientCheck.username === recipientUsername
      && payloadKind === 'text'
      && deliveryMode === 'instant'
      && !file
      && !attachmentLoading
      && !attachmentSaving
      && content.trim(),
  );

  const updateKind = (kind: DropPayloadKind) => {
    setError('');
    setNotice('');
    if (!isDropPayloadKindCompatibleWithMedia(kind, file)) {
      setAttachmentFormatError(`Remove this ${file?.type === 'image/gif' ? 'GIF' : 'photo'} before switching formats.`);
      return;
    }
    attachmentChosenRef.current = true;
    setPayloadKind(kind);
    setAttachmentFormatError('');
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;
    if (!selected) return;
    setAttachmentFormatError('');
    const accountId = getLocalAccountId();
    attachmentChosenRef.current = true;
    const validationError = validateDropMedia(selected);
    if (validationError) {
      setError(validationError);
      event.target.value = '';
      return;
    }
    setFile(selected);
    const nextPayloadKind = selected.type === 'image/gif' ? 'gif' : 'image';
    setPayloadKind(nextPayloadKind);
    setError('');
    setAttachmentSaving(true);
    try {
      if (!draft) throw new Error('Draft unavailable');
      const mediaDraft = saveLetterDraft({ payloadKind: nextPayloadKind, mediaUploadId: crypto.randomUUID() });
      setDraft(mediaDraft);
      await saveDraftAttachment(draft.id, selected);
      if (!isCurrentLocalAccount(accountId)) return;
      const updatedDraft = saveLetterDraft({ payloadKind: nextPayloadKind });
      setDraft(updatedDraft);
      setAttachmentSaved(true);
      setNotice('Attachment saved privately on this device.');
    } catch {
      setAttachmentSaved(false);
      setNotice('Attachment is ready for now. Keep this screen open while sending.');
    } finally {
      setAttachmentSaving(false);
    }
  };

  const makeDraft = () => {
    if (!draft) return null;
    return saveLetterDraft({
      content,
      recipient,
      subject,
      fontSize,
      alignment,
      payloadKind,
      deliveryMode,
      mediaUploadId: draft.mediaUploadId,
      sealId,
      sealColor,
      sealMonogram,
      address: { ...draft.address, name: recipient.trim() },
    });
  };

  const clearRecipientInviteProgressForRecipient = (nextRecipient: string) => {
    const nextUsername = normalizeDropRecipient(nextRecipient);
    if (!draft?.recipientInviteProgress || nextUsername === draft.recipientInviteProgress.username) return;
    const accountId = getLocalAccountId();
    const cleared = clearRecipientInviteProgressForDraft(draft.id, accountId, draft.recipientInviteProgress.username);
    if (isCurrentLocalAccount(accountId) && getLetterDraft(accountId).id === draft.id) {
      setDraft(cleared ?? { ...draft, recipientInviteProgress: undefined });
    }
  };

  const saveBeforeLeaving = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (deletingRef.current) {
      event.preventDefault();
      return;
    }
    if (attachmentSaving || (file && !attachmentSaved)) {
      event.preventDefault();
      setNotice(attachmentSaving
        ? 'Saving your attachment on this device…'
        : 'This browser cannot save attachments between screens. Remove it, connect your account, then add it again.');
      return;
    }
    makeDraft();
  };

  const handleSave = () => {
    if (deletingRef.current) return;
    const next = makeDraft();
    if (!next) return;
    setDraft(next);
    setSaved(true);
    setNotice(file && !attachmentSaved ? 'Your words are saved. Keep this screen open to keep the photo attached.' : 'Saved to your desk on this device.');
  };

  const handleRecipientChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = `@${event.target.value.replace(/^@/, '')}`;
    clearRecipientInviteProgressForRecipient(next);
    if (normalizeDropRecipient(next) !== recipientUsername) {
      recipientCheckRequest.current += 1;
      setRecipientCheck({ status: 'idle', username: null });
    }
    setRecipient(next);
    setSaved(false);
    setError('');
    setInviteNotice('');
    setManualInviteUrl('');
    setPrivateClaimUrl('');
  };

  const checkRecipient = async (value = recipientUsername) => {
    const username = normalizeDropRecipient(value || '');
    if (!username || (recipientCheck.status === 'checking' && recipientCheck.username === username)) return;
    const request = ++recipientCheckRequest.current;
    const accountId = getLocalAccountId();
    const draftId = draft?.id;
    setInviteNotice('');
    setManualInviteUrl(draft?.recipientInviteProgress?.manualLinkAvailable ? `${window.location.origin}/invite` : '');
    setRecipientCheck({ status: 'checking', username });
    setError('');
    const result = await lookupDropRecipient(username);
    if (request !== recipientCheckRequest.current || !isCurrentLocalAccount(accountId)) return;
    if (result.status === 'found') {
      setRecipientCheck({ status: 'found', username: result.recipient.username, id: result.recipient.id, displayName: result.recipient.displayName });
      if (draftId && draft?.recipientInviteProgress?.username === username) {
        const cleared = clearRecipientInviteProgressForDraft(draftId, accountId, username);
        if (getLetterDraft(accountId).id === draftId) {
          setDraft(cleared ?? { ...draft, recipientInviteProgress: undefined });
          setManualInviteUrl('');
        }
      }
    } else {
      setRecipientCheck({ status: result.status, username });
    }
  };

  const selectRecentRecipient = (username: string) => {
    const nextRecipient = `@${username}`;
    clearRecipientInviteProgressForRecipient(nextRecipient);
    setRecipient(nextRecipient);
    setSaved(false);
    setError('');
    setInviteNotice('');
    setManualInviteUrl('');
    setPrivateClaimUrl('');
    void checkRecipient(username);
  };

  const sharePrivateClaimInvite = async () => {
    if (!draft || !canSendPrivateClaim || sharingInvite || sending || deletingRef.current) return;
    const request = recipientCheckRequest.current;
    const next = makeDraft();
    if (!next) return;
    const accountId = getLocalAccountId();
    if (!isLetterDraftPersisted(next, accountId)) {
      setSaved(false);
      setInviteNotice('Your note could not be saved on this device. Check browser storage before sharing a private link.');
      return;
    }

    setSending(true);
    setSharingInvite(true);
    setError('');
    setInviteNotice('');
    setManualInviteUrl('');
    setPrivateClaimUrl('');
    try {
      const token = createDropClaimToken();
      const issued = await issueDropClaimInvite(next, accountId, token);
      if (request !== recipientCheckRequest.current || !isCurrentLocalAccount(accountId)) return;
      if (!issued.ok || !issued.letterId) {
        setInviteNotice(issued.error || 'This private note could not be saved. Your draft is still here—try again.');
        return;
      }

      const dispatchedAt = issued.dispatchedAt || new Date().toISOString();
      const sent = completeSuccessfulSend(next, accountId, 'claim_pending', dispatchedAt, {});
      setDraft(sent || { ...next, status: 'claim_pending', dispatchedAt, updatedAt: new Date().toISOString() });
      setSaved(Boolean(sent));

      const inviteUrl = buildDropClaimUrl(window.location.origin, token);
      if (!inviteUrl) {
        setInviteNotice('Your note is saved in Sent, but this browser could not prepare its private link. Open the note in Sent and try again.');
        return;
      }
      const payload = createDropClaimSharePayload(inviteUrl);
      const result = await shareInviteLink(
        inviteUrl,
        navigator.share ? (details) => navigator.share(details) : undefined,
        async (url) => {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(url);
        },
        payload,
      );
      if (request !== recipientCheckRequest.current || !isCurrentLocalAccount(accountId)) return;
      if (result === 'shared' || result === 'copied') {
        router.push(`/sent?letter=${encodeURIComponent(issued.letterId)}&sync=cloud&mode=instant&claim=1`);
        return;
      }
      setPrivateClaimUrl(inviteUrl);
      setInviteNotice(result === 'cancelled'
        ? 'Nothing was shared yet. Copy this private link when you’re ready.'
        : 'Sharing is unavailable. Copy this private link to send it yourself.');
    } catch {
      if (isCurrentLocalAccount(accountId)) setInviteNotice('The private link could not be prepared. Your draft is still here—try again.');
    } finally {
      setSharingInvite(false);
      setSending(false);
    }
  };

  const copyPrivateClaimInvite = async () => {
    if (!privateClaimUrl) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(privateClaimUrl);
      if (!draft) return;
      router.push(`/sent?letter=${encodeURIComponent(draft.id)}&sync=cloud&mode=instant&claim=1`);
    } catch {
      setInviteNotice('Copy is unavailable here. Select the link above and copy it manually.');
    }
  };

  const inviteRecipient = async () => {
    if (!draft || recipientCheck.status !== 'not-found' || recipientCheck.username !== recipientUsername || sharingInvite || sending || deletingRef.current) return;
    const request = recipientCheckRequest.current;
    const savedDraft = makeDraft();
    if (!savedDraft) return;
    const accountId = getLocalAccountId();
    if (!isLetterDraftPersisted(savedDraft, accountId)) {
      setSaved(false);
      setInviteNotice('Your draft could not be saved on this device. Check browser storage and try again before sharing.');
      return;
    }
    const inviteUsername = normalizeDropRecipient(savedDraft.recipient);
    const hadManualInviteLink = savedDraft.recipientInviteProgress?.username === inviteUsername
      && Boolean(savedDraft.recipientInviteProgress.manualLinkAvailable);
    const draftId = savedDraft.id;
    setDraft(savedDraft);
    setSaved(true);
    if (attachmentSaving || (file && !attachmentSaved)) {
      setInviteNotice('Your draft text is saved, but its attachment is not saved on this device yet. Wait for it to finish before sharing.');
      return;
    }
    setSharingInvite(true);
    setInviteNotice('');
    const inviteUrl = `${window.location.origin}/invite`;
    try {
      const result = await shareInviteLink(
        inviteUrl,
        navigator.share ? (details) => navigator.share(details) : undefined,
        async (url) => {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(url);
        },
        {
          title: 'Join me on Drop',
          text: 'Set up your Drop profile, then share your handle with me. I have a little moment for you.',
        },
      );
      if (request !== recipientCheckRequest.current || !isCurrentLocalAccount(accountId)) return;
      const manualLinkAvailable = result === 'unavailable' || (result === 'cancelled' && hadManualInviteLink);
      const updatedDraft = inviteUsername
        ? recordRecipientInviteProgress(draftId, accountId, inviteUsername, result, manualLinkAvailable)
        : null;
      if (getLetterDraft(accountId).id !== draftId) return;
      const progressSaved = Boolean(updatedDraft);
      if (updatedDraft) setDraft(updatedDraft);
      else setDraft({ ...savedDraft, recipientInviteProgress: undefined });
      setManualInviteUrl(manualLinkAvailable ? inviteUrl : '');
      setInviteNotice(progressSaved
        ? ''
        : result === 'shared'
          ? 'Invite shared. You can check their handle here after they join.'
          : result === 'copied'
            ? 'Invite link copied. You can check their handle here after they join.'
            : result === 'cancelled'
              ? 'Invite not shared. Your draft is still saved on this device.'
              : 'Sharing and copying are unavailable. Copy the invite link below.');
    } finally {
      setSharingInvite(false);
    }
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!complete || !confirmedRecipient || !draft || sending || deletingRef.current) return;
    if (payloadKind !== 'text') {
      const validationError = validateDropMedia(file);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setError('');
    setNotice('');
    setSending(true);
    const accountId = getLocalAccountId();
    let next = makeDraft();
    if (!next) {
      setSending(false);
      return;
    }
    if (file && !next.mediaUploadId) {
      next = setActiveLetterDraft({ ...next, mediaUploadId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
    }
    setDraft(next);
    try {
      const result = await syncDropToBackend(next, confirmedRecipient.id, accountId, file || undefined);
      if (!isCurrentLocalAccount(accountId)) return;
      if (!result.ok) {
        setError(result.error || 'This drop could not be sent. Your draft is safe to retry.');
        setRecipientCheck({ status: 'idle', username: null });
        setInviteNotice('');
        setSending(false);
        return;
      }
      const status = deliveryMode === 'instant' ? 'delivered' : 'dispatched';
      const sent = completeSuccessfulSend(next, accountId, status, result.dispatchedAt ?? new Date().toISOString(), {
        mediaPath: result.mediaPath,
        mediaMimeType: result.mediaMimeType,
        mediaSizeBytes: result.mediaSizeBytes,
      });
      if (!sent) {
        setError('Drop was sent, but this device could not save its receipt. Check Sent before trying again.');
        setSending(false);
        return;
      }
      void deleteDraftAttachment(next.id, accountId).catch(() => undefined);
      router.push(`/sent?letter=${encodeURIComponent(sent.id)}&sync=cloud&mode=${deliveryMode}`);
    } catch {
      if (!isCurrentLocalAccount(accountId)) return;
      setError('Something interrupted the send. Your draft is still here—try again.');
      setRecipientCheck({ status: 'idle', username: null });
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!draft || sending || attachmentSaving || deletingRef.current) return;
    const accountId = getLocalAccountId();
    if (!canDeleteLocalDraft(draft.id, accountId)
      || !window.confirm('Delete this unsent draft and its saved attachment from this device? This can’t be undone.')) return;
    if (!isCurrentLocalAccount(accountId)) return;

    deletingRef.current = true;
    setDeleting(true);
    setError('');
    setNotice('');
    const latest = makeDraft();
    if (!latest) {
      deletingRef.current = false;
      setDeleting(false);
      return;
    }
    const result = deleteLocalDraft(latest.id, accountId);
    if (result.status !== 'deleted') {
      if (result.status === 'storage-error' && !result.restored) setActiveLetterDraft(latest);
      setError(result.status === 'storage-error' && !result.restored
        ? 'Drop could not safely remove the draft. Your current copy is still open; save it again before leaving.'
        : result.status === 'storage-error'
          ? 'Drop could not remove this draft from this device. Your draft is still here.'
          : 'This draft is no longer available to delete.');
      deletingRef.current = false;
      setDeleting(false);
      return;
    }

    try {
      if (latest.payloadKind !== 'text' && attachmentSaved) await deleteDraftAttachment(latest.id, accountId);
    } catch {
      const restored = restoreDeletedDraft(result.snapshot);
      if (!restored && isCurrentLocalAccount(accountId)) setActiveLetterDraft(latest);
      if (isCurrentLocalAccount(accountId)) {
        setError(restored
          ? 'The saved attachment could not be removed, so your draft was restored.'
          : 'The saved attachment could not be removed. Your draft is open; save it again before leaving.');
      }
      deletingRef.current = false;
      setDeleting(false);
      return;
    }

    if (!isCurrentLocalAccount(accountId)) {
      deletingRef.current = false;
      setDeleting(false);
      return;
    }
    router.replace(`/compose?letter=${encodeURIComponent(result.nextDraft.id)}`);
  };

  if (!ready) {
    return <main className="page-shell"><div className="page-container max-w-[720px]"><p className="meta" role="status">Loading your draft…</p></div></main>;
  }

  const isText = payloadKind === 'text';
  const pendingInvite = draft?.recipientInviteProgress?.username === recipientUsername ? draft.recipientInviteProgress : null;
  const alignClass = alignment === 'center' ? 'text-center' : alignment === 'right' ? 'text-right' : 'text-left';
  const saveLabel = saved ? 'Saved' : 'Save draft';
  const sendProgressLabel = isText ? 'Sending your note…' : payloadKind === 'gif' ? 'Sending your GIF…' : 'Sending your photo…';
  const deletableDraft = draft ? canDeleteLocalDraft(draft.id) : false;

  return (
    <main className="page-shell page-enter !pt-4 sm:!pt-8">
      <div className="page-container max-w-[760px]">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" onClick={saveBeforeLeaving} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Desk</Link>
          <p className="inline-flex items-center gap-1.5 font-mono text-[0.65rem] text-on-surface-variant" aria-live="polite">{saved ? <Check className="h-3.5 w-3.5 text-[#2f8d67]" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#d08354]" aria-hidden="true" />}{saved ? 'Saved on this device' : 'Saving as you go'}</p>
        </header>

        <div className="mt-7 sm:mt-10">
          <p className="eyebrow">Make a drop</p>
          <h1 className="mt-2 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-5xl">Send a little moment.</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:text-base">One person, one thing you wanted them to see. The rest can wait.</p>
        {accountState !== 'connected' && <div className="rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-4"><p className="text-sm font-semibold text-ink-navy">{accountState === 'checking' ? 'Checking your account…' : accountState === 'unavailable' ? 'Preview mode' : 'Connect your account to send.'}</p><p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{accountState === 'unavailable' ? 'Sign-in isn’t available in this preview. Your drafts stay on this device.' : 'Connect your account to send a private note or invite someone to claim one.'}</p><Link href={profileHref} onClick={saveBeforeLeaving} aria-disabled={attachmentSaving || Boolean(file && !attachmentSaved)} className="mt-2 inline-flex min-h-11 items-center text-xs font-bold text-[#2b45f7]">{accountState === 'unavailable' ? 'Account options' : 'Your profile'} <ArrowRightIcon /></Link></div>}
          {accountState === 'connected' && <p className="mt-4 rounded-xl border border-[#cae6d5] bg-[#f0f9f3] px-4 py-3 text-sm font-semibold text-[#26734f]" role="status">Your account is ready. Start by choosing who gets this drop.</p>}
        </div>

        {draft?.status === 'claim_pending' ? <section className="mt-6 rounded-2xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-5 shadow-[0_8px_24px_rgba(16,42,67,.04)] sm:mt-8 sm:p-7" aria-labelledby="claim-pending-title">
          <p className="eyebrow">Private note sent</p>
          <h2 id="claim-pending-title" className="mt-2 font-headline-md text-3xl font-semibold leading-tight text-ink-navy">Waiting for them to claim.</h2>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">The note is saved in your account. They’ll need to sign in, set up a Drop handle, and claim the link before they can read it.</p>
          {privateClaimUrl && <div className="mt-5 rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-4">
            <p className="text-sm font-semibold text-ink-navy">Anyone holding this link can claim the note.</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">Share it directly with the person you had in mind.</p>
            <code tabIndex={0} aria-label="Select and copy this private note link" className="mt-3 block select-all break-all rounded-lg bg-white/80 px-2 py-2 font-mono text-[0.68rem] text-ink-navy">{privateClaimUrl}</code>
            <button type="button" onClick={() => void copyPrivateClaimInvite()} className="button-primary mt-3 !min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Copy private note link</button>
          </div>}
          {inviteNotice && <p className="field-help mt-3" role="status" aria-live="polite">{inviteNotice}</p>}
          <Link href="/mailbox" className="button-secondary mt-5 !min-h-12 !rounded-xl">Open your mailbox <ArrowRightIcon /></Link>
        </section> : <form onSubmit={handleSend} aria-busy={deleting} className="mt-6 sm:mt-8">
          <fieldset disabled={deleting || sending} aria-label="Compose drop" className="m-0 min-w-0 space-y-4 border-0 p-0 sm:space-y-5">
          <section className="rounded-2xl border border-[rgba(16,42,67,.12)] bg-white/55 p-4 sm:p-6">
            <p className="eyebrow">First · your person</p>
            <label htmlFor="drop-recipient" className="field-label mt-1 block">Who should get this drop?</label>
            <div className="mt-2 flex items-center rounded-xl border border-[rgba(16,42,67,.14)] bg-white px-3 focus-within:ring-2 focus-within:ring-[#2b45f7]/35">
              <span className="font-mono text-sm font-bold text-[#2b45f7]">@</span>
              <input id="drop-recipient" value={recipient.replace(/^@/, '')} onChange={handleRecipientChange} disabled={sending || sharingInvite} className="min-h-12 min-w-0 flex-1 border-0 bg-transparent px-2 text-base text-ink-navy outline-none placeholder:text-on-surface-variant/60 disabled:opacity-60" placeholder="their.username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={recipientHasValue && !recipientUsername} aria-describedby={recipientHasValue && !recipientUsername ? 'drop-recipient-help drop-recipient-error' : 'drop-recipient-help'} />
            </div>
            <p id="drop-recipient-help" className="field-help mt-2">They need a Drop account to open a note. If they don’t have one yet, you can share a private claim link. Handles use 2–24 letters, numbers, periods, underscores, or hyphens.</p>
            {pendingInvite && <div className="mt-2 rounded-lg bg-[#f5f1e9] px-3 py-2 text-sm leading-relaxed text-ink-navy">
              <p role="status" aria-atomic="true">{sharingInvite
                ? 'Opening the invite…'
                : pendingInvite.status === 'shared'
                ? `Invite shared · check @${pendingInvite.username} here after they join.`
                : pendingInvite.status === 'copied'
                  ? `Invite link copied · check @${pendingInvite.username} here after they join.`
                  : pendingInvite.status === 'cancelled'
                    ? 'Invite not shared. You can try again whenever you’re ready.'
                    : 'Sharing isn’t available. Copy this invite link instead.'}</p>
              {pendingInvite.manualLinkAvailable && manualInviteUrl && <code tabIndex={0} aria-label="Select and copy this invite link" className="mt-2 block select-all break-all rounded-lg bg-white/75 px-2 py-1.5 font-mono text-[0.68rem] text-ink-navy">{manualInviteUrl}</code>}
            </div>}
            {recentRecipients.length > 0 && <div className="mt-3">
              <p className="field-help">Recent people from your sent drops</p>
              <div role="group" aria-label="Recent recipients" className="mt-2 flex flex-wrap gap-2">
                {recentRecipients.map(({ username, displayName }) => <button key={username} type="button" aria-label={`Check ${displayName} (@${username})`} onClick={() => selectRecentRecipient(username)} disabled={sending || sharingInvite} className="inline-flex min-h-12 min-w-0 max-w-full flex-col items-start justify-center rounded-xl border border-[rgba(16,42,67,.14)] bg-white/75 px-3 py-1.5 text-left transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7] disabled:opacity-50">
                  <span className="block max-w-[10rem] truncate text-xs font-semibold text-ink-navy">{displayName}</span>
                  <span className="block max-w-[10rem] truncate font-mono text-[0.62rem] text-on-surface-variant">@{username}</span>
                </button>)}
              </div>
            </div>}
            {recipientHasValue && !recipientUsername && <p id="drop-recipient-error" className="error-notice mt-2" role="status" aria-live="polite">Enter a valid Drop handle to send.</p>}
            <button type="button" onClick={() => void checkRecipient()} disabled={!recipientUsername || recipientCheck.status === 'checking' || accountState !== 'connected' || sending || sharingInvite} className="button-secondary mt-3 !min-h-12 w-full !rounded-xl disabled:opacity-45">{recipientCheck.status === 'checking' ? 'Checking…' : pendingInvite ? `Check @${pendingInvite.username}` : recipientCheck.status === 'found' || recipientCheck.status === 'not-found' ? 'Check again' : recipientCheck.status === 'idle' ? 'Check handle' : 'Try again'}</button>
            {recipientCheck.status === 'checking' && recipientCheck.username === recipientUsername && <p className="field-help mt-2" role="status" aria-live="polite">Checking @{recipientUsername}…</p>}
            {confirmedRecipient && <p className="mt-2 text-sm font-semibold text-[#26734f]" role="status" aria-live="polite">Recipient confirmed: {confirmedRecipient.displayName} (@{confirmedRecipient.username})</p>}
            {recipientCheck.status === 'not-found' && recipientCheck.username === recipientUsername && <>
              <p className="error-notice mt-2" role="status" aria-live="polite">No Drop account found for @{recipientUsername}.</p>
              <div className="mt-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-3">
                {!pendingInvite && <p className="text-xs leading-relaxed text-on-surface-variant">{canSendPrivateClaim ? 'Send this instant note as a private link, or invite them to Drop and check their handle again.' : 'Your draft stays here. Invite them to Drop, then check their handle again. Private claim links are for instant text notes.'}</p>}
                {canSendPrivateClaim && <div className="rounded-lg bg-[#eef1ff] p-3">
                  <p className="text-sm font-semibold text-ink-navy">Send this note with a private link</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">The note stays sealed until they sign in, set up a Drop handle, and claim it. Anyone holding the link can claim it.</p>
                  <button type="button" onClick={() => void sharePrivateClaimInvite()} disabled={sharingInvite || sending || deleting} className="button-primary mt-3 !min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">
                    <Share2 className="h-4 w-4" aria-hidden="true" />{sharingInvite ? 'Preparing private link…' : 'Send a private note link'}
                  </button>
                </div>}
                <button type="button" onClick={() => void inviteRecipient()} disabled={sharingInvite || sending || deleting} className="button-secondary mt-3 !min-h-12 w-full !rounded-xl disabled:opacity-50">
                  <Share2 className="h-4 w-4" aria-hidden="true" />{sharingInvite ? 'Opening share…' : pendingInvite ? 'Share invite again' : 'Invite them to Drop'}
                </button>
                {inviteNotice && <p className="field-help mt-2 break-words" role="status" aria-live="polite">{inviteNotice}</p>}
                {manualInviteUrl && pendingInvite?.status !== 'unavailable' && <code tabIndex={0} aria-label="Select and copy this invite link" className="mt-2 block select-all break-all rounded-lg bg-[#f5f1e9] px-2 py-1.5 font-mono text-[0.68rem] text-ink-navy">{manualInviteUrl}</code>}
              </div>
            </>}
            {recipientCheck.status === 'error' && recipientCheck.username === recipientUsername && <p className="error-notice mt-2" role="status" aria-live="polite">Couldn’t check that handle. Try again.</p>}
          </section>

          <fieldset>
            <legend className="field-label">Then, what are we sending?</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([
                ['text', 'A note', Type],
                ['image', 'A photo', FileImage],
                ['gif', 'A GIF', ImagePlus],
              ] as const).map(([kind, label, Icon]) => (
                <button key={kind} type="button" aria-pressed={payloadKind === kind} disabled={attachmentLoading || attachmentSaving} onClick={() => updateKind(kind)} className={cn('flex min-h-[58px] items-center justify-center gap-2 rounded-xl border px-2 text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-50 sm:min-h-12 sm:text-sm', payloadKind === kind ? 'border-[#2b45f7] bg-[#2b45f7]/[0.07] text-[#2b45f7]' : 'border-[rgba(16,42,67,.15)] bg-white/65 text-ink-navy hover:bg-white')}>
                  <Icon className="h-4 w-4" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            {attachmentFormatError && <p className="notice error-notice mt-2" role="alert">{attachmentFormatError}</p>}
            {attachmentLoading && <p className="mt-2 text-xs text-on-surface-variant" role="status">Checking this draft for a saved attachment…</p>}
          </fieldset>

          {!isText && (
            <section className="overflow-hidden rounded-2xl border border-[rgba(16,42,67,.14)] bg-white/60">
              {previewUrl ? (
                <div className="relative aspect-[4/3] max-h-[430px] overflow-hidden bg-[#ede8df]">
                  <ReducedMotionGif src={previewUrl} alt={content.trim() ? '' : `Preview of your ${payloadKind === 'gif' ? 'GIF' : 'photo'}`} animated={payloadKind === 'gif'} sizes="(max-width: 760px) 100vw, 760px" className="object-contain" />
                  <button type="button" aria-label="Remove attachment" disabled={attachmentSaving} onClick={() => { setFile(null); setAttachmentSaved(false); setAttachmentFormatError(''); attachmentChosenRef.current = true; if (draft) void deleteDraftAttachment(draft.id).catch(() => undefined); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              ) : (
                <label htmlFor="drop-media" className="flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-3 px-5 py-8 text-center sm:min-h-[240px]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]"><ImagePlus className="h-5 w-5" aria-hidden="true" /></span>
                  <span><span className="block text-sm font-bold text-ink-navy">Tap to add a {payloadKind === 'gif' ? 'GIF' : 'photo or meme'}</span><span className="mt-1 block text-xs text-on-surface-variant">JPG, PNG, WebP, or GIF · up to 8 MB</span></span>
                </label>
              )}
              <input ref={fileInputRef} id="drop-media" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFile} className="sr-only" aria-label={`Choose a ${payloadKind === 'gif' ? 'GIF' : 'photo'}`} />
              {previewUrl && <p className="px-4 pb-3 text-center font-mono text-[0.62rem] text-on-surface-variant">{attachmentSaving ? 'Saving attachment on this device…' : attachmentSaved ? 'Saved privately on this device · uploads only when sent' : 'Local preview · keep this screen open while sending'}</p>}
            </section>
          )}

          <section className="rounded-2xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-4 shadow-[0_8px_24px_rgba(16,42,67,.04)] sm:p-6">
            <label htmlFor="drop-subject" className="field-label">Give it a name <span className="font-normal text-on-surface-variant">(optional)</span></label>
            <input id="drop-subject" value={subject} onChange={(event) => { setSubject(event.target.value); setSaved(false); }} className="input-field mt-2 !rounded-xl !border-0 !bg-[#f5f1e9]" placeholder={isText ? 'A thought for later' : 'This made me think of you'} maxLength={100} />
            <div className="mt-4 border-t border-[rgba(16,42,67,.1)] pt-4">
              {writingPrompt && <div className="mb-4 rounded-xl border-l-2 border-[#dc7951] bg-[#fff4e7] px-3 py-2.5"><p className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[#9a5037]">A thought to start with</p><p className="mt-1 font-literata text-sm leading-relaxed text-ink-navy">{writingPrompt}</p></div>}
              <label htmlFor="drop-content" className="field-label">{isText ? 'Your note' : 'Add a caption or description'} <span className="font-normal text-on-surface-variant">{isText ? '' : '(optional)'}</span></label>
              <textarea id="drop-content" value={content} onChange={(event) => { setContent(event.target.value); setSaved(false); }} className={cn('textarea-field mt-2 min-h-[150px] !rounded-xl !border-0 !bg-[#f5f1e9] font-literata leading-relaxed text-ink-navy placeholder:font-sans placeholder:text-sm sm:min-h-[190px]', isText && alignClass)} style={isText ? { fontSize: `${fontSize}px` } : undefined} placeholder={isText ? 'Say the thing you wanted them to know…' : 'Describe the moment or add a little context.'} maxLength={5000} />
              {isText && <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="meta">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
                <div className="flex items-center gap-1 rounded-xl border border-[rgba(16,42,67,.1)] bg-white/70 p-0.5">
                  <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-[#f3efe7]" aria-label="Decrease text size" onClick={() => setFontSize((size) => Math.max(16, size - 1))}><Minus className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  <span className="meta min-w-7 text-center">{fontSize}</span>
                  <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-[#f3efe7]" aria-label="Increase text size" onClick={() => setFontSize((size) => Math.min(26, size + 1))}><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  {([[AlignLeft, 'left'], [AlignCenter, 'center'], [AlignRight, 'right']] as const).map(([Icon, value]) => <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={alignment === value} onClick={() => setAlignment(value)} className={cn('flex h-11 w-11 items-center justify-center rounded-lg', alignment === value ? 'bg-[#152b43] text-white' : 'text-on-surface-variant hover:bg-[#f3efe7]')}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></button>)}
                </div>
              </div>}
            </div>
          </section>

          <fieldset className="rounded-2xl border border-[rgba(16,42,67,.12)] bg-white/55 p-4 sm:p-6">
            <legend className="field-label px-1">How should it get there?</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([
                ['instant', 'Instant', 'Right to their inbox'],
                ['relay', 'Make a journey', 'Let people carry it'],
              ] as const).map(([mode, label, copy]) => <button key={mode} type="button" aria-pressed={deliveryMode === mode} onClick={() => setDeliveryMode(mode)} className={cn('min-h-[74px] rounded-xl border px-3 py-2 text-left transition-colors', deliveryMode === mode ? 'border-[#2b45f7] bg-[#2b45f7]/[0.06]' : 'border-[rgba(16,42,67,.12)] bg-white/60 hover:bg-white')}><span className="block text-sm font-bold text-ink-navy">{label}</span><span className="mt-1 block text-[0.68rem] leading-snug text-on-surface-variant">{copy}</span></button>)}
            </div>
            {deliveryMode === 'relay' && <p className="field-help mt-3">Their message stays private. You can follow the handoff from Journey.</p>}
          </fieldset>

          {isText && <details className="rounded-2xl border border-[rgba(16,42,67,.12)] bg-white/55 p-4 sm:p-5">
            <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-ink-navy"><span className="inline-flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full text-base" style={{ backgroundColor: `${sealColor}18`, color: sealColor }}>{currentSeal.displayMark}</span><span>Choose a little sign-off</span><span className="ml-auto font-mono text-xs text-on-surface-variant">{currentSeal.name} · tap to change</span></span></summary>
            <div className="mt-4 border-t border-[rgba(16,42,67,.1)] pt-4">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label="Choose a sign-off">
                {mockSeals.map((seal) => <button key={seal.id} type="button" aria-pressed={sealId === seal.id} onClick={() => setSealId(seal.id)} className={cn('flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-center text-[0.58rem] font-semibold leading-tight', sealId === seal.id ? 'border-[#2b45f7] bg-[#2b45f7]/[0.06] text-ink-navy' : 'border-transparent text-on-surface-variant hover:bg-white')}><span className="text-base" style={{ color: sealColor }}>{seal.id === 'monogram' ? sealMonogram || 'M' : seal.mark}</span>{seal.name.split(' ').slice(-1)[0]}</button>)}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Choose a sign-off color">{waxColors.map((color) => <button key={color.id} type="button" aria-label={color.name} aria-pressed={sealColor === color.hex} onClick={() => setSealColor(color.hex)} className={cn('h-11 w-11 rounded-full border-2', sealColor === color.hex ? 'border-ink-navy ring-2 ring-white' : 'border-white')} style={{ backgroundColor: color.hex }} />)}</div>
              {sealId === 'monogram' && <label htmlFor="drop-monogram" className="field-label mt-4">Monogram<input id="drop-monogram" value={sealMonogram} onChange={(event) => setSealMonogram(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} className="input-field mt-2 !rounded-xl" maxLength={2} placeholder="AB" /></label>}
            </div>
          </details>}

          {error && <p className="notice error-notice" role="alert">{error}</p>}
          {notice && !error && <p className="notice" role="status">{notice}</p>}

          <div className="flex flex-col gap-2 pb-3">
            <Link href={draft ? `/compose/preview?letter=${encodeURIComponent(draft.id)}` : '/compose/preview'} onClick={saveBeforeLeaving} className="button-secondary !min-h-12 !rounded-xl"><Eye className="h-4 w-4" aria-hidden="true" /> Preview as recipient</Link>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div className={deletableDraft ? 'grid grid-cols-2 gap-2 sm:flex' : 'flex'}>
                <button type="button" onClick={handleSave} className="button-secondary !min-h-12 !rounded-xl">{saveLabel}</button>
                {deletableDraft && <button type="button" onClick={handleDelete} disabled={deleting || sending || attachmentSaving} className="button-secondary !min-h-12 !rounded-xl !border-[#e6c7bd] !text-[#9e4038] disabled:opacity-45"><Trash2 className="h-4 w-4" aria-hidden="true" />{deleting ? 'Deleting…' : 'Delete draft'}</button>}
              </div>
              {accountState === 'connected' ? <button type="submit" disabled={!complete || sending || deleting || attachmentSaving} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-45"><span aria-live="polite" aria-atomic="true">{sending ? sendProgressLabel : 'Send drop'}</span> <Send className="h-4 w-4" aria-hidden="true" /></button> : <Link href={profileHref} onClick={saveBeforeLeaving} aria-disabled={deleting || attachmentSaving || Boolean(file && !attachmentSaved)} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">{accountState === 'unavailable' ? 'Account options' : 'Connect to send'} <Send className="h-4 w-4" aria-hidden="true" /></Link>}
            </div>
          </div>
          </fieldset>
        </form>}
      </div>
    </main>
  );
}

function ArrowRightIcon() {
  return <span aria-hidden="true" className="ml-1">↗</span>;
}

export default function ComposePage() {
  return <Suspense fallback={<main className="page-shell"><div className="page-container max-w-[760px]"><p className="meta">Loading your draft…</p></div></main>}><Composer /></Suspense>;
}
