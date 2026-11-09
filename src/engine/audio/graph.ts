import type { Random } from "../shuffle";
import { dbToGain } from "./curves";
import { generateImpulse } from "./reverbIr";
import { createSpectrumTap, type SpectrumTap } from "./spectrum";

export const EQ_RAMP_S = 0.02;
export const PITCH_SWITCH_S = 0.015;
export const SLEEP_RAMP_S = 0.3;
export const MASK_RAMP_S = 0.008;
export const REVERB_CLOSED_AT = 0.01;
export const REVERB_WET_SCALE = 1.2;
export const ANALYSER_FFT = 4096;
/** The send ramps to zero in about 20 ms; the edge is cut after the ramp has settled. */
const SEND_CLOSE_MS = 200;

export interface EqState {
  enabled: boolean;
  gains: number[];
  preampDb: number;
  bypass: boolean;
}

export interface EqBandSpec {
  type: BiquadFilterType;
  frequency: number;
  q: number;
}

export interface DeckNodes {
  source: MediaElementAudioSourceNode;
  transition: GainNode;
  loudness: GainNode;
}

export interface GraphDeps {
  bands: EqBandSpec[];
  loadPitch(context: AudioContext): Promise<AudioWorkletNode | null>;
  random: Random;
  // Kept across hot reload: a second source node for one element throws
  sources: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>;
}

