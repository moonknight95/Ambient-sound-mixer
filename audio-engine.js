/**
 * audio-engine.js — Web Audio API engine with procedural sound synthesis
 *
 * All 8 ambient sounds are generated algorithmically using DSP — no audio
 * files, no network requests, no external dependencies.
 *
 * Node chain per track:
 *   BufferSource (loop) → GainNode (track vol) → MasterGain → AnalyserNode → Destination
 */

// ─── AudioContext (lazy singleton) ───────────────────────────────────────────

let ctx          = null;
let masterGain   = null;
let analyser     = null;
let isMuted      = false;
let lastMasterVol = 1;

export function getContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    masterGain = ctx.createGain();
    masterGain.gain.value = 1;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
  }
  return ctx;
}

export async function resumeContext() {
  const c = getContext();
  if (c.state === "suspended") await c.resume();
}

// ─── Track map ────────────────────────────────────────────────────────────────

const trackMap = new Map();

export function initTrack(id) {
  if (trackMap.has(id)) return;
  const c = getContext();
  const gainNode = c.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(masterGain);
  trackMap.set(id, { buffer: null, gainNode, source: null });
}

// ─── DSP Utilities ────────────────────────────────────────────────────────────

function noiseData(n) {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return d;
}

/** First-order IIR lowpass (in-place). Coefficient from Euler approx. */
function lowpass(d, fc, sr) {
  const a = Math.exp(-2 * Math.PI * (fc / sr));
  const b = 1 - a;
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    y = b * d[i] + a * y;
    d[i] = y;
  }
}

/** Highpass = signal − lowpass of signal */
function highpass(d, fc, sr) {
  const a = Math.exp(-2 * Math.PI * (fc / sr));
  const b = 1 - a;
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    const lp = b * d[i] + a * y;
    y = lp;
    d[i] = d[i] - lp;
  }
}

function normalize(d, peak = 0.8) {
  let max = 0;
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > max) max = Math.abs(d[i]);
  if (max < 1e-6) return;
  const s = peak / max;
  for (let i = 0; i < d.length; i++) d[i] *= s;
}

/** Fade first/last `secs` seconds to 0 for seamless looping */
function fadeEdges(d, sr, secs = 0.08) {
  const n = Math.min(Math.floor(secs * sr), d.length >> 1);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    d[i]               *= t;
    d[d.length - 1 - i] *= t;
  }
}

// ─── Sound Generators ─────────────────────────────────────────────────────────

function makeRain(sr) {
  const n = sr * 10;
  const d = noiseData(n);
  highpass(d, 300, sr);
  lowpass(d, 6000, sr);

  // Individual drops — short noise bursts
  for (let i = 0; i < 700; i++) {
    const pos = Math.floor(Math.random() * n);
    const len = Math.floor(sr * (0.004 + Math.random() * 0.014));
    const amp = 0.25 + Math.random() * 0.55;
    for (let k = 0; k < len && pos + k < n; k++) {
      d[pos + k] += amp * Math.exp(-k / (len * 0.3)) * (Math.random() * 2 - 1);
    }
  }

  normalize(d, 0.55);
  fadeEdges(d, sr, 0.15);
  return d;
}

function makeThunder(sr) {
  const n = sr * 16;
  const d = noiseData(n);
  lowpass(d, 140, sr);

  const env = new Float32Array(n).fill(0.06); // constant low rumble

  const claps = 3 + Math.floor(Math.random() * 2);
  for (let c = 0; c < claps; c++) {
    const start = Math.floor(sr * (1.5 + Math.random() * 10));
    const len   = Math.floor(sr * (2.5 + Math.random() * 2.5));
    const amp   = 0.65 + Math.random() * 0.35;
    for (let k = 0; k < len && start + k < n; k++) {
      const e = amp * Math.exp(-k / (sr * 1.1));
      if (e > env[start + k]) env[start + k] = e;
    }
  }

  for (let i = 0; i < n; i++) d[i] *= env[i];
  normalize(d, 0.78);
  fadeEdges(d, sr, 0.35);
  return d;
}

