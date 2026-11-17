import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeContext, type FakeBiquad, type FakeDelay, type FakeGain, type FakeNode, type FakeOscillator, type FakeParam } from "../test/fakeAudio";
import { earCues, MOVING_FADE_S, MOVING_PRESETS, MovingSound, REAR_DB, SPEED_GLIDE_S, TURN_SECONDS, turnHz, type MovingSoundState } from "./movingSound";

const ON: MovingSoundState = { on: true, preset: "4d", speed: "medium" };

function setup() {
  const context = new FakeContext();
  const stage = new MovingSound(context as unknown as BaseAudioContext, () => 0.5);
  const input = stage.input as unknown as FakeGain;
  const dry = input.outputs[0] as FakeGain;
  const [sweepX, sweepZ] = context.ofType("oscillator") as FakeOscillator[];
  const wetGain = () => input.outputs.find((node) => node !== dry) as FakeGain | undefined;
  return { context, stage, input, dry, sweepX, sweepZ, wetGain };
}

function driver(sweep: FakeOscillator, param: FakeParam): number | undefined {
  return (sweep.outputs as FakeGain[]).find((scale) => scale.paramOutputs.includes(param))?.gain.value;
}

function directWrites(context: FakeContext): number {
  const params = context.nodes.flatMap((node) =>
    Object.values(node).filter((value): value is { directWrites: number } => typeof value === "object" && value !== null && "directWrites" in value),
  );
  return params.reduce((sum, param) => sum + param.directWrites, 0);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("path maths", () => {
  it("one turn takes 16, 8 or 4 seconds", () => {
    expect(TURN_SECONDS).toEqual({ slow: 16, medium: 8, fast: 4 });
    expect(turnHz("slow")).toBeCloseTo(1 / 16, 9);
    expect(turnHz("fast")).toBeCloseTo(0.25, 9);
  });

  it("in the middle both ears hear the same; level with the right ear, the right ear hears it first, louder and brighter", () => {
    const [left, right] = earCues(0);
    expect(left).toEqual(right);
    const [far, near] = earCues(1);
    expect(near.delayS).toBe(0);
    expect(far.delayS * 1000).toBeCloseTo(0.66, 9);
    expect(20 * Math.log10(far.level / near.level)).toBeCloseTo(-6.02, 1);
    expect(far.shadowHz).toBe(2_500);
    expect(near.shadowHz).toBe(19_500);
    expect(earCues(-0.4)).toEqual([...earCues(0.4)].reverse());
  });

  it("only 16D tilts, and the room grows from 4D to 16D", () => {
    expect(MOVING_PRESETS["4d"]).toEqual({ tiltDb: 0, room: 0 });
    expect(MOVING_PRESETS["8d"].tiltDb).toBe(0);
    expect(MOVING_PRESETS["16d"].tiltDb).toBeGreaterThan(0);
    expect(MOVING_PRESETS["8d"].room).toBeGreaterThan(0);
    expect(MOVING_PRESETS["16d"].room).toBeGreaterThan(MOVING_PRESETS["8d"].room);
  });

  it("a sine drives the side cues and a minus cosine the rear shelf, both started together, so the sound starts in front and turns right", () => {
    const { context, sweepX, sweepZ } = setup();
    expect(sweepX.wave).toBeNull();
    expect(Array.from(sweepZ.wave!.real)).toEqual([0, -1]);
    expect(Array.from(sweepZ.wave!.imag)).toEqual([0, 0]);
    expect(sweepX.startedAt).not.toBeNull();
    expect(sweepZ.startedAt).toBe(sweepX.startedAt);
    const rear = (context.ofType("biquad") as unknown as FakeBiquad[]).find((filter) => filter.type === "highshelf")!;
    expect(rear.gain.value).toBe(REAR_DB);
    expect(driver(sweepZ, rear.gain)).toBe(REAR_DB);
    const [centre, side] = [earCues(0), earCues(1)];
    const delays = context.ofType("delay") as FakeDelay[];
    delays.forEach((delay, ear) => {
      expect(delay.delayTime.value).toBe(centre[ear].delayS);
      expect(driver(sweepX, delay.delayTime)).toBeCloseTo(side[ear].delayS - centre[ear].delayS, 12);
      expect(delay.maxDelayTime).toBeGreaterThan(side[0].delayS);
    });
    const shadows = (context.ofType("biquad") as unknown as FakeBiquad[]).filter((filter) => filter.type === "lowpass");
    shadows.forEach((shadow, ear) => expect(driver(sweepX, shadow.frequency)).toBe(side[ear].shadowHz - centre[ear].shadowHz));
  });
});

describe("smoothing", () => {
  it("starts dry and silent on the moving path", () => {
    const { stage, input, dry } = setup();
    expect(input.outputs).toEqual([dry]);
    expect(dry.outputs).toEqual([stage.output]);
  });

  it("turning on links the moving path and crossfades on the audio clock, with no jumps", () => {
    const { stage, context, dry, wetGain } = setup();
    const before = directWrites(context);
    stage.set(ON);
    const wet = wetGain()!;
    expect(wet).toMatchObject({ channelCount: 1, channelCountMode: "explicit" });
    expect(dry.gain.last("target")).toMatchObject({ value: 0, constant: MOVING_FADE_S });
    expect(wet.gain.last("target")?.constant).toBe(MOVING_FADE_S);
    expect(wet.gain.last("target")?.value).toBeGreaterThan(0);
    expect(directWrites(context)).toBe(before);
  });

  it("a speed change glides both sweeps together, so the circle keeps its shape", () => {
    const { stage, sweepX, sweepZ } = setup();
    stage.set(ON);
    stage.set({ ...ON, speed: "fast" });
    for (const sweep of [sweepX, sweepZ]) expect(sweep.frequency.last("target")).toMatchObject({ value: turnHz("fast"), constant: SPEED_GLIDE_S });
    expect(sweepX.frequency.events).toEqual(sweepZ.frequency.events);
  });

  it("a preset change ramps the tilt and the room instead of rebuilding", () => {
    const { stage, context } = setup();
    stage.set(ON);
    const nodes = context.nodes.length;
    stage.set({ ...ON, preset: "16d" });
    const params = context.nodes.flatMap((node) => [(node as FakeGain).gain].filter(Boolean));
    const targets = params.map((param) => param.last("target")?.value);
    expect(targets).toContain(MOVING_PRESETS["16d"].tiltDb);
    expect(targets).toContain(MOVING_PRESETS["16d"].room);
    expect(context.nodes.length).toBe(nodes);
  });

  it("the room impulse is built once, on the first preset that needs it", () => {
    const { stage, context } = setup();
    const convolver = context.ofType("convolver")[0] as FakeNode & { buffer: unknown };
    stage.set(ON);
    expect(convolver.buffer).toBeNull();
    stage.set({ ...ON, preset: "8d" });
    const built = convolver.buffer;
    expect(built).not.toBeNull();
    stage.set({ ...ON, preset: "16d" });
    expect(convolver.buffer).toBe(built);
  });

  it("turning off fades first and unlinks the moving path only after the fade has settled", async () => {
    const { stage, input, dry, wetGain } = setup();
    stage.set({ ...ON, preset: "8d" });
    const wet = wetGain()!;
    stage.set({ ...ON, preset: "8d", on: false });
    expect(dry.gain.last("target")?.value).toBe(1);
    expect(wet.gain.last("target")?.value).toBe(0);
    expect(input.outputs).toContain(wet);
    await vi.advanceTimersByTimeAsync(5 * MOVING_FADE_S * 1000);
    expect(input.outputs).toContain(wet);
    await vi.advanceTimersByTimeAsync(1000);
    expect(input.outputs).toEqual([dry]);
    expect(wet.outputs.some((node) => node.kind === "convolver")).toBe(false);
  });

  it("turning back on before the unlink keeps the path linked", async () => {
    const { stage, input, wetGain } = setup();
    stage.set(ON);
    const wet = wetGain()!;
    stage.set({ ...ON, on: false });
    stage.set(ON);
    await vi.advanceTimersByTimeAsync(2000);
    expect(input.outputs.filter((node) => node === wet)).toHaveLength(1);
  });

  it("dispose stops the sweeps and the pending unlink", async () => {
    const { stage, sweepX, sweepZ } = setup();
    stage.set(ON);
    stage.set({ ...ON, on: false });
    stage.dispose();
    expect(sweepX.stopped && sweepZ.stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
