"""Builds the spoken test songs: espeak-ng words at known times over a synthetic backing track.

Run from this folder with espeak-ng and ffmpeg on PATH: python3 make.py
"""

import array
import math
import subprocess
import tempfile

RATE = 16000
LINES = {
    "en": ["The river runs along the quiet town", "We sing until the morning light", "Hold the line and never let it go"],
    "ru": ["Солнце встаёт над тихой рекой", "Мы поём до самого утра", "Держи меня и не отпускай"],
}
WORD_GAP = 0.12
LINE_GAP = 1.2
# The stamps a lyrics site might give: a little early or late.
LRC_JITTER = [0.3, -0.25, 0.2]


def speak(lang, word):
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
        subprocess.run(["espeak-ng", "-v", lang, "-s", "150", "-w", wav.name, word], check=True)
        raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", wav.name, "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"], check=True, capture_output=True).stdout
    samples = array.array("h", raw)
    loud = [i for i, s in enumerate(samples) if abs(s) > 600]
    return samples[loud[0]:loud[-1] + 1]


def backing(length):
    chords = [(220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7), (164.8, 207.7, 246.9)]
    out = []
    for i in range(length):
        t = i / RATE
        chord = chords[int(t / 2) % len(chords)]
        pad = sum(math.sin(2 * math.pi * f * t) for f in chord) / 3
        beat = t % 0.5
        kick = math.sin(2 * math.pi * 55 * t) * math.exp(-beat * 18)
        out.append(0.18 * pad + 0.25 * kick)
    return out


def build(lang):
    voice, truth, lrc = [], [], []
    at = 1.0
    for number, line in enumerate(LINES[lang]):
        lrc.append((at + LRC_JITTER[number], line))
        for word in line.split():
            samples = speak(lang, word)
            start = int(at * RATE)
            voice.extend([0] * (start - len(voice)))
            voice.extend(samples)
            truth.append((round(at * 1000), round((at + len(samples) / RATE) * 1000), word))
            at += len(samples) / RATE + WORD_GAP
        at += LINE_GAP
    length = len(voice) + RATE
    voice.extend([0] * (length - len(voice)))
    music = backing(length)
    mixed = array.array("h", (max(-32767, min(32767, int(v + m * 9000))) for v, m in zip(voice, music)))
    with open(f"{lang}.s16", "wb") as out:
        mixed.tofile(out)
    with open(f"{lang}.lrc", "w", encoding="utf-8") as out:
        for start, line in lrc:
            out.write(f"[{int(start // 60):02}:{start % 60:05.2f}]{line}\n")
    with open(f"{lang}.words", "w", encoding="utf-8") as out:
        for start, end, word in truth:
            out.write(f"{start}\t{end}\t{word}\n")


for lang in LINES:
    build(lang)
