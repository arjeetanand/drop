'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, MapPin, Navigation, ShieldCheck } from 'lucide-react';
import { acceptRelayHandoffToken } from '@/lib/relayStore';
import { getActiveCarry, saveActiveCarry } from '@/lib/gpsUtils';
import { getLocalAccountId, isCurrentLocalAccount } from '@/lib/localAccountScope';
import {
  clearRelayAcceptanceAttempt,
  getRelayAcceptanceRecoveryKey,
  readRelayAcceptanceAttempt,
  saveRelayAcceptanceAttempt,
} from '@/lib/relayAcceptanceRecovery';
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

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function RelayTokenHandoff({ token, destination, backHref, method }: RelayTokenHandoffProps) {
  const requestIdRef = useRef('');
  const recoveryStorageKeyRef = useRef<string | null>(null);
  const recoveryAccountIdRef = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');

  useEffect(() => {
    let active = true;
    const accountId = getLocalAccountId();

    requestIdRef.current = '';
    recoveryStorageKeyRef.current = null;
    recoveryAccountIdRef.current = accountId;
    setName('');
    setNeighborhood('');
    setNote('');
    setError('');
    setRetryLocked(false);
    setRecoveryNotice('');
    setRecoveryReady(false);

    void getRelayAcceptanceRecoveryKey(token, accountId).then((key) => {
      if (!active) return;

      recoveryStorageKeyRef.current = key;
      const storage = key ? getSessionStorage() : null;
      const attempt = storage && key ? readRelayAcceptanceAttempt(storage, key) : null;
      if (attempt) {
        requestIdRef.current = attempt.requestId;
        setName(attempt.name);
        setNeighborhood(attempt.neighborhood);
        setNote(attempt.note);
        setRetryLocked(true);
        setRecoveryNotice('We saved your last handoff attempt in this tab for up to 24 hours. Retry with the same details to continue it safely.');
      }
      setRecoveryReady(true);
    });

    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!recoveryReady) {
      setError('Preparing a safe retry. Please try again in a moment.');
      return;
    }
    if (!isRelayToken(token)) {
      setError('This carrier invite is incomplete. Ask the sender to create a fresh link.');
      return;
    }

    const accountId = getLocalAccountId();
    if (accountId !== recoveryAccountIdRef.current) {
      setError('Your Drop account changed while this invite was open. Reload the invite to continue.');
      return;
    }

    setAccepting(true);
    try {
      const attempt = {
        requestId: requestIdRef.current || newRequestId(),
        name: name.trim(),
        neighborhood: neighborhood.trim(),
        note: note.trim(),
        savedAt: Date.now(),
      };
      requestIdRef.current = attempt.requestId;

      const key = recoveryStorageKeyRef.current;
      const storage = key ? getSessionStorage() : null;
      const savedForRetry = Boolean(key && storage && saveRelayAcceptanceAttempt(storage, key, attempt));
      setRetryLocked(true);
      setRecoveryNotice(savedForRetry
        ? 'If the response is interrupted, your retry details are saved in this tab.'
        : 'This browser could not save retry details. Keep this tab open until the handoff is confirmed.');

      const result = await acceptRelayHandoffToken({
        token,
        requestId: attempt.requestId,
        name: attempt.name,
        neighborhood: attempt.neighborhood || 'Nearby area',
        note: attempt.note || undefined,
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

      const savedCarry = getActiveCarry(accountId);
      if (savedCarry?.letterId !== result.letterId || savedCarry.successorToken !== result.successorToken) {
        throw new Error('The handoff was accepted, but this device could not save your carrier pass. Retry in this tab.');
      }

      if (key && storage) clearRelayAcceptanceAttempt(storage, key);
      requestIdRef.current = '';
      setRecoveryNotice('');
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
            Name shown on the route <span className="text-[#b84b3a]">*</span>
            <input
              id="relay-carrier-name"
              required
              maxLength={60}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              readOnly={retryLocked}
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
              readOnly={retryLocked}
              className="input-field mt-2 !min-h-12 !rounded-xl"
              placeholder="Nearby area"
            />
            <span className="field-help mt-2 block">Optional. Type a neighborhood label; no device location is requested.</span>
          </label>

          <label htmlFor="relay-carrier-note" className="field-label block">
            A note for the next carrier <span className="font-normal text-on-surface-variant">(optional)</span>
            <textarea
              id="relay-carrier-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              readOnly={retryLocked}
              className="textarea-field mt-2 min-h-[5.5rem] !rounded-xl"
              placeholder="What would you like them to know?"
            />
          </label>
        </div>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-on-surface-variant">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" />
          Carrier names are entered by each person and are not verified against a Drop account. Your note and neighborhood appear on the route; the drop’s text and media stay private.
        </p>
        {recoveryNotice && <p className="mt-4 rounded-xl bg-[#2b45f7]/5 px-3 py-2 text-sm leading-relaxed text-on-surface-variant" role="status" aria-live="polite">{recoveryNotice}</p>}
        {error && <p className="notice error-notice mt-5" role="alert" aria-live="assertive">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Link href={backHref} className="button-quiet !min-h-12 !rounded-xl">Back</Link>
          <button type="submit" disabled={accepting || !name.trim() || !recoveryReady} className="button-primary !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white disabled:opacity-50">
            {accepting ? 'Joining the relay…' : retryLocked ? 'Retry same handoff' : 'Accept sealed drop'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
