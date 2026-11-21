import type { Random } from "../shuffle";
import type { Tempo } from "../tempo";
import { dbToGain } from "./curves";
import { createLimiter, REVERB_CLOSED_AT, REVERB_HIGHPASS_HZ, REVERB_WET_SCALE, type EqBandSpec, type EqState } from "./graph";
import pitchWorkletUrl from "./pitch.worklet.ts?worker&url";
import { generateImpulse } from "./reverbIr";

export interface SoundEffects {
  eq: EqState | null;
  bands: EqBandSpec[];
  reverb: { on: boolean; level: number };
  tempo: Tempo;
  gainDb: number;
}

const PITCH_FLOOR = 0.05;
const FADE_STEPS = 64;

// a linked speed already moves the pitch; an unlinked one keeps it, so the shifter undoes the speed
export function pitchShiftFor(tempo: Tempo): number {
  return tempo.linked ? 0 : tempo.semitones - 12 * Math.log2(tempo.rate);
}

export function wavBytes(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + frames * channels.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * channels.length * 2, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      view.setInt16(at, Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767), true);
      at += 2;
    }
  }
  return bytes;
}

function fadeCurve(rising: boolean): Float32Array {
  return Float32Array.from({ length: FADE_STEPS }, (_, i) => {
    const t = i / (FADE_STEPS - 1);
    const eased = t * t * (3 - 2 * t);
    return rising ? eased : 1 - eased;
  });
}

export async function renderWithEffects(
  song: AudioBuffer,
  fromMs: number,
  lenMs: number,
  sound: SoundEffects,
  fadeMs: number,
  random: Random,
): Promise<AudioBuffer> {
  const rate = sound.tempo.rate;
  const sampleRate = song.sampleRate;
  const outSeconds = lenMs / rate / 1000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round(outSeconds * sampleRate)), sampleRate);

  const source = ctx.createBufferSource();
  source.buffer = song;
  source.playbackRate.value = rate;
  const loudness = ctx.createGain();
  loudness.gain.value = dbToGain(sound.gainDb);
  let chain: AudioNode = source.connect(loudness);

  const shift = pitchShiftFor(sound.tempo);
  if (Math.abs(shift) >= PITCH_FLOOR) {
    await ctx.audioWorklet.addModule(pitchWorkletUrl);
    const pitch = new AudioWorkletNode(ctx, "nuvo-pitch", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    pitch.parameters.get("semitones")?.setValueAtTime(shift, 0);
    chain = chain.connect(pitch);
  }

  const flat = !sound.eq || !sound.eq.enabled || sound.eq.bypass;
  const preamp = ctx.createGain();
  preamp.gain.value = flat ? 1 : dbToGain(sound.eq!.preampDb);
  chain = chain.connect(preamp);
  sound.bands.forEach((band, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.frequency;
    filter.Q.value = band.q;
    filter.gain.value = flat ? 0 : (sound.eq!.gains[i] ?? 0);
    chain = chain.connect(filter);
  });

  const master = ctx.createGain();
  chain.connect(master);
  if (sound.reverb.on && sound.reverb.level > REVERB_CLOSED_AT) {
    const [left, right] = generateImpulse(sampleRate, random);
    const impulse = ctx.createBuffer(2, left.length, sampleRate);
    impulse.getChannelData(0).set(left);
    impulse.getChannelData(1).set(right);
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = REVERB_HIGHPASS_HZ;
    highpass.Q.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = sound.reverb.level * REVERB_WET_SCALE;
    chain.connect(convolver).connect(highpass).connect(wet).connect(master);
  }

  const fade = Math.min(fadeMs, lenMs / 2) / rate / 1000;
  if (fade > 0) {
    master.gain.setValueCurveAtTime(fadeCurve(true), 0, fade);
    master.gain.setValueCurveAtTime(fadeCurve(false), outSeconds - fade, fade);
  }
  const [limiter, trim] = createLimiter(ctx);
  master.connect(limiter);
  trim.connect(ctx.destination);
  source.start(0, fromMs / 1000, lenMs / 1000);
  return ctx.startRendering();
}
