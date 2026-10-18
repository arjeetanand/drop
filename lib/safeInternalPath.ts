export function safeInternalPath(value: string | null, origin: string): string | null {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  const url = new URL(value, origin);
  if (url.origin !== origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
