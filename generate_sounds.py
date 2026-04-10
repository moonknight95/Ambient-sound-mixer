"""
generate_sounds.py
==================
Generates 8 synthetic ambient sound files as .ogg audio using Python's wave
module + struct. Each sound is a unique procedural ambient texture.

Requires: Python 3 + pip install pydub (for ogg export)
OR: falls back to writing .wav files that browsers can also use.

Run:  python generate_sounds.py
"""

import os, math, struct, wave, random, subprocess, sys

SAMPLE_RATE = 44100
DURATION    = 30      # seconds per file
OUT_DIR     = "sounds"

os.makedirs(OUT_DIR, exist_ok=True)

def clamp(v, lo=-1.0, hi=1.0):
    return max(lo, min(hi, v))

def write_wav(filename, samples):
    """Write a list of float samples (-1..1) as a 16-bit mono WAV."""
    path = os.path.join(OUT_DIR, filename)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        packed = struct.pack(f"<{len(samples)}h",
                             *[int(clamp(s) * 32767) for s in samples])
        wf.writeframes(packed)
    print(f"  Wrote {path}  ({len(samples)//SAMPLE_RATE}s)")
    return path

# ── Low-pass filter ──────────────────────────────────────────────────────────
def lowpass(samples, cutoff_hz, sr=SAMPLE_RATE):
    alpha = cutoff_hz / (cutoff_hz + sr / (2 * math.pi))
    out, prev = [], 0.0
    for s in samples:
        prev = prev + alpha * (s - prev)
        out.append(prev)
    return out

# ── Band-pass filter ─────────────────────────────────────────────────────────
def bandpass(samples, lo, hi):
    return lowpass([s - lp for s, lp in zip(samples, lowpass(samples, lo))], hi)

# ── Helpers ──────────────────────────────────────────────────────────────────
def white_noise(n):
    return [random.uniform(-1, 1) for _ in range(n)]

def sine(freq, n, phase=0.0):
    return [math.sin(2*math.pi*freq*i/SAMPLE_RATE + phase) for i in range(n)]

def mix(*tracks, weights=None):
    if weights is None:
        weights = [1.0] * len(tracks)
    total_w = sum(weights)
    n = len(tracks[0])
    return [sum(tracks[j][i]*weights[j] for j in range(len(tracks)))/total_w
            for i in range(n)]

def fade(samples, fade_secs=1.5):
    """Apply fade-in and fade-out for seamless looping."""
    n = len(samples)
    fade_n = int(fade_secs * SAMPLE_RATE)
    result = list(samples)
    for i in range(fade_n):
        amp = i / fade_n
        result[i]   = result[i] * amp
        result[-i-1] = result[-i-1] * amp
    return result

N = SAMPLE_RATE * DURATION

print("Generating ambient sounds…\n")

# ── 1. Rain ──────────────────────────────────────────────────────────────────
print("1/8  rain")
noise = white_noise(N)
rain = lowpass(noise, 3000)
rain = [s * 0.48 for s in rain]
# Add occasional drop pops
for _ in range(1800):
    idx = random.randint(0, N-200)
    amp = random.uniform(0.2, 0.55)
    for k in range(80):
        rain[idx+k] = rain[idx+k] + amp * math.exp(-k/15) * random.choice([-1,1])
rain = [clamp(s*0.6) for s in rain]
write_wav("rain.wav", fade(rain))

# ── 2. Thunder ───────────────────────────────────────────────────────────────
print("2/8  thunder")
thud = white_noise(N)
thunder = lowpass(thud, 180)
# Big rumble bursts
for _ in range(6):
    start = random.randint(0, N - SAMPLE_RATE*4)
    duration = random.randint(SAMPLE_RATE, SAMPLE_RATE*4)
    amp = random.uniform(0.6, 1.0)
    for k in range(min(duration, N-start)):
        env = amp * math.exp(-3*k/duration)
        thunder[start+k] = thunder[start+k] * env * 1.8
thunder = [clamp(s) for s in thunder]
write_wav("thunder.wav", fade(thunder))

# ── 3. Wind ──────────────────────────────────────────────────────────────────
print("3/8  wind")
w = white_noise(N)
wind = lowpass(w, 600)
# Slow amplitude modulation (gusts)
for i in range(N):
    t = i / SAMPLE_RATE
    gust = 0.45 + 0.35 * math.sin(2*math.pi*0.07*t) + 0.2*math.sin(2*math.pi*0.03*t)
    wind[i] = wind[i] * gust
