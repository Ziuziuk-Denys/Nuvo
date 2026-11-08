import { describe, expect, it } from "vitest";
import { ownInputs, systemMuted, unmuteSystem, type Pactl } from "./systemSound";

const input = (index: number, pid: number, mute: boolean, value = 65536) => ({
  index,
  mute,
  volume: { "front-left": { value }, "front-right": { value } },
  properties: { "application.process.id": String(pid), "application.name": "nuvo" },
});

function fakePactl(inputs: unknown[]) {
  const calls: string[][] = [];
  const run: Pactl = async (args) => {
    calls.push(args);
    if (args[0] === "-f") return JSON.stringify(inputs);
    return "";
  };
  return { run, calls };
}

describe("system mixer", () => {
  it("keeps only the streams of the given process", () => {
    const json = JSON.stringify([input(1, 10, true), input(2, 11, false), { index: 3 }]);
    expect(ownInputs(json, 10)).toEqual([{ index: 1, muted: true, zeroVolume: false }]);
  });

  it("a stream the mixer restored muted is reported, an audible one is not", async () => {
    expect(await systemMuted(10, fakePactl([input(1, 10, true)]).run)).toBe(true);
    expect(await systemMuted(10, fakePactl([input(1, 10, false)]).run)).toBe(false);
    expect(await systemMuted(10, fakePactl([input(1, 10, false, 0)]).run)).toBe(true);
  });

  it("cannot tell without a stream or without pactl", async () => {
    expect(await systemMuted(10, fakePactl([input(1, 11, true)]).run)).toBeNull();
    expect(await systemMuted(10, () => Promise.reject(new Error("ENOENT")))).toBeNull();
    expect(await systemMuted(10, async () => "Sink Input #1")).toBeNull();
  });

  it("unmutes and raises only its own silenced streams", async () => {
    const { run, calls } = fakePactl([input(4, 10, true), input(5, 10, false, 0), input(6, 11, true)]);
    await unmuteSystem(10, run);
    expect(calls.slice(1)).toEqual([
      ["set-sink-input-mute", "4", "0"],
      ["set-sink-input-volume", "5", "100%"],
    ]);
  });
});
