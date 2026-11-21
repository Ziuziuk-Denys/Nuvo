import { createRequire } from "node:module";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const SWITCH = '[role=switch][aria-label="Moving sound"]';

let isolation: Isolation;
let app: ElectronApplication;
let main: Page;

beforeAll(async () => {
  isolation = isolate("nuvo-moving-e2e");
  app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--ozone-platform=x11", "--mute-audio", `--user-data-dir=${isolation.userData}`],
    cwd: ROOT,
    env: isolation.env,
  });
  main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.nuvoShell));
  await main.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await main.reload();
  await main.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer), undefined, { timeout: 60_000 });
}, 120_000);

afterAll(async () => {
  const pid = app?.process().pid;
  await app?.close().catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  isolation?.dispose();
});

function stageGains(page: Page) {
  return page.evaluate(() => {
    const decks = (window as unknown as { __nuvoPlayer: { decks: { rebuildGraph(): void; graph: unknown } } }).__nuvoPlayer.decks;
    if (!decks.graph) decks.rebuildGraph();
    const stage = (decks.graph as { moving: { dry: GainNode; wet: GainNode } }).moving;
    return { dry: stage.dry.gain.value, wet: stage.wet.gain.value };
  });
}

it("the switch in Sound settings reaches the audio graph and crossfades both ways", async () => {
  await main.evaluate(() => (location.hash = "#/settings?section=spatial"));
  await main.locator(SWITCH).click();
  await expect.poll(async () => (await stageGains(main)).dry).toBeLessThan(0.01);
  expect((await stageGains(main)).wet).toBeGreaterThan(1);
  await main.locator(SWITCH).click();
  await expect.poll(async () => (await stageGains(main)).wet).toBeLessThan(0.01);
  expect((await stageGains(main)).dry).toBeGreaterThan(0.99);
});

