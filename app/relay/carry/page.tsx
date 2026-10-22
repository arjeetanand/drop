'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, MapPin, Package, QrCode, RefreshCcw, Share2, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { clearActiveCarry, getActiveCarry, type ActiveCarry } from '@/lib/gpsUtils';
import { getCarrierRelayRoute, getRelayHandoffStatus, issueRelayPassFromCarrier, type CarrierRelayRouteEvent, type RelayHandoffStatus, type IssuedRelayToken } from '@/lib/relayStore';
import { getLocalAccountId, isCurrentLocalAccount } from '@/lib/localAccountScope';
import { buildRelayScanUrl } from '@/lib/relayInviteUrl';
import { shareInviteLink } from '@/lib/shareInvite';

type CarryPhase = 'loading' | 'carrying' | 'pass-on' | 'confirmed' | 'unavailable';

function CarryContent() {
  const searchParams = useSearchParams();
  const requestedLetterId = searchParams.get('letter');
  const [phase, setPhase] = useState<CarryPhase>('loading');
  const [carry, setCarry] = useState<ActiveCarry | null>(null);
  const [pass, setPass] = useState<IssuedRelayToken | null>(null);
  const [route, setRoute] = useState<CarrierRelayRouteEvent[] | null>();
  const [now, setNow] = useState(Date.now());
  const [acceptedBy, setAcceptedBy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const activeCarry = getActiveCarry(getLocalAccountId());
    if (activeCarry && (!requestedLetterId || activeCarry.letterId === requestedLetterId)) {
      setCarry(activeCarry);
      setPhase('carrying');
    } else {
      setCarry(null);
      setPhase('unavailable');
    }
  }, [requestedLetterId]);

  useEffect(() => {
    let active = true;
    setRoute(undefined);
    if (!carry?.successorToken) {
      setRoute(null);
      return () => { active = false; };
    }
    void getCarrierRelayRoute(carry.successorToken).then((events) => {
      if (active) setRoute(events);
    });
    return () => { active = false; };
  }, [carry?.successorToken]);

  useEffect(() => {
    if ((phase !== 'pass-on' && phase !== 'carrying') || !pass) return;
    const accountId = getLocalAccountId();
    setNow(Date.now());
    const countdown = window.setInterval(() => setNow(Date.now()), 1000);
    let active = true;
    const checkAcceptance = async () => {
      if (Date.parse(pass.expiresAt) <= Date.now()) return;
      const status: RelayHandoffStatus | null = await getRelayHandoffStatus(pass.token);
      if (!active || !status?.accepted) return;
      clearActiveCarry(accountId);
      if (!isCurrentLocalAccount(accountId)) return;
      setAcceptedBy(status.acceptedBy || 'the next carrier');
      setPhase('confirmed');
    };
    void checkAcceptance();
    const polling = window.setInterval(() => void checkAcceptance(), 3000);
    return () => {
      active = false;
      window.clearInterval(countdown);
      window.clearInterval(polling);
    };
  }, [pass, phase]);

  const letterId = carry?.letterId || requestedLetterId || '';
  const destination = carry?.destinationNeighborhood || carry?.recipient || searchParams.get('dest') || 'the recipient area';
  const remainingMs = pass ? Math.max(0, Date.parse(pass.expiresAt) - now) : 0;
  const expired = remainingMs <= 0;
  const passUrl = pass && typeof window !== 'undefined'
    ? buildRelayScanUrl(window.location.origin, { token: pass.token, letterId, destination })
    : '';

  const handlePassOn = async () => {
    if (pass && Date.parse(pass.expiresAt) > Date.now()) {
      setPhase('pass-on');
      return;
    }
    if (!carry?.successorToken) {
      setError('This carry came from an older invite and cannot create a secure pass. Ask the sender to issue a fresh carrier invite.');
      return;
    }
    setError('');
    setNotice('');
    setIssuing(true);
    try {
      const nextPass = await issueRelayPassFromCarrier(carry.successorToken);
      setPass(nextPass);
      setNow(Date.now());
      setPhase('pass-on');
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'A handoff code could not be created. Try again.');
    } finally {
      setIssuing(false);
    }
  };

  const handleRefreshPass = async () => {
    if (!carry?.successorToken) return;
    setIssuing(true);
    setError('');
    try {
      const nextPass = await issueRelayPassFromCarrier(carry.successorToken);
      setPass(nextPass);
      setNow(Date.now());
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'A fresh code could not be created. Try again.');
    } finally {
      setIssuing(false);
    }
  };

  const sharePassLink = async () => {
    if (!passUrl) return;

    const result = await shareInviteLink(
      passUrl,
      navigator.share ? (details) => navigator.share(details) : undefined,
      async (url) => {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
      },
    );
    if (result === 'shared') {
      setCopied(false);
      setNotice('Secure invite shared. It expires in 10 minutes.');
    } else if (result === 'copied') {
      setCopied(true);
      setNotice('Secure invite link copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } else if (result === 'unavailable') setNotice('Sharing is unavailable here. The QR code is ready to scan.');
  };

  if (phase === 'loading') {
    return <main className="page-shell"><div className="page-container max-w-2xl"><p className="meta" role="status">Opening your carrier view…</p></div></main>;
  }

  if (phase === 'unavailable') {
    return (
      <main className="page-shell page-enter !pt-4 sm:!pt-8">
        <div className="page-container max-w-2xl">
          <Link href="/relay?mode=carrier" className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Relay</Link>
          <section className="mt-7 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-6 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:mt-10 sm:p-9">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true"><Package className="h-6 w-6" /></span>
            <p className="eyebrow mt-6 text-[#2b45f7]">Carrier view</p>
            <h1 className="mt-2 font-headline-md text-3xl leading-tight text-ink-navy sm:text-4xl">A secure invite is needed to carry a drop.</h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-on-surface-variant">Ask the sender to share a fresh relay QR code or link. The invite keeps the drop sealed and lets you pass it on securely.</p>
            <Link href="/relay?mode=carrier" className="button-primary mt-6 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">How relay works <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell page-enter !pt-4 sm:!pt-8">
      <div className="page-container max-w-3xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-ink-navy hover:bg-white/65"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Relay passport</Link>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#2b45f7]/[0.08] px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#2b45f7]"><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{phase === 'pass-on' ? 'Ready to pass on' : phase === 'confirmed' ? 'Transfer complete' : 'Current carry'}</span>
        </header>

        {phase === 'carrying' && carry && (
          <section className="mt-7 grid gap-5 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true"><Package className="h-6 w-6" /></span>
              <p className="eyebrow mt-6 text-[#2b45f7]">Current carry</p>
              <h1 className="mt-2 font-headline-md text-3xl leading-tight text-ink-navy sm:text-4xl">A sealed drop is in your care.</h1>
              <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">Carry it toward the recipient area. When you’re ready, show the next person a short-lived QR code or share their invite link.</p>
              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-[#f5f3ed] p-4">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" />
                <div><p className="text-xs font-bold uppercase tracking-[0.1em] text-ink-navy">Destination area</p><p className="mt-1 text-sm text-on-surface-variant">{destination}</p></div>
              </div>
              <button type="button" onClick={() => void handlePassOn()} disabled={issuing} className="button-primary mt-6 w-full !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white sm:w-auto">
                <QrCode className="h-4 w-4" aria-hidden="true" />{issuing ? 'Preparing secure invite…' : 'Pass it on'}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              {pass && Date.parse(pass.expiresAt) > Date.now() && <p className="mt-4 text-xs leading-relaxed text-on-surface-variant" role="status" aria-live="polite">A previous invite is still active. If the next carrier accepts it, this screen will confirm the transfer.</p>}
              {error && <p className="notice error-notice mt-4" role="alert" aria-live="assertive">{error}</p>}
            </div>
            <aside className="rounded-3xl border border-[rgba(16,42,67,.12)] bg-[#fffdf9] p-5 sm:p-6">
              <p className="eyebrow">A sealed route</p>
              <div className="mt-4 flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#2b45f7]" aria-hidden="true" /><p className="text-sm leading-relaxed text-on-surface-variant">Carriers can see route details only. The drop’s note and media stay private.</p></div>
              {route === undefined && <p className="mt-5 text-sm text-on-surface-variant" role="status">Loading route details…</p>}
              {route === null && <p className="mt-5 text-sm text-on-surface-variant" role="status">Route details are unavailable for this carry.</p>}
              {route?.length === 0 && <p className="mt-5 text-sm text-on-surface-variant" role="status">No route details to show yet.</p>}
              {route && route.length > 0 && <ol aria-label="Drop route so far" className="mt-5 max-h-72 space-y-4 overflow-y-auto border-l border-[rgba(43,69,247,.2)] pl-4 pr-2">{route.map((event) => <li key={event.id} className="relative"><span className="absolute -left-[1.32rem] top-1.5 h-2 w-2 rounded-full bg-[#2b45f7]" aria-hidden="true" /><p className="break-words text-sm font-semibold text-ink-navy">{event.carrierName} · {event.neighborhood}</p><time className="mt-1 block text-xs text-on-surface-variant" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>{event.note && <p className="mt-1 break-words text-xs leading-relaxed text-on-surface-variant">{event.note}</p>}</li>)}</ol>}
              <p className="mt-5 border-t border-[rgba(16,42,67,.1)] pt-4 font-mono text-[0.65rem] text-on-surface-variant">Your secure carry pass is saved on this device.</p>
            </aside>
          </section>
        )}

        {phase === 'pass-on' && pass && (
          <section className="mt-7 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-5 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:mt-10 sm:p-8">
            <div className="mx-auto max-w-xl text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true"><QrCode className="h-6 w-6" /></span>
              <p className="eyebrow mt-6 text-[#2b45f7]">Secure pass</p>
              <h1 className="mt-2 font-headline-md text-3xl leading-tight text-ink-navy sm:text-4xl">Let the next carrier scan.</h1>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">This invite expires in ten minutes. Once they accept, this screen will confirm the handoff.</p>
              <div className="mx-auto mt-6 flex w-fit max-w-full items-center justify-center rounded-2xl border border-[rgba(16,42,67,.12)] bg-white p-3" role="img" aria-label="Secure QR invite for the next carrier">
                {passUrl && <QRCodeSVG value={passUrl} size={220} level="M" includeMargin={false} />}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold ${expired ? 'bg-[#f3efe7] text-on-surface-variant' : 'bg-[#2b45f7]/[0.08] text-[#2b45f7]'}`} role="status" aria-live="polite"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{expired ? 'Invite expired' : `Expires in ${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`}</span>
                <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#f5f3ed] px-3 text-xs font-bold text-ink-navy"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2b45f7] motion-reduce:animate-none" aria-hidden="true" />Waiting for acceptance</span>
              </div>
              {passUrl && <button type="button" onClick={() => void sharePassLink()} className="button-secondary mt-5 !min-h-11 !rounded-xl"><Share2 className="h-4 w-4" aria-hidden="true" />{copied ? 'Link copied' : 'Share secure link'}</button>}
              {expired && <button type="button" onClick={() => void handleRefreshPass()} disabled={issuing} className="button-secondary mt-3 !min-h-11 !rounded-xl disabled:opacity-50"><RefreshCcw className="h-4 w-4" aria-hidden="true" />{issuing ? 'Making a new invite…' : 'Create a fresh invite'}</button>}
              {notice && <p className="mt-3 text-sm text-on-surface-variant" role="status" aria-live="polite">{notice}</p>}
              {error && <p className="notice error-notice mt-4" role="alert" aria-live="assertive">{error}</p>}
            </div>
            <p className="mx-auto mt-6 flex max-w-xl items-start gap-2 border-t border-[rgba(16,42,67,.1)] pt-5 text-xs leading-relaxed text-on-surface-variant"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2b45f7]" aria-hidden="true" />The QR code contains a temporary handoff invite. It does not include the drop’s text, media, or your exact location.</p>
            <button type="button" onClick={() => { setPhase('carrying'); setError(''); }} className="button-quiet mt-5"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Keep carrying</button>
          </section>
        )}

        {phase === 'confirmed' && (
          <section className="mt-7 rounded-3xl border border-[rgba(16,42,67,.12)] bg-white p-6 shadow-[0_12px_36px_rgba(16,42,67,.06)] sm:mt-10 sm:p-9">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b45f7]/10 text-[#2b45f7]" aria-hidden="true"><CheckCircle2 className="h-6 w-6" /></span>
            <p className="eyebrow mt-6 text-[#2b45f7]">Transfer recorded</p>
            <h1 className="mt-2 font-headline-md text-3xl leading-tight text-ink-navy sm:text-4xl">Passed to {acceptedBy}.</h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-on-surface-variant">The next carrier accepted the sealed drop. Its route has been updated.</p>
            <Link href={`/relay?letter=${encodeURIComponent(letterId)}`} className="button-primary mt-6 !min-h-12 !rounded-xl !border-[#2b45f7] !bg-[#2b45f7] !text-white">View relay passport <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </section>
        )}
      </div>
    </main>
  );
}

export default function CarryPage() {
  return <Suspense fallback={<main className="page-shell"><div className="page-container"><p className="meta">Loading carrier mode…</p></div></main>}><CarryContent /></Suspense>;
}
