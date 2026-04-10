/**
 * main.js — UI layer + state management for Ambient Sound Mixer
 *
 * All 8 ambient tracks are synthesised procedurally in audio-engine.js —
 * no external files, no network requests.
 */

import {
  getContext,
  resumeContext,
  initTrack,
  generateTrack,
  playTrack,
  stopTrack,
  isPlaying,
  setVolume,
  fadeVolume,
  getVolume,
  setMasterVolume,
  getMasterVolume,
  toggleMute,
  getMuted,
  getAnalyser,
  silenceAll,
} from "./audio-engine.js";

import {
  BUILT_IN_PRESETS,
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
} from "./presets.js";

// ─── Track definitions ────────────────────────────────────────────────────────

const TRACKS = [
  { id: "rain",       label: "Rain",       icon: "🌧️" },
  { id: "thunder",    label: "Thunder",    icon: "⛈️" },
  { id: "wind",       label: "Wind",       icon: "💨" },
  { id: "forest",     label: "Forest",     icon: "🌲" },
  { id: "ocean",      label: "Ocean",      icon: "🌊" },
  { id: "fire",       label: "Fire",       icon: "🔥" },
  { id: "cafe",       label: "Café",       icon: "☕" },
  { id: "whitenoise", label: "White Noise",icon: "〰️" },
];

const STATE_KEY  = "ambient_mixer_state";
const MASTER_KEY = "ambient_mixer_master";

// ─── State ────────────────────────────────────────────────────────────────────

