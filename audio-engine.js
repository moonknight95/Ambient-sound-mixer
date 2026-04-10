/**
 * audio-engine.js — Web Audio API engine for Ambient Sound Mixer
 *
 * Architecture per track:
 *   BufferSource (loop) → GainNode (track vol) → MasterGainNode → Destination
 *                                                      ↓
 *                                               AnalyserNode → Canvas
 */

// ─── AudioContext (lazy singleton) ───────────────────────────────────────────

let ctx = null;
let masterGain = null;
let analyser = null;
let isMuted = false;
let lastMasterVol = 1;

/**
 * Returns (or creates) the shared AudioContext.
 * Must be called from a user gesture to satisfy browser autoplay policy.
 */
export function getContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    // Master gain node
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;

    // AnalyserNode for visualiser
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
  }
  return ctx;
}

/**
 * Resume context if suspended (required after page focus loss or pre-gesture init).
 */
export async function resumeContext() {
  const c = getContext();
  if (c.state === "suspended") {
    await c.resume();
  }
}

// ─── Track map ───────────────────────────────────────────────────────────────

/**
 * Internal track state map keyed by track id.
 * @type {Map<string, { buffer: AudioBuffer|null, gainNode: GainNode, source: AudioBufferSourceNode|null }>}
 */
const trackMap = new Map();

/**
 * Initialise a track slot (no audio loaded yet).
 */
export function initTrack(id) {
  if (trackMap.has(id)) return;
  const c = getContext();
  const gainNode = c.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(masterGain);
  trackMap.set(id, { buffer: null, gainNode, source: null });
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * Fetch and decode audio for one track.
 * Tries .ogg first, falls back to .mp3.
 * @param {string} id - track id
 * @param {string} baseUrl - path without extension, e.g. "sounds/rain"
 */
export async function loadTrack(id, baseUrl) {
  const c = getContext();
  const track = trackMap.get(id);
  if (!track) throw new Error(`Track ${id} not initialised`);

  const urls = [`${baseUrl}.ogg`, `${baseUrl}.mp3`, `${baseUrl}.wav`];
  let buffer = null;
  let lastErr = null;

  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) { lastErr = new Error(`HTTP ${resp.status} for ${url}`); continue; }
      const arrayBuf = await resp.arrayBuffer();
      buffer = await c.decodeAudioData(arrayBuf);
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!buffer) {
    console.warn(`[AudioEngine] Could not load ${id}:`, lastErr);
    return false;
  }

  track.buffer = buffer;
  return true;
}

// ─── Playback ─────────────────────────────────────────────────────────────────

/**
 * Play a track (looped). Safe to call if already playing.
 * @param {string} id
 */
export function playTrack(id) {
  const c = getContext();
  const track = trackMap.get(id);
  if (!track || !track.buffer) return;
  if (track.source) return; // Already playing

  const source = c.createBufferSource();
  source.buffer = track.buffer;
  source.loop = true;
  source.connect(track.gainNode);
  source.start(0);
  track.source = source;
}

/**
 * Stop a track and disconnect its source node to free memory.
 */
export function stopTrack(id) {
  const track = trackMap.get(id);
  if (!track || !track.source) return;
  try {
    track.source.stop();
  } catch (_) { /* already stopped */ }
  track.source.disconnect();
  track.source = null;
}

/**
 * Returns true if a track is currently playing.
 */
export function isPlaying(id) {
  const track = trackMap.get(id);
  return !!(track && track.source);
}

// ─── Volume ───────────────────────────────────────────────────────────────────

/**
 * Set track volume with a smooth ramp (no clicks).
 * @param {string} id
 * @param {number} val - 0 to 1
 * @param {number} [rampTime=0.05]
 */
export function setVolume(id, val, rampTime = 0.05) {
  const c = getContext();
  const track = trackMap.get(id);
  if (!track) return;
  track.gainNode.gain.setTargetAtTime(val, c.currentTime, rampTime);
}

/**
 * Fade a track volume from current to target over `duration` seconds.
 */
export function fadeVolume(id, targetVol, duration = 0.8) {
  const c = getContext();
  const track = trackMap.get(id);
  if (!track) return;
  const now = c.currentTime;
  track.gainNode.gain.cancelScheduledValues(now);
  track.gainNode.gain.setValueAtTime(track.gainNode.gain.value, now);
  track.gainNode.gain.linearRampToValueAtTime(targetVol, now + duration);
}

/**
 * Get current gain value for a track.
 */
export function getVolume(id) {
  const track = trackMap.get(id);
  return track ? track.gainNode.gain.value : 0;
}

// ─── Master volume & mute ─────────────────────────────────────────────────────

export function setMasterVolume(val) {
  if (!masterGain) { getContext(); }
  lastMasterVol = val;
  if (!isMuted) {
    masterGain.gain.setTargetAtTime(val, ctx.currentTime, 0.05);
  }
}

export function getMasterVolume() {
  return lastMasterVol;
}

export function toggleMute() {
  if (!masterGain) { getContext(); }
  isMuted = !isMuted;
  masterGain.gain.setTargetAtTime(
    isMuted ? 0 : lastMasterVol,
    ctx.currentTime,
    0.05
  );
  return isMuted;
}

export function getMuted() {
  return isMuted;
}

// ─── Analyser ────────────────────────────────────────────────────────────────

export function getAnalyser() {
  if (!analyser) getContext();
  return analyser;
}

// ─── Silence all ─────────────────────────────────────────────────────────────

/**
 * Stop all tracks and reset their gain nodes.
 */
export function silenceAll() {
  for (const [id, track] of trackMap) {
    if (track.source) {
      fadeVolume(id, 0, 0.3);
      setTimeout(() => stopTrack(id), 350);
    }
  }
}
