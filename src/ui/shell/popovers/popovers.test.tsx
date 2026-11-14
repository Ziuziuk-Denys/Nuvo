// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { SOUND_TABS, SoundPopover, SoundTrailing } from "./SoundPopover";
import { VolumePopover, wheelVolume } from "./VolumePopover";
import { useImportsUi } from "../../screens/imports/importsUi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spectrum = vi.hoisted(() => ({ listener: null as null | ((frame: { bands: Float32Array; clip: boolean }) => void), off: vi.fn(), fail: false }));

const mocks = vi.hoisted(() => {
  const player = {
    volume: 0.49,
    playbackRate: 1,
    pitchSemitones: 0,
    isPitchLinked: true,
    keepSpeedAcrossTracks: true,
    isReverbEnabled: false,
    reverbLevel: 0.35,
    status: "playing",
    positionMs: 83_400,
    currentTrack: { id: "t1", title: "Song", artists: "Band", coverUrl: "" } as { id: string; title: string; artists: string; coverUrl: string } | null,
  };
  const engine = {
    setPlaybackRate: vi.fn(),
    setPitchSemitones: vi.fn(),
    setIsPitchLinked: vi.fn(),
    setKeepSpeedAcrossTracks: vi.fn(),
    setIsReverbEnabled: vi.fn(),
    setReverbLevel: vi.fn(),
    resetSpeedAndPitch: vi.fn(),
    setVolume: vi.fn(),
    seek: vi.fn(),
  };
  const sound = {
    eqEnabled: false,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    presetName: "flat",
    customPresets: {} as Record<string, number[]>,
    byTrack: {} as Record<string, unknown>,
    byArtist: {} as Record<string, unknown>,
    tempoByTrack: {} as Record<string, unknown>,
    tempoByArtist: {} as Record<string, unknown>,
    setEnabled: vi.fn(),
    setGains: vi.fn(),
    applyPreset: vi.fn(),
    setProfile: vi.fn(),
    forget: vi.fn(),
    rememberTempo: vi.fn(),
    forgetTempo: vi.fn(),
    autoGain: true,
    bypass: false,
    setAutoGain: vi.fn(),
    setBypass: vi.fn(),
    saveCustomPreset: vi.fn(),
    renameCustomPreset: vi.fn(),
    deleteCustomPreset: vi.fn(),
    moments: {} as Record<string, Array<{ id: string; positionMs: number; label: string }>>,
    addMoment: vi.fn(),
    removeMoment: vi.fn(),
  };
  const sleep = { target: null as unknown, remainingMs: null as number | null, arm: vi.fn(), cancel: vi.fn() };
  const library = {
    playlists: [] as { id: string; title: string; trackCount: number; coverUrl: string; coverUrls: string[]; updatedAt?: string }[],
    isLoading: false,
    mutateAsync: vi.fn(),
    openCreatePlaylist: vi.fn(),
  };
  return { player, engine, sound, sleep, library, applyTempo: vi.fn() };
});

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${Object.values(params).join(" ")}` : key),
  }),
}));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/player", () => ({
  usePlayerState: () => mocks.player,
  usePlayerStore: (select: (state: typeof mocks.player) => unknown) => select(mocks.player),
  playerEngine: mocks.engine,
  toVolumeGain: (level: number) => level * level,
  toVolumeLevel: (gain: number) => Math.sqrt(gain),
}));
vi.mock("../../ports/sound", async () => {
  const eq = await vi.importActual<typeof import("@/features/sound/lib/eq")>("@/features/sound/lib/eq");
  const tempo = await vi.importActual<typeof import("@/features/sound/lib/tempo")>("@/features/sound/lib/tempo");
  const store = Object.assign((select: (state: typeof mocks.sound) => unknown) => select(mocks.sound), {
    getState: () => mocks.sound,
  });
  return {
    ...eq,
    ...tempo,
    useSoundStore: store,
    presetNameFor: (_gains: number[], preferred: string) => preferred,
    profileGains: (profile: unknown) => (Array.isArray(profile) ? profile : mocks.sound.gains),
    applyTempo: mocks.applyTempo,
    readPlayerTempo: () => tempo.TEMPO_PRESETS.normal,
    selectArtist: () => "Band",
    useSleepTimer: () => ({ target: mocks.sleep.target, remainingMs: mocks.sleep.remainingMs }),
    armSleepTimer: mocks.sleep.arm,
    cancelSleepTimer: mocks.sleep.cancel,
    formatSleepClock: () => "12:30",
    subscribeSpectrum: (listener: (frame: { bands: Float32Array; clip: boolean }) => void) => {
      if (spectrum.fail) throw new Error("engine not started");
      spectrum.listener = listener;
      return spectrum.off;
    },
  };
});
vi.mock("../../ports/library", () => ({
  usePlaylistsList: () => ({ data: { playlists: mocks.library.playlists }, isLoading: mocks.library.isLoading }),
  useAddPlaylistTracks: () => ({ mutateAsync: mocks.library.mutateAsync, isPending: false }),
  useModalStore: (select: (state: { openCreatePlaylist: typeof mocks.library.openCreatePlaylist }) => unknown) =>
    select({ openCreatePlaylist: mocks.library.openCreatePlaylist }),
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number) {
      super("api");
    }
  },
}));

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  Object.assign(mocks.player, { volume: 0.49, playbackRate: 1, isReverbEnabled: false });
  document.querySelectorAll("body > :not(div)").forEach((node) => node.remove());
  Object.assign(mocks.sound, { eqEnabled: false, byTrack: {}, byArtist: {} });
  Object.assign(mocks.sleep, { target: null, remainingMs: null });
  Object.assign(mocks.library, { playlists: [], isLoading: false });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const mount = (node: ReactNode) => act(() => root.render(node));
const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
const click = (target: Element) => act(() => (target as HTMLElement).click());
const slider = (name: string) => host.querySelector<HTMLElement>(`[role="slider"][aria-label="${name}"]`);
const button = (name: string) =>
  [...host.querySelectorAll<HTMLElement>("button, [role='button'], [role='switch']")].find(
    (element) => element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  );

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("SoundPopover", () => {
  it("sizes the equalizer wider than the compact speed, sleep and moments tabs", () => {
    expect(SOUND_TABS).toEqual([
      { id: "eq", width: 440 },
      { id: "speed", width: 320 },
      { id: "sleep", width: 320 },
      { id: "moments", width: 320 },
    ]);
  });

  it("renders the four tabs and the active panel, and reports a tab change", () => {
    const onTab = vi.fn();
    mount(<SoundPopover tab="speed" onTab={onTab} />);
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["ui.sound.tab_eq", "ui.sound.tab_speed", "ui.sound.tab_sleep", "ui.sound.tab_moments"]);
    expect(slider("player.speed")).not.toBeNull();
    click(button("ui.sound.tab_sleep")!);
    expect(onTab).toHaveBeenCalledWith("sleep");
    key(host.querySelector('[role="tab"][aria-selected="true"]')!, "ArrowLeft");
    expect(onTab).toHaveBeenLastCalledWith("eq");
    key(host.querySelector('[role="tab"][aria-selected="true"]')!, "End");
    expect(onTab).toHaveBeenLastCalledWith("moments");
  });
});

describe("Moments", () => {
  it("marks the playing moment, plays from a mark and forgets it", () => {
    mocks.sound.moments = {
      t1: [
        { id: "m2", positionMs: 200_000, label: "Moment 2" },
        { id: "m1", positionMs: 61_000, label: "Moment 1" },
      ],
    };
    mount(<SoundPopover tab="moments" onTab={() => undefined} />);
    click(button("ui.sound.moments.add 1:23")!);
    expect(mocks.sound.addMoment).toHaveBeenCalledWith("t1", 83_400, "ui.sound.moments.label 3");
    const marks = [...host.querySelectorAll("[data-moment] > button")].map((node) => node.textContent);
    expect(marks).toEqual(["1:01Moment 1", "3:20Moment 2"]);
    click(button("1:01Moment 1")!);
    expect(mocks.engine.seek).toHaveBeenCalledWith(61_000);
    click(button("ui.sound.moments.remove Moment 2")!);
    expect(mocks.sound.removeMoment).toHaveBeenCalledWith("t1", "m2");
    mocks.sound.moments = {};
  });
});

describe("Speed", () => {
  it("moves the speed by one step with ArrowRight and with the plus button", () => {
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(slider("player.speed")!.getAttribute("aria-valuetext")).toBe("1.00×");
    key(slider("player.speed")!, "ArrowRight");
    expect(mocks.engine.setPlaybackRate).toHaveBeenCalledWith(1.05);
    click(host.querySelectorAll('[aria-label="player.increase"]')[0]);
    expect(mocks.engine.setPlaybackRate).toHaveBeenCalledTimes(2);
  });

  it("resets the speed from its value pill", () => {
    mocks.player.playbackRate = 1.5;
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    click(button("1.50×")!);
    expect(mocks.engine.setPlaybackRate).toHaveBeenCalledWith(1);
  });

  it("applies a preset chip through the tempo sync", () => {
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(button("sound.tempo.normal")!.getAttribute("aria-pressed")).toBe("true");
    click(button("sound.tempo.slowed")!);
    expect(mocks.applyTempo).toHaveBeenCalledWith(expect.objectContaining({ rate: 0.85 }));
  });

  it("draws every fifth notch from the neutral speed taller, and the current one lit", () => {
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    const ticks = [...slider("player.speed")!.querySelectorAll("span")];
    const lit = ticks.findIndex((tick) => tick.hasAttribute("data-on"));
    expect(ticks[lit].hasAttribute("data-mark")).toBe(true);
    expect([1, 2, 3, 4].map((step) => ticks[lit + step].hasAttribute("data-mark"))).toEqual([false, false, false, false]);
    expect(ticks[lit + 5].hasAttribute("data-mark")).toBe(true);
    expect(ticks[lit - 5].hasAttribute("data-mark")).toBe(true);
  });

  it("formats the pitch in signed semitones", () => {
    mocks.player.pitchSemitones = 2;
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(slider("player.pitch")!.getAttribute("aria-valuetext")).toBe("+2.0 st");
    mocks.player.pitchSemitones = 0;
  });

  it("has no header control", () => {
    mount(<SoundTrailing tab="speed" />);
    expect(host.childElementCount).toBe(0);
  });

  it("turns reverb on with a usable level and shows its amount ruler only while on", () => {
    Object.assign(mocks.player, { reverbLevel: 0.05 });
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(slider("player.reverb_amount")).toBeNull();
    click(button("player.reverb")!);
    expect(mocks.engine.setReverbLevel).toHaveBeenCalledWith(0.4);
    expect(mocks.engine.setIsReverbEnabled).toHaveBeenCalledWith(true);
    Object.assign(mocks.player, { isReverbEnabled: true, reverbLevel: 0.4 });
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(slider("player.reverb_amount")!.getAttribute("aria-valuetext")).toBe("40%");
    mocks.player.reverbLevel = 0.35;
  });

  it("remembers the tempo for the track", () => {
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(button("sound.remember_track")!.getAttribute("aria-checked")).toBe("false");
    click(button("sound.remember_track")!);
    expect(mocks.sound.rememberTempo).toHaveBeenCalledWith("track", "t1", expect.objectContaining({ rate: 1 }));
  });

  it("keeps the speed across tracks from its option row", () => {
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(button("player.keep_speed_across_tracks")!.getAttribute("aria-checked")).toBe("true");
    click(button("player.keep_speed_across_tracks")!);
    expect(mocks.engine.setKeepSpeedAcrossTracks).toHaveBeenCalledWith(false);
  });

  it("describes an option row's switch with its hint on keyboard focus", () => {
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    const toggle = button("player.keep_speed_across_tracks")!;
    act(() => toggle.focus());
    const hint = document.getElementById(toggle.getAttribute("aria-describedby") ?? "");
    expect(hint?.getAttribute("role")).toBe("tooltip");
    expect(hint?.textContent).not.toBe("");
  });
});

describe("Equalizer", () => {
  it("draws the live spectrum as a fast and a slow wave with the clip light while open, and stops listening when closed", () => {
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    act(() => spectrum.listener!({ bands: new Float32Array([0, 1]), clip: true }));
    const [back, front] = Array.from(host.querySelectorAll('path[fill^="url(#eq-wave"]'), (path) => path.getAttribute("d"));
    expect(front).toMatch(/^M-12,140\.0L-12,.+C.+Z$/);
    expect(back).toMatch(/^M-12,140\.0L-12,.+C.+Z$/);
    expect(back).not.toBe(front);
    expect(host.querySelector('[aria-label="ui.eq.clip"]')!.hasAttribute("data-on")).toBe(true);
    mount(<SoundPopover tab="speed" onTab={() => undefined} />);
    expect(spectrum.off).toHaveBeenCalledOnce();
  });

  it("lets the waves sink while paused and then stops listening, so nothing runs at idle", () => {
    mocks.player.status = "paused";
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    act(() => spectrum.listener!({ bands: new Float32Array([1, 1]), clip: true }));
    expect(host.querySelector('[aria-label="ui.eq.clip"]')!.hasAttribute("data-on")).toBe(false);
    expect(spectrum.off).toHaveBeenCalledOnce();
    mocks.player.status = "playing";
  });

  it("opens with no spectrum before the engine has started", () => {
    spectrum.fail = true;
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    expect(host.querySelector("svg path")!.getAttribute("d")).toBeNull();
    spectrum.fail = false;
  });

  it("turns on from the header, which also holds Auto gain and Compare", () => {
    mount(<SoundTrailing tab="eq" />);
    click(host.querySelector('[role="switch"]')!);
    expect(mocks.sound.setEnabled).toHaveBeenCalledWith(true);
    click(button("sound.compare")!);
    expect(mocks.sound.setBypass).toHaveBeenCalledWith(true);
    click(button("sound.auto_gain")!);
    expect(mocks.sound.setAutoGain).toHaveBeenCalledWith(false);
  });

  it("applies a preset and turns the equalizer on so the edit is heard", () => {
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    click(button("sound.presets.rock")!);
    expect(mocks.sound.setEnabled).toHaveBeenCalledWith(true);
    expect(mocks.sound.applyPreset).toHaveBeenCalledWith("rock");
  });

  it("raises a band by half a decibel with ArrowUp", () => {
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    key(slider("ui.eq.bands.125, sound.hz 125")!, "ArrowUp");
    expect(mocks.sound.setGains).toHaveBeenCalledWith([0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("names the hovered band in a tip, with no gain numbers", () => {
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    const handle = slider("ui.eq.bands.62, sound.hz 62")!;
    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    const tip = host.querySelector("[data-on]")!;
    expect(tip.textContent).toBe("ui.eq.bands.62");
    expect(host.textContent).not.toMatch(/[+-]\d+\.\d/);
  });

  it("edits the track's own curve when the track has one", () => {
    mocks.sound.byTrack = { t1: "rock" };
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    click(button("sound.presets.vocal")!);
    expect(mocks.sound.setProfile).toHaveBeenCalledWith("track", "t1", "vocal");
    expect(mocks.sound.applyPreset).not.toHaveBeenCalled();
  });

  it("saves the curve as a named preset and refuses a built-in name", () => {
    mount(<SoundPopover tab="eq" onTab={() => undefined} />);
    click(button("sound.save_preset")!);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="sound.preset_name"]')!;
    type(field, "rock");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("sound.name_taken");
    type(field, "Night drive");
    key(field, "Enter");
    expect(mocks.sound.saveCustomPreset).toHaveBeenCalledWith("Night drive");
  });
});

describe("Sleep", () => {
  it("arms a preset length", () => {
    mount(<SoundPopover tab="sleep" onTab={() => undefined} />);
    click(button("sound.sleep.minutes 30")!);
    expect(mocks.sleep.arm).toHaveBeenCalledWith({ kind: "minutes", minutes: 30 });
  });

  it("arms a typed length and refuses nonsense", () => {
    mount(<SoundPopover tab="sleep" onTab={() => undefined} />);
    const input = host.querySelector("input")!;
    type(input, "abc");
    expect(button("sound.sleep.start")!.hasAttribute("disabled")).toBe(true);
    type(input, "20");
    click(button("sound.sleep.start")!);
    expect(mocks.sleep.arm).toHaveBeenCalledWith({ kind: "minutes", minutes: 20 });
  });

  it("says the time left in the header and cancels from the panel", () => {
    mocks.sleep.target = { kind: "minutes", minutes: 30 };
    mocks.sleep.remainingMs = 750_000;
    mount(
      <>
        <SoundTrailing tab="sleep" />
        <SoundPopover tab="sleep" onTab={() => undefined} />
      </>,
    );
    expect(host.querySelector('[role="status"]')!.textContent).toBe("sound.sleep.stops_in 12:30");
    click(button("sound.sleep.cancel")!);
    expect(mocks.sleep.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("VolumePopover", () => {
  const anchor = () => document.body.appendChild(document.createElement("button"));
  const volume = () => document.querySelector<HTMLElement>('[role="slider"][aria-label="ui.volume.title"]');
  const inDocument = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`);

  it("opens as a column over its anchor and lowers the level 5 % with ArrowDown", () => {
    mount(<VolumePopover open anchor={anchor()} onClose={() => undefined} />);
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("ui.volume.title");
    expect(volume()!.getAttribute("aria-valuetext")).toBe("70 %");
    key(volume()!, "ArrowDown");
    expect(mocks.engine.setVolume).toHaveBeenCalledWith(0.65 * 0.65);
  });

  it("mutes, then unmutes back to the previous gain", () => {
    mount(<VolumePopover open anchor={anchor()} onClose={() => undefined} />);
    click(inDocument("ui.volume.mute")!);
    expect(mocks.engine.setVolume).toHaveBeenLastCalledWith(0);
    mocks.player.volume = 0;
    mount(<VolumePopover open anchor={anchor()} onClose={() => undefined} />);
    click(inDocument("ui.volume.unmute")!);
    expect(mocks.engine.setVolume).toHaveBeenLastCalledWith(0.7 * 0.7);
  });

  it("steps 5 % per wheel notch", () => {
    wheelVolume(0.49, -100);
    expect(mocks.engine.setVolume).toHaveBeenLastCalledWith(0.75 * 0.75);
    wheelVolume(0.49, 100);
    expect(mocks.engine.setVolume).toHaveBeenLastCalledWith(0.65 * 0.65);
  });
});

