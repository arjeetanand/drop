const privateShellPaths = ['/mailbox', '/journey', '/profile', '/sent', '/compose', '/letter', '/relay'];

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function usesPrivateShell(pathname: string | null) {
  return pathname === null || pathname === '/' || privateShellPaths.some((path) => matchesPath(pathname, path));
}

export function getActiveNavigationHref(pathname: string | null) {
  if (!pathname) return null;
  if (pathname === '/' || matchesPath(pathname, '/compose')) return '/';
  if (matchesPath(pathname, '/mailbox') || matchesPath(pathname, '/sent')) return '/mailbox';
  if (matchesPath(pathname, '/journey') || matchesPath(pathname, '/relay')) return '/journey';
  if (matchesPath(pathname, '/profile')) return '/profile';
  return null;
}