function makeWind(sr) {
  const n = sr * 12;
  const d = noiseData(n);
  highpass(d, 60, sr);
  lowpass(d, 500, sr);

  // Gust modulation
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] *= 0.45 + 0.35 * Math.sin(2 * Math.PI * 0.07 * t)
                 + 0.20 * Math.sin(2 * Math.PI * 0.03 * t + 1.2);
  }

  normalize(d, 0.62);
  fadeEdges(d, sr, 0.25);
  return d;
}

function makeForest(sr) {
  const n = sr * 20;
  const d = noiseData(n);
  highpass(d, 3000, sr);
  for (let i = 0; i < n; i++) d[i] *= 0.035; // subtle leaf rustle

  // Bird chirps
  const chirps = 55 + Math.floor(Math.random() * 20);
  for (let c = 0; c < chirps; c++) {
    const freq = 1800 + Math.random() * 3600;
    const pos  = Math.floor(Math.random() * n);
    const len  = Math.floor(sr * (0.07 + Math.random() * 0.28));
    const amp  = 0.10 + Math.random() * 0.22;
    for (let k = 0; k < len && pos + k < n; k++) {
      const env = amp * Math.sin(Math.PI * k / len);
      const fm  = 1 + 0.015 * Math.sin(2 * Math.PI * 8 * k / sr);
      d[pos + k] += env * Math.sin(2 * Math.PI * freq * fm * k / sr);
    }
  }

  // Crickets
  for (let c = 0; c < 8; c++) {
    const freq = 3400 + Math.random() * 900;
    const pos  = Math.floor(Math.random() * (n - sr * 2));
    const len  = Math.floor(sr * (0.8 + Math.random() * 1.5));
    for (let k = 0; k < len && pos + k < n; k++) {
      d[pos + k] += 0.055 * Math.sin(Math.PI * k / len)
                         * Math.sin(2 * Math.PI * freq * k / sr);
    }
  }

  normalize(d, 0.55);
  fadeEdges(d, sr, 0.3);
  return d;
}

function makeOcean(sr) {
  const n = sr * 16;
  const d = noiseData(n);
  lowpass(d, 900, sr);
  highpass(d, 40, sr);

  // Wave envelope — crash pattern
  for (let i = 0; i < n; i++) {
    const t     = i / sr;
    const wave  = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * 0.09 * t), 2)
                * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.04 * t + 1.1));
    d[i] *= wave;
  }

  normalize(d, 0.68);
  fadeEdges(d, sr, 0.35);
  return d;
}

function makeFire(sr) {
  const n = sr * 9;
  const d = noiseData(n);
  highpass(d, 200, sr);
  lowpass(d, 4500, sr);

  // Crackles — short high-amp bursts
  for (let c = 0; c < 280; c++) {
    const pos = Math.floor(Math.random() * n);
    const len = Math.floor(sr * (0.002 + Math.random() * 0.005));
    const amp = 0.45 + Math.random() * 0.7;
    for (let k = 0; k < len && pos + k < n; k++) {
      d[pos + k] += amp * Math.exp(-k / (len * 0.35)) * (Math.random() * 2 - 1);
    }
  }

  // Flame flicker modulation
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] *= 0.55 + 0.28 * Math.sin(2 * Math.PI * 4.3 * t)
                 + 0.17 * Math.sin(2 * Math.PI * 9.7 * t + 2.1);
  }

  normalize(d, 0.62);
  fadeEdges(d, sr, 0.12);
  return d;
}

function makeCafe(sr) {
  const n = sr * 18;
  const d = noiseData(n);
  lowpass(d, 2500, sr);
  for (let i = 0; i < n; i++) d[i] *= 0.07; // quiet murmur bed

  // Conversation blobs
  const voices = 16 + Math.floor(Math.random() * 6);
  for (let v = 0; v < voices; v++) {
    const freq = 180 + Math.random() * 600;
    const pos  = Math.floor(Math.random() * n);
    const len  = Math.floor(sr * (0.4 + Math.random() * 2.0));
    const amp  = 0.07 + Math.random() * 0.13;
    for (let k = 0; k < len && pos + k < n; k++) {
      d[pos + k] += amp * Math.sin(Math.PI * k / len)
                        * Math.sin(2 * Math.PI * freq * k / sr);
    }
  }

  // Cup/spoon clinks
  for (let c = 0; c < 14; c++) {
    const freq = 900 + Math.random() * 1800;
    const pos  = Math.floor(Math.random() * n);
    const len  = Math.floor(sr * (0.05 + Math.random() * 0.12));
    const amp  = 0.14 + Math.random() * 0.22;
    for (let k = 0; k < len && pos + k < n; k++) {
      d[pos + k] += amp * Math.exp(-k / (len * 0.18))
                        * Math.sin(2 * Math.PI * freq * k / sr);
    }
  }

  normalize(d, 0.52);
  fadeEdges(d, sr, 0.3);
  return d;
}