describe("AddToPlaylistPopover", () => {
  const track = { id: "t1", title: "Song", artists: "Band", coverUrl: "" } as Parameters<typeof AddToPlaylistPopover>[0]["track"];
  const playlists = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `p${index}`, title: `List ${index}`, trackCount: index, coverUrl: "", coverUrls: [] }));
  const row = (title: string) => [...host.querySelectorAll<HTMLElement>("button[data-row]")].find((element) => element.textContent?.includes(title));

  it("adds the track once, says so, then closes", async () => {
    vi.useFakeTimers();
    mocks.library.playlists = playlists(2);
    mocks.library.mutateAsync.mockResolvedValue({});
    const onDone = vi.fn();
    mount(<AddToPlaylistPopover track={track} onDone={onDone} />);
    click(row("List 1")!);
    click(row("List 0")!);
    await act(async () => undefined);
    expect(mocks.library.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.library.mutateAsync).toHaveBeenCalledWith({ playlistId: "p1", track });
    expect(row("List 1")!.textContent).toContain("ui.add.added");
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1200));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("says the track is already there and stays open", async () => {
    mocks.library.playlists = playlists(2);
    const { ApiError } = await import("../../ports/library");
    mocks.library.mutateAsync.mockRejectedValue(new (ApiError as unknown as new (status: number) => Error)(409));
    const onDone = vi.fn();
    mount(<AddToPlaylistPopover track={track} onDone={onDone} />);
    click(row("List 0")!);
    await act(async () => undefined);
    expect(row("List 0")!.textContent).toContain("ui.add.already");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("clears the already-there note when another playlist is picked, and adds there", async () => {
    mocks.library.playlists = playlists(2);
    const { ApiError } = await import("../../ports/library");
    mocks.library.mutateAsync.mockRejectedValueOnce(new (ApiError as unknown as new (status: number) => Error)(409)).mockResolvedValueOnce({});
    mount(<AddToPlaylistPopover track={track} onDone={() => undefined} />);
    click(row("List 0")!);
    await act(async () => undefined);
    expect(row("List 0")!.textContent).toContain("ui.add.already");
    click(row("List 1")!);
    await act(async () => undefined);
    expect(mocks.library.mutateAsync).toHaveBeenLastCalledWith({ playlistId: "p1", track });
    expect(row("List 0")!.textContent).not.toContain("ui.add.already");
    expect(row("List 1")!.textContent).toContain("ui.add.added");
  });

  it("hands the track to a link import that makes a new playlist", () => {
    const onDone = vi.fn();
    mount(<AddToPlaylistPopover track={track} onDone={onDone} />);
    click(button("ui.add.from_link")!);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useImportsUi.getState().sheet).toEqual({ pendingTrack: { id: "t1", title: "Song", artists: [{ id: "", name: "Band" }], durationMs: 0 } });
    useImportsUi.getState().close();
  });

  it("hands the track to the create-playlist flow", () => {
    const onDone = vi.fn();
    mount(<AddToPlaylistPopover track={track} onDone={onDone} />);
    expect(host.textContent).toContain("ui.add.empty");
    click(button("ui.add.new")!);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mocks.library.openCreatePlaylist).toHaveBeenCalledWith(undefined, track);
  });

  it("searches as soon as there is a playlist and narrows the rows", () => {
    mount(<AddToPlaylistPopover track={track} onDone={() => undefined} />);
    expect(host.querySelector("input")).toBeNull();
    mocks.library.playlists = playlists(9);
    mount(<AddToPlaylistPopover track={track} onDone={() => undefined} />);
    type(host.querySelector("input")!, "list 8");
    expect(host.querySelectorAll("button[data-row]")).toHaveLength(1);
    expect(row("List 8")).toBeDefined();
  });

  it("names each playlist's song count and falls back to its first song cover", () => {
    mocks.library.playlists = [{ id: "p", title: "Road", trackCount: 14, coverUrl: "", coverUrls: ["first.jpg"] }];
    mount(<AddToPlaylistPopover track={track} onDone={() => undefined} />);
    expect(row("Road")!.textContent).toContain("common.songs 14");
    expect(row("Road")!.querySelector("img")?.getAttribute("src")).toContain("first.jpg");
  });

  it("lists the most recently changed playlists first", () => {
    mocks.library.playlists = [
      { id: "old", title: "Old", trackCount: 1, coverUrl: "", coverUrls: [], updatedAt: "2026-01-01T00:00:00Z" },
      { id: "new", title: "New", trackCount: 1, coverUrl: "", coverUrls: [], updatedAt: "2026-10-01T00:00:00Z" },
    ];
    mount(<AddToPlaylistPopover track={track} onDone={() => undefined} />);
    expect([...host.querySelectorAll("button[data-row]")].map((element) => element.textContent?.slice(0, 3))).toEqual(["New", "Old"]);
  });

  it("walks from the search field into the rows with the arrow keys", () => {
    mocks.library.playlists = playlists(2);
    mount(<AddToPlaylistPopover track={track} onDone={() => undefined} />);
    const input = host.querySelector("input")!;
    act(() => input.focus());
    key(input, "ArrowDown");
    expect(document.activeElement).toBe(row("List 0"));
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(row("List 1"));
    key(document.activeElement!, "ArrowUp");
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(input);
  });
});
