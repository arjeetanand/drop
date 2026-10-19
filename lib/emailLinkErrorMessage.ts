const EMAIL_LINK_ERROR_FALLBACK = 'A sign-in link could not be sent. Check your connection and try again.';

export function emailLinkErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.name !== 'AuthApiError') return EMAIL_LINK_ERROR_FALLBACK;

  return error.message.trim() || EMAIL_LINK_ERROR_FALLBACK;
}