export class AudioGraph {
  readonly decks: [DeckNodes, DeckNodes];
  readonly analyser: AnalyserNode;
  private readonly bus: GainNode;
  private readonly pitchDry: GainNode;
  private readonly pitchWet: GainNode;
  private readonly pitchSum: GainNode;
  private pitchNode: AudioWorkletNode | null = null;
  private pitchLinked = false;
  private pitchTimer: ReturnType<typeof setTimeout> | null = null;
  private pitchLoading: Promise<AudioWorkletNode | null> | null = null;
  private pitchUnavailable = false;
  private readonly preamp: GainNode;
  private readonly filters: BiquadFilterNode[];
  readonly eqOut: GainNode;
  readonly spectrum: SpectrumTap;
  private readonly send: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly wet: GainNode;
  private irBuilt = false;
  readonly master: GainNode;
  private sleepLevel = 1;
  private readonly nodes: AudioNode[] = [];
  private sendConnected = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    readonly context: AudioContext,
    elements: [HTMLMediaElement, HTMLMediaElement],
    private readonly deps: GraphDeps,
  ) {
    const ctx = context;
    const bus = this.own(ctx.createGain());
    this.bus = bus;
    this.decks = elements.map((element) => {
      let source = deps.sources.get(element);
      if (!source) {
        source = ctx.createMediaElementSource(element);
        deps.sources.set(element, source);
      }
      this.own(source);
      const transition = this.own(ctx.createGain());
      transition.gain.value = 0;
      const loudness = this.own(ctx.createGain());
      source.connect(transition).connect(loudness).connect(bus);
      return { source, transition, loudness };
    }) as [DeckNodes, DeckNodes];

    this.pitchDry = this.own(ctx.createGain());
    this.pitchWet = this.own(ctx.createGain());
    this.pitchWet.gain.value = 0;
    this.pitchSum = this.own(ctx.createGain());
    bus.connect(this.pitchDry).connect(this.pitchSum);
    this.pitchWet.connect(this.pitchSum);

    this.preamp = this.own(ctx.createGain());
    this.filters = deps.bands.map((band) => {
      const filter = this.own(ctx.createBiquadFilter());
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.Q.value = band.q;
      filter.gain.value = 0;
      return filter;
    });
    this.eqOut = this.own(ctx.createGain());
    this.spectrum = createSpectrumTap(ctx, this.eqOut);
    let chain: AudioNode = this.pitchSum.connect(this.preamp);
    for (const filter of this.filters) chain = chain.connect(filter);
    chain.connect(this.eqOut);

    this.master = this.own(ctx.createGain());
    const dry = this.own(ctx.createGain());
    this.eqOut.connect(dry).connect(this.master);
    this.send = this.own(ctx.createGain());
    this.send.gain.value = 0;
    this.convolver = this.own(ctx.createConvolver());
    const highpass = this.own(ctx.createBiquadFilter());
    highpass.type = "highpass";
    highpass.frequency.value = 120;
    highpass.Q.value = 0.7;
    this.wet = this.own(ctx.createGain());
    this.wet.gain.value = 0;
    this.eqOut.connect(this.send);
    this.convolver.connect(highpass).connect(this.wet).connect(this.master);

    this.analyser = this.own(ctx.createAnalyser());
    this.analyser.fftSize = ANALYSER_FFT;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master.connect(ctx.destination);
    this.master.connect(this.analyser);
  }

  private own<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  dispose(): void {
    this.disposed = true;
    this.spectrum.dispose();
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (this.pitchTimer) clearTimeout(this.pitchTimer);
    this.pitchTimer = null;
    for (const node of this.nodes) node.disconnect();
    if (this.pitchNode) this.pitchNode.disconnect();
  }

  private get now(): number {
    return this.context.currentTime;
  }

  resume(): void {
    if (this.context.state !== "running") void this.context.resume().catch(() => undefined);
  }

  shapeEq(state: EqState, rampSeconds = EQ_RAMP_S): void {
    this.resume();
    const flat = !state.enabled || state.bypass;
    this.filters.forEach((filter, i) => filter.gain.setTargetAtTime(flat ? 0 : (state.gains[i] ?? 0), this.now, rampSeconds));
    this.preamp.gain.setTargetAtTime(flat ? 1 : dbToGain(state.preampDb), this.now, rampSeconds);
  }

  setLoudness(deck: 0 | 1, db: number): void {
    this.decks[deck].loudness.gain.setTargetAtTime(dbToGain(db), this.now, EQ_RAMP_S);
  }

  presetLoudness(deck: 0 | 1, db: number): void {
    const param = this.decks[deck].loudness.gain;
    param.cancelScheduledValues(this.now);
    param.setValueAtTime(dbToGain(db), this.now);
  }

  get pitchAvailable(): boolean {
    return !this.pitchUnavailable;
  }

  async setPitch(active: boolean, semitones: number): Promise<void> {
    this.resume();
    if (active && !this.pitchNode && !this.pitchUnavailable) {
      this.pitchLoading ??= this.deps.loadPitch(this.context);
      const node = await this.pitchLoading;
      if (this.disposed) return;
      if (!node) {
        this.pitchUnavailable = true;
        return;
      }
      if (!this.pitchNode) {
        this.pitchNode = node;
        // from the bus, not the dry gain: that one closes as the shifter opens, and would silence it
        this.bus.connect(node);
      }
    }
    if (this.pitchNode) this.pitchNode.parameters.get("semitones")?.setValueAtTime(semitones, this.now);
    const wet = active && this.pitchNode ? 1 : 0;
    // An unconnected worklet output is not pulled, so the shifter costs no CPU while inactive.
    if (this.pitchTimer) clearTimeout(this.pitchTimer);
    this.pitchTimer = null;
    if (this.pitchNode && wet && !this.pitchLinked) {
      this.pitchNode.connect(this.pitchWet);
      this.pitchLinked = true;
    }
    if (this.pitchNode && !wet && this.pitchLinked) {
      const node = this.pitchNode;
      this.pitchTimer = setTimeout(() => {
        this.pitchTimer = null;
        node.disconnect();
        this.pitchLinked = false;
      }, SEND_CLOSE_MS);
    }
    this.pitchWet.gain.setTargetAtTime(wet, this.now, PITCH_SWITCH_S);
    this.pitchDry.gain.setTargetAtTime(1 - wet, this.now, PITCH_SWITCH_S);
  }

  setReverb(on: boolean, level: number): void {
    this.resume();
    const open = on && level > REVERB_CLOSED_AT;
    if (open && !this.irBuilt) {
      const [left, right] = generateImpulse(this.context.sampleRate, this.deps.random);
      const buffer = this.context.createBuffer(2, left.length, this.context.sampleRate);
      buffer.getChannelData(0).set(left);
      buffer.getChannelData(1).set(right);
      this.convolver.buffer = buffer;
      this.irBuilt = true;
    }
    // The convolver only receives input while reverb is open, so it costs no CPU otherwise.
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (open && !this.sendConnected) {
      this.send.connect(this.convolver);
      this.sendConnected = true;
    }
    if (!open && this.sendConnected) {
      this.sendTimer = setTimeout(() => {
        this.sendTimer = null;
        this.send.disconnect();
        this.sendConnected = false;
      }, SEND_CLOSE_MS);
    }
    this.send.gain.setTargetAtTime(open ? 1 : 0, this.now, EQ_RAMP_S);
    this.wet.gain.setTargetAtTime(open ? level * REVERB_WET_SCALE : 0, this.now, EQ_RAMP_S);
  }

  get impulseBuilt(): boolean {
    return this.irBuilt;
  }

  setSleepLevel(multiplier: number): void {
    this.sleepLevel = Math.min(1, Math.max(0, multiplier));
    this.master.gain.setTargetAtTime(this.sleepLevel, this.now, SLEEP_RAMP_S);
  }

  mask(down: boolean): void {
    const param = this.eqOut.gain;
    param.cancelScheduledValues(this.now);
    param.setValueAtTime(param.value, this.now);
    param.linearRampToValueAtTime(down ? 0 : 1, this.now + MASK_RAMP_S);
  }
}
