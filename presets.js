/**
 * presets.js — Built-in and custom preset definitions
 * Each preset is a map of { trackId: volume (0–1) }
 */

export const BUILT_IN_PRESETS = {
  "Deep Focus": {
    rain: 0.5,
    whitenoise: 0.3,
    wind: 0.15,
  },
  "Rainy Night": {
    rain: 0.8,
    thunder: 0.4,
    wind: 0.25,
  },
  "Forest Morning": {
    forest: 0.75,
    wind: 0.2,
    rain: 0.1,
  },
  "Cozy Cafe": {
    cafe: 0.7,
    rain: 0.3,
    fire: 0.35,
  },
  "Ocean Breeze": {
    ocean: 0.8,
    wind: 0.3,
  },
  "Campfire": {
    fire: 0.75,
    forest: 0.3,
    wind: 0.15,
  },
};

const STORAGE_KEY = "ambient_mixer_custom_presets";

/**
 * Load custom presets from localStorage.
 * @returns {Object} custom presets map
 */
export function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save a single custom preset to localStorage.
 * @param {string} name - preset name
 * @param {Object} preset - { trackId: volume } map
 */
export function saveCustomPreset(name, preset) {
  const existing = loadCustomPresets();
  existing[name] = preset;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

/**
 * Delete a custom preset by name.
 * @param {string} name
 */
export function deleteCustomPreset(name) {
  const existing = loadCustomPresets();
  delete existing[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}
