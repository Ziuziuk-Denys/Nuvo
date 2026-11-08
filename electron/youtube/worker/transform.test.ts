// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PlayerTransforms, type Solver } from "./transform";
import { FakeFetch, text } from "../../../src/youtube/test/fakeFetch";

const SYNTHETIC = readFileSync(new URL("../../../fixtures/yt/player-synthetic.js", import.meta.url), "utf8");
const TCL = (id: string) => `https://www.youtube.com/s/player/${id}/tv-player-ias-tcl.vflset/tv-player-ias-tcl.js`;
const PLAIN = (id: string) => `https://www.youtube.com/s/player/${id}/tv-player-ias.vflset/tv-player-ias.js`;

/** Test solver for the synthetic fixture only: it evaluates the fixture and calls its two functions. */
const syntheticSolver: Solver = {
  async load(_playerId, script) {
    const player = new Function(`${script}\nreturn nuvoPlayer;`)() as {
      n(v: string): string;
      sig(v: string): string;
    };
    return {
      n: async (value) => player.n(value),
      sig: async (value) => player.sig(value),
    };
  },
};

const transforms = (fake: FakeFetch, solver: Solver = syntheticSolver) => new PlayerTransforms(fake.fetch, async () => solver);

describe("player transform", () => {
  it("the synthetic fixture gives its timestamp and known outputs in order", async () => {
    const fake = new FakeFetch().on("GET", TCL("synth01"), text(SYNTHETIC));
    const result = await transforms(fake).transform("synth01", ["abc", "def"], ["XYsig"]);
    expect(result).toEqual({
      signatureTimestamp: 20123,
      n: ["cbaQ", "fedQ"],
      sig: ["sigXY"],
    });
  });

  it("the plain variant answers when tcl is missing; both missing fails", async () => {
    const fake = new FakeFetch().on("GET", TCL("synth02"), text("", 404)).on("GET", PLAIN("synth02"), text(SYNTHETIC));
    expect(await transforms(fake).timestamp("synth02")).toBe(20123);
    const none = new FakeFetch().on("GET", TCL("gone0001"), text("", 404)).on("GET", PLAIN("gone0001"), text("", 404));
    await expect(transforms(none).timestamp("gone0001")).rejects.toThrow("no TV player script");
  });

  it("fetched once per id; a failed load is retried", async () => {
    const fake = new FakeFetch().on("GET", TCL("synth03"), text(SYNTHETIC));
    const subject = transforms(fake);
    await subject.transform("synth03", ["a1"], []);
    await subject.transform("synth03", ["b2"], []);
    expect(fake.calls).toHaveLength(1);

    const flaky = new FakeFetch().on("GET", TCL("synth04"), [text("", 500), text(SYNTHETIC)]).on("GET", PLAIN("synth04"), text("", 500));
    const retrying = transforms(flaky);
    await expect(retrying.timestamp("synth04")).rejects.toThrow();
    expect(await retrying.timestamp("synth04")).toBe(20123);
  });

  it("an unchanged value or one with a slash fails the call", async () => {
    const fake = new FakeFetch().on("GET", TCL("synth05"), text(SYNTHETIC));
    const identity: Solver = {
      load: async () => ({
        n: async (value) => value,
        sig: async (value) => value,
      }),
    };
    await expect(transforms(fake, identity).transform("synth05", ["abc"], [])).rejects.toThrow("unusable");
    const slashed: Solver = {
      load: async () => ({ n: async () => "a/b", sig: async (value) => value }),
    };
    await expect(transforms(fake, slashed).transform("synth05", ["abc"], [])).rejects.toThrow("unusable");
  });

  it("a script without signatureTimestamp fails", async () => {
    const fake = new FakeFetch().on("GET", TCL("synth06"), text("var x = 1;"));
    await expect(transforms(fake).timestamp("synth06")).rejects.toThrow("signatureTimestamp");
  });

  it("a timestamp-only call never loads the solver", async () => {
    const fake = new FakeFetch().on("GET", TCL("synth07"), text(SYNTHETIC));
    let loads = 0;
    const subject = new PlayerTransforms(fake.fetch, async () => {
      loads += 1;
      return syntheticSolver;
    });
    expect(await subject.transform("synth07", [], [])).toEqual({
      signatureTimestamp: 20123,
      n: [],
      sig: [],
    });
    expect(loads).toBe(0);
  });

  it("rejects a bad player id, an oversized script and an overlong output", async () => {
    const fake = new FakeFetch();
    await expect(transforms(fake).timestamp("../x")).rejects.toThrow("bad player id");
    expect(fake.calls).toHaveLength(0);
    const huge = new FakeFetch().on("GET", TCL("synth08"), text(`signatureTimestamp: 1;${"x".repeat(9 * 1024 * 1024)}`));
    await expect(transforms(huge).timestamp("synth08")).rejects.toThrow("too large");
    const long: Solver = {
      load: async () => ({
        n: async () => "a".repeat(5000),
        sig: async (value) => value,
      }),
    };
    const ok = new FakeFetch().on("GET", TCL("synth09"), text(SYNTHETIC));
    await expect(transforms(ok, long).transform("synth09", ["abc"], [])).rejects.toThrow("unusable");
  });

  it("validates inputs before any fetch", async () => {
    const fake = new FakeFetch();
    const subject = transforms(fake);
    await expect(subject.transform("synth10", Array(17).fill("a"), [])).rejects.toThrow("too many");
    await expect(subject.transform("synth10", ["a/b"], [])).rejects.toThrow("bad characters");
    await expect(subject.transform("synth10", [], ["a".repeat(5000)])).rejects.toThrow("too long");
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps at most 4 player scripts and evicts the least recent", async () => {
    const fake = new FakeFetch();
    for (const id of ["lru1", "lru2", "lru3", "lru4", "lru5"]) fake.on("GET", TCL(id), () => text(SYNTHETIC));
    const subject = transforms(fake);
    for (const id of ["lru1", "lru2", "lru3", "lru4", "lru1", "lru5"]) await subject.timestamp(id);
    expect(fake.calls).toHaveLength(5);
    await subject.timestamp("lru1");
    expect(fake.calls).toHaveLength(5);
    await subject.timestamp("lru2");
    expect(fake.calls).toHaveLength(6);
  });

  it("caps the script by bytes", async () => {
    const wide = new FakeFetch().on("GET", TCL("synth11"), text(`signatureTimestamp: 1;${"\u20ac".repeat(3 * 1024 * 1024)}`));
    await expect(transforms(wide).timestamp("synth11")).rejects.toThrow("too large");
  });
});
