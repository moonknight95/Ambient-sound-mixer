/**
 * main.js — UI layer + state management for Ambient Sound Mixer
 *
 * Responsibilities:
 *  - Render track cards from TRACKS data
 *  - Wire all events (toggle, slider, master vol, mute, keyboard)
 *  - Manage preset system (built-in + custom)
 *  - Persist & restore state via localStorage
 *  - Drive the AnalyserNode canvas visualiser
 */

import {
  getContext,
  resumeContext,
  initTrack,
  loadTrack,
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
  { id: "rain",       label: "Rain",        src: "sounds/rain",       icon: "🌧️" },
  { id: "thunder",    label: "Thunder",      src: "sounds/thunder",    icon: "⛈️" },
  { id: "wind",       label: "Wind",         src: "sounds/wind",       icon: "💨" },
  { id: "forest",     label: "Forest",       src: "sounds/forest",     icon: "🌲" },
  { id: "ocean",      label: "Ocean",        src: "sounds/ocean",      icon: "🌊" },
  { id: "fire",       label: "Fire",         src: "sounds/fire",       icon: "🔥" },
  { id: "cafe",       label: "Café",         src: "sounds/cafe",       icon: "☕" },
  { id: "whitenoise", label: "White Noise",  src: "sounds/whitenoise", icon: "〰️" },
];

const STATE_KEY   = "ambient_mixer_state";
const MASTER_KEY  = "ambient_mixer_master";

// ─── State ────────────────────────────────────────────────────────────────────

