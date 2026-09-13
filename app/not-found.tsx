import Link from 'next/link';
import { ArrowLeft, MailSearch } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="page-shell page-enter">
      <div className="page-container flex min-h-[72dvh] items-center justify-center">
        <section className="panel w-full max-w-[620px] p-8 text-center sm:p-12">
          <MailSearch className="mx-auto h-8 w-8 text-[#b84b3a]" aria-hidden="true" />
          <p className="eyebrow mt-6">404 · Unposted address</p>
          <h1 className="display-title mt-4">This page is not in the mailbox.</h1>
          <p className="body-copy mx-auto mt-5 max-w-md">
            The letter or profile you are looking for may have moved on. Let&apos;s take you back to the desk.
          </p>
          <Link
            href="/"
            className="button-primary mt-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Return to desk
          </Link>
        </section>
      </div>
    </main>
  );
}
