'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  Clock3,
  Feather,
  HeartHandshake,
  LockKeyhole,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Download,
  History,
  Check,
  Bike,
  Building,
  KeyRound,
  Fingerprint,
  Radio,
  FileText
} from 'lucide-react';
import { RelayChain } from '@/components/RelayChain';
import { StitchHero3D } from '@/components/StitchHero3D';
import { Card3DTilt } from '@/components/Card3DTilt';
import { Luminous3DMap } from '@/components/Luminous3DMap';
import { LetterCard } from '@/components/LetterCard';
import { currentFocusDraft, mockLetters } from '@/data/mockData';
import { getLetterDraft, getLettersWithDraft, type LetterDraftState } from '@/lib/letterStore';
import { getRemoteLetters, getRemoteProfile } from '@/lib/letterBackend';
import { getInitialRelayState, getRelayState, getRelayStats, type RelayState } from '@/lib/relayStore';
import { defaultUserProfile, getUserProfile, type UserProfile } from '@/lib/userStore';

export default function HomeDesk() {
  const [draft, setDraft] = useState<LetterDraftState | null>(null);
  const [letters, setLetters] = useState(mockLetters);
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [relay, setRelay] = useState<RelayState>(getInitialRelayState);

  useEffect(() => {
    let active = true;
    const loadDesk = async () => {
      const localDraft = getLetterDraft();
      const [remoteLetters, remoteProfile] = await Promise.all([getRemoteLetters(), getRemoteProfile()]);
      if (!active) return;
      setDraft(localDraft);
      setLetters(remoteLetters?.length ? remoteLetters : getLettersWithDraft(localDraft));
      setProfile(remoteProfile || getUserProfile());
      setRelay(getRelayState(currentFocusDraft.id, {
        subject: currentFocusDraft.subject,
        recipient: 'Eleanor',
      }));
    };
    void loadDesk();
    return () => { active = false; };
  }, []);

  const focusDraft = draft ?? { ...currentFocusDraft, content: currentFocusDraft.excerpt, status: 'draft' as const };
  const focusRecipient = focusDraft.recipient || 'someone special';
  const incoming = letters.find((letter) => letter.direction === 'received') || mockLetters.find((letter) => letter.direction === 'received');
  const recentLetters = letters.filter((letter) => letter.id !== focusDraft.id && letter.id !== incoming?.id).slice(0, 4);
  const relayStats = getRelayStats(relay);

  return (
    <main className="page-enter min-h-screen pb-32 bg-[#fafafa] text-slate-900 relative selection:bg-cyan-500 selection:text-white">
      {/* ── Luminous Ambient Bloom & Micro-Dot Grid (Stitch System) ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-to-b from-cyan-500/10 via-emerald-500/5 to-transparent blur-3xl rounded-full opacity-70" />
        <div className="absolute top-1/3 -left-48 w-[450px] h-[450px] bg-cyan-500/5 blur-3xl rounded-full" />
        <div className="absolute top-1/2 -right-48 w-[500px] h-[500px] bg-emerald-500/5 blur-3xl rounded-full" />
        <div className="absolute inset-0 bg-dot-matrix opacity-60" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1360px] px-4 py-6 md:px-8 xl:px-12">
        {/* ── Stitch Subheader: Network Telemetry Bar ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs border border-slate-200/80 rounded-xl px-4 py-2.5 bg-white/80 backdrop-blur-md shadow-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider font-semibold">NETWORK TELEMETRY:</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-800 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> 1,248 Letters in Motion
            </span>
          </div>
          <div className="flex items-center gap-6 font-mono text-xs text-slate-500">
            <span className="hidden sm:inline-flex items-center gap-1">
              <span className="text-cyan-600">●</span> 99.98% Chain Custody
            </span>
            <span className="hidden md:inline-flex items-center gap-1">
              <span className="text-emerald-600">●</span> Mumbai Metro Mesh Active (#BOM-7)
            </span>
            <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-slate-800 font-semibold">
              Current Block: #4,892,104
            </span>
          </div>
        </div>

        {/* ── BENTO GRID: 3D Center Stage, Left Pipeline, Right Manifest ── */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mb-16">
          {/* LEFT COLUMN: Custody Pipeline & Transit Vector (3 cols) */}
          <aside className="lg:col-span-3 flex flex-col gap-5 order-2 lg:order-1">
            {/* Custody Pipeline Card */}
            <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 shadow-sm bg-white/85">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="font-sans text-sm font-bold tracking-tight text-slate-900">Custody Pipeline</span>
                </div>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 font-semibold text-slate-600">
                  LIVE CHAIN
                </span>
              </div>

              {/* Step progression diagram */}
              <div className="flex flex-col gap-3.5 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200">
                {/* Step 1 */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-7 h-7 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center text-emerald-600 shadow-xs">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-sans text-xs font-semibold text-slate-800">Sender Verification</span>
                    <span className="font-mono text-[11px] text-slate-400">Khar West • 10:14 IST</span>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-7 h-7 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center text-emerald-600 shadow-xs">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-sans text-xs font-semibold text-slate-800">Bandra Depot #02</span>
                    <span className="font-mono text-[11px] text-slate-400">Vaulted &amp; Wax Sealed</span>
                  </div>
                </div>

                {/* Step 3 (Active) */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center ring-4 ring-emerald-400/30 shadow-xs animate-pulse">
                    <Bike className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="font-sans text-xs font-bold text-slate-900">Courier Vikram R.</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    </div>
                    <span className="font-mono text-[11px] text-cyan-600 font-semibold">Sea Link Transit • 18 km/h</span>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex items-start gap-3 relative z-10 opacity-60">
                  <div className="w-7 h-7 rounded-full bg-slate-50 border border-slate-300 flex items-center justify-center text-slate-400">
                    <Building className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-sans text-xs font-medium text-slate-600">Colaba Heritage Hub</span>
                    <span className="font-mono text-[11px] text-slate-400">ETA: 42 mins</span>
                  </div>
                </div>

                {/* Step 5 */}
                <div className="flex items-start gap-3 relative z-10 opacity-40">
                  <div className="w-7 h-7 rounded-full bg-slate-50 border border-slate-300 flex items-center justify-center text-slate-400">
                    <Fingerprint className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-sans text-xs font-medium text-slate-600">Biometric Handshake</span>
                    <span className="font-mono text-[11px] text-slate-400">Recipient Final OTP</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Transit Vector Preview */}
            <div className="glass-panel rounded-2xl p-5 flex flex-col gap-3 shadow-sm bg-white/85">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider font-semibold">TRANSIT VECTOR</span>
                <span className="font-mono text-[11px] text-emerald-600 font-bold">GPS LOCKED</span>
              </div>
              <div className="relative h-32 rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <img
                  src="/concepts/modern-light-journey.jpg"
                  alt="Transit Route Preview"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-white">
                  <span className="font-mono text-[10px] bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded">
                    Coastal Highway
                  </span>
                  <span className="font-mono text-[10px] bg-emerald-500 text-slate-900 px-1.5 py-0.5 rounded font-bold">
                    12.4 km left
                  </span>
                </div>
              </div>

              {/* Protocol Security Metrics */}
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/70">
                  <span className="text-slate-400 block text-[9px]">Tamper Sensor</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 0.0g Shock
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/70">
                  <span className="text-slate-400 block text-[9px]">ZK Recipient</span>
                  <span className="font-semibold text-slate-800 truncate">colaba-box#88</span>
                </div>
              </div>
            </div>
          </aside>

          {/* CENTER STAGE: 3D Floating Envelope & Orbiting Telemetry (6 cols) */}
          <section className="lg:col-span-6 flex flex-col items-center justify-center order-1 lg:order-2">
            <StitchHero3D
              recipient={focusRecipient}
              subject={focusDraft.subject || 'Morning Light & Sea Air'}
              excerpt={focusDraft.content || 'Morning light through the kitchen window. The kettle is whistling and I am thinking of you across the bay…'}
              carrierName="Vikram R."
              carrierRating="4.98"
              trackingId="#DEL-8842-X"
            />

            {/* Core Action CTAs */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 w-full">
              <Link
                href="/compose?new=1"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3.5 font-sans text-xs uppercase tracking-wider font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-md active:scale-[0.99]"
              >
                <Feather className="h-4 w-4 text-emerald-400" />
                <span>Write a Letter</span>
                <kbd className="ml-2 rounded border border-white/20 px-1.5 py-0.5 font-mono text-[9px] text-white/70">N</kbd>
              </Link>
              <Link
                href="/journey"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 font-sans text-xs uppercase tracking-wider font-semibold text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 shadow-2xs"
              >
                <Radio className="h-3.5 w-3.5 text-cyan-600" />
                <span>Live 3D City Journey</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              </Link>
            </div>
          </section>

          {/* RIGHT COLUMN: Dispatch Manifest Glass Card (3 cols) */}
          <aside className="lg:col-span-3 flex flex-col gap-5 order-3">
            {/* Manifest Glass Card */}
            <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 shadow-sm bg-white/85">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div className="flex flex-col">
                  <span className="font-mono text-[10px] text-slate-400 uppercase tracking-wider font-semibold">DISPATCH MANIFEST</span>
                  <span className="font-sans text-base font-extrabold text-slate-900">#DEL-8842-X</span>
                </div>
                <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  <LockKeyhole className="w-3 h-3" /> Locked
                </span>
              </div>

              {/* Manifest Attributes Grid */}
              <div className="flex flex-col gap-2 font-sans text-xs">
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Sealed Content</span>
                  <span className="font-mono font-semibold text-slate-800">Cotton Bond (42g)</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Security Protocol</span>
                  <span className="font-mono font-semibold text-emerald-600">Level 4 Biometric</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Origin Depot</span>
                  <span className="font-mono font-semibold text-slate-800">Bandra West #02</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Target Node</span>
                  <span className="font-mono font-semibold text-slate-800">Colaba Heritage</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Carrier Custody Key</span>
                  <span className="font-mono font-semibold text-cyan-600">0x8F4...C19B</span>
                </div>

                {/* Recipient Handshake OTP Box */}
                <div className="mt-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center gap-1 text-center">
                  <span className="font-mono text-[10px] text-slate-400 font-bold tracking-wider uppercase">
                    RECIPIENT HANDSHAKE ONE-TIME PIN
                  </span>
                  <div className="flex items-center gap-2 mt-1 font-mono text-2xl font-bold tracking-widest text-slate-900">
                    <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">7</span>
                    <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">4</span>
                    <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">2</span>
                    <span className="px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-xs">3</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 mt-0.5">
                    Expires upon recipient iris/touch confirmation
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => alert('Proof of Custody certificate exported to cryptographic PDF.')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all shadow-xs active:scale-[0.98]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Proof of Custody</span>
                </button>
                <Link
                  href="/journey"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-all border border-slate-200/70 active:scale-[0.98]"
                >
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  <span>View Biometric Audit Log</span>
                </Link>
              </div>
            </div>

            {/* Active Relay Node Stake Card */}
            <div className="glass-panel rounded-2xl p-4 flex items-center gap-3 bg-white/85">
              <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
                <Radio className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-sans text-xs font-bold text-slate-900">Active Relay Node #BOM-7</span>
                <span className="font-mono text-[11px] text-slate-500">Custody bonded with 10 ETH stake</span>
              </div>
            </div>
          </aside>
        </section>

        {/* ── LIVE 3D CITY ROUTE TELEMETRY (Luminous3DMap) ── */}
        <section className="border-t border-slate-200/80 py-12 md:py-16">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 font-mono text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live 3D City Wireframe
              </div>
              <h2 className="font-sans font-bold text-2xl md:text-3xl text-slate-900 tracking-tight">
                Track Letters in Motion
              </h2>
              <p className="font-sans text-sm text-slate-500 mt-1">
                Real-time 3D architectural city telemetry. Move your cursor to pan and tilt the route.
              </p>
            </div>
            <Link
              href={`/relay?letter=${encodeURIComponent(relay.letterId)}`}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 font-sans text-xs uppercase tracking-wider font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <span>Full Relay Dashboard</span>
              <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />
            </Link>
          </div>
          <Luminous3DMap
            currentCarrier={relay.currentCarrierName || 'Vikram R.'}
            currentNeighborhood={relay.gpsWaypoints?.at(-1)?.neighborhood || 'Sea Link Transit'}
            destinationNeighborhood={relay.destinationNeighborhood || 'Colaba Heritage'}
          />
        </section>

        {/* ── HOW IT WORKS: 3-STEP CLEAR EXPLAINER ── */}
        <section id="how-it-works" className="border-t border-slate-200/80 py-12 md:py-16">
          <div className="text-center max-w-xl mx-auto">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-600 font-semibold">
              The Philosophy
            </p>
            <h2 className="mt-2 font-sans font-extrabold text-2xl md:text-3xl text-slate-900 tracking-tight">
              How Dear.exe Works
            </h2>
            <p className="mt-2 font-sans text-sm text-slate-500">
              In a world of instant messages, we make words travel slower so they carry more meaning.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {/* Step 1 */}
            <Card3DTilt className="h-full">
              <div className="h-full bg-white border border-slate-200/90 rounded-2xl p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white mb-4 shadow-xs">
                    <Feather className="h-4 w-4 text-emerald-400" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">Step 1</p>
                  <h3 className="mt-1 font-sans text-lg font-bold text-slate-900">Pen Your Letter</h3>
                  <p className="mt-2.5 font-sans text-xs leading-relaxed text-slate-500">
                    A tranquil typewriter canvas on clean cotton paper. Autosaved to your desk so you can write at your own pace.
                  </p>
                </div>
                <div className="mt-6 pt-3 border-t border-slate-100 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  Private drafting
                </div>
              </div>
            </Card3DTilt>

            {/* Step 2 */}
            <Card3DTilt className="h-full">
              <div className="h-full bg-white border border-slate-200/90 rounded-2xl p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white mb-4 shadow-xs">
                    <LockKeyhole className="h-4 w-4 text-emerald-400" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">Step 2</p>
                  <h3 className="mt-1 font-sans text-lg font-bold text-slate-900">Seal with Wax</h3>
                  <p className="mt-2.5 font-sans text-xs leading-relaxed text-slate-500">
                    Choose a custom wax signet and press the brass die. Once stamped, the contents are permanently sealed.
                  </p>
                </div>
                <div className="mt-6 pt-3 border-t border-slate-100 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  Zero words exposed
                </div>
              </div>
            </Card3DTilt>

            {/* Step 3 */}
            <Card3DTilt className="h-full">
              <div className="h-full bg-white border border-slate-200/90 rounded-2xl p-6 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-emerald-400 mb-4 shadow-xs">
                    <HeartHandshake className="h-4 w-4" />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">Step 3</p>
                  <h3 className="mt-1 font-sans text-lg font-bold text-slate-900">The Human Relay</h3>
                  <p className="mt-2.5 font-sans text-xs leading-relaxed text-slate-500">
                    Share the passport with carriers. Each person logs their GPS stop without opening the envelope, building a living route.
                  </p>
                </div>
                <div className="mt-6 pt-3 border-t border-slate-100 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  GPS-verified handoffs
                </div>
              </div>
            </Card3DTilt>
          </div>
        </section>

        {/* ── RECENT LETTERS & CORRESPONDENCE OVERVIEW ── */}
        <section className="mt-12 grid gap-10 md:mt-16 md:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="flex items-end justify-between border-b border-slate-200/80 pb-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">Your Desk</p>
                <h2 className="mt-1 font-sans font-extrabold text-2xl text-slate-900">Recent Letters</h2>
              </div>
              <Link href="/mailbox" className="font-mono text-xs text-slate-500 hover:text-slate-900">
                Open All in Mailbox →
              </Link>
            </div>

            {/* In-progress Draft if any */}
            {focusDraft && (
              <div className="border-b border-slate-200/80 py-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                      Unfinished Draft
                    </span>
                    <h3 className="mt-2 font-sans font-bold text-xl text-slate-900">
                      {focusDraft.subject || 'Untitled Letter'}
                    </h3>
                    <p className="mt-1 font-sans text-sm text-slate-500">
                      To {focusRecipient} · {focusDraft.content.trim() ? `${focusDraft.content.trim().split(/\s+/).length} words written` : 'Empty draft'}
                    </p>
                  </div>
                  <Link
                    href="/compose"
                    className="inline-flex shrink-0 items-center gap-2 border border-slate-900 px-4 py-2 font-sans text-xs uppercase tracking-wider font-semibold text-slate-900 rounded-lg hover:bg-slate-900 hover:text-white transition-colors"
                  >
                    Continue Writing <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}

            {/* List of recent letters */}
            <div className="divide-y divide-slate-100">
              {recentLetters.map((letter) => (
                <LetterCard key={letter.id} letter={letter} />
              ))}
              {!recentLetters.length && (
                <p className="py-8 font-sans text-sm text-slate-400">
                  No other letters yet. Start writing your first one!
                </p>
              )}
            </div>
          </div>

          {/* Incoming Letter Highlight */}
          <aside className="border-l border-slate-200/80 pl-0 md:pl-8">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-emerald-600 font-bold">
                <ShieldCheck className="h-4 w-4" /> Letter Arrival
              </div>
              <h3 className="mt-3 font-sans font-bold text-xl text-slate-900">
                {incoming ? 'A note arrived for you.' : 'Your Mailbox is Quiet.'}
              </h3>
              <p className="mt-2 font-sans text-xs leading-relaxed text-slate-500">
                {incoming
                  ? `From ${incoming.sender || 'a correspondent'}. The envelope traveled across cities and is sealed with wax.`
                  : 'When someone sends a letter to your username, it will appear here.'}
              </p>

              {incoming && (
                <Link
                  href={`/letter/${incoming.id}`}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl font-sans text-xs uppercase tracking-wider font-semibold hover:bg-slate-800 transition-colors shadow-xs"
                >
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                  Open &amp; Break Seal
                </Link>
              )}
            </div>

            <div className="mt-6 space-y-3 border-t border-slate-100 pt-6">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Your Postal Link</p>
              <p className="font-sans text-xs text-slate-700 break-all">
                Share <strong>@{profile.username}</strong> with friends so they can write to you.
              </p>
              <Link
                href="/profile"
                className="inline-flex items-center gap-1 font-sans text-xs text-emerald-600 font-semibold hover:underline"
              >
                Edit your profile &amp; share link →
              </Link>
            </div>
          </aside>
        </section>
      </div>

      {/* ── LINEAR / APPLE FLOATING FROSTED DOCK (Bottom Navbar) ── */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 p-1.5 rounded-full bg-white/90 backdrop-blur-xl border border-slate-200/90 shadow-2xl">
        <Link
          href="/compose?new=1"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <Feather className="w-3.5 h-3.5 text-slate-500" />
          <span>Compose</span>
        </Link>
        <Link
          href="/sent"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <Mail className="w-3.5 h-3.5 text-slate-500" />
          <span>Dispatch</span>
        </Link>
        <button
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-bold bg-slate-900 text-white shadow-sm transition-all"
        >
          <Radio className="w-3.5 h-3.5 text-emerald-400" />
          <span>Telemetry</span>
        </button>
        <Link
          href="/relay"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <KeyRound className="w-3.5 h-3.5 text-slate-500" />
          <span>Keys</span>
        </Link>
        <Link
          href="/journey"
          className="flex items-center gap-1.5 px-4 py-2 rounded-full font-sans text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 transition-all"
        >
          <FileText className="w-3.5 h-3.5 text-slate-500" />
          <span>Audit</span>
        </Link>
      </nav>
    </main>
  );
}
