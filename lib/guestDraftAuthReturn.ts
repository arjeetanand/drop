export interface TransferableGuestDraft {
  id: string;
}

export type GuestDraftAuthReturnResult =
  | { status: 'ready'; nextPath: string; draftId: string }
  | { status: 'retry' };

export async function isAuthAccountCurrent(
  accountId: string,
  getSession: () => Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>,
) {
  try {
    if (!accountId) return false;
    const { data, error } = await getSession();
    return !error && data.session?.user.id === accountId;
  } catch {
    return false;
  }
}

function composeReturnUrl(nextPath: string, draftId: string) {
  const url = new URL(nextPath, 'https://drop.invalid');
  if (url.origin !== 'https://drop.invalid'
    || url.pathname !== '/compose'
    || url.searchParams.get('letter') !== draftId) {
    return null;
  }
  return url;
}

function readyResult(url: URL, draftId: string): GuestDraftAuthReturnResult {
  url.searchParams.set('letter', draftId);
  return {
    status: 'ready',
    nextPath: `${url.pathname}${url.search}${url.hash}`,
    draftId,
  };
}

/** Allow an existing compose return only when the requested draft is account-owned. */
export function resolveStoredDraftAuthReturn(
  nextPath: string,
  draftId: string,
  accountId: string,
  readAccountDraft: (draftId: string, accountId: string) => TransferableGuestDraft | null,
): GuestDraftAuthReturnResult {
  try {
    const url = composeReturnUrl(nextPath, draftId);
    if (!url) return { status: 'retry' };
    const persistedDraft = readAccountDraft(draftId, accountId);
    if (!persistedDraft || persistedDraft.id !== draftId) return { status: 'retry' };
    return readyResult(url, persistedDraft.id);
  } catch {
    return { status: 'retry' };
  }
}

/** Copy a guest draft and allow its auth return only after account-scoped readback. */
export async function resolveGuestDraftAuthReturn(
  nextPath: string,
  draftId: string,
  accountId: string,
  copyDraft: (draftId: string, accountId: string) => Promise<TransferableGuestDraft | null>,
  readAccountDraft: (draftId: string, accountId: string) => TransferableGuestDraft | null,
): Promise<GuestDraftAuthReturnResult> {
  try {
    const url = composeReturnUrl(nextPath, draftId);
    if (!url) return { status: 'retry' };

    const copiedDraft = await copyDraft(draftId, accountId);
    if (!copiedDraft?.id) return { status: 'retry' };

    const persistedDraft = readAccountDraft(copiedDraft.id, accountId);
    if (!persistedDraft || persistedDraft.id !== copiedDraft.id) return { status: 'retry' };

    return readyResult(url, persistedDraft.id);
  } catch {
    return { status: 'retry' };
  }
}
