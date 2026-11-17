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
  await main.evaluate(() => (location.hash = "#/settings?section=sound"));
  await main.locator(SWITCH).click();
  await expect.poll(async () => (await stageGains(main)).dry).toBeLessThan(0.01);
  expect((await stageGains(main)).wet).toBeGreaterThan(1);
  await main.locator(SWITCH).click();
  await expect.poll(async () => (await stageGains(main)).wet).toBeLessThan(0.01);
  expect((await stageGains(main)).dry).toBeGreaterThan(0.99);
});

it("rendered offline, the sound turns at the set rate, louder on its side and darker behind, as loud as the dry mix and without a click", async () => {
  const result = await main.evaluate(async () => {
    const decks = (window as unknown as { __nuvoPlayer: { decks: { graph: { moving: object } } } }).__nuvoPlayer.decks;
    const Stage = decks.graph.moving.constructor as new (
      context: BaseAudioContext,
      random: () => number,
    ) => { input: AudioNode; output: AudioNode; set(state: object): void };
    const rate = 48_000;
    const seconds = 44;

    const render = async (source: "noise" | "tone", schedule: Array<[number, object]>, length = seconds) => {
      const ctx = new OfflineAudioContext(2, rate * length, rate);
      let input: AudioScheduledSourceNode;
      if (source === "tone") {
        input = new OscillatorNode(ctx, { frequency: 220 });
      } else {
        // Pink noise with the channel correlation of a typical mix, about 0.8
        const buffer = ctx.createBuffer(2, rate * 4, rate);
        const pink = () => {
          const state = [0, 0, 0];
          return () => {
            const white = Math.random() * 2 - 1;
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
        input = new AudioBufferSourceNode(ctx, { buffer, loop: true });
      }
      const stage = new Stage(ctx, Math.random);
      input.connect(stage.input);
      stage.output.connect(ctx.destination);
      const at = (time: number, state: object) =>
        void ctx.suspend(time).then(() => {
          stage.set(state);
          void ctx.resume();
        });
      for (const [time, state] of schedule) {
        if (time === 0) stage.set(state);
        else at(time, state);
      }
      input.start();
      const rendered = await ctx.startRendering();
      return [rendered.getChannelData(0), rendered.getChannelData(1)];
    };

    const changes: Array<[number, object]> = [
      [1, { on: true, preset: "4d", speed: "fast" }],
      [15, { on: true, preset: "16d", speed: "medium" }],
      [41, { on: false, preset: "16d", speed: "medium" }],
    ];
    const [noiseLeft, noiseRight] = await render("noise", changes);
    const frame = rate / 50;
    const turn = (from: number, to: number) => {
      const points: Array<[number, number]> = [];
      for (let start = from * rate; start + frame <= to * rate; start += frame) {
        let l = 0;
        let r = 0;
        for (let i = start; i < start + frame; i++) {
          l += noiseLeft[i] ** 2;
          r += noiseRight[i] ** 2;
        }
        points.push([(start + frame / 2) / rate, (l - r) / (l + r)]);
      }
      let best = { hz: 0, swing: 0 };
      for (let hz = 0.05; hz <= 0.4; hz += 0.001) {
        let c = 0;
        let s = 0;
        for (const [t, b] of points) {
          c += b * Math.cos(2 * Math.PI * hz * t);
          s += b * Math.sin(2 * Math.PI * hz * t);
        }
        const swing = (2 * Math.hypot(c, s)) / points.length;
        if (swing > best.swing) best = { hz, swing };
      }
      return best;
    };
    const db = (from: number, to: number) => {
      let sum = 0;
      for (let i = from * rate; i < to * rate; i++) sum += noiseLeft[i] ** 2 + noiseRight[i] ** 2;
      return 10 * Math.log10(sum / ((to - from) * rate));
    };
    const dryDb = db(0, 1);

    const [toneLeft, toneRight] = await render("tone", changes);
    const block = 128;
    const peaksOf = (channel: Float32Array) => {
      const peaks = new Float32Array(Math.ceil(channel.length / block));
      for (let i = 0; i < channel.length; i++) peaks[Math.floor(i / block)] = Math.max(peaks[Math.floor(i / block)], Math.abs(channel[i]));
      return peaks;
    };
    const tone = [toneLeft, toneRight].map((channel) => ({ channel, peaks: peaksOf(channel) }));
    const worstJump = (from: number, to: number) => {
      let worst = 0;
      for (const { channel, peaks } of tone) {
        for (let i = Math.max(3, from * rate); i < to * rate; i++) {
          const b = Math.floor(i / block);
          const local = Math.max(0.05, peaks[b], peaks[Math.max(0, b - 1)], peaks[Math.min(peaks.length - 1, b + 1)]);
          const third = channel[i] - 3 * channel[i - 1] + 3 * channel[i - 2] - channel[i - 3];
          worst = Math.max(worst, Math.abs(third) / local);
        }
      }
      return worst;
    };
    const jumps = {
      dry: worstJump(0, 1),
      on: worstJump(1, 2),
      fast: worstJump(2, 15),
      change: worstJump(15, 17),
      medium: worstJump(17, 41),
      off: worstJump(41, 44),
    };

    const [orbitLeft, orbitRight] = await render("noise", [[0, { on: true, preset: "4d", speed: "medium" }]], 17);
    const cue = (centre: number) => {
      let left = 0;
      let right = 0;
      let high = 0;
      for (let i = (centre - 0.25) * rate; i < (centre + 0.25) * rate; i++) {
        left += orbitLeft[i] ** 2;
        right += orbitRight[i] ** 2;
        high += (orbitLeft[i] - orbitLeft[i - 1]) ** 2 + (orbitRight[i] - orbitRight[i - 1]) ** 2;
      }
      return { sideDb: 10 * Math.log10(right / left), brightness: high / (left + right) };
    };
    const [front, rightSide, back, leftSide, frontAgain, backAgain] = [8, 10, 12, 14, 16, 4].map(cue);

    return {
      rightDb: rightSide.sideDb,
      leftDb: leftSide.sideDb,
      frontBackDb: 10 * Math.log10((front.brightness + frontAgain.brightness) / (back.brightness + backAgain.brightness)),
      frontSideDb: front.sideDb,
      fast: turn(2, 15),
      medium: turn(17, 41),
      dry: turn(42, 44),
      jumps,
      onDb: db(2, 15) - dryDb,
      roomDb: db(17, 41) - dryDb,
      offDb: db(42, 44) - dryDb,
    };
  });

  expect(result.fast.hz).toBeCloseTo(0.25, 2);
  expect(result.medium.hz).toBeCloseTo(0.125, 2);
  expect(result.fast.swing).toBeGreaterThan(0.3);
  expect(result.dry.swing).toBeLessThan(0.1);
  // The third difference of a 220 Hz sine is about 2.4e-5 of its peak; a click is orders of magnitude above that
  for (const jump of Object.values(result.jumps)) expect(jump).toBeLessThan(1e-3);
  expect(result.rightDb).toBeGreaterThan(6);
  expect(result.leftDb).toBeLessThan(-6);
  expect(Math.abs(result.frontSideDb)).toBeLessThan(0.5);
  expect(result.frontBackDb).toBeGreaterThan(3);
  expect(Math.abs(result.onDb)).toBeLessThan(1.5);
  expect(Math.abs(result.roomDb)).toBeLessThan(1.5);
  expect(Math.abs(result.offDb)).toBeLessThan(0.5);
});