wind = [clamp(s * 0.65) for s in wind]
write_wav("wind.wav", fade(wind))

# ── 4. Forest ────────────────────────────────────────────────────────────────
print("4/8  forest")
base = white_noise(N)
forest = lowpass(base, 2000)
forest = [s * 0.15 for s in forest]
# Bird chirps (short sine bursts at random pitches)
for _ in range(80):
    freq  = random.uniform(2000, 5000)
    start = random.randint(0, N - 4000)
    chirp_n = random.randint(800, 3000)
    for k in range(min(chirp_n, N - start)):
        env = math.exp(-5*k/chirp_n)
        forest[start+k] = forest[start+k] + 0.18 * env * math.sin(2*math.pi*freq*k/SAMPLE_RATE)
# Crickets
for _ in range(12):
    freq  = random.uniform(3500, 4500)
    start = random.randint(0, N - SAMPLE_RATE)
    dur = random.randint(SAMPLE_RATE//2, SAMPLE_RATE*2)
    for k in range(min(dur, N-start)):
        forest[start+k] += 0.06 * math.sin(2*math.pi*freq*k/SAMPLE_RATE)
forest = [clamp(s) for s in forest]
write_wav("forest.wav", fade(forest))

# ── 5. Ocean ─────────────────────────────────────────────────────────────────
print("5/8  ocean")
w = white_noise(N)
ocean = lowpass(w, 800)
# Wave amplitude modulation
for i in range(N):
    t = i / SAMPLE_RATE
    wave_env = 0.5*(1 + math.sin(2*math.pi*0.12*t + 0.4)) * \
               (0.8 + 0.2*math.sin(2*math.pi*0.04*t))
    ocean[i] = ocean[i] * wave_env
# Low frequency swells
swells = sine(0.1, N)
for i in range(N):
    ocean[i] = ocean[i] * (0.6 + 0.4*abs(swells[i]))
ocean = [clamp(s * 0.7) for s in ocean]
write_wav("ocean.wav", fade(ocean))

# ── 6. Fire ──────────────────────────────────────────────────────────────────
print("6/8  fire")
w = white_noise(N)
# Fire = bandpass noise with crackling
fire = bandpass(w, 400, 4000)
# Random crackles
for _ in range(4000):
    idx = random.randint(0, N-100)
    amp = random.uniform(0.1, 0.4)
    for k in range(40):
        fire[idx+k] = fire[idx+k] + amp * math.exp(-k/8)
# Slow flicker
for i in range(N):
    t = i / SAMPLE_RATE
    flicker = 0.5 + 0.3*math.sin(2*math.pi*4.3*t) + 0.2*math.sin(2*math.pi*9.7*t)
    fire[i] = fire[i] * flicker
fire = [clamp(s * 0.6) for s in fire]
write_wav("fire.wav", fade(fire))

# ── 7. Cafe ──────────────────────────────────────────────────────────────────
print("7/8  cafe")
# Coffee shop: low murmur + clinking
murmur = lowpass(white_noise(N), 1500)
murmur = [s * 0.2 for s in murmur]
# Add speech-like formant bursts
for _ in range(200):
    start = random.randint(0, N - 8000)
    dur   = random.randint(2000, 7000)
    freq1 = random.uniform(300, 800)
    for k in range(min(dur, N-start)):
        env = min(k, dur-k) / (dur/2)
        murmur[start+k] += 0.07 * env * math.sin(2*math.pi*freq1*k/SAMPLE_RATE)
# Clinks
for _ in range(40):
    freq  = random.uniform(800, 2500)
    start = random.randint(0, N - 3000)
    for k in range(2000):
        murmur[start+k] += 0.12 * math.exp(-k/200) * math.sin(2*math.pi*freq*k/SAMPLE_RATE)
cafe = [clamp(s) for s in murmur]
write_wav("cafe.wav", fade(cafe))

# ── 8. White Noise ───────────────────────────────────────────────────────────
print("8/8  whitenoise")
wn = white_noise(N)
wn = [clamp(s * 0.55) for s in wn]
write_wav("whitenoise.wav", fade(wn))

print("\n✅ All 8 sounds generated in sounds/")
print("   The app will load .wav files automatically (Web Audio API supports WAV)")
print("\n   Tip: Rename or convert to .ogg for smaller file sizes (optional)")
