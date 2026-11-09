import { DEFAULT_BINDINGS } from "./bindings";
import type { CommandDefinition, CommandGroup } from "./registry";

export interface PlayerControls {
  hasTrack(): boolean;
  toggle(): void;
  next(): void;
  previous(): void;
  positionMs(): number;
  durationMs(): number;
  seekTo(positionMs: number): void;
  volumeLevel(): number;
  setVolumeLevel(level: number): void;
}

export interface LikeControls {
  currentLiked(): boolean | null;
  like(): void;
  unlike(): void;
}

export interface LoopControls {
  setA(): void;
  setB(): void;
  clear(): void;
}

export interface AppControls {
  quit(): void;
  toggleFullscreen(): void;
}

export interface NavControls {
  hasTrack(): boolean;
  openSearch(): void;
  toggleQueue(): void;
  lyricsOpen(): boolean;
  openLyrics(): void;
  closeLyrics(): void;
  openRecognize(): void;
}

export const SEEK_STEP_MS = 5000;
export const VOLUME_STEP = 5;
export const UNMUTE_LEVEL = 70;

export function labelKeyFor(id: string): string {
  return `ui.commands.${id.replace(/[.-]/g, "_")}`;
}

function command(id: string, group: CommandGroup, run: () => void, extra: Partial<CommandDefinition> = {}): CommandDefinition {
  const defaults = DEFAULT_BINDINGS[id];
  return {
    id,
    labelKey: labelKeyFor(id),
    group,
    defaultApp: defaults?.app ?? null,
    defaultGlobal: defaults?.global ?? null,
    globalAllowed: group === "playback" || group === "library",
    run,
    ...extra,
  };
}

export function coreCommands(deps: { player: PlayerControls; likes: LikeControls; loop: LoopControls; app: AppControls }): CommandDefinition[] {
  const { player, likes, loop, app } = deps;
  const withTrack = { enabled: () => player.hasTrack() };
  const setLevel = (level: number) => player.setVolumeLevel(Math.min(100, Math.max(0, Math.round(level))));
  let unmuteLevel: number | null = null;
  return [
    command("player.toggle", "playback", () => player.toggle(), withTrack),
    command("player.next", "playback", () => player.next(), withTrack),
    command("player.previous", "playback", () => player.previous(), withTrack),
    command(
      "player.seek-forward",
      "playback",
      () => {
        const duration = player.durationMs();
        const target = player.positionMs() + SEEK_STEP_MS;
        player.seekTo(duration > 0 ? Math.min(duration, target) : target);
      },
      { ...withTrack, repeatable: true },
    ),
    command("player.seek-back", "playback", () => player.seekTo(Math.max(0, player.positionMs() - SEEK_STEP_MS)), { ...withTrack, repeatable: true }),
    command("player.volume-up", "playback", () => setLevel(Math.round(player.volumeLevel()) + VOLUME_STEP), { repeatable: true }),
    command("player.volume-down", "playback", () => setLevel(Math.round(player.volumeLevel()) - VOLUME_STEP), { repeatable: true }),
    command("player.mute", "playback", () => {
      const level = player.volumeLevel();
      if (level > 0) {
        unmuteLevel = level;
        setLevel(0);
      } else {
        setLevel(unmuteLevel ?? UNMUTE_LEVEL);
      }
    }),
    command("library.like-toggle", "library", () => (likes.currentLiked() ? likes.unlike() : likes.like()), { enabled: () => likes.currentLiked() !== null }),
    command("loop.set-a", "sound", () => loop.setA(), withTrack),
    command("loop.set-b", "sound", () => loop.setB(), withTrack),
    command("loop.clear", "sound", () => loop.clear()),
    command("app.quit", "app", () => app.quit()),
    command("app.fullscreen", "app", () => app.toggleFullscreen()),
  ];
}

export function navCommands(nav: NavControls): CommandDefinition[] {
  return [
    command("nav.search", "navigation", () => nav.openSearch()),
    command("nav.queue", "navigation", () => nav.toggleQueue()),
    command("nav.lyrics", "navigation", () => (nav.lyricsOpen() ? nav.closeLyrics() : nav.openLyrics()), { enabled: () => nav.lyricsOpen() || nav.hasTrack() }),
    command("nav.recognize", "navigation", () => nav.openRecognize()),
  ];
}