let trackStates  = {};
let activePreset = null;
let customPresets = {};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const trackGrid        = document.getElementById("track-grid");
const masterVolSlider  = document.getElementById("master-vol");
const masterVolDisplay = document.getElementById("master-vol-display");
const muteBtn          = document.getElementById("mute-btn");
const presetContainer  = document.getElementById("preset-buttons");
const savePresetBtn    = document.getElementById("save-preset-btn");
const presetNameInput  = document.getElementById("preset-name-input");
const toastEl          = document.getElementById("toast");
const canvas           = document.getElementById("visualiser");
const ctx2d            = canvas ? canvas.getContext("2d") : null;
const loadingOverlay   = document.getElementById("loading-overlay");
const loadingProgress  = document.getElementById("loading-progress");
const loadingText      = document.getElementById("loading-text");

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = "info") {
  toastEl.textContent = msg;
  toastEl.className   = `toast toast--${type} toast--show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("toast--show"), 3000);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderTracks() {
  trackGrid.innerHTML = "";
  TRACKS.forEach(({ id, label, icon }) => {
    const st     = trackStates[id];
    const active = st?.active ?? false;
    const vol    = st?.volume ?? 40;

    const card       = document.createElement("div");
    card.className   = `track-card${active ? " active" : ""}`;
    card.dataset.id  = id;
    card.innerHTML   = `
      <div class="track-icon">${icon}</div>
      <div class="track-label">${label}</div>
      <label class="toggle-wrap" aria-label="Toggle ${label}">
        <input type="checkbox" class="track-toggle sr-only"
               data-id="${id}" ${active ? "checked" : ""}>
        <span class="toggle-pill"></span>
      </label>
      <div class="slider-wrap">
        <input type="range" class="track-slider" data-id="${id}"
               min="0" max="100" value="${vol}"
               aria-label="${label} volume">
        <span class="vol-display">${vol}%</span>
      </div>
    `;
    trackGrid.appendChild(card);
  });
}

// ─── Track UI helpers ─────────────────────────────────────────────────────────

function getCard(id) {
  return trackGrid.querySelector(`.track-card[data-id="${id}"]`);
}

function syncCardUI(id) {
  const st   = trackStates[id];
  const card = getCard(id);
  if (!card || !st) return;

  card.classList.toggle("active", st.active);

  const toggle = card.querySelector(".track-toggle");
  if (toggle) toggle.checked = st.active;

  const slider = card.querySelector(".track-slider");
  if (slider) slider.value = st.volume;

  const display = card.querySelector(".vol-display");
  if (display) display.textContent = `${st.volume}%`;
}

// ─── Audio interaction ────────────────────────────────────────────────────────

async function enableTrack(id, vol, fadeTime = 0.8) {
  await resumeContext();
  if (!isPlaying(id)) {
    setVolume(id, 0);
    playTrack(id);
  }
  fadeVolume(id, vol / 100, fadeTime);
  trackStates[id].active = true;
  trackStates[id].volume = vol;
  syncCardUI(id);
}

async function disableTrack(id, fadeTime = 0.8) {
  fadeVolume(id, 0, fadeTime);
  setTimeout(() => stopTrack(id), (fadeTime + 0.05) * 1000);
  trackStates[id].active = false;
  syncCardUI(id);
}

// ─── Event delegation ─────────────────────────────────────────────────────────

trackGrid.addEventListener("change", async (e) => {
  const { target } = e;
  const id = target.dataset.id;
  if (!id) return;

  await resumeContext();

  if (target.classList.contains("track-toggle")) {
    if (target.checked) {
      await enableTrack(id, trackStates[id]?.volume ?? 50);
    } else {
      await disableTrack(id);
    }
    activePreset = null;
    updatePresetHighlight();
    persistState();
  }

  if (target.classList.contains("track-slider")) {
    const vol = parseInt(target.value, 10);
    trackStates[id].volume = vol;

    const display = target.nextElementSibling;
    if (display) display.textContent = `${vol}%`;

    if (vol > 0 && !trackStates[id].active) {
      await enableTrack(id, vol, 0.3);
    } else if (vol === 0 && trackStates[id].active) {
      await disableTrack(id, 0.3);
    } else if (trackStates[id].active) {
      setVolume(id, vol / 100);
    }

    activePreset = null;
    updatePresetHighlight();
    persistState();
  }
});

// ─── Master volume ────────────────────────────────────────────────────────────

masterVolSlider.addEventListener("input", async () => {
  await resumeContext();
  const val = parseInt(masterVolSlider.value, 10);
  masterVolDisplay.textContent = `${val}%`;
  setMasterVolume(val / 100);
  localStorage.setItem(MASTER_KEY, val);
});

// ─── Mute ─────────────────────────────────────────────────────────────────────

muteBtn.addEventListener("click", async () => {
  await resumeContext();
  const muted = toggleMute();
  muteBtn.classList.toggle("muted", muted);
  muteBtn.setAttribute("aria-pressed", muted);
  muteBtn.querySelector(".mute-label").textContent = muted ? "Unmute" : "Mute";
  muteBtn.querySelector(".mute-icon").textContent  = muted ? "🔇" : "🔊";
});

// ─── Presets ──────────────────────────────────────────────────────────────────

function getAllPresets() {
  return { ...BUILT_IN_PRESETS, ...customPresets };
}

function renderPresets() {
  presetContainer.innerHTML = "";
  Object.keys(getAllPresets()).forEach((name) => {
    const isCustom = !!customPresets[name];
    const btn      = document.createElement("button");
    btn.className  = `preset-btn${activePreset === name ? " active" : ""}`;
    btn.dataset.name = name;
    btn.innerHTML  = `<span>${name}</span>${isCustom ? `<span class="preset-delete" data-name="${name}" title="Delete">✕</span>` : ""}`;
    presetContainer.appendChild(btn);
  });
}

function updatePresetHighlight() {
  presetContainer.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.name === activePreset);
  });
}

async function applyPreset(name) {
  const preset = getAllPresets()[name];
  if (!preset) return;

  silenceAll();
  activePreset = name;

  TRACKS.forEach(({ id }) => {
    trackStates[id] = { active: false, volume: trackStates[id]?.volume ?? 40 };
  });

  await new Promise((r) => setTimeout(r, 380));

  for (const [id, vol] of Object.entries(preset)) {
    if (!trackStates[id]) continue;
    const volPct = Math.round(vol * 100);
    trackStates[id].volume = volPct;
    await enableTrack(id, volPct, 1.5);
  }

  updatePresetHighlight();
  renderTracks();
  persistState();
  showToast(`"${name}" applied ✓`, "success");
}

presetContainer.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".preset-delete");
  if (delBtn) {
    e.stopPropagation();
    const name = delBtn.dataset.name;
    deleteCustomPreset(name);
    delete customPresets[name];
    if (activePreset === name) activePreset = null;
    renderPresets();
    showToast(`"${name}" deleted`, "info");
    return;
  }

  const presetBtn = e.target.closest(".preset-btn");
  if (presetBtn) {
    await resumeContext();
    await applyPreset(presetBtn.dataset.name);
  }
});

savePresetBtn.addEventListener("click", () => {
  const name = presetNameInput.value.trim();
  if (!name) { showToast("Enter a preset name first", "warn"); return; }

  const snapshot = {};
  TRACKS.forEach(({ id }) => {
    const st = trackStates[id];
    if (st?.active && st.volume > 0) snapshot[id] = st.volume / 100;
  });

  if (!Object.keys(snapshot).length) {
    showToast("No active tracks to save!", "warn");
    return;
  }

  saveCustomPreset(name, snapshot);
  customPresets[name] = snapshot;
  activePreset = name;
  renderPresets();
  presetNameInput.value = "";
  showToast(`"${name}" saved ✓`, "success");
});

// ─── State persistence ────────────────────────────────────────────────────────

function persistState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(trackStates));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) trackStates = JSON.parse(raw);
  } catch { /* ignore */ }
  TRACKS.forEach(({ id }) => {
    if (!trackStates[id]) trackStates[id] = { active: false, volume: 40 };
  });
}

function restoreMasterVol() {
  const stored = parseInt(localStorage.getItem(MASTER_KEY), 10);
  const val    = isNaN(stored) ? 80 : stored;
  masterVolSlider.value        = val;
  masterVolDisplay.textContent = `${val}%`;
  setMasterVolume(val / 100);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener("keydown", async (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); muteBtn.click(); }
  if (e.key === "r" || e.key === "R") {
    const all  = Object.keys(getAllPresets());
    await resumeContext();
    await applyPreset(all[Math.floor(Math.random() * all.length)]);
  }
});

// ─── Visualiser ───────────────────────────────────────────────────────────────

function resizeCanvas() {
  if (!canvas) return;
  canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx2d.scale(devicePixelRatio, devicePixelRatio);
}

function drawVisualiser() {
  requestAnimationFrame(drawVisualiser);
  if (!canvas || !ctx2d) return;

  const an    = getAnalyser();
  const buf   = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(buf);

  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  ctx2d.clearRect(0, 0, W, H);

  const bars = 52;
  const barW = (W / bars) - 1.5;
  const step = Math.floor(buf.length / bars);

  for (let i = 0; i < bars; i++) {
    const val  = buf[i * step] / 255;
    const barH = val * H * 0.9;
    const x    = i * (barW + 1.5);
    const y    = H - barH;

    const grad = ctx2d.createLinearGradient(0, y, 0, H);
    grad.addColorStop(0, `hsla(${200 + val * 80}, 85%, 65%, 0.92)`);
    grad.addColorStop(1, `hsla(${200 + val * 80}, 85%, 38%, 0.35)`);

    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, barW, barH, 3);
    ctx2d.fill();
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  restoreState();
  customPresets = loadCustomPresets();

  // Show loading overlay
  if (loadingOverlay) loadingOverlay.style.display = "flex";

  // Bootstrap AudioContext + master volume
  getContext();
  restoreMasterVol();

  // Initialise track slots
  TRACKS.forEach(({ id }) => initTrack(id));

  // Generate all sounds procedurally (synchronous, ~50-100ms total)
  if (loadingText) loadingText.textContent = "Synthesising sounds…";
  TRACKS.forEach(({ id }, idx) => {
    generateTrack(id);
    if (loadingProgress) {
      loadingProgress.style.width = `${((idx + 1) / TRACKS.length) * 100}%`;
    }
  });

  // Render UI
  renderTracks();
  renderPresets();

  // Hide overlay
  if (loadingOverlay) {
    loadingOverlay.classList.add("done");
    setTimeout(() => (loadingOverlay.style.display = "none"), 600);
  }

  // Restore active tracks from saved state
  TRACKS.forEach(({ id }) => {
    const st = trackStates[id];
    if (st?.active) {
      setVolume(id, 0);
      playTrack(id);
      fadeVolume(id, st.volume / 100, 1.2);
    }
  });

  // Start visualiser
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  drawVisualiser();
}

init();