function makeWhiteNoise(sr) {
  const n = sr * 5;
  const d = noiseData(n);
  lowpass(d, 14000, sr);
  normalize(d, 0.45);
  fadeEdges(d, sr, 0.1);
  return d;
}

// ─── Generator registry ───────────────────────────────────────────────────────

const GENERATORS = {
  rain:       makeRain,
  thunder:    makeThunder,
  wind:       makeWind,
  forest:     makeForest,
  ocean:      makeOcean,
  fire:       makeFire,
  cafe:       makeCafe,
  whitenoise: makeWhiteNoise,
};

/**
 * Procedurally generate the AudioBuffer for a track.
 * Synchronous — typically completes in < 100ms for all 8 tracks combined.
 */
export function generateTrack(id) {
  const c     = getContext();
  const track = trackMap.get(id);
  if (!track || !GENERATORS[id]) return false;

  const sr   = c.sampleRate;
  const data = GENERATORS[id](sr);

  const buffer = c.createBuffer(1, data.length, sr);
  buffer.copyToChannel(data, 0);
  track.buffer = buffer;
  return true;
}

// ─── Playback ─────────────────────────────────────────────────────────────────

export function playTrack(id) {
  const c     = getContext();
  const track = trackMap.get(id);
  if (!track || !track.buffer || track.source) return;

  const source  = c.createBufferSource();
  source.buffer = track.buffer;
  source.loop   = true;
  source.connect(track.gainNode);
  source.start(0);
  track.source = source;
}

export function stopTrack(id) {
  const track = trackMap.get(id);
  if (!track || !track.source) return;
  try { track.source.stop(); } catch (_) { /* already stopped */ }
  track.source.disconnect();
  track.source = null;
}

export function isPlaying(id) {
  const track = trackMap.get(id);
  return !!(track && track.source);
}

// ─── Volume ───────────────────────────────────────────────────────────────────

export function setVolume(id, val, rampTime = 0.05) {
  const c     = getContext();
  const track = trackMap.get(id);
  if (!track) return;
  track.gainNode.gain.setTargetAtTime(val, c.currentTime, rampTime);
}

export function fadeVolume(id, targetVol, duration = 0.8) {
  const c     = getContext();
  const track = trackMap.get(id);
  if (!track) return;
  const now = c.currentTime;
  track.gainNode.gain.cancelScheduledValues(now);
  track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
  track.gainNode.gain.linearRampToValueAtTime(targetVol, now + duration);
}

export function getVolume(id) {
  const track = trackMap.get(id);
  return track ? track.gainNode.gain.value : 0;
}

// ─── Master volume & mute ─────────────────────────────────────────────────────

export function setMasterVolume(val) {
  if (!masterGain) getContext();
  lastMasterVol = val;
  if (!isMuted) masterGain.gain.setTargetAtTime(val, ctx.currentTime, 0.05);
}

export function getMasterVolume() { return lastMasterVol; }

export function toggleMute() {
  if (!masterGain) getContext();
  isMuted = !isMuted;
  masterGain.gain.setTargetAtTime(isMuted ? 0 : lastMasterVol, ctx.currentTime, 0.05);
  return isMuted;
}

export function getMuted() { return isMuted; }

// ─── Analyser ─────────────────────────────────────────────────────────────────

export function getAnalyser() {
  if (!analyser) getContext();
  return analyser;
}

// ─── Silence all ─────────────────────────────────────────────────────────────

export function silenceAll() {
  for (const [id, track] of trackMap) {
    if (track.source) {
      fadeVolume(id, 0, 0.3);
      setTimeout(() => stopTrack(id), 380);
    }
  }
}
