/**
 * audio-engine.js — Web Audio API engine
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

export async function loadTrack(id, url) {
  const c = getContext();
  const track = trackMap.get(id);
  if (!track) throw new Error(`Track ${id} not initialised`);

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    const arrayBuf = await resp.arrayBuffer();
    const buffer = await c.decodeAudioData(arrayBuf);
    track.buffer = buffer;
    return true;
  } catch (e) {
    console.warn(`[AudioEngine] Could not load ${id}:`, e);
    return false;
  }
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
