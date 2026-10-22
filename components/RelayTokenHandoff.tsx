'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MapPin, Navigation, ShieldCheck } from 'lucide-react';
import { acceptRelayHandoffToken } from '@/lib/relayStore';
import { saveActiveCarry } from '@/lib/gpsUtils';
import { getLocalAccountId, isCurrentLocalAccount } from '@/lib/localAccountScope';
import { isRelayToken } from '@/lib/relayValidation';

interface RelayTokenHandoffProps {
  token: string;
  destination: string;
  backHref: string;
  method: 'QR' | 'link';
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('This browser cannot create a secure handoff request. Open the invite in a current browser.');
}

export function RelayTokenHandoff({ token, destination, backHref, method }: RelayTokenHandoffProps) {
  const requestIdRef = useRef('');
  const [name, setName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const handleAccept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!isRelayToken(token)) {
      setError('This carrier invite is incomplete. Ask the sender to create a fresh link.');
      return;
    }

    const accountId = getLocalAccountId();
    setAccepting(true);
    try {
      // Keep this ID for retries so a lost response cannot create a duplicate handoff.
      requestIdRef.current ||= newRequestId();
      const area = neighborhood.trim() || 'Nearby area';
      const result = await acceptRelayHandoffToken({
        token,
        requestId: requestIdRef.current,
        name: name.trim(),
        neighborhood: area,
        note: note.trim() || undefined,
      });

      saveActiveCarry({
        letterId: result.letterId,
        subject: 'A sealed drop',
        recipient: destination || 'Recipient area',
        acceptedAt: new Date().toISOString(),
        waypoints: [],
        destinationNeighborhood: destination || 'Recipient area',
        successorToken: result.successorToken,
        successorExpiresAt: result.successorExpiresAt,
      }, accountId);
      if (!isCurrentLocalAccount(accountId)) return;
      setAccepted(true);
    } catch (acceptError) {
      if (isCurrentLocalAccount(accountId)) {
        setError(acceptError instanceof Error ? acceptError.message : 'This handoff could not be accepted. Try the invite again.');
      }
    } finally {
      setAccepting(false);
    }
  };

  if (accepted) {
    return (
      <section className="mt-8 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="eyebrow text-[#2b45f7]">You’re in the relay</p>
            <h2 className="mt-2 font-headline-md text-2xl text-ink-navy">A sealed drop is in your care.</h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              Your place is recorded as {neighborhood.trim() || 'Nearby area'}. The drop stays sealed while you carry it toward {destination || 'the recipient area'}.
            </p>
            <Link
              href="/relay/carry"
              className="button-primary mt-5 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white"
            >
              Open carrier view <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-7">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true">
          {method === 'QR' ? <Navigation className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
        </span>
        <div>
          <p className="eyebrow text-[#2b45f7]">{method} handoff</p>
          <h2 className="mt-2 font-headline-md text-2xl text-ink-navy">Add your hand to the route.</h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            You’ll carry a sealed drop toward {destination || 'the recipient area'}. Type a neighborhood if you like; this invite does not access your device location.
          </p>
        </div>
      </div>

      <form onSubmit={handleAccept}>
        <div className="space-y-5">
          <label htmlFor="relay-carrier-name" className="field-label">
            Your name <span className="text-[#b84b3a]">*</span>
            <input
              id="relay-carrier-name"
              required
              maxLength={60}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="input-field mt-2 !min-h-12 !rounded-xl"
              placeholder="Your name"
            />
          </label>

          <label htmlFor="relay-carrier-neighborhood" className="field-label">
            Neighborhood <span className="font-normal text-on-surface-variant">(optional)</span>
            <input
              id="relay-carrier-neighborhood"
              maxLength={120}
              value={neighborhood}
              onChange={(event) => setNeighborhood(event.target.value)}
              className="input-field mt-2 !min-h-12 !rounded-xl"
              placeholder="Nearby area"
            />
            <span className="field-help mt-2 block">Optional. Type a neighborhood label; no device location is requested.</span>
          </label>

          <label htmlFor="relay-carrier-note" className="field-label block">
            Note for the next carrier <span className="font-normal text-on-surface-variant">(optional)</span>
            <textarea
              id="relay-carrier-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="textarea-field mt-2 min-h-[5.5rem] !rounded-xl"
              placeholder="A short note about the handoff"
            />
          </label>
        </div>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-on-surface-variant">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" />
          Your neighborhood label is optional. We never show the drop’s text or media to carriers.
        </p>
        {error && <p className="notice error-notice mt-5" role="alert" aria-live="assertive">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Link href={backHref} className="button-quiet !min-h-12 !rounded-xl">Back</Link>
          <button type="submit" disabled={accepting || !name.trim()} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">
            {accepting ? 'Joining the relay…' : 'Accept sealed drop'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
