# 🌿 Ambient Sound Mixer

A beautiful ambient soundscape mixer built with vanilla **HTML**, **CSS**, and the **Web Audio API**.

**[Live Demo →](https://moonknight95.github.io/Ambient-sound-mixer)**

---

## Features

- 🎚️ **8 ambient tracks** — Rain, Thunder, Wind, Forest, Ocean, Fire, Café, White Noise
- 🎛️ Per-track volume sliders with smooth gain ramping (no clicks)
- 🌟 **6 built-in presets** — Deep Focus, Rainy Night, Forest Morning, Cozy Cafe, Ocean Breeze, Campfire
- 💾 Save & delete **custom presets** (persisted to localStorage)
- 📊 Real-time **audio visualiser** (AnalyserNode → canvas)
- ⌨️ Keyboard shortcuts — `Space` mute/unmute · `R` random preset
- 💾 **State persistence** — volumes and active tracks restored on reload
- 🎨 Dark glassmorphism design with animated glow effects
- 📱 Fully responsive CSS Grid layout
- 🌐 **External Audio Fetching** — No heavy audio files stored in the repository. Audio is dynamically loaded using public MP3/OGG URLs!

---

## Tech Stack

| Layer   | Tech |
|---------|------|
| Structure | Semantic HTML5 |
| Styles  | Vanilla CSS (design tokens, glassmorphism, micro-animations) |
| Audio   | Web Audio API — direct BufferSource streaming using public URLs |
| Logic   | Vanilla ES Modules (no framework, no bundler) |
| Fonts   | Google Fonts — Inter + Outfit |

---

## Audio Engine Architecture

```
BufferSource (external audio buffer)
        │
   GainNode (per-track volume)  ← linearRampToValueAtTime for fades
        │
  MasterGainNode               ← master vol + mute toggle
        │
   AnalyserNode                ─── 52-bar canvas visualiser
        │
    Destination
```

**Key rules:**
- `AudioContext` created lazily (browser autoplay policy)
- `ctx.resume()` called on every user interaction
- `BufferSourceNode` recreated per play (one-shot design)
- Stopped sources immediately disconnected (no memory leaks)
- Volumes use `setTargetAtTime` / `linearRampToValueAtTime` (no clicks)
- Fault-tolerant fetch implementation that visually disables unavailable audio channels

---

## Running Locally

```bash
# Clone
git clone https://github.com/moonknight95/Ambient-sound-mixer.git
cd Ambient-sound-mixer

# Serve (Web Audio API requires HTTP, not file://)
npx serve .
# Or use live server
```

---

## Keyboard Shortcuts

| Key     | Action              |
|---------|---------------------|
| `Space` | Mute / Unmute all   |
| `R`     | Apply a random preset |

---

## Deploy to GitHub Pages

1. Push to `main` branch  
2. Go to **Settings → Pages → Source: `main` branch → `/ (root)` → Save**  
3. Live at: `https://moonknight95.github.io/Ambient-sound-mixer`

---

## License

MIT
