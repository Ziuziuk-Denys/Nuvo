import type { Random } from "../shuffle";
import { generateImpulse } from "./reverbIr";

export type MovingPreset = "4d" | "8d" | "16d";
export type MovingSpeed = "slow" | "medium" | "fast";

export interface MovingSoundState {
  on: boolean;
  preset: MovingPreset;
  speed: MovingSpeed;
}

export interface MovingPresetShape {
  /** How far towards one ear the sound goes, 0 for the centre and 1 for one ear only. */
  width: number;
  rearDb: number;
  tiltDb: number;
  room: number;
}

export const MOVING_PRESETS: Record<MovingPreset, MovingPresetShape> = {
  "4d": { width: 0.6, rearDb: 0, tiltDb: 0, room: 0 },
  "8d": { width: 0.8, rearDb: -12, tiltDb: 0, room: 0.5 },
  "16d": { width: 0.9, rearDb: -12, tiltDb: 9, room: 1 },
};
export const TURN_SECONDS: Record<MovingSpeed, number> = { slow: 16, medium: 8, fast: 4 };
export const MOVING_FADE_S = 0.1;
export const SPEED_GLIDE_S = 0.5;
export const PRESET_RAMP_S = 0.15;
const ROOM_SECONDS = 1.2;
// On pink noise with a mix-like channel correlation the mono ear-filtered path is this much under the dry mix
const PANNED_GAIN = 1.5;
/** Half the largest interaural delay, for a source level with one ear. */
const ITD_HALF_S = 0.00033;
const SHADOW_HZ = { mid: 11_000, swing: 8_500 };
const REAR_SHELF_HZ = 3_000;
const HEIGHT_BAND_HZ = 8_000;
const CURVE_POINTS = 1025;
const UNLINK_MS = 5 * MOVING_FADE_S * 1000 + 100;

export function turnHz(speed: MovingSpeed): number {
  return 1 / TURN_SECONDS[speed];
}

/** Equal power, so the loudness holds while the sound moves from ear to ear. */
export function earGains(side: number): [number, number] {
  const angle = (Math.PI / 4) * (1 + side);
  return [Math.cos(angle), Math.sin(angle)];
}

export interface EarCue {
  delayS: number;
  shadowHz: number;
}

/** Side runs from -1, level with the left ear, to 1, level with the right one. */
export function earCues(side: number): [EarCue, EarCue] {
  const ear = (sign: number): EarCue => ({
    delayS: ITD_HALF_S * (1 - sign * side),
    shadowHz: SHADOW_HZ.mid + sign * SHADOW_HZ.swing * side,
  });
  return [ear(-1), ear(1)];
}

