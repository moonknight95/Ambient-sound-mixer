# 🌿 Ambient Sound Mixer

A beautiful ambient soundscape mixer built with vanilla HTML, CSS, and the Web Audio API.

**[Live Demo →](https://YOUR_USERNAME.github.io/jsmixer)**

![Ambient Sound Mixer UI](https://raw.githubusercontent.com/YOUR_USERNAME/jsmixer/main/preview.png)

---

## Features

- 🎚️ **8 ambient tracks** — Rain, Thunder, Wind, Forest, Ocean, Fire, Café, White Noise
- 🎛️ Per-track volume sliders with smooth gain ramping (no clicks)
- 🌟 **6 built-in presets** — Deep Focus, Rainy Night, Forest Morning, Cozy Cafe, Ocean Breeze, Campfire
- 💾 Save & delete **custom presets** (persisted to localStorage)
- 📊 Real-time **audio visualiser** (AnalyserNode → canvas)
- ⌨️ Keyboard shortcuts — `Space` mute/unmute, `R` random preset
- 💾 **State persistence** — volumes and active tracks restored on reload
- 🎨 Dark glassmorphism design with animated glow effects
- 📱 Fully responsive CSS Grid layout

## Tech Stack

| Layer | Tech |
|---|---|
| Structure | Semantic HTML5 |
| Styles | Vanilla CSS (design tokens, glassmorphism, micro-animations) |
| Audio | Web Audio API (`AudioContext`, `BufferSourceNode`, `GainNode`, `AnalyserNode`) |
| Logic | Vanilla ES Modules (no framework, no bundler) |
| Fonts | Google Fonts — Inter + Outfit |

## Running Locally

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/jsmixer.git
cd jsmixer

# Generate synthetic sound files (Python 3 required)
python generate_sounds.py

# Serve (Web Audio API requires HTTP, not file://)
python -m http.server 5500
# then open http://localhost:5500
```

> **Note:** You can replace the generated `.wav` files with real ambient recordings.  
> Place `.ogg` or `.mp3` files in `sounds/` — the engine tries `.ogg` → `.mp3` → `.wav`.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Mute / Unmute all |
| `R` | Apply a random preset |

## Audio Engine Architecture

```
BufferSource (loop)
      │
   GainNode (track vol)  ← setTargetAtTime() for smooth ramp
      │
 MasterGainNode          ← master vol + mute
      │
  AnalyserNode           ─── canvas visualiser
      │
  Destination
```

Key rules followed:
- `AudioContext` created lazily on first user gesture
- `ctx.resume()` guarded on every interaction
- `BufferSourceNode` recreated per play (they're one-shot)
- Stopped sources immediately disconnected to prevent memory leaks

## Sound Generation

The included `generate_sounds.py` script synthesises 8 × 30-second ambient loops using only Python's standard library (`wave`, `struct`, `math`, `random`) — no dependencies needed.

## Deploy to GitHub Pages

1. Create a repo named `jsmixer` on GitHub
2. `git remote add origin https://github.com/YOUR_USERNAME/jsmixer.git`
3. `git push -u origin main`
4. Go to **Settings → Pages → Source: main branch → / (root)**
5. Access at `https://YOUR_USERNAME.github.io/jsmixer`

## License

MIT
