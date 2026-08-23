type SoundName = 'tap' | 'seal' | 'send' | 'reveal';

const SOUND_KEY = 'dear-exe:sound-muted:v1';

let sharedContext: AudioContext | null = null;

function getAudioContext() {
  const AudioContextClass = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContextClass();
  }
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

export function isSoundMuted() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SOUND_KEY) === 'true';
}

export function setSoundMuted(muted: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUND_KEY, String(muted));
}

export function playInterfaceSound(name: SoundName) {
  if (typeof window === 'undefined' || isSoundMuted()) return;

  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const settings: Record<SoundName, { start: number; end: number; duration: number; type: OscillatorType }> = {
    tap: { start: 520, end: 680, duration: 0.08, type: 'sine' },
    seal: { start: 220, end: 120, duration: 0.22, type: 'triangle' },
    send: { start: 260, end: 760, duration: 0.36, type: 'sine' },
    reveal: { start: 480, end: 880, duration: 0.42, type: 'sine' },
  };
  const sound = settings[name];
  const now = context.currentTime;

  oscillator.type = sound.type;
  oscillator.frequency.setValueAtTime(sound.start, now);
  oscillator.frequency.exponentialRampToValueAtTime(sound.end, now + sound.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + sound.duration + 0.03);
}
