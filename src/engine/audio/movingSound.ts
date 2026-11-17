import type { Random } from "../shuffle";
import { generateImpulse } from "./reverbIr";

export type MovingPreset = "4d" | "8d" | "16d";
export type MovingSpeed = "slow" | "medium" | "fast";

export interface MovingSoundState {
  on: boolean;
  preset: MovingPreset;
  speed: MovingSpeed;
}

export const MOVING_PRESETS: Record<MovingPreset, { tiltDb: number; room: number }> = {
  "4d": { tiltDb: 0, room: 0 },
  "8d": { tiltDb: 0, room: 0.4 },
  "16d": { tiltDb: 6, room: 0.65 },
};
export const TURN_SECONDS: Record<MovingSpeed, number> = { slow: 16, medium: 8, fast: 4 };
export const MOVING_FADE_S = 0.1;
export const SPEED_GLIDE_S = 0.5;
const PRESET_RAMP_S = 0.15;
const ROOM_SECONDS = 1.2;
// On pink noise with a mix-like channel correlation the mono ear-filtered path is 3.4 dB under the dry mix
const PANNED_GAIN = 1.5;
/** Half the largest interaural delay, for a source level with one ear. */
const ITD_HALF_S = 0.00033;
const EAR_LEVEL = { mid: 0.75, swing: 0.25 };
const SHADOW_HZ = { mid: 11_000, swing: 8_500 };
/** The high shelf in front is flat and falls to twice this behind the head. */
export const REAR_DB = -5;
const REAR_SHELF_HZ = 3_000;
const HEIGHT_BAND_HZ = 8_000;
const UNLINK_MS = 5 * MOVING_FADE_S * 1000 + 100;

export function turnHz(speed: MovingSpeed): number {
  return 1 / TURN_SECONDS[speed];
}

export interface EarCue {
  delayS: number;
  level: number;
  shadowHz: number;
}

/** Side runs from -1, level with the left ear, to 1, level with the right one. */
export function earCues(side: number): [EarCue, EarCue] {
  const ear = (sign: number): EarCue => ({
    delayS: ITD_HALF_S * (1 - sign * side),
    level: EAR_LEVEL.mid + sign * EAR_LEVEL.swing * side,
    shadowHz: SHADOW_HZ.mid + sign * SHADOW_HZ.swing * side,
  });
  return [ear(-1), ear(1)];
}

export class MovingSound {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly height: GainNode;
  private readonly sweeps: [OscillatorNode, OscillatorNode];
  private readonly convolver: ConvolverNode;
  private readonly room: GainNode;
  private readonly nodes: AudioNode[] = [];
  private state: MovingSoundState = { on: false, preset: "4d", speed: "medium" };
  private wetLinked = false;
  private roomLinked = false;
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

    const rear = this.own(ctx.createBiquadFilter());
    rear.type = "highshelf";
    rear.frequency.value = REAR_SHELF_HZ;
    rear.gain.value = REAR_DB;
    sweepZ.connect(this.scale(REAR_DB)).connect(rear.gain);

    const heightBand = this.own(ctx.createBiquadFilter());
    heightBand.type = "peaking";
    heightBand.frequency.value = HEIGHT_BAND_HZ;
    heightBand.gain.value = 0;
    this.height = this.scale(0);
    sweepX.connect(this.height).connect(heightBand.gain);

    this.wet.connect(rear).connect(heightBand);
    const merger = this.own(ctx.createChannelMerger(2));
    // The cues are linear in the side, so the centre plus the side times its slope traces them exactly
    const centre = earCues(0);
    const side = earCues(1);
    centre.forEach((at, channel) => {
      const delay = this.own(ctx.createDelay(4 * ITD_HALF_S));
      delay.delayTime.value = at.delayS;
      sweepX.connect(this.scale(side[channel].delayS - at.delayS)).connect(delay.delayTime);
      const shadow = this.own(ctx.createBiquadFilter());
      shadow.type = "lowpass";
      shadow.Q.value = 0.5;
      shadow.frequency.value = at.shadowHz;
      sweepX.connect(this.scale(side[channel].shadowHz - at.shadowHz)).connect(shadow.frequency);
      const level = this.own(ctx.createGain());
      level.gain.value = at.level;
      sweepX.connect(this.scale(side[channel].level - at.level)).connect(level.gain);
      heightBand.connect(delay).connect(shadow).connect(level).connect(merger, 0, channel);
    });
    merger.connect(this.output);

    this.convolver = this.own(ctx.createConvolver());
    this.room = this.own(ctx.createGain());
    this.room.gain.value = 0;
    this.convolver.connect(this.room).connect(this.output);

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
    this.height.gain.setTargetAtTime(preset.tiltDb, now, PRESET_RAMP_S);
    this.room.gain.setTargetAtTime(preset.room, now, PRESET_RAMP_S);
    for (const sweep of this.sweeps) sweep.frequency.setTargetAtTime(turnHz(next.speed), now, SPEED_GLIDE_S);
  }

  private get roomWanted(): boolean {
    return this.state.on && MOVING_PRESETS[this.state.preset].room > 0;
  }

  // An unlinked path gets no input, so the effect costs no CPU while it is off
  private relink(): void {
    if (this.state.on && !this.wetLinked) {
      this.input.connect(this.wet);
      this.wetLinked = true;
    }
    if (this.roomWanted && !this.roomLinked) {
      if (!this.convolver.buffer) {
        const [left, right] = generateImpulse(this.context.sampleRate, this.random, ROOM_SECONDS);
        const buffer = this.context.createBuffer(2, left.length, this.context.sampleRate);
        buffer.getChannelData(0).set(left);
        buffer.getChannelData(1).set(right);
        this.convolver.buffer = buffer;
      }
      this.wet.connect(this.convolver);
      this.roomLinked = true;
    }
    if (this.unlinkTimer) clearTimeout(this.unlinkTimer);
    this.unlinkTimer = null;
    if ((this.state.on || !this.wetLinked) && (this.roomWanted || !this.roomLinked)) return;
    this.unlinkTimer = setTimeout(() => {
      this.unlinkTimer = null;
      if (!this.state.on && this.wetLinked) {
        this.input.disconnect(this.wet);
        this.wetLinked = false;
      }
      if (!this.roomWanted && this.roomLinked) {
        this.wet.disconnect(this.convolver);
        this.roomLinked = false;
      }
    }, UNLINK_MS);
  }

  dispose(): void {
    if (this.unlinkTimer) clearTimeout(this.unlinkTimer);
    this.unlinkTimer = null;
    for (const sweep of this.sweeps) sweep.stop();
    for (const node of this.nodes) node.disconnect();
  }
}
