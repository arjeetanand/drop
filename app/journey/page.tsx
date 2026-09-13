'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  NotebookPen,
  UsersRound,
  ShieldCheck,
  Check,
  Bike,
  Building,
  KeyRound,
  Fingerprint,
  Radio,
  Thermometer,
  Zap,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  LockKeyhole,
  Download,
  Share2,
  Plus
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { RelayChain } from '@/components/RelayChain';
import { Luminous3DMap } from '@/components/Luminous3DMap';
import { currentFocusDraft } from '@/data/mockData';
import { getJourneyNotes, getLetterDraft, getLettersWithDraft, saveJourneyNotes, type JourneyNote } from '@/lib/letterStore';
import { getRemoteJourney, saveRemoteJourneyNote } from '@/lib/letterBackend';
import { addRelayHandoff, getInitialRelayState, getRelayState, getRelayStats, relayToTrackingEvents, type RelayState } from '@/lib/relayStore';

function Journey() {
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<JourneyNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [letterId, setLetterId] = useState(currentFocusDraft.id);
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);
  const [showHandoff, setShowHandoff] = useState(false);
  const [carrierName, setCarrierName] = useState('');
  const [carrierLocation, setCarrierLocation] = useState('');
  const [carrierNote, setCarrierNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<'1x' | '2x'>('1x');

  useEffect(() => {
    let active = true;
    const loadJourney = async () => {
      const draft = getLetterDraft();
      const selectedId = searchParams.get('letter') || draft.id;
      const selectedLetter = getLettersWithDraft(draft).find((letter) => letter.id === selectedId);
      const nextRelay = getRelayState(selectedId, {
        subject: selectedLetter?.subject ?? draft.subject ?? currentFocusDraft.subject,
        recipient: selectedLetter?.recipient ?? draft.address.name ?? draft.recipient ?? 'Eleanor',
      });
      const remote = selectedId ? await getRemoteJourney(selectedId) : null;
      if (!active) return;
      setLetterId(selectedId);
      setRelay(nextRelay);
      setNotes(remote?.notes.length ? remote.notes : getJourneyNotes());
      if (searchParams.get('join') === '1') {
        setShowHandoff(true);
      }
    };
    void loadJourney();
    return () => { active = false; };
  }, [searchParams]);

  const stats = getRelayStats(relay);

  const handleAddNote = () => {
    const text = newNote.trim();
    if (!text) return;
    const nextNotes = [...notes, {
      id: String(notes.length + 1),
      date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date()),
      text,
    }];
    setNotes(nextNotes);
    saveJourneyNotes(nextNotes);
    if (letterId) void saveRemoteJourneyNote(letterId, text);
    setNewNote('');
  };

  const handleRecordHandoff = (event: React.FormEvent) => {
    event.preventDefault();
    if (!carrierName.trim() || !carrierLocation.trim()) return;
    const next = addRelayHandoff(
      letterId,
      { name: carrierName, location: carrierLocation, note: carrierNote },
      { subject: relay.subject, recipient: relay.recipient }
    );
    setRelay(next);
    setCarrierName('');
    setCarrierLocation('');
    setCarrierNote('');
    setShowHandoff(false);
    setNotice(`${carrierName.trim()} was recorded as the next carrier!`);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const shareLink = typeof window === 'undefined'
    ? `/journey?letter=${encodeURIComponent(letterId)}&join=1`
    : `${window.location.origin}/journey?letter=${encodeURIComponent(letterId)}&join=1`;

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setNotice('Carrier passport link copied!');
      window.setTimeout(() => {
        setCopied(false);
        setNotice('');
      }, 2500);
    } catch {
      setNotice('Could not copy link');
    }
  };

  return (
    <main className="page-enter min-h-screen pb-32 bg-[#fafafa] text-slate-900 relative selection:bg-cyan-500 selection:text-white">
      {/* ── Luminous Ambient Bloom & Micro-Dot Grid ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-cyan-500/10 via-emerald-500/5 to-transparent blur-3xl rounded-full opacity-70" />
        <div className="absolute inset-0 bg-dot-matrix opacity-60" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1360px] px-4 py-6 md:px-8 xl:px-12">
        {/* ── Top Header Strip: Active Route & Consensus Latency ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs border border-slate-200/80 rounded-xl px-4 py-2.5 bg-white/85 backdrop-blur-md shadow-xs">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Desk
            </Link>
            <span className="text-slate-300">|</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              ACTIVE ROUTE:
            </span>
            <span className="font-mono font-bold text-slate-900 text-xs">
              #DEL-8842-X: Coastal Sea Link corridor
            </span>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-slate-500">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Protocol v2.4
            </span>
            <span className="hidden md:inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-slate-800 font-semibold">
              BLK #4,892,108
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200/60">
              9ms latency
            </span>
          </div>
        </div>

        {/* ── Notification Toast if any ── */}
        {notice && (
          <div className="mb-6 rounded-xl bg-slate-900 text-white px-4 py-2.5 font-sans text-xs flex items-center justify-between shadow-lg">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}

        {/* ── MAIN 3D SPATIAL JOURNEY GRID (Iteration 2 Stitch Layout) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT PANEL: Relay Custody Audit (3 cols) */}
          <aside className="lg:col-span-3 flex flex-col gap-5 order-2 lg:order-1">
            <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 shadow-sm bg-white/85">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="font-sans text-sm font-bold tracking-tight text-slate-900">Relay Custody Audit</span>
                </div>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                  SEALED
                </span>
              </div>

              <div className="font-mono text-[11px] text-slate-400">
                Route ID: <strong className="text-slate-800">DEL-8842-X</strong> • Physical Proof of Handoff
              </div>

              {/* Custody Audit Events */}
              <div className="flex flex-col gap-4 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200">
                {/* Event 1 */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-7 h-7 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center text-emerald-600 shadow-xs shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-sans font-bold text-slate-800">Consignor Vaulting</span>
                      <span className="font-mono text-[10px] text-slate-400">14:15 IST</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 mt-0.5">SHA-256: 0x8F4A...B902</span>
                    <span className="text-[11px] text-slate-500 mt-0.5">Cotton Bond Paper 42g weight verification verified intact.</span>
                  </div>
                </div>

                {/* Event 2 */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-7 h-7 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center text-emerald-600 shadow-xs shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-sans font-bold text-slate-800">Cryo-Seal Imprinted</span>
                      <span className="font-mono text-[10px] text-slate-400">14:30 IST</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 mt-0.5">Bandra Depot Station #02</span>
                    <span className="text-[11px] text-slate-500 mt-0.5">Physical wax seal signature cryptographic hash confirmed.</span>
                  </div>
                </div>

                {/* Event 3 (Active) */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center ring-4 ring-cyan-400/30 shadow-xs shrink-0 animate-pulse">
                    <Bike className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <div className="flex flex-col text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-sans font-bold text-slate-900">In Custody: Vikram R.</span>
                      <span className="font-mono text-[9px] px-1.5 py-0.2 bg-cyan-100 text-cyan-800 rounded font-bold">LIVE</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 mt-0.5">Biometric sig: 0x981C...7701</span>
                    <div className="mt-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200/80 font-mono text-[10px] grid grid-cols-2 gap-1 text-slate-600">
                      <span>Shock: <strong className="text-emerald-600">0.0g</strong></span>
                      <span>Tilt: <strong>3.2°</strong></span>
                      <span>Speed: <strong>22 km/h</strong></span>
                      <span>Case: <strong className="text-emerald-600">Hermetic</strong></span>
                    </div>
                  </div>
                </div>

                {/* Event 4 */}
                <div className="flex items-start gap-3 relative z-10 opacity-50">
                  <div className="w-7 h-7 rounded-full bg-slate-50 border border-slate-300 flex items-center justify-center text-slate-400 shrink-0">
                    <Building className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col text-xs">
                    <span className="font-sans font-medium text-slate-700">Final Handshake</span>
                    <span className="text-[11px] text-slate-500">Colaba Heritage Box #88 • Recipient Iris/Touch OTP required</span>
                  </div>
                </div>
              </div>

              {/* Merkle Root Tag */}
              <div className="mt-2 pt-3 border-t border-slate-100 font-mono text-[10px] text-slate-400 flex items-center justify-between">
                <span>MERKLE ROOT:</span>
                <span className="text-slate-700 font-bold">0x9B22...DF10</span>
              </div>
            </div>

            {/* Carrier Handoff Button & QR Code */}
            <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3 bg-white/85">
              <div className="flex items-center justify-between font-mono text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                <span>Passcode Access</span>
                <span className="text-emerald-600 font-bold">{relay.passcode}</span>
              </div>
              <button
                onClick={() => setShowHandoff(!showHandoff)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showHandoff ? 'Close Handoff Form' : 'Record Carrier Handoff'}</span>
              </button>
              <button
                onClick={copyShareLink}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-all border border-slate-200/70"
              >
                <Share2 className="w-3.5 h-3.5 text-slate-500" />
                <span>{copied ? 'Link Copied!' : 'Copy Carrier Link'}</span>
              </button>
            </div>
          </aside>

          {/* CENTER VIEWPORT: 3D City Wireframe & Playback Scrubber (6 cols) */}
          <section className="lg:col-span-6 flex flex-col gap-4 order-1 lg:order-2">
            {/* Luminous 3D Architectural City Map */}
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm overflow-hidden">
              <Luminous3DMap
                currentCarrier={relay.currentCarrierName || 'Vikram R.'}
                currentNeighborhood={relay.gpsWaypoints?.at(-1)?.neighborhood || 'Sea Link Transit'}
                destinationNeighborhood={relay.destinationNeighborhood || 'Colaba Heritage'}
              />
            </div>

            {/* Bottom Scrubbable Route Playback Dock (Stitch Iteration 2) */}
            <div className="glass-panel rounded-2xl p-4 shadow-sm bg-white/90 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-slate-700 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  TRANSIT PROGRESS: 57.8% (Bandra Depot → Colaba Heritage)
                </span>
                <span className="font-mono text-xs text-slate-500 font-semibold">24:18 / 42:00</span>
              </div>

              {/* Scrubbing timeline slider */}
              <div className="relative w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-slate-900 rounded-full w-[57.8%] relative">
                  <span className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white shadow-sm" />
                </div>
              </div>

              {/* Waypoint timestamp tags */}
              <div className="flex justify-between font-mono text-[10px] text-slate-400">
                <span>00:00 (Depot)</span>
                <span>14:30 (Sea Link)</span>
                <span className="text-slate-700 font-bold">24:18 (Current)</span>
                <span>42:00 (Colaba)</span>
              </div>

              {/* Playback action controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="p-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs"
                    title={isPlaying ? 'Pause Simulation' : 'Play Simulation'}
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                  </button>
                  <button
                    onClick={() => setPlaybackSpeed(playbackSpeed === '1x' ? '2x' : '1x')}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    {playbackSpeed} Speed
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => alert('Camera centered on active courier Vikram R.')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 font-sans text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
                  >
                    Recenter Camera
                  </button>
                  <button
                    onClick={() => alert('3D Perspective tilt toggled to aerial mode.')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 font-sans text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3 text-cyan-600" />
                    <span>3D Perspective Tilt</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Carrier Handoff Form (expandable) */}
            {showHandoff && (
              <form onSubmit={handleRecordHandoff} className="glass-panel rounded-2xl p-5 bg-white shadow-md flex flex-col gap-3">
                <h3 className="font-sans font-bold text-sm text-slate-900">Record Next Carrier Handoff</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Your Name / Handle"
                    value={carrierName}
                    onChange={(e) => setCarrierName(e.target.value)}
                    required
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-sans focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <input
                    type="text"
                    placeholder="City / Neighborhood (e.g. Worli)"
                    value={carrierLocation}
                    onChange={(e) => setCarrierLocation(e.target.value)}
                    required
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-sans focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <textarea
                  placeholder="Optional logbook note from your leg of the journey…"
                  value={carrierNote}
                  onChange={(e) => setCarrierNote(e.target.value)}
                  rows={2}
                  className="rounded-xl border border-slate-200 p-3 text-xs font-sans focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  type="submit"
                  className="py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors shadow-xs"
                >
                  Confirm &amp; Pass the Letter Forward
                </button>
              </form>
            )}
          </section>

          {/* RIGHT PANEL: Live Courier Telemetry HUD (3 cols) */}
          <aside className="lg:col-span-3 flex flex-col gap-5 order-3">
            {/* Courier Profile & Rating */}
            <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 shadow-sm bg-white/85">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-base shadow-xs">
                  VR
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-sans font-bold text-sm text-slate-900">Vikram R.</span>
                    <span className="font-mono text-xs text-amber-500 font-bold">★ 4.98</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block ml-1 animate-pulse" />
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">1,420 physical letters relayed</span>
                </div>
              </div>

              {/* Telemetry Sensor Gauges */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider block">VELOCITY</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold text-slate-900">22</span>
                    <span className="font-mono text-xs text-slate-500">km/h</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full bg-slate-900 w-[55%]" />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider block">BATTERY</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold text-slate-900">84%</span>
                    <span className="font-mono text-xs text-slate-500">68km</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full bg-emerald-500 w-[84%]" />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                    <Thermometer className="w-3 h-3 text-cyan-600" /> THERMAL
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-mono text-xl font-bold text-slate-900">24°C</span>
                    <span className="font-mono text-xs text-slate-500">58% RH</span>
                  </div>
                  <span className="font-mono text-[9px] text-emerald-600 font-bold mt-1 block">
                    OPTIMAL STABILITY
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" /> SHOCK
                  </span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-mono text-xl font-bold text-emerald-600">0.0g</span>
                  </div>
                  <span className="font-mono text-[9px] text-slate-400 font-semibold mt-1 block">
                    ZERO IMPACT
                  </span>
                </div>
              </div>

              {/* Recipient Handshake OTP */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center gap-1 text-center">
                <span className="font-mono text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  RECIPIENT HANDSHAKE OTP
                </span>
                <div className="flex items-center gap-2 mt-1 font-mono text-2xl font-bold tracking-widest text-slate-900">
                  <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">7</span>
                  <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">4</span>
                  <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">2</span>
                  <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">3</span>
                </div>
                <span className="font-mono text-[10px] text-slate-400 mt-0.5">
                  Rendezvous PIN coordinate verified
                </span>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => alert('Handoff cryptographic key verified with courier node.')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all shadow-xs"
                >
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Verify Handoff Key</span>
                </button>
                <button
                  onClick={() => alert('Biometric audit log certificate downloaded.')}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-all border border-slate-200/70"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>View Biometric Audit Log</span>
                </button>
              </div>
            </div>

            {/* Living Journey Notes Section */}
            <div className="glass-panel rounded-2xl p-4 bg-white/85 flex flex-col gap-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <NotebookPen className="w-4 h-4 text-emerald-600" />
                <span className="font-sans text-xs font-bold text-slate-900">Courier Logbook Notes</span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-xl bg-slate-50 p-2.5 text-xs border border-slate-100">
                    <span className="font-mono text-[10px] text-slate-400 block">{note.date}</span>
                    <p className="font-sans text-slate-700 mt-0.5">{note.text}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  placeholder="Add note to manifest…"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-sans focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <button
                  onClick={handleAddNote}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  Post
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── FLOATING FROSTED DOCK ── */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 p-1.5 rounded-full bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-2xl">
        <Link
          href="/compose?new=1"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <span>Compose</span>
        </Link>
        <Link
          href="/sent"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <span>Dispatch</span>
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <span>Telemetry</span>
        </Link>
        <Link
          href="/relay"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <span>Keys</span>
        </Link>
        <button
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-bold bg-slate-900 text-white shadow-sm transition-all"
        >
          <Radio className="w-3.5 h-3.5 text-emerald-400" />
          <span>Audit</span>
        </button>
      </nav>
    </main>
  );
}

export default function JourneyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fafafa] flex items-center justify-center font-mono text-xs text-slate-400">Loading live 3D journey…</div>}>
      <Journey />
    </Suspense>
  );
}
