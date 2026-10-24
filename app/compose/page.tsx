'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Check, Eye, FileImage, ImagePlus, Minus, Plus, QrCode, Send, Share2, Trash2, Type, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getSealInfo, mockSeals, waxColors, writingPrompts, type DropDeliveryMode, type DropPayloadKind } from '@/data/mockData';
import { canDeleteLocalDraft, clearRecipientInviteProgressForDraft, completeSuccessfulSend, deleteLocalDraft, ensureLetterDraftMediaUploadId, getLetterDraft, getLetterDraftById, getLetterDraftByMediaUploadId, isLetterDraftPersisted, recordRecipientInviteProgress, restoreDeletedDraft, saveLetterDraft, setActiveLetterDraft, startNewLetter, type LetterDraftState, type LetterAlignment } from '@/lib/letterStore';
import { getRemoteRecentDropRecipients, issueDropClaimInvite, issueDropMediaClaimInvite, lookupDropRecipient, syncDropToBackend } from '@/lib/letterBackend';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isDropPayloadKindCompatibleWithMedia, isDropRecipientConfirmed, normalizeDropRecipient, validateDropMedia } from '@/lib/dropValidation';
import { AttachmentCommittedAfterAccountSwitchError, deleteDraftAttachment, getDraftAttachment, saveDraftAttachment } from '@/lib/letterMediaStore';
import { getLocalAccountId, isCurrentLocalAccount } from '@/lib/localAccountScope';
import { canOfferInstantClaimSwitch, canOfferPrivateClaimInvite, getClaimInviteExpiryDuration, getConfirmedMediaRetryUploadId } from '@/lib/claimInviteStatus';
import { rollbackShareTargetImport, type ShareTargetImportRollbackContext } from '@/lib/shareTargetImportRollback';
import { ReducedMotionGif } from '@/components/ReducedMotionGif';
import { getDropMediaAccessibleName } from '@/lib/dropMediaAccessibility';
import { cn } from '@/lib/utils';
import { shareInviteLink } from '@/lib/shareInvite';
import { buildDropClaimUrl, createDropClaimSharePayload, createDropClaimToken } from '@/lib/dropClaim';
import { buildPrivateClaimDetailsPath, buildSentReceiptPath, getComposerClaimPendingCopy } from '@/lib/claimReceipt';
import type { RecentDropRecipient } from '@/lib/recentDropRecipients';
import { deleteShareTargetHandoff, getShareTargetHandoff, isValidShareTargetHandoffId, validateShareTargetHandoffFile } from '@/lib/shareTargetHandoff';

const SHARE_TARGET_ERROR_COPY: Record<string, string> = {
  'invalid-share': 'This share could not be opened. Pick a photo or GIF to start a fresh drop.',
  'unsupported-media': 'Drop can open JPG, PNG, WebP, or GIF images. Pick one to try again.',
  'too-large': 'This image is over Drop’s 8 MB limit. Pick a smaller image.',
  'storage-unavailable': 'This browser could not save the shared image. Try the photo picker instead.',
  'worker-unavailable': 'Drop could not import this share. Your browser sent it to the website, but it was not saved as a drop. Use the photo picker in the app.',
};

type ShareTargetImportResult = {
  draft: LetterDraftState;
  file: File;
  payloadKind: 'image' | 'gif';
  reused: boolean;
};

type RecipientCheck =
  | { status: 'idle' | 'checking' | 'not-found' | 'error'; username: string | null }
  | { status: 'found'; username: string; id: string; displayName: string };

type PrivateClaimInviteReceipt = {
  ok: boolean;
  error?: string;
  letterId?: string;
  dispatchedAt?: string;
  mediaPath?: string;
  mediaMimeType?: string;
  mediaSizeBytes?: number;
  mediaExpiresAt?: string;
  cleanupQueued?: boolean;
  retryUploadId?: string;
};

function formatMediaExpiryDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date);
}

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
  const [shareWithoutHandle, setShareWithoutHandle] = useState(false);
  const [recipientCheck, setRecipientCheck] = useState<RecipientCheck>({ status: 'idle', username: null });
  const [recentRecipients, setRecentRecipients] = useState<RecentDropRecipient[]>([]);
  const recipientCheckRequest = useRef(0);
  const recipientInputRef = useRef<HTMLInputElement>(null);
  const recipientlessPanelRef = useRef<HTMLDivElement>(null);
  const focusRecipientlessPanel = useRef(false);
  const focusRecipientInput = useRef(false);
  const privateClaimQrRef = useRef<HTMLDivElement>(null);
  const focusPrivateClaimQrOnRender = useRef(false);
  const privateClaimButtonRef = useRef<HTMLButtonElement>(null);
  const focusPrivateClaimButtonAfterModeSwitch = useRef(false);
  const [subject, setSubject] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [alignment, setAlignment] = useState<LetterAlignment>('left');
  const [sealId, setSealId] = useState('heart');
  const [sealColor, setSealColor] = useState('#991b1b');
  const [sealMonogram, setSealMonogram] = useState('');
  const [writingPrompt, setWritingPrompt] = useState('');
  const [ready, setReady] = useState(false);
  const [shareImporting, setShareImporting] = useState(false);
  const shareImportInProgressRef = useRef(false);
  const shareImportOperationsRef = useRef(new Map<string, Promise<ShareTargetImportResult>>());
  // Effect replays for one handoff must share rollback state with the deduplicated import promise.
  const shareImportRollbackContextsRef = useRef(new Map<string, ShareTargetImportRollbackContext>());
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
  const [showPrivateClaimQr, setShowPrivateClaimQr] = useState(false);
  const [privateClaimAction, setPrivateClaimAction] = useState<'share' | 'qr' | null>(null);
  const [mediaExpiresAt, setMediaExpiresAt] = useState<string | null>(null);
  const [sharingInvite, setSharingInvite] = useState(false);
  const privateClaimContextRef = useRef<{ accountId: string | null; draftId: string | null; url: string }>({ accountId: null, draftId: null, url: '' });
  const currentAccountId = getLocalAccountId();

  const clearPrivateClaimInvite = () => {
    setPrivateClaimUrl('');
    setShowPrivateClaimQr(false);
    setPrivateClaimAction(null);
    focusPrivateClaimQrOnRender.current = false;
  };

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
    setShowPrivateClaimQr(false);
    setPrivateClaimAction(null);
    focusPrivateClaimQrOnRender.current = false;
    setMediaExpiresAt(null);
    setContent(current.content);
    setRecipient(requestedRecipient);
    setShareWithoutHandle(false);
    focusRecipientlessPanel.current = false;
    focusRecipientInput.current = false;
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
      if (!deletingRef.current && !shareImportInProgressRef.current) {
        saveLetterDraft({ content, recipient, subject, fontSize, alignment, payloadKind, deliveryMode, sealId, sealColor, sealMonogram });
        setSaved(true);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [alignment, content, deliveryMode, draft, fontSize, payloadKind, ready, recipient, sealColor, sealId, sealMonogram, subject]);

  useEffect(() => {
    if (!ready || deletingRef.current) return;

    const routeDraft = () => {
      const currentDraftId = getLetterDraft().id;
      return `/compose?letter=${encodeURIComponent(currentDraftId)}`;
    };
    const shareError = searchParams.get('shareError');
    if (shareError) {
      setError('');
      setNotice(SHARE_TARGET_ERROR_COPY[shareError] || SHARE_TARGET_ERROR_COPY['invalid-share']);
      router.replace(routeDraft(), { scroll: false });
      return;
    }

    const handoffId = searchParams.get('shareImport');
    if (!handoffId) return;
    if (!isValidShareTargetHandoffId(handoffId)) {
      setError('');
      setNotice(SHARE_TARGET_ERROR_COPY['invalid-share']);
      router.replace(routeDraft(), { scroll: false });
      return;
    }

    let active = true;
    shareImportInProgressRef.current = true;
    setShareImporting(true);
    setAttachmentLoading(true);
    setError('');
    setNotice('Adding the shared image to a new draft…');

    const rollbackContext = shareImportRollbackContextsRef.current.get(handoffId) ?? {
      accountId: undefined,
      previousActiveDraft: null,
      activatedDraftIds: new Set<string>(),
      newlyWrittenAttachmentDraftId: null,
    };
    shareImportRollbackContextsRef.current.set(handoffId, rollbackContext);

    let operation = shareImportOperationsRef.current.get(handoffId);
    if (!operation) {
      operation = (async (): Promise<ShareTargetImportResult> => {
        const handoff = await getShareTargetHandoff(handoffId);
        if (!handoff) throw new Error('This share expired or could not be opened. Choose a photo or GIF to start again.');

        const mediaError = validateShareTargetHandoffFile(handoff.file);
        if (mediaError) throw new Error(mediaError);

        const accountId = getLocalAccountId();
        rollbackContext.accountId = accountId;
        rollbackContext.previousActiveDraft = getLetterDraft(accountId);
        const saveShareAttachment = async (draftId: string) => {
          try {
            await saveDraftAttachment(draftId, handoff.file, accountId);
          } catch (error) {
            if (error instanceof AttachmentCommittedAfterAccountSwitchError
              && error.draftId === draftId
              && error.accountId === accountId) {
              rollbackContext.newlyWrittenAttachmentDraftId = draftId;
            }
            throw error;
          }
          rollbackContext.newlyWrittenAttachmentDraftId = draftId;
        };
        const startNewShareDraft = () => {
          try {
            return startNewLetter({ forceNew: true, requirePreserved: true });
          } catch (error) {
            if (isCurrentLocalAccount(accountId)) {
              const activeDraftAfterFailure = getLetterDraft(accountId);
              if (activeDraftAfterFailure.id !== rollbackContext.previousActiveDraft?.id) {
                rollbackContext.activatedDraftIds.add(activeDraftAfterFailure.id);
              }
            }
            throw error;
          }
        };
        const payloadKind = handoff.file.type === 'image/gif' ? 'gif' : 'image';
        const existingImport = getLetterDraftByMediaUploadId(handoffId, accountId, payloadKind);
        let importedDraft: LetterDraftState;
        let importedFile = handoff.file;
        if (existingImport) {
          const activeDraft = getLetterDraft(accountId);
          if (activeDraft.id !== existingImport.id) {
            const blank = startNewShareDraft();
            rollbackContext.activatedDraftIds.add(blank.id);
          }
          importedDraft = setActiveLetterDraft(existingImport);
          rollbackContext.activatedDraftIds.add(importedDraft.id);
          if (!isLetterDraftPersisted(importedDraft, accountId)) {
            throw new Error('The existing draft could not be restored on this device. Your saved version is still available.');
          }
          const savedAttachment = await getDraftAttachment(existingImport.id);
          if (!isCurrentLocalAccount(accountId)) throw new Error('Your active account changed before the share could be restored. Reopen it and try again.');
          if (savedAttachment) {
            if (!isDropPayloadKindCompatibleWithMedia(payloadKind, savedAttachment)) {
              throw new Error('The saved attachment does not match this shared image. Your existing draft was left unchanged.');
            }
            importedFile = savedAttachment;
          } else {
            await saveShareAttachment(importedDraft.id);
          }
        } else {
          const blank = startNewShareDraft();
          rollbackContext.activatedDraftIds.add(blank.id);
          importedDraft = setActiveLetterDraft({
            ...blank,
            content: handoff.caption,
            recipient: '',
            subject: '',
            payloadKind,
            deliveryMode: 'instant',
            mediaUploadId: handoffId,
            address: { ...blank.address, name: '' },
          });
          rollbackContext.activatedDraftIds.add(importedDraft.id);
          const preexistingAttachment = await getDraftAttachment(importedDraft.id);
          if (preexistingAttachment) {
            throw new Error('A saved attachment already exists for this draft. Your shared image is still available to reopen.');
          }
          await saveShareAttachment(importedDraft.id);
          if (!isCurrentLocalAccount(accountId)) throw new Error('Your active account changed before the share could be saved. Reopen it and try again.');

          const persistedDraft = saveLetterDraft({
            content: handoff.caption,
            recipient: '',
            subject: '',
            payloadKind,
            deliveryMode: 'instant',
            mediaUploadId: importedDraft.mediaUploadId,
            address: { ...importedDraft.address, name: '' },
          });
          if (persistedDraft.id !== importedDraft.id || !isLetterDraftPersisted(persistedDraft, accountId)) {
            throw new Error('The new draft could not be saved on this device. The shared image is still available to reopen.');
          }
          importedDraft = persistedDraft;
        }

        if (!isCurrentLocalAccount(accountId)) throw new Error('Your active account changed before the share could be restored. Reopen it and try again.');
        await deleteShareTargetHandoff(handoffId).catch(() => undefined);
        return { draft: importedDraft, file: importedFile, payloadKind, reused: Boolean(existingImport) };
      })();
      shareImportOperationsRef.current.set(handoffId, operation);
    }

    void operation.then((result) => {
      shareImportRollbackContextsRef.current.delete(handoffId);
      if (!active) return;
      setDraft(result.draft);
      setContent(result.draft.content);
      setRecipient(result.draft.recipient);
      setSubject(result.draft.subject);
      setFontSize(result.draft.fontSize);
      setAlignment(result.draft.alignment);
      setPayloadKind(result.draft.payloadKind);
      setDeliveryMode(result.draft.deliveryMode);
      setSealId(result.draft.sealId || 'heart');
      setSealColor(result.draft.sealColor || '#991b1b');
      setSealMonogram(result.draft.sealMonogram || '');
      setFile(result.file);
      setAttachmentSaved(true);
      setAttachmentFormatError('');
      setAttachmentLoading(false);
      setAttachmentSaving(false);
      setSaved(true);
      setError('');
      const mediaLabel = result.payloadKind === 'gif' ? 'GIF' : 'Photo';
      setNotice(result.reused
        ? `Your saved ${mediaLabel} draft is ready again. Saved on this device; not sent.`
        : `${mediaLabel} added to a new draft. Saved on this device; not sent.`);
      shareImportOperationsRef.current.delete(handoffId);
      router.replace(`/compose?letter=${encodeURIComponent(result.draft.id)}`, { scroll: false });
    }).catch(async (error: unknown) => {
      shareImportOperationsRef.current.delete(handoffId);

      const rollbackResult = await rollbackShareTargetImport(rollbackContext);
      shareImportRollbackContextsRef.current.delete(handoffId);

      if (!active) return;
      setAttachmentLoading(false);
      setAttachmentSaved(false);
      const message = error instanceof Error ? error.message : 'This shared image could not be opened. Choose a photo or GIF to try again.';
      setError(rollbackResult.activeDraftRestoreFailed
        ? `${message} Your earlier draft is still saved, but Drop could not make it active again.`
        : rollbackResult.preserveCommittedImportForCapturedAccount
          ? `${message} The imported draft remains saved to its original account.`
        : message);
      setNotice('The shared item has not been sent. You can still choose a photo or GIF below.');
    }).finally(() => {
      if (active) {
        shareImportInProgressRef.current = false;
        setShareImporting(false);
      }
    });

    return () => { active = false; };
  }, [ready, router, searchParams]);

  useEffect(() => {
    privateClaimContextRef.current = { accountId: currentAccountId, draftId: draft?.id ?? null, url: privateClaimUrl };
  }, [currentAccountId, draft?.id, privateClaimUrl]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const recipientUsername = normalizeDropRecipient(recipient);
  const confirmedRecipient = recipientCheck.status === 'found' && isDropRecipientConfirmed(recipientCheck, recipient) ? recipientCheck : null;
  const recipientHasValue = recipient.replace(/^@/, '').trim().length > 0;
  const complete = Boolean(confirmedRecipient && recipientUsername && (payloadKind === 'text' ? content.trim() : file));
  const currentSeal = getSealInfo(sealId, sealMonogram, sealColor);
  const profileHref = draft ? `/profile?next=${encodeURIComponent(`/compose?letter=${encodeURIComponent(draft.id)}`)}#account` : '/profile#account';
  const privateClaimEligibility = {
    accountConnected: accountState === 'connected',
    recipientStatus: recipientCheck.status,
    recipientUsername,
    checkedUsername: recipientCheck.username,
    shareWithoutHandle,
    deliveryMode,
    payloadKind,
    hasText: Boolean(content.trim()),
    hasMedia: Boolean(file),
    attachmentSaved,
    attachmentBusy: attachmentLoading || attachmentSaving,
  };
  const canSendPrivateClaim = canOfferPrivateClaimInvite(privateClaimEligibility);
  const canSwitchToInstantClaim = canOfferInstantClaimSwitch(privateClaimEligibility);
  const privateClaimReadinessMessage = accountState !== 'connected'
    ? 'Connect your Drop account before making a private claim link.'
    : attachmentLoading || attachmentSaving
      ? 'Wait until the attachment finishes saving on this device.'
      : payloadKind === 'text'
        ? 'Add a note before making a private claim link.'
        : !file
          ? `Add a ${payloadKind === 'gif' ? 'GIF' : 'photo'} before making a private claim link.`
          : 'Wait until the attachment finishes saving on this device.';

  useEffect(() => {
    if (!canSendPrivateClaim || !focusPrivateClaimButtonAfterModeSwitch.current) return;
    focusPrivateClaimButtonAfterModeSwitch.current = false;
    privateClaimButtonRef.current?.focus();
  }, [canSendPrivateClaim]);

  useEffect(() => {
    if (!focusPrivateClaimQrOnRender.current || !privateClaimUrl || !showPrivateClaimQr) return;
    focusPrivateClaimQrOnRender.current = false;
    privateClaimQrRef.current?.focus();
  }, [privateClaimUrl, showPrivateClaimQr]);

  useEffect(() => {
    if (shareWithoutHandle && focusRecipientlessPanel.current) {
      focusRecipientlessPanel.current = false;
      recipientlessPanelRef.current?.focus();
    } else if (!shareWithoutHandle && focusRecipientInput.current) {
      focusRecipientInput.current = false;
      recipientInputRef.current?.focus();
    }
  }, [shareWithoutHandle]);

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

  const makeDraft = (nextDeliveryMode = deliveryMode) => {
    if (!draft) return null;
    return saveLetterDraft({
      content,
      recipient,
      subject,
      fontSize,
      alignment,
      payloadKind,
      deliveryMode: nextDeliveryMode,
      mediaUploadId: draft.mediaUploadId,
      sealId,
      sealColor,
      sealMonogram,
      address: { ...draft.address, name: recipient.trim() },
    });
  };

  const switchToInstantForPrivateClaim = () => {
    if (!canSwitchToInstantClaim || sharingInvite || sending || deleting || deletingRef.current) return;
    const updatedDraft = makeDraft('instant');
    if (!updatedDraft) return;
    focusPrivateClaimButtonAfterModeSwitch.current = true;
    setDraft(updatedDraft);
    setDeliveryMode('instant');
    setSaved(false);
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
    if (shareImporting || shareImportInProgressRef.current) {
      event.preventDefault();
      setNotice('Adding the shared image to a draft… Keep Drop open for a moment.');
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
    setShareWithoutHandle(false);
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
    clearPrivateClaimInvite();
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
    setShareWithoutHandle(false);
    clearRecipientInviteProgressForRecipient(nextRecipient);
    setRecipient(nextRecipient);
    setSaved(false);
    setError('');
    setInviteNotice('');
    setManualInviteUrl('');
    clearPrivateClaimInvite();
    void checkRecipient(username);
  };

  const chooseLinkWithoutHandle = () => {
    if (sharingInvite || sending || deletingRef.current) return;
    clearRecipientInviteProgressForRecipient('');
    recipientCheckRequest.current += 1;
    focusRecipientlessPanel.current = true;
    setRecipient('');
    setRecipientCheck({ status: 'idle', username: null });
    setShareWithoutHandle(true);
    setInviteNotice('');
    setManualInviteUrl('');
    clearPrivateClaimInvite();
  };

  const chooseHandleInstead = () => {
    recipientCheckRequest.current += 1;
    focusRecipientInput.current = true;
    setShareWithoutHandle(false);
    setRecipient('');
    setRecipientCheck({ status: 'idle', username: null });
    setInviteNotice('');
    clearPrivateClaimInvite();
  };

  const sharePrivateClaimInvite = async (action: 'share' | 'qr' = 'share') => {
    if (!draft || !canSendPrivateClaim || sharingInvite || sending || deletingRef.current) return;
    const request = recipientCheckRequest.current;
    let next = makeDraft();
    if (!next) return;
    const accountId = getLocalAccountId();
    if (file && !next.mediaUploadId) {
      const stableDraft = ensureLetterDraftMediaUploadId(next, accountId);
      if (!stableDraft) {
        setSaved(false);
        setInviteNotice('Your drop could not be saved on this device. Check browser storage before sharing a private link.');
        return;
      }
      next = stableDraft;
      setDraft(next);
    }
    if (!isLetterDraftPersisted(next, accountId)) {
      setSaved(false);
      setInviteNotice('Your drop could not be saved on this device. Check browser storage before sharing a private link.');
      return;
    }

    setSending(true);
    setSharingInvite(true);
    setError('');
    setInviteNotice('');
    setManualInviteUrl('');
    clearPrivateClaimInvite();
    setPrivateClaimAction(action);
    try {
      const token = createDropClaimToken();
      let issued: PrivateClaimInviteReceipt;
      if (next.payloadKind === 'text') {
        issued = await issueDropClaimInvite(next, accountId, token);
      } else if (file) {
        issued = await issueDropMediaClaimInvite(next, file, accountId, token);
      } else {
        issued = { ok: false, error: 'Attach the photo or GIF before sharing a private link.' };
      }
      if (request !== recipientCheckRequest.current || !isCurrentLocalAccount(accountId)) return;
      if (!issued.ok || !issued.letterId) {
        const retryUploadId = next.payloadKind === 'text'
          ? null
          : getConfirmedMediaRetryUploadId(issued, next.mediaUploadId);
        if (retryUploadId) {
          const retryDraft = saveLetterDraft({ mediaUploadId: retryUploadId });
          const retryIdPersisted = retryDraft.id === next.id && isLetterDraftPersisted(retryDraft, accountId);
          setDraft(retryDraft);
          setSaved(retryIdPersisted);
          setInviteNotice(retryIdPersisted
            ? 'Cleanup is queued. Your attachment is still here; retrying will use a fresh upload path.'
            : 'Cleanup is queued, but the fresh retry path is not saved on this device yet. Save your draft before retrying.');
          return;
        }
        setInviteNotice(issued.error || 'This private drop could not be saved. Your draft is still here—try again.');
        return;
      }

      const dispatchedAt = issued.dispatchedAt || new Date().toISOString();
      const mediaReceipt = next.payloadKind !== 'text' ? {
        mediaPath: issued.mediaPath,
        mediaMimeType: issued.mediaMimeType,
        mediaSizeBytes: issued.mediaSizeBytes,
      } : {};
      const sent = completeSuccessfulSend(next, accountId, 'claim_pending', dispatchedAt, mediaReceipt);
      setDraft(sent || { ...next, status: 'claim_pending', dispatchedAt, updatedAt: new Date().toISOString() });
      setSaved(Boolean(sent));
      if (next.payloadKind !== 'text') {
        setMediaExpiresAt(issued.mediaExpiresAt ?? null);
      }
      if (sent && next.payloadKind !== 'text') void deleteDraftAttachment(next.id, accountId).catch(() => undefined);

      const inviteUrl = buildDropClaimUrl(window.location.origin, token);
      if (!inviteUrl) {
        setInviteNotice('Your drop is saved in Sent, but this browser could not prepare its private link. Open it in Sent and try again.');
        return;
      }
      setPrivateClaimUrl(inviteUrl);
      if (action === 'qr') {
        focusPrivateClaimQrOnRender.current = true;
        setShowPrivateClaimQr(true);
        setInviteNotice('Your private claim scan code is ready. Anyone who scans it can claim this drop.');
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
        router.push(buildSentReceiptPath({ kind: 'claim', letterId: issued.letterId, shareOutcome: result }));
        return;
      }
      setInviteNotice(result === 'cancelled'
        ? 'Nothing was shared yet. Copy this private link when you’re ready.'
        : 'Sharing is unavailable. Copy this private link to send it yourself.');
    } catch {
      if (isCurrentLocalAccount(accountId)) setInviteNotice('The private link could not be prepared. Your draft is still here—try again.');
    } finally {
      setSharingInvite(false);
      setPrivateClaimAction(null);
      setSending(false);
    }
  };

  const sharePreparedPrivateClaimInvite = async () => {
    if (!privateClaimUrl || !draft || sharingInvite || sending || deletingRef.current) return;
    const accountId = getLocalAccountId();
    const draftId = draft.id;
    const isCurrentInviteContext = () => {
      const current = privateClaimContextRef.current;
      return isCurrentLocalAccount(accountId)
        && current.accountId === accountId
        && current.draftId === draftId
        && current.url === privateClaimUrl;
    };
    setSharingInvite(true);
    setInviteNotice('');
    try {
      const result = await shareInviteLink(
        privateClaimUrl,
        navigator.share ? (details) => navigator.share(details) : undefined,
        async (url) => {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(url);
        },
        createDropClaimSharePayload(privateClaimUrl),
      );
      if (!isCurrentInviteContext()) return;
      if (result === 'shared' || result === 'copied') {
        router.push(buildSentReceiptPath({ kind: 'claim', letterId: draftId, shareOutcome: result }));
        return;
      }
      setInviteNotice(result === 'cancelled'
        ? 'Nothing was shared yet. The same private link is still ready below.'
        : 'Sharing is unavailable. Copy the private link below instead.');
    } catch {
      if (isCurrentInviteContext()) setInviteNotice('The share sheet is unavailable. The same private link is still ready to copy.');
    } finally {
      setSharingInvite(false);
    }
  };

  const copyPrivateClaimInvite = async () => {
    if (!privateClaimUrl) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(privateClaimUrl);
      if (!draft) return;
      router.push(buildSentReceiptPath({ kind: 'claim', letterId: draft.id, shareOutcome: 'copied' }));
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
      router.push(buildSentReceiptPath({ kind: 'delivery', letterId: sent.id, mode: deliveryMode }));
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
  const privateClaimPayloadLabel = isText ? 'note' : payloadKind === 'gif' ? 'GIF' : 'photo';
  const privateClaimPendingCopy = getComposerClaimPendingCopy(Boolean(privateClaimUrl));
  const privateClaimDetailsHref = draft ? buildPrivateClaimDetailsPath(draft.id) : '/sent';
  const pendingInvite = draft?.recipientInviteProgress?.username === recipientUsername ? draft.recipientInviteProgress : null;
  const alignClass = alignment === 'center' ? 'text-center' : alignment === 'right' ? 'text-right' : 'text-left';
  const saveLabel = saved ? 'Saved' : 'Save draft';
  const sendProgressLabel = isText ? 'Sending your note…' : payloadKind === 'gif' ? 'Sending your GIF…' : 'Sending your photo…';
  const mediaExpiryLabel = formatMediaExpiryDate(mediaExpiresAt);
  const deletableDraft = draft ? canDeleteLocalDraft(draft.id) : false;

  return (
    <main className="page-shell page-enter page-shell--composer !pt-4 sm:!pt-8">
      <div className="page-container max-w-[760px]">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" onClick={saveBeforeLeaving} aria-disabled={shareImporting} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65 aria-disabled:cursor-wait"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Desk</Link>
          <p className="inline-flex items-center gap-1.5 font-mono text-[0.65rem] text-on-surface-variant" aria-live="polite">{saved ? <Check className="h-3.5 w-3.5 text-[#2f8d67]" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#d08354]" aria-hidden="true" />}{saved ? 'Saved on this device' : 'Saving as you go'}</p>
        </header>

        <div className="mt-7 sm:mt-10">
          <p className="eyebrow">Make a drop</p>
          <h1 className="mt-2 font-headline-md text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-ink-navy sm:text-5xl">Send a little moment.</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-on-surface-variant sm:text-base">One person, one thing you wanted them to see. The rest can wait.</p>
        {accountState !== 'connected' && <div className="rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-4"><p className="text-sm font-semibold text-ink-navy">{accountState === 'checking' ? 'Checking your account…' : accountState === 'unavailable' ? 'Preview mode' : 'Connect your account to send.'}</p><p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{accountState === 'unavailable' ? 'Sign-in isn’t available in this preview. Your drafts stay on this device.' : 'Connect your account to send a private note or invite someone to claim one.'}</p><Link href={profileHref} onClick={saveBeforeLeaving} aria-disabled={shareImporting || attachmentSaving || Boolean(file && !attachmentSaved)} className="mt-2 inline-flex min-h-11 items-center text-xs font-bold text-[#2b45f7]">{accountState === 'unavailable' ? 'Account options' : 'Your profile'} <ArrowRightIcon /></Link></div>}
        {accountState === 'connected' && <p className="mt-4 rounded-xl border border-[#cae6d5] bg-[#f0f9f3] px-4 py-3 text-sm font-semibold text-[#26734f]" role="status">Your account is ready. {shareWithoutHandle ? 'Choose what goes in this drop, then share its private link.' : 'Start by choosing who gets this drop.'}</p>}
        </div>

        {draft?.status === 'claim_pending' ? <section className="mt-6 rounded-2xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-5 shadow-[0_8px_24px_rgba(16,42,67,.04)] sm:mt-8 sm:p-7" aria-labelledby="claim-pending-title">
          <p className="eyebrow">{privateClaimPendingCopy.eyebrow}</p>
          <h2 id="claim-pending-title" className="mt-2 font-headline-md text-3xl font-semibold leading-tight text-ink-navy">{privateClaimPendingCopy.heading}</h2>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{privateClaimPendingCopy.body}</p>
          {shareImporting && <p className="mt-3 rounded-xl border border-[#d9defd] bg-[#eef1ff] p-3 text-sm leading-relaxed text-ink-navy" role="status" aria-live="polite">Adding the shared image… Keep Drop open while it is added to your draft.</p>}
          <p className="mt-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-3 text-xs leading-relaxed text-on-surface-variant">This link {getClaimInviteExpiryDuration(payloadKind)}. Anyone holding it can claim the drop.</p>
          {payloadKind !== 'text' && <p className="mt-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-3 text-xs leading-relaxed text-on-surface-variant">If the {payloadKind === 'gif' ? 'GIF' : 'photo'} drop is still unclaimed after 30 days{mediaExpiryLabel ? ` (on ${mediaExpiryLabel})` : ''}, its claim and media access end. Drop queues the attachment for deletion then; cleanup can be delayed if the free project is paused or unavailable. A fresh link won’t extend the cutoff.</p>}
          {privateClaimUrl && <div className="mt-5 rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-4">
            <p className="text-sm font-semibold text-ink-navy">Anyone holding this link can claim the drop.</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">Share it directly with the person you had in mind.</p>
            <code tabIndex={0} aria-label="Select and copy this private claim link" className="mt-3 block select-all break-all rounded-lg bg-white/80 px-2 py-2 font-mono text-[0.68rem] text-ink-navy">{privateClaimUrl}</code>
            <div id="private-claim-qr" ref={privateClaimQrRef} tabIndex={showPrivateClaimQr ? -1 : undefined} role={showPrivateClaimQr ? 'region' : undefined} aria-label={showPrivateClaimQr ? 'Private claim scan code' : undefined} hidden={!showPrivateClaimQr} className={showPrivateClaimQr ? 'mt-4 flex flex-col items-center rounded-xl border border-[rgba(16,42,67,.12)] bg-white/80 p-4 focus:outline-none focus:ring-2 focus:ring-[#2b45f7] focus:ring-offset-2' : 'hidden'}>
              {showPrivateClaimQr && <>
                <div className="max-w-full rounded-lg bg-white p-3" role="img" aria-label="QR code for the private claim link">
                  <QRCodeSVG value={privateClaimUrl} size={216} level="M" includeMargin />
                </div>
                <p className="mt-3 max-w-sm text-center text-xs leading-relaxed text-ink-navy">Anyone who scans this code can claim the drop. The code expires with the private link.</p>
              </>}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setShowPrivateClaimQr((visible) => !visible)} disabled={sharingInvite || sending} aria-expanded={showPrivateClaimQr} aria-controls="private-claim-qr" className="button-secondary !min-h-12 !rounded-xl disabled:opacity-50">{showPrivateClaimQr ? 'Hide scan code' : 'Show scan code'}</button>
              <button type="button" onClick={() => void copyPrivateClaimInvite()} disabled={sharingInvite || sending} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">Copy private link</button>
            </div>
            <button type="button" onClick={() => void sharePreparedPrivateClaimInvite()} disabled={sharingInvite || sending} className="button-secondary mt-2 !min-h-12 w-full !rounded-xl disabled:opacity-50">{sharingInvite ? 'Opening share…' : 'Share private link'}</button>
          </div>}
          {inviteNotice && <p className="field-help mt-3" role="status" aria-live="polite">{inviteNotice}</p>}
          <Link href={privateClaimDetailsHref} onClick={saveBeforeLeaving} aria-disabled={shareImporting} className="button-secondary mt-5 !min-h-12 !rounded-xl aria-disabled:cursor-wait">Open saved drop <ArrowRightIcon /></Link>
        </section> : <form onSubmit={handleSend} aria-busy={deleting || sending || shareImporting} className="composer-form mt-6 sm:mt-8">
          <fieldset disabled={deleting || sending || shareImporting} aria-label="Compose drop" className="m-0 min-w-0 space-y-4 border-0 p-0 sm:space-y-5">
          <section className="rounded-2xl border border-[rgba(16,42,67,.12)] bg-white/55 p-4 sm:p-6">
            <p className="eyebrow">First · your person</p>
            {shareWithoutHandle ? <div ref={recipientlessPanelRef} role="region" aria-labelledby="unaddressed-claim-title" tabIndex={-1} className="mt-2 rounded-xl border border-[#e9d6c7] bg-[#fff6ec] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b45f7]">
              <h3 id="unaddressed-claim-title" className="text-sm font-semibold text-ink-navy">Let them choose a handle later.</h3>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">They can sign in or join Drop, choose a handle if they are new, and claim this drop from the link.</p>
              <p className="mt-2 rounded-lg border border-[rgba(16,42,67,.12)] bg-white/75 p-3 text-xs leading-relaxed text-on-surface-variant">Anyone holding the link can claim this drop, so share it directly with the person you have in mind.</p>
              <button type="button" onClick={chooseHandleInstead} disabled={sharingInvite || sending} className="button-secondary mt-3 !min-h-12 w-full !rounded-xl disabled:opacity-50">Use a Drop handle instead</button>
              {deliveryMode === 'relay' && <div className="mt-3 rounded-lg border border-[rgba(16,42,67,.12)] bg-[#eef1ff] p-3">
                <p className="text-xs leading-relaxed text-on-surface-variant">Private claim links use Instant delivery. Relay needs an existing Drop handle.</p>
                {canSwitchToInstantClaim && <button type="button" onClick={switchToInstantForPrivateClaim} disabled={sharingInvite || sending || deleting} className="button-secondary mt-3 !min-h-12 w-full !rounded-xl disabled:opacity-50">Switch to Instant for a private link</button>}
              </div>}
              {canSendPrivateClaim ? <div className="mt-3 rounded-lg border border-[rgba(16,42,67,.12)] bg-[#eef1ff] p-3">
                <p className="text-sm font-semibold text-ink-navy">Share this private {privateClaimPayloadLabel} link</p>
                {payloadKind === 'text'
                  ? <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">The link lasts 7 days.</p>
                  : <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">The link {getClaimInviteExpiryDuration(payloadKind)}. If unclaimed after 30 days, access ends and Drop queues the attachment for deletion. A paused free project or worker outage can delay removal.</p>}
                <button ref={privateClaimButtonRef} type="button" onClick={() => void sharePrivateClaimInvite()} disabled={sharingInvite || sending || deleting} className="button-primary mt-3 !min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">
                  <Share2 className="h-4 w-4" aria-hidden="true" />{privateClaimAction === 'share' ? 'Preparing private link…' : 'Share private link'}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">A scan code contains this same private link. Anyone who scans it can claim the drop.</p>
                <button type="button" onClick={() => void sharePrivateClaimInvite('qr')} disabled={sharingInvite || sending || deleting} className="button-secondary mt-2 !min-h-12 w-full !rounded-xl disabled:opacity-50">
                  <QrCode className="h-4 w-4" aria-hidden="true" />{privateClaimAction === 'qr' ? 'Creating scan code…' : 'Show scan code'}
                </button>
              </div> : !canSwitchToInstantClaim && <p className="field-help mt-3" role="status">{privateClaimReadinessMessage}</p>}
              {privateClaimUrl && <div className="mt-3 rounded-lg border border-[rgba(16,42,67,.12)] bg-white/75 p-3">
                <p className="text-sm font-semibold text-ink-navy">Your private link is ready, but not shared yet.</p>
                <code tabIndex={0} aria-label="Select and copy this private claim link" className="mt-2 block select-all break-all rounded-lg bg-white px-2 py-2 font-mono text-[0.68rem] text-ink-navy">{privateClaimUrl}</code>
                <button type="button" onClick={() => void copyPrivateClaimInvite()} className="button-primary mt-3 !min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">Copy private link</button>
              </div>}
              {inviteNotice && <p className="field-help mt-3 break-words" role="status" aria-live="polite">{inviteNotice}</p>}
            </div> : <>
            <label htmlFor="drop-recipient" className="field-label mt-1 block">Who should get this drop?</label>
            <div className="mt-2 flex items-center rounded-xl border border-[rgba(16,42,67,.14)] bg-white px-3 focus-within:ring-2 focus-within:ring-[#2b45f7]/35">
              <span className="font-mono text-sm font-bold text-[#2b45f7]">@</span>
              <input ref={recipientInputRef} id="drop-recipient" value={recipient.replace(/^@/, '')} onChange={handleRecipientChange} disabled={sending || sharingInvite} className="min-h-12 min-w-0 flex-1 border-0 bg-transparent px-2 text-base text-ink-navy outline-none placeholder:text-on-surface-variant/60 disabled:opacity-60" placeholder="their.username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={recipientHasValue && !recipientUsername} aria-describedby={recipientHasValue && !recipientUsername ? 'drop-recipient-help drop-recipient-error' : 'drop-recipient-help'} />
            </div>
            <p id="drop-recipient-help" className="field-help mt-2">They need a Drop account to open a drop. If they don’t have one yet, you can share a private claim link. Handles use 2–24 letters, numbers, periods, underscores, or hyphens.</p>
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
            {!recipientUsername && <div className="mt-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-3">
              <p className="text-sm font-semibold text-ink-navy">No handle yet?</p>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">Share a private link; they can choose a Drop handle if they are new.</p>
              <button type="button" onClick={chooseLinkWithoutHandle} disabled={sharingInvite || sending || deleting} className="button-secondary mt-3 !min-h-12 w-full !rounded-xl disabled:opacity-50">Share without a handle</button>
            </div>}
            {recipientCheck.status === 'checking' && recipientCheck.username === recipientUsername && <p className="field-help mt-2" role="status" aria-live="polite">Checking @{recipientUsername}…</p>}
            {confirmedRecipient && <p className="mt-2 text-sm font-semibold text-[#26734f]" role="status" aria-live="polite">Recipient confirmed: {confirmedRecipient.displayName} (@{confirmedRecipient.username})</p>}
            {recipientCheck.status === 'not-found' && recipientCheck.username === recipientUsername && <>
              <p className="mt-2 rounded-lg border border-[#e9d6c7] bg-[#fff6ec] px-3 py-2 text-sm text-ink-navy" role="status" aria-live="polite">No Drop account found for @{recipientUsername} yet.</p>
              <div className="mt-3 rounded-xl border border-[rgba(16,42,67,.12)] bg-white/75 p-3">
                {!pendingInvite && <p className="text-xs leading-relaxed text-on-surface-variant">{canSendPrivateClaim ? `Send this instant ${privateClaimPayloadLabel} with a private link, or invite them to Drop and check their handle again.` : canSwitchToInstantClaim ? 'Relay needs an existing Drop account. Switch to Instant for a private claim link, or invite them to join and check their handle again.' : 'Your draft stays here. Invite them to Drop, then check their handle again. Private claim links are for instant notes or attached photos and GIFs.'}</p>}
                {canSwitchToInstantClaim && <div className="mt-3 rounded-lg border border-[rgba(16,42,67,.12)] bg-[#eef1ff] p-3">
                  <p className="text-sm font-semibold text-ink-navy">Want to share a private link instead?</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">Your draft and any saved attachment stay in place. This only changes delivery mode; nothing is shared until you choose the separate private-link action.</p>
                  <button type="button" onClick={switchToInstantForPrivateClaim} disabled={sharingInvite || sending || deleting} className="button-secondary mt-3 !min-h-12 w-full !rounded-xl disabled:opacity-50">
                    Switch to Instant for a private link
                  </button>
                </div>}
                {canSendPrivateClaim && <div className="rounded-lg bg-[#eef1ff] p-3">
                  <p className="text-sm font-semibold text-ink-navy">Send this {privateClaimPayloadLabel} with a private link</p>
                  <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">The drop stays sealed until they sign in, set up a Drop handle, and claim it. Anyone holding the link can claim it.</p>
                  {payloadKind === 'text'
                    ? <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">The link lasts 7 days.</p>
                    : <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">The link {getClaimInviteExpiryDuration(payloadKind)}. If unclaimed after 30 days, the claim and media access end and Drop queues the attachment for deletion. Cleanup can be delayed if the free project is paused or unavailable. A fresh link won’t extend the cutoff.</p>}
                  <button ref={privateClaimButtonRef} type="button" onClick={() => void sharePrivateClaimInvite()} disabled={sharingInvite || sending || deleting} className="button-primary mt-3 !min-h-12 w-full !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">
                    <Share2 className="h-4 w-4" aria-hidden="true" />{privateClaimAction === 'share' ? 'Preparing private link…' : `Send a private ${privateClaimPayloadLabel} link`}
                  </button>
                  <p className="mt-3 text-xs leading-relaxed text-on-surface-variant">A scan code contains this same private link. Anyone who scans it can claim the drop.</p>
                  <button type="button" onClick={() => void sharePrivateClaimInvite('qr')} disabled={sharingInvite || sending || deleting} className="button-secondary mt-2 !min-h-12 w-full !rounded-xl disabled:opacity-50">
                    <QrCode className="h-4 w-4" aria-hidden="true" />{privateClaimAction === 'qr' ? 'Creating scan code…' : 'Show scan code'}
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
            </>}
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
            <section className="media-picker-surface overflow-hidden rounded-2xl border border-[rgba(16,42,67,.14)] bg-white/60">
              {previewUrl ? (
                <div className="relative aspect-[4/3] max-h-[430px] overflow-hidden bg-[#ede8df]">
                  <ReducedMotionGif src={previewUrl} alt={getDropMediaAccessibleName(payloadKind === 'gif' ? 'gif' : 'image')} animated={payloadKind === 'gif'} sizes="(max-width: 760px) 100vw, 760px" className="object-contain" />
                  <button type="button" aria-label="Remove attachment" disabled={attachmentSaving} onClick={() => { setFile(null); setAttachmentSaved(false); setAttachmentFormatError(''); attachmentChosenRef.current = true; if (draft) void deleteDraftAttachment(draft.id).catch(() => undefined); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              ) : (
                <label htmlFor="drop-media" className="flex min-h-[190px] cursor-pointer flex-col items-center justify-center gap-3 px-5 py-8 text-center sm:min-h-[240px]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]"><ImagePlus className="h-5 w-5" aria-hidden="true" /></span>
                  <span><span className="block text-sm font-bold text-ink-navy">Tap to add a {payloadKind === 'gif' ? 'GIF' : 'photo or meme'}</span><span className="mt-1 block text-xs text-on-surface-variant">JPG, PNG, WebP, or GIF · up to 8 MB</span></span>
                </label>
              )}
              <input ref={fileInputRef} id="drop-media" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFile} onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) event.currentTarget.closest('.media-picker-surface')?.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); }} className="sr-only" aria-label={`Choose a ${payloadKind === 'gif' ? 'GIF' : 'photo'}`} />
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

          <div className={`composer-action-tray${deletableDraft ? ' composer-action-tray--with-delete' : ''}`} role="group" aria-label="Drop actions">
            <Link href={draft ? `/compose/preview?letter=${encodeURIComponent(draft.id)}` : '/compose/preview'} onClick={saveBeforeLeaving} aria-label="Preview as recipient" aria-disabled={shareImporting} className="button-secondary composer-action-preview !min-h-12 !rounded-xl aria-disabled:cursor-wait"><Eye className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Preview as recipient</span><span className="sm:hidden" aria-hidden="true">Preview</span></Link>
            <div className="composer-action-footer">
              <div className="composer-action-secondary">
                <button type="button" onClick={handleSave} aria-label={saveLabel} className="button-secondary composer-action-save !min-h-12 !rounded-xl"><span className="hidden sm:inline">{saveLabel}</span><span className="sm:hidden" aria-hidden="true">{saved ? 'Saved' : 'Save'}</span></button>
                {deletableDraft && <button type="button" onClick={handleDelete} disabled={deleting || sending || attachmentSaving} aria-label={deleting ? 'Deleting draft' : 'Delete draft'} className="button-secondary composer-action-delete !min-h-12 !rounded-xl !border-[#e6c7bd] !text-[#9e4038] disabled:opacity-45"><Trash2 className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{deleting ? 'Deleting…' : 'Delete draft'}</span><span className="sm:hidden" aria-hidden="true">{deleting ? 'Deleting…' : 'Delete'}</span></button>}
              </div>
              {accountState === 'connected' ? <button type="submit" disabled={!complete || sending || deleting || attachmentSaving || shareImporting} className="button-primary composer-action-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-45"><span aria-live="polite" aria-atomic="true">{sending ? sendProgressLabel : 'Send drop'}</span> <Send className="h-4 w-4" aria-hidden="true" /></button> : <Link href={profileHref} onClick={saveBeforeLeaving} aria-disabled={shareImporting || deleting || attachmentSaving || Boolean(file && !attachmentSaved)} className="button-primary composer-action-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">{accountState === 'unavailable' ? 'Account options' : 'Connect to send'} <Send className="h-4 w-4" aria-hidden="true" /></Link>}
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
