export type ComposerNavigationBlockReason =
  | 'deleting'
  | 'sending'
  | 'sharing-invite'
  | 'share-importing'
  | 'saving-attachment'
  | 'unsaved-attachment';

export type ComposerNavigationState = {
  deleting: boolean;
  sending: boolean;
  sharingInvite: boolean;
  shareImporting: boolean;
  attachmentSaving: boolean;
  unsavedAttachment: boolean;
};

export function getComposerNavigationBlockReason(
  state: ComposerNavigationState,
): ComposerNavigationBlockReason | null {
  if (state.deleting) return 'deleting';
  if (state.sending) return 'sending';
  if (state.sharingInvite) return 'sharing-invite';
  if (state.shareImporting) return 'share-importing';
  if (state.attachmentSaving) return 'saving-attachment';
  if (state.unsavedAttachment) return 'unsaved-attachment';
  return null;
}

const NAVIGATION_BLOCK_NOTICES: Partial<Record<ComposerNavigationBlockReason, string>> = {
  sending: 'Drop is finishing this step… Keep this screen open until the result appears.',
  'sharing-invite': 'Opening your share options… Keep Drop open until you return.',
  'share-importing': 'Adding the shared image to a draft… Keep Drop open for a moment.',
  'saving-attachment': 'Saving your attachment on this device…',
  'unsaved-attachment': 'This browser cannot save attachments between screens. Remove it, connect your account, then add it again.',
};

export function guardComposerNavigation(
  event: { preventDefault: () => void },
  state: ComposerNavigationState,
  setNotice: (message: string) => void,
): boolean {
  const reason = getComposerNavigationBlockReason(state);
  if (!reason) return false;

  event.preventDefault();
  const message = NAVIGATION_BLOCK_NOTICES[reason];
  if (message) setNotice(message);
  return true;
}
