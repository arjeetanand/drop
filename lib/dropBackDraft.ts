import { normalizeDropRecipient } from './dropValidation.ts';
import { startNewLetter } from './letterStore.ts';

export function startDropBackDraft(senderUsername: string) {
  const recipient = normalizeDropRecipient(senderUsername);
  if (!recipient) throw new Error('The sender handle is unavailable. Open the drop again and try once more.');

  const draft = startNewLetter({ forceNew: true, requirePreserved: true });
  return {
    draft,
    composeHref: `/compose?letter=${encodeURIComponent(draft.id)}&recipient=${encodeURIComponent(`@${recipient}`)}`,
  };
}