it("rendered offline, each preset is clearly different, turns at the set rate, holds its loudness and never clicks", async () => {
  const result = await main.evaluate(async () => {
    const decks = (window as unknown as { __nuvoPlayer: { decks: { graph: { moving: object } } } }).__nuvoPlayer.decks;
    const Stage = decks.graph.moving.constructor as new (
      context: BaseAudioContext,
      random: () => number,
    ) => { input: AudioNode; output: AudioNode; set(state: object): void };
    const rate = 48_000;
    const db = (ratio: number) => 10 * Math.log10(ratio);

    // Seeded, so every render hears the same input and room and a level change belongs to the effect
    const seeded = () => {
      let seed = 1;
      return () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed / 2_147_483_648;
      };
    };

    // Pink noise with the channel correlation of a typical mix, about 0.8
    const pinkNoise = (ctx: BaseAudioContext, seconds: number) => {
      const buffer = ctx.createBuffer(2, rate * seconds, rate);
      const random = seeded();
      const pink = () => {
        const state = [0, 0, 0];
        return () => {
          const white = random() * 2 - 1;
          state[0] = 0.99765 * state[0] + white * 0.099046;
          state[1] = 0.963 * state[1] + white * 0.2965164;
          state[2] = 0.57 * state[2] + white * 1.0526913;
          return (state[0] + state[1] + state[2] + white * 0.1848) * 0.1;
        };
      };
      const [mid, left, right] = [pink(), pink(), pink()];
      const [l, r] = [buffer.getChannelData(0), buffer.getChannelData(1)];
      for (let i = 0; i < l.length; i++) {
        const m = mid();
        l[i] = m + 0.5 * left();
        r[i] = m + 0.5 * right();
      }
      return buffer;
    };

    const render = async (source: "noise" | "tone" | "burst", schedule: Array<[number, object]>, seconds: number) => {
      const ctx = new OfflineAudioContext(2, rate * seconds, rate);
      let input: AudioScheduledSourceNode;
      if (source === "tone") input = new OscillatorNode(ctx, { frequency: 220 });
      else if (source === "burst") input = new AudioBufferSourceNode(ctx, { buffer: pinkNoise(ctx, 0.5) });
      else input = new AudioBufferSourceNode(ctx, { buffer: pinkNoise(ctx, 4), loop: true });
      const stage = new Stage(ctx, seeded());
      input.connect(stage.input);
      stage.output.connect(ctx.destination);
      for (const [time, state] of schedule) {
        if (time === 0) stage.set(state);
        else
          void ctx.suspend(time).then(() => {
            stage.set(state);
            void ctx.resume();
          });
      }
      input.start();
      const rendered = await ctx.startRendering();
      return [rendered.getChannelData(0), rendered.getChannelData(1)];
    };
    const energy = (channel: Float32Array, from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * rate); i < Math.round(to * rate); i++) sum += channel[i] ** 2;
      return sum;
    };
    const brightness = (left: Float32Array, right: Float32Array, centre: number) => {
      let high = 0;
      for (let i = (centre - 0.25) * rate; i < (centre + 0.25) * rate; i++) high += (left[i] - left[i - 1]) ** 2 + (right[i] - right[i - 1]) ** 2;
      return high / (energy(left, centre - 0.25, centre + 0.25) + energy(right, centre - 0.25, centre + 0.25));
    };

    // At one turn in 8 s from the start: in front at 0, 8 and 16 s, right at 2 and 10 s, behind at 4 and 12 s
    const shape = async (preset: string | null) => {
      const on = preset !== null;
      const [left, right] = await render("noise", [[0, { on, preset: preset ?? "4d", speed: "medium" }]], 17);
      const windows: number[] = [];
      for (let t = 1; t < 17; t += 0.5) windows.push(energy(left, t, t + 0.5) + energy(right, t, t + 0.5));
      const [tailLeft, tailRight] = await render("burst", [[0, { on, preset: preset ?? "4d", speed: "medium" }]], 2);
      const burst = energy(tailLeft, 0, 0.5) + energy(tailRight, 0, 0.5);
      const tail = energy(tailLeft, 0.6, 1.6) + energy(tailRight, 0.6, 1.6);
      return {
        sideDb: db(energy(right, 9.75, 10.25) / energy(left, 9.75, 10.25)),
        frontBackDb: db((brightness(left, right, 8) + brightness(left, right, 16)) / (brightness(left, right, 4) + brightness(left, right, 12))),
        pumpDb: db(Math.max(...windows) / Math.min(...windows)),
        power: windows.reduce((sum, value) => sum + value, 0),
        tailDb: tail > 0 ? db(tail / burst) : -200,
      };
    };
    const off = await shape(null);
    const presets = { "4d": await shape("4d"), "8d": await shape("8d"), "16d": await shape("16d") };
    const levelDb = Object.fromEntries(Object.entries(presets).map(([key, value]) => [key, db(value.power / off.power)]));

    const changes: Array<[number, object]> = [
      [1, { on: true, preset: "4d", speed: "fast" }],
      [15, { on: true, preset: "8d", speed: "medium" }],
      [28, { on: true, preset: "16d", speed: "medium" }],
      [41, { on: false, preset: "16d", speed: "medium" }],
    ];
    const [noiseLeft, noiseRight] = await render("noise", changes, 44);
    const turn = (from: number, to: number) => {
      const frame = rate / 50;
      const points: Array<[number, number]> = [];
      for (let start = from * rate; start + frame <= to * rate; start += frame) {
        const l = energy(noiseLeft, start / rate, (start + frame) / rate);
        const r = energy(noiseRight, start / rate, (start + frame) / rate);
        points.push([(start + frame / 2) / rate, (l - r) / (l + r)]);
      }
      let best = 0;
      let bestSwing = 0;
      for (let hz = 0.05; hz <= 0.4; hz += 0.001) {
        let c = 0;
        let s = 0;
        for (const [t, b] of points) {
          c += b * Math.cos(2 * Math.PI * hz * t);
          s += b * Math.sin(2 * Math.PI * hz * t);
        }
        const swing = (2 * Math.hypot(c, s)) / points.length;
        if (swing > bestSwing) [best, bestSwing] = [hz, swing];
      }
      return best;
    };

    const [toneLeft, toneRight] = await render("tone", changes, 44);
    const block = 128;
    const tone = [toneLeft, toneRight].map((channel) => {
      const peaks = new Float32Array(Math.ceil(channel.length / block));
      for (let i = 0; i < channel.length; i++) peaks[Math.floor(i / block)] = Math.max(peaks[Math.floor(i / block)], Math.abs(channel[i]));
      return { channel, peaks };
    });
    const worstClick = (from: number, to: number) => {
      let worst = 0;
      for (const { channel, peaks } of tone) {
        for (let i = Math.max(3, from * rate); i < to * rate; i++) {
          const b = Math.floor(i / block);
          const local = Math.max(0.05, peaks[b], peaks[Math.max(0, b - 1)], peaks[Math.min(peaks.length - 1, b + 1)]);
          worst = Math.max(worst, Math.abs(channel[i] - 3 * channel[i - 1] + 3 * channel[i - 2] - channel[i - 3]) / local);
        }
      }
      return worst;
    };
    const clicks = {
      on: worstClick(0, 2),
      fast: worstClick(2, 15),
      to8d: worstClick(15, 17),
      "8d": worstClick(17, 28),
      to16d: worstClick(28, 30),
      "16d": worstClick(30, 41),
      off: worstClick(41, 44),
    };

    return { off, presets, levelDb, fastHz: turn(2, 15), mediumHz: turn(17, 41), clicks };
  });
  const { off, presets, levelDb } = result;
  console.log("TEMP pumpDb", JSON.stringify({ off: off.pumpDb, ...Object.fromEntries(Object.entries(presets).map(([key, value]) => [key, value.pumpDb])) }));

  expect(Math.abs(off.sideDb)).toBeLessThan(1);
  expect(presets["4d"].sideDb).toBeGreaterThan(6);
  expect(presets["8d"].sideDb).toBeGreaterThan(presets["4d"].sideDb + 3);
  expect(presets["16d"].sideDb).toBeGreaterThan(presets["8d"].sideDb + 2);

  expect(Math.abs(presets["4d"].frontBackDb)).toBeLessThan(1);
  expect(presets["8d"].frontBackDb).toBeGreaterThan(6);
  expect(presets["16d"].frontBackDb).toBeGreaterThan(6);

  expect(presets["4d"].tailDb).toBeLessThan(-60);
  expect(presets["8d"].tailDb).toBeGreaterThan(-40);
  expect(presets["16d"].tailDb).toBeGreaterThan(presets["8d"].tailDb + 3);

  for (const preset of Object.values(presets)) expect(preset.pumpDb).toBeLessThan(off.pumpDb + 1.5);
  for (const level of Object.values(levelDb)) expect(Math.abs(level)).toBeLessThan(1.5);

  expect(result.fastHz).toBeCloseTo(0.25, 2);
  expect(result.mediumHz).toBeCloseTo(0.125, 2);
  // The third difference of a 220 Hz sine is about 2.4e-5 of its peak; a click is orders of magnitude above that
  for (const click of Object.values(result.clicks)) expect(click).toBeLessThan(1e-3);
});
