import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <p className="font-caption text-caption uppercase tracking-widest text-on-surface-variant">404</p>
      <h1 className="mt-3 font-headline-lg text-headline-lg text-primary">This page is not in the mailbox.</h1>
      <p className="mt-3 max-w-md font-body-md text-on-surface-variant">
        The letter you are looking for may have moved on.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-sm bg-ink-navy px-6 py-3 font-label-md uppercase tracking-widest text-surface-bright transition-colors hover:bg-ink-navy/90"
      >
        Return to desk
      </Link>
    </main>
  );
}
