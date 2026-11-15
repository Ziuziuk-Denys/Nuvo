import { describe, expect, it, vi } from "vitest";
import type { SurfaceState } from "../../src/engine/types";
import { IDLE_STATE } from "./relay";
import { THUMBAR_LABELS_EN, Thumbar, thumbarButtons, thumbarIconSize, validateThumbarLabels, type ThumbarButton } from "./thumbar";

const state = (extra: Partial<SurfaceState> = {}): SurfaceState => ({
  ...IDLE_STATE,
  trackId: "t1",
  title: "Song",
  artists: "Artist",
  status: "playing",
  ...extra,
});

const RU = { previous: "Предыдущий", play: "Воспроизвести", pause: "Пауза", next: "Следующий", like: "Нравится", unlike: "Убрать из любимых" };

describe("thumbarButtons", () => {
  it("shows previous, pause, next and like while a track plays", () => {
    expect(thumbarButtons(state(), THUMBAR_LABELS_EN)).toEqual([
      { command: "previous", icon: "previous", tooltip: "Previous" },
      { command: "toggle", icon: "pause", tooltip: "Pause" },
      { command: "next", icon: "next", tooltip: "Next" },
      { command: "like", icon: "like", tooltip: "Like" },
    ]);
  });

  it("follows the play state and the like of the current track", () => {
    const paused = thumbarButtons(state({ status: "paused", liked: true }), THUMBAR_LABELS_EN);
    expect(paused[1]).toEqual({ command: "toggle", icon: "play", tooltip: "Play" });
    expect(paused[3]).toEqual({ command: "like", icon: "liked", tooltip: "Remove from liked songs" });
    expect(thumbarButtons(state({ status: "loading" }), THUMBAR_LABELS_EN)[1].icon).toBe("pause");
  });

  it("takes the tooltips in the app language", () => {
    expect(thumbarButtons(state({ liked: true }), RU).map((button) => button.tooltip)).toEqual(["Предыдущий", "Пауза", "Следующий", "Убрать из любимых"]);
  });

  it("has no buttons when nothing is loaded", () => {
    expect(thumbarButtons(IDLE_STATE, THUMBAR_LABELS_EN)).toEqual([]);
    expect(thumbarButtons(state({ trackId: null, status: "paused" }), THUMBAR_LABELS_EN)).toEqual([]);
  });
});

describe("thumbarIconSize", () => {
  it("picks the file drawn for the taskbar scale, rounding up", () => {
    expect([1, 1.25, 1.5, 1.75, 2].map(thumbarIconSize)).toEqual([16, 20, 24, 28, 32]);
    expect(thumbarIconSize(1.1)).toBe(20);
    expect(thumbarIconSize(3)).toBe(32);
  });
});

describe("validateThumbarLabels", () => {
  it("accepts six short strings and nothing else", () => {
    expect(validateThumbarLabels(RU)).toEqual(RU);
    expect(validateThumbarLabels({ ...RU, extra: "x" })).toEqual(RU);
    expect(validateThumbarLabels({ ...RU, pause: 1 })).toBeNull();
    expect(validateThumbarLabels({ ...RU, next: "x".repeat(200) })).toBeNull();
    expect(validateThumbarLabels(null)).toBeNull();
  });
});

describe("Thumbar", () => {
  it("applies only when the buttons change, not on every position update", () => {
    const apply = vi.fn((_buttons: ThumbarButton[]) => true);
    const thumbar = new Thumbar(apply);
    thumbar.update(state({ positionMs: 1 }));
    thumbar.update(state({ positionMs: 2 }));
    thumbar.update(state({ trackId: "t2", title: "Other" }));
    expect(apply).toHaveBeenCalledTimes(1);
    thumbar.update(state({ status: "paused" }));
    thumbar.update(state({ status: "paused", liked: true }));
    thumbar.setLabels(RU);
    thumbar.setLabels(RU);
    thumbar.update(IDLE_STATE);
    expect(apply.mock.calls.map(([buttons]) => buttons.map((button) => button.icon))).toEqual([
      ["previous", "pause", "next", "like"],
      ["previous", "play", "next", "like"],
      ["previous", "play", "next", "liked"],
      ["previous", "play", "next", "liked"],
      [],
    ]);
  });

  it("tries again on the next update when the window could not take the buttons", () => {
    const apply = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const thumbar = new Thumbar(apply);
    thumbar.update(state());
    thumbar.update(state());
    thumbar.update(state());
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