export class MovingSound {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly width: GainNode;
  private readonly height: GainNode;
  private readonly rear: BiquadFilterNode;
  private readonly rearSwing: GainNode;
  private readonly sweeps: [OscillatorNode, OscillatorNode];
  private readonly ears: ChannelMergerNode;
  private readonly convolver: ConvolverNode;
  private readonly room: GainNode;
  private readonly nodes: AudioNode[] = [];
  private state: MovingSoundState = { on: false, preset: "4d", speed: "medium" };
  private wetLinked = false;
  private unlinkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly random: Random,
  ) {
    const ctx = context;
    this.input = this.own(ctx.createGain());
    this.output = this.own(ctx.createGain());
    this.dry = this.own(ctx.createGain());
    this.input.connect(this.dry).connect(this.output);

    // A stereo mix moved as two points would keep its energy balanced and never seem to turn
    this.wet = this.own(ctx.createGain());
    this.wet.channelCount = 1;
    this.wet.channelCountMode = "explicit";
    this.wet.gain.value = 0;

    const sweepX = this.own(ctx.createOscillator());
    const sweepZ = this.own(ctx.createOscillator());
    sweepZ.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, -1]), new Float32Array([0, 0])));
    for (const sweep of [sweepX, sweepZ]) sweep.frequency.value = turnHz(this.state.speed);
    this.sweeps = [sweepX, sweepZ];

    this.rear = this.own(ctx.createBiquadFilter());
    this.rear.type = "highshelf";
    this.rear.frequency.value = REAR_SHELF_HZ;
    this.rear.gain.value = 0;
    this.rearSwing = this.scale(0);
    sweepZ.connect(this.rearSwing).connect(this.rear.gain);

    const heightBand = this.own(ctx.createBiquadFilter());
    heightBand.type = "peaking";
    heightBand.frequency.value = HEIGHT_BAND_HZ;
    heightBand.gain.value = 0;
    this.height = this.scale(0);
    sweepX.connect(this.height).connect(heightBand.gain);

    this.wet.connect(this.rear).connect(heightBand);
    this.width = this.scale(0);
    sweepX.connect(this.width);
    this.ears = this.own(ctx.createChannelMerger(2));
    // Delay and shadow are linear in the side, so the centre plus the side times its slope traces them exactly
    const centre = earCues(0);
    const side = earCues(1);
    centre.forEach((at, channel) => {
      const delay = this.own(ctx.createDelay(4 * ITD_HALF_S));
      delay.delayTime.value = at.delayS;
      this.width.connect(this.scale(side[channel].delayS - at.delayS)).connect(delay.delayTime);
      const shadow = this.own(ctx.createBiquadFilter());
      shadow.type = "lowpass";
      shadow.Q.value = 0.5;
      shadow.frequency.value = at.shadowHz;
      this.width.connect(this.scale(side[channel].shadowHz - at.shadowHz)).connect(shadow.frequency);
      const curve = this.own(ctx.createWaveShaper());
      curve.curve = Float32Array.from({ length: CURVE_POINTS }, (_, i) => earGains((2 * i) / (CURVE_POINTS - 1) - 1)[channel]);
      const level = this.own(ctx.createGain());
      level.gain.value = 0;
      this.width.connect(curve).connect(level.gain);
      heightBand.connect(delay).connect(shadow).connect(level).connect(this.ears, 0, channel);
    });
    this.ears.connect(this.output);

    this.convolver = this.own(ctx.createConvolver());
    this.room = this.own(ctx.createGain());
    this.room.gain.value = 0;
    // Fed from the ears, each side echoes its own signal, so the room keeps the direction instead of filling the far ear.
    // It stays linked while the effect is on, so a preset change only ramps its level and never starts a reverb mid-song.
    this.ears.connect(this.convolver).connect(this.room).connect(this.output);

    const startAt = ctx.currentTime;
    for (const sweep of this.sweeps) sweep.start(startAt);
  }

  private own<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  private scale(factor: number): GainNode {
    const node = this.own(this.context.createGain());
    node.gain.value = factor;
    return node;
  }

  set(next: MovingSoundState): void {
    this.state = next;
    const now = this.context.currentTime;
    const preset = MOVING_PRESETS[next.preset];
    this.relink();
    this.dry.gain.setTargetAtTime(next.on ? 0 : 1, now, MOVING_FADE_S);
    this.wet.gain.setTargetAtTime(next.on ? PANNED_GAIN : 0, now, MOVING_FADE_S);
    this.width.gain.setTargetAtTime(preset.width, now, PRESET_RAMP_S);
    // Flat in front and the full cut behind: half as a fixed offset, half swung by the front-back sweep
    this.rear.gain.setTargetAtTime(preset.rearDb / 2, now, PRESET_RAMP_S);
    this.rearSwing.gain.setTargetAtTime(preset.rearDb / 2, now, PRESET_RAMP_S);
    this.height.gain.setTargetAtTime(preset.tiltDb, now, PRESET_RAMP_S);
    this.room.gain.setTargetAtTime(preset.room, now, PRESET_RAMP_S);
    for (const sweep of this.sweeps) sweep.frequency.setTargetAtTime(turnHz(next.speed), now, SPEED_GLIDE_S);
  }

  // An unlinked path gets no input, so the effect costs no CPU while it is off
  private relink(): void {
    if (this.unlinkTimer) clearTimeout(this.unlinkTimer);
    this.unlinkTimer = null;
    if (this.state.on && !this.wetLinked) {
      if (!this.convolver.buffer) {
        const [left, right] = generateImpulse(this.context.sampleRate, this.random, ROOM_SECONDS);
        const buffer = this.context.createBuffer(2, left.length, this.context.sampleRate);
        buffer.getChannelData(0).set(left);
        buffer.getChannelData(1).set(right);
        this.convolver.buffer = buffer;
      }
      this.input.connect(this.wet);
      this.wetLinked = true;
    }
    if (this.state.on || !this.wetLinked) return;
    this.unlinkTimer = setTimeout(() => {
      this.unlinkTimer = null;
      this.input.disconnect(this.wet);
      this.wetLinked = false;
    }, UNLINK_MS);
  }

  dispose(): void {
    if (this.unlinkTimer) clearTimeout(this.unlinkTimer);
    this.unlinkTimer = null;
    for (const sweep of this.sweeps) sweep.stop();
    for (const node of this.nodes) node.disconnect();
  }
}
