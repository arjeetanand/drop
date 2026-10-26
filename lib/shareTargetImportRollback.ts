import { deleteDraftAttachmentForCurrentAccount } from './letterMediaStore.ts';
import { isCurrentLocalAccount } from './localAccountScope.ts';
import { getLetterDraft, isLetterDraftPersisted, setActiveLetterDraft, type LetterDraftState } from './letterStore.ts';

export type ShareTargetImportRollbackContext = {
  accountId: string | null | undefined;
  previousActiveDraft: LetterDraftState | null;
  activatedDraftIds: Set<string>;
  newlyWrittenAttachmentDraftId: string | null;
};

export type ShareTargetImportRollbackResult = {
  activeDraftRestoreFailed: boolean;
  preserveCommittedImportForCapturedAccount: boolean;
};

/** Reverts import writes on failure while leaving its handoff available for retry. */
export async function rollbackShareTargetImport(
  context: ShareTargetImportRollbackContext,
  deleteAttachment: (draftId: string) => Promise<'deleted' | 'account-switched' | void> = deleteDraftAttachmentForCurrentAccount,
): Promise<ShareTargetImportRollbackResult> {
  let activeDraftRestoreFailed = false;
  const rollbackAccountId = context.accountId;
  if (rollbackAccountId === undefined) {
    return { activeDraftRestoreFailed, preserveCommittedImportForCapturedAccount: false };
  }

  let preserveCommittedImportForCapturedAccount = Boolean(context.newlyWrittenAttachmentDraftId)
    && !isCurrentLocalAccount(rollbackAccountId);

  if (isCurrentLocalAccount(rollbackAccountId) && context.newlyWrittenAttachmentDraftId) {
    try {
      const deletion = await deleteAttachment(context.newlyWrittenAttachmentDraftId);
      preserveCommittedImportForCapturedAccount = deletion === 'account-switched';
    } catch {
      // Keep a committed attachment reachable if cleanup could not confirm its deletion.
      preserveCommittedImportForCapturedAccount = true;
    }
  }

  if (context.previousActiveDraft && !preserveCommittedImportForCapturedAccount) {
    try {
      const currentActiveDraft = getLetterDraft(rollbackAccountId);
      if (context.activatedDraftIds.has(currentActiveDraft.id)) {
        const restoredDraft = setActiveLetterDraft(context.previousActiveDraft, rollbackAccountId);
        activeDraftRestoreFailed = !isLetterDraftPersisted(restoredDraft, rollbackAccountId);
      }
    } catch {
      activeDraftRestoreFailed = true;
    }
  }

  return { activeDraftRestoreFailed, preserveCommittedImportForCapturedAccount };
}