let trackStates = {};   // { id: { active: bool, volume: 0–100 } }
let activePreset = null;
let customPresets = {}; // merged from localStorage
let loadError = {};     // tracks that failed to load

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

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = "info") {
  toastEl.textContent = msg;
  toastEl.className = `toast toast--${type} toast--show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("toast--show"), 3000);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderTracks() {
  trackGrid.innerHTML = "";
  TRACKS.forEach(({ id, label, icon }) => {
    const st = trackStates[id];
    const active = st?.active ?? false;
    const vol    = st?.volume ?? 40;
    const failed = loadError[id];

    const card = document.createElement("div");
    card.className = `track-card${active ? " active" : ""}${failed ? " failed" : ""}`;
    card.dataset.id = id;
    card.innerHTML = `
      <div class="track-icon">${icon}</div>
      <div class="track-label">${label}</div>
      ${failed ? `<div class="track-error">⚠️ No audio file</div>` : ""}
      <label class="toggle-wrap" aria-label="Toggle ${label}">
        <input type="checkbox" class="track-toggle sr-only" data-id="${id}" ${active ? "checked" : ""} ${failed ? "disabled" : ""}>
        <span class="toggle-pill"></span>
      </label>
      <div class="slider-wrap">
        <input type="range" class="track-slider" data-id="${id}"
          min="0" max="100" value="${vol}" ${failed ? "disabled" : ""}
          aria-label="${label} volume">
        <span class="vol-display">${vol}%</span>
      </div>
    `;
    trackGrid.appendChild(card);
  });
}

// ─── Track state helpers ──────────────────────────────────────────────────────

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
  const target = e.target;
  const id     = target.dataset.id;
  if (!id) return;

  await resumeContext();

  if (target.classList.contains("track-toggle")) {
    const nowActive = target.checked;
    if (nowActive) {
      const vol = trackStates[id]?.volume ?? 50;
      await enableTrack(id, vol);
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

    // Update display
    const display = target.nextElementSibling;
    if (display) display.textContent = `${vol}%`;

    // Auto-enable if slider moved above 0
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
  muteBtn.querySelector(".mute-icon").textContent  = muted ? "🔇" : "📢";
});

// ─── Presets ──────────────────────────────────────────────────────────────────

function getAllPresets() {
  return { ...BUILT_IN_PRESETS, ...customPresets };
}

function renderPresets() {
  presetContainer.innerHTML = "";
  const all = getAllPresets();
  Object.keys(all).forEach((name) => {
    const isCustom   = !!customPresets[name];
    const btn        = document.createElement("button");
    btn.className    = `preset-btn${activePreset === name ? " active" : ""}`;
    btn.dataset.name = name;
    btn.innerHTML    = `<span>${name}</span>${isCustom ? `<span class="preset-delete" data-name="${name}" title="Delete">✕</span>` : ""}`;
    presetContainer.appendChild(btn);
  });
}

function updatePresetHighlight() {
  presetContainer.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.name === activePreset);
  });
}

async function applyPreset(name) {
  const all    = getAllPresets();
  const preset = all[name];
  if (!preset) return;

  silenceAll();
  activePreset = name;

  // Reset all track states
  TRACKS.forEach(({ id }) => {
    trackStates[id] = { active: false, volume: trackStates[id]?.volume ?? 40 };
  });

  // Wait a tiny moment for silence to propagate
  await new Promise((r) => setTimeout(r, 400));

  // Fade in preset tracks
  const entries = Object.entries(preset);
  for (const [id, vol] of entries) {
    if (!trackStates[id]) continue;
    const volPct = Math.round(vol * 100);
    trackStates[id].volume = volPct;
    await enableTrack(id, volPct, 1.5);
  }

  updatePresetHighlight();
  renderTracks(); // sync all cards
  persistState();
  showToast(`Preset "${name}" applied ✓`, "success");
}

presetContainer.addEventListener("click", async (e) => {
  // Delete button
  const delBtn = e.target.closest(".preset-delete");
  if (delBtn) {
    e.stopPropagation();
    const name = delBtn.dataset.name;
    deleteCustomPreset(name);
    delete customPresets[name];
    if (activePreset === name) activePreset = null;
    renderPresets();
    showToast(`Preset "${name}" deleted`, "info");
    return;
  }

  // Preset button
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
    if (st?.active && st.volume > 0) {
      snapshot[id] = st.volume / 100;
    }
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
  showToast(`Preset "${name}" saved ✓`, "success");
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
    if (!trackStates[id]) {
      trackStates[id] = { active: false, volume: 40 };
    }
  });
}

function restoreMasterVol() {
  const stored = parseInt(localStorage.getItem(MASTER_KEY), 10);
  const val    = isNaN(stored) ? 80 : stored;
  masterVolSlider.value          = val;
  masterVolDisplay.textContent   = `${val}%`;
  setMasterVolume(val / 100);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener("keydown", async (e) => {
  if (e.target.tagName === "INPUT") return;

  if (e.code === "Space") {
    e.preventDefault();
    muteBtn.click();
  }

  if (e.key === "r" || e.key === "R") {
    const all  = Object.keys(getAllPresets());
    const name = all[Math.floor(Math.random() * all.length)];
    await resumeContext();
    await applyPreset(name);
  }
});

// ─── Visualiser ───────────────────────────────────────────────────────────────

function resizeCanvas() {
  if (!canvas) return;
  canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  ctx2d.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawVisualiser() {
  requestAnimationFrame(drawVisualiser);
  if (!canvas || !ctx2d) return;

  const analyser = getAnalyser();
  const bufLen   = analyser.frequencyBinCount;
  const data     = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);

  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;

  ctx2d.clearRect(0, 0, W, H);

  const barCount = 48;
  const barW     = (W / barCount) - 1.5;
  const step     = Math.floor(bufLen / barCount);

  for (let i = 0; i < barCount; i++) {
    const val    = data[i * step] / 255;
    const barH   = val * H * 0.88;
    const x      = i * (barW + 1.5);
    const y      = H - barH;

    // Gradient bar
    const grad = ctx2d.createLinearGradient(0, y, 0, H);
    grad.addColorStop(0, `hsla(${200 + val * 80}, 85%, 65%, 0.9)`);
    grad.addColorStop(1, `hsla(${200 + val * 80}, 85%, 40%, 0.4)`);

    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.roundRect(x, y, barW, barH, 3);
    ctx2d.fill();
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  restoreState();
  customPresets = loadCustomPresets();

  // Show loading overlay
  if (loadingOverlay) loadingOverlay.style.display = "flex";

  // Init AudioContext (deferred to first user gesture, but we can set up nodes)
  getContext();
  restoreMasterVol();

  // Initialise all track slots
  TRACKS.forEach(({ id }) => initTrack(id));

  // Render initial UI
  renderTracks();
  renderPresets();

  // Load all audio files (concurrent)
  let loaded = 0;
  const results = await Promise.all(
    TRACKS.map(async ({ id, src }) => {
      const ok = await loadTrack(id, src);
      if (!ok) loadError[id] = true;
      loaded++;
      if (loadingProgress) {
        loadingProgress.style.width = `${(loaded / TRACKS.length) * 100}%`;
      }
      return ok;
    })
  );

  // Hide loading overlay
  if (loadingOverlay) {
    loadingOverlay.classList.add("done");
    setTimeout(() => (loadingOverlay.style.display = "none"), 600);
  }

  // Re-render with error states
  renderTracks();

  // Restore active tracks (only those that loaded successfully)
  for (const { id } of TRACKS) {
    const st = trackStates[id];
    if (st?.active && !loadError[id]) {
      setVolume(id, 0);
      playTrack(id);
      fadeVolume(id, st.volume / 100, 1.2);
    }
  }

  // Start visualiser
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  drawVisualiser();

  // Failed audio hint
  const failedCount = Object.keys(loadError).length;
  if (failedCount > 0) {
    showToast(
      `${failedCount} sound(s) not found — add .ogg/.mp3 files to /sounds/`,
      "warn"
    );
  }
}

init();
