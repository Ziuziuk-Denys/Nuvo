import { describe, expect, it, vi, beforeEach } from "vitest";
import { coreCommands, labelKeyFor, navCommands, type PlayerControls } from "./commands";
import type { CommandDefinition } from "./registry";

let player: PlayerControls & { level: number; position: number; duration: number; track: boolean };
let liked: boolean | null;
let likes: { currentLiked(): boolean | null; like: ReturnType<typeof vi.fn<() => void>>; unlike: ReturnType<typeof vi.fn<() => void>> };
let commands: CommandDefinition[];

const run = (id: string) => commands.find((command) => command.id === id)!.run("key");
const byId = (id: string) => commands.find((command) => command.id === id)!;

beforeEach(() => {
  player = {
    level: 40,
    position: 0,
    duration: 0,
    track: true,
    hasTrack: () => player.track,
    toggle: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    positionMs: () => player.position,
    durationMs: () => player.duration,
    seekTo: vi.fn((ms: number) => {
      player.position = ms;
    }),
    volumeLevel: () => player.level,
    setVolumeLevel: (level: number) => {
      player.level = level;
    },
  };
  liked = false;
  likes = { currentLiked: () => liked, like: vi.fn(), unlike: vi.fn() };
  commands = coreCommands({ player, likes, loop: { setA: vi.fn(), setB: vi.fn(), clear: vi.fn() }, app: { quit: vi.fn(), toggleFullscreen: vi.fn() } });
});

describe("core commands", () => {
  it("seeks 5 s, floored at 0 and capped at a known duration (test 15)", () => {
    player.position = 3000;
    run("player.seek-back");
    expect(player.position).toBe(0);
    player.position = 10_000;
    player.duration = 12_000;
    run("player.seek-forward");
    expect(player.position).toBe(12_000);
    player.position = 10_000;
    player.duration = 0;
    run("player.seek-forward");
    expect(player.position).toBe(15_000);
  });

  it("steps volume by 5 points within 0-100 (test 16)", () => {
    player.level = 98;
    run("player.volume-up");
    expect(player.level).toBe(100);
    run("player.volume-up");
    expect(player.level).toBe(100);
    player.level = 3;
    run("player.volume-down");
    expect(player.level).toBe(0);
  });

  it("mutes and restores the last level, or 70 with none known (test 17)", () => {
    run("player.mute");
    expect(player.level).toBe(0);
    run("player.mute");
    expect(player.level).toBe(40);
    const fresh = coreCommands({ player, likes, loop: { setA: vi.fn(), setB: vi.fn(), clear: vi.fn() }, app: { quit: vi.fn(), toggleFullscreen: vi.fn() } });
    player.level = 0;
    fresh.find((command) => command.id === "player.mute")!.run("key");
    expect(player.level).toBe(70);
  });

  it("volume-up after a mute starts from 0 and the next mute remembers that level (test 18)", () => {
    run("player.mute");
    run("player.volume-up");
    expect(player.level).toBe(5);
    run("player.mute");
    expect(player.level).toBe(0);
    run("player.mute");
    expect(player.level).toBe(5);
  });

  it("likes or unlikes the current track and is off with no track (test 20)", () => {
    run("library.like-toggle");
    expect(likes.like).toHaveBeenCalledTimes(1);
    liked = true;
    run("library.like-toggle");
    expect(likes.unlike).toHaveBeenCalledTimes(1);
    liked = null;
    expect(byId("library.like-toggle").enabled!()).toBe(false);
  });

  it("needs a track for transport and loop points, not for volume", () => {
    player.track = false;
    expect(byId("player.toggle").enabled!()).toBe(false);
    expect(byId("loop.set-a").enabled!()).toBe(false);
    expect(byId("player.volume-up").enabled).toBeUndefined();
  });

  it("takes defaults and labels from the table, and allows global keys for playback and library only", () => {
    expect(byId("player.toggle")).toMatchObject({ defaultApp: "Space", defaultGlobal: null, globalAllowed: true, labelKey: "ui.commands.player_toggle" });
    expect(byId("library.like-toggle")).toMatchObject({ defaultApp: null, defaultGlobal: "Alt+Shift+L", globalAllowed: true });
    expect(byId("loop.clear")).toMatchObject({ defaultApp: "\\", globalAllowed: false });
    expect(byId("app.quit")).toMatchObject({ defaultApp: "Control+Q", globalAllowed: false });
    expect(byId("player.seek-back").repeatable).toBe(true);
    expect(labelKeyFor("player.seek-back")).toBe("ui.commands.player_seek_back");
  });
});

describe("nav commands", () => {
  it("opens lyrics only with a track and closes them again (test 19)", () => {
    const state = { open: false, track: false };
    const nav = navCommands({
      hasTrack: () => state.track,
      openSearch: vi.fn(),
      toggleQueue: vi.fn(),
      lyricsOpen: () => state.open,
      openLyrics: () => {
        state.open = true;
      },
      closeLyrics: () => {
        state.open = false;
      },
      openRecognize: vi.fn(),
    });
    const lyrics = nav.find((command) => command.id === "nav.lyrics")!;
    expect(lyrics.enabled!()).toBe(false);
    state.track = true;
    lyrics.run("key");
    expect(state.open).toBe(true);
    lyrics.run("key");
    expect(state.open).toBe(false);
    expect(nav.map((command) => [command.id, command.defaultApp, command.globalAllowed])).toEqual([
      ["nav.search", "/", false],
      ["nav.queue", "Q", false],
      ["nav.lyrics", "F", false],
      ["nav.recognize", "Control+Shift+R", false],
    ]);
  });
});
