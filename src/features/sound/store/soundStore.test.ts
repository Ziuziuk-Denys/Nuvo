import { beforeEach, describe, expect, it } from "vitest";
import { TEMPO_PRESETS } from "../lib/tempo";
import { presetNameFor, useSoundStore } from "./soundStore";
import { BUILT_IN_PRESETS, FLAT } from "../lib/eq";

const initial = useSoundStore.getState();

describe("soundStore", () => {
  beforeEach(() => {
    useSoundStore.setState(initial, true);
  });

  it("applies built-in and custom presets", () => {
    useSoundStore.getState().applyPreset("rock");
    expect(useSoundStore.getState().gains).toEqual(BUILT_IN_PRESETS.rock);
    expect(useSoundStore.getState().presetName).toBe("rock");

    useSoundStore.getState().setGain(0, 20);
    expect(useSoundStore.getState().gains[0]).toBe(12);
    expect(useSoundStore.getState().presetName).toBe("custom");

    useSoundStore.getState().saveCustomPreset("mine");
    useSoundStore.getState().applyPreset("flat");
    useSoundStore.getState().applyPreset("mine");
    expect(useSoundStore.getState().gains[0]).toBe(12);
    expect(useSoundStore.getState().presetName).toBe("mine");

    useSoundStore.getState().deleteCustomPreset("mine");
    expect(useSoundStore.getState().customPresets.mine).toBeUndefined();
    expect(useSoundStore.getState().presetName).toBe("custom");
  });

  it("evicts the oldest loudness entries by timestamp, not key order", () => {
    const seeded = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [String(i), { db: 1, at: 1000 + i }]));
    useSoundStore.setState({ loudness: seeded });
    // Re-setting the oldest numeric key makes it newest; key "1" becomes the oldest.
    useSoundStore.getState().setLoudness("0", 2);
    useSoundStore.getState().setLoudness("5000", 1);
    const loudness = useSoundStore.getState().loudness;
    expect(Object.keys(loudness)).toHaveLength(5000);
    expect(loudness["0"].db).toBe(2);
    expect(loudness["1"]).toBeUndefined();
    expect(loudness["5000"]).toBeDefined();
  });

  it("remembers and forgets profiles", () => {
    useSoundStore.getState().applyPreset("vocal");
    useSoundStore.getState().rememberForTrack("a");
    useSoundStore.getState().rememberForArtist("Some Band");
    expect(useSoundStore.getState().byTrack.a).toBe("vocal");
    expect(useSoundStore.getState().byArtist["some band"]).toBe("vocal");
    useSoundStore.getState().forget("track", "a");
    expect(useSoundStore.getState().byTrack.a).toBeUndefined();
    useSoundStore.getState().forget("artist", "Some Band");
    expect(useSoundStore.getState().byArtist["some band"]).toBeUndefined();
  });

  it("adds and removes moments", () => {
    useSoundStore.getState().addMoment("a", 1000, "drop");
    const [moment] = useSoundStore.getState().moments.a;
    expect(moment.positionMs).toBe(1000);
    useSoundStore.getState().removeMoment("a", moment.id);
    expect(useSoundStore.getState().moments.a ?? []).toEqual([]);
    expect(useSoundStore.getState().gains).toEqual(FLAT);
  });

  it("keeps the preset name while the curve still equals the preset", () => {
    const store = useSoundStore.getState();
    store.applyPreset("rock");
    store.setGain(0, BUILT_IN_PRESETS.rock[0]);
    expect(useSoundStore.getState().presetName).toBe("rock");
    store.setGains([...BUILT_IN_PRESETS.rock]);
    expect(useSoundStore.getState().presetName).toBe("rock");
    store.setGain(0, 0);
    expect(useSoundStore.getState().presetName).toBe("custom");
  });

  it("an edit that lands on another preset's curve takes that preset's name", () => {
    const store = useSoundStore.getState();
    store.applyPreset("bass_boost");
    store.setGains([...BUILT_IN_PRESETS.bass_reducer]);
    expect(useSoundStore.getState().presetName).toBe("bass_reducer");
    expect(presetNameFor([...FLAT], "custom", {})).toBe("flat");
    expect(presetNameFor([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "flat", { mine: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] })).toBe("mine");
  });

  it("deleting a custom preset keeps its curve in profiles that used it", () => {
    const store = useSoundStore.getState();
    store.setGains([1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    store.saveCustomPreset("warm");
    store.setProfile("track", "t1", "warm");
    store.setProfile("artist", "Band", "warm");
    store.setProfile("track", "t2", "rock");
    store.deleteCustomPreset("warm");
    const state = useSoundStore.getState();
    expect(state.byTrack.t1).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    expect(state.byArtist.band).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    expect(state.byTrack.t2).toBe("rock");
  });

  it("renames a custom preset and rewrites references", () => {
    const store = useSoundStore.getState();
    store.saveCustomPreset("a");
    store.saveCustomPreset("b");
    store.setProfile("track", "t1", "b");
    store.renameCustomPreset("b", "c");
    const state = useSoundStore.getState();
    expect(Object.keys(state.customPresets)).toEqual(["a", "c"]);
    expect(state.presetName).toBe("c");
    expect(state.byTrack.t1).toBe("c");
    store.renameCustomPreset("a", "c");
    expect(Object.keys(useSoundStore.getState().customPresets)).toEqual(["a", "c"]);
  });

  it("saving with explicit gains leaves the global preset alone", () => {
    const store = useSoundStore.getState();
    store.applyPreset("vocal");
    store.saveCustomPreset("loud", [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const state = useSoundStore.getState();
    expect(state.presetName).toBe("vocal");
    expect(state.customPresets.loud[0]).toBe(5);
  });

  it("does not persist bypass and drops it from older saves", () => {
    const options = useSoundStore.persist.getOptions();
    useSoundStore.getState().setBypass(true);
    expect(options.partialize!(useSoundStore.getState())).not.toHaveProperty("bypass");
    expect(options.version).toBe(3);
    const migrated = options.migrate!({ bypass: true, autoGain: false }, 0) as Record<string, unknown>;
    expect(migrated).toEqual({ autoGain: false, globalTempo: TEMPO_PRESETS.normal, tempoByTrack: {}, tempoByArtist: {} });
    const kept = { tempoByTrack: { a: { rate: 0.8 } } };
    expect(options.migrate!(kept, 1)).toEqual({ globalTempo: TEMPO_PRESETS.normal, tempoByTrack: { a: { rate: 0.8 } }, tempoByArtist: {} });
    expect(options.migrate!(undefined, 1)).toEqual({ globalTempo: TEMPO_PRESETS.normal, tempoByTrack: {}, tempoByArtist: {} });
  });
});

describe("moments", () => {
  it("adds, renames and removes moments per track", () => {
    useSoundStore.setState({ moments: {} });
    const store = useSoundStore.getState();
    store.addMoment("t1", 65_000, "1:05");
    const [moment] = useSoundStore.getState().moments.t1;
    expect(moment).toMatchObject({ positionMs: 65_000, label: "1:05" });

    useSoundStore.getState().renameMoment("t1", moment.id, "Drop");
    expect(useSoundStore.getState().moments.t1[0].label).toBe("Drop");

    useSoundStore.getState().removeMoment("t1", moment.id);
    expect(useSoundStore.getState().moments.t1).toEqual([]);
  });
});
