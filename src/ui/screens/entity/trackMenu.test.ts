import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../components/Menu";
import { trackMenuItems, type TrackMenuActions } from "./trackMenu";

vi.mock("../../recs/notInterestedItems", () => ({ notInterestedItems: () => [] }));

const actions = (extra: Partial<TrackMenuActions> = {}): TrackMenuActions => ({
  t: ((key: string) => key) as TrackMenuActions["t"],
  playNext: vi.fn(),
  addToQueue: vi.fn(),
  addToPlaylist: vi.fn(),
  startRadio: vi.fn(),
  goToArtist: vi.fn(),
  goToAlbum: vi.fn(),
  remove: vi.fn(),
  ...extra,
});
const labels = (items: MenuItem[]) => items.flatMap((item) => (item === "separator" ? [] : [item.label]));
const track = (id: string) => ({ id, title: "T", artists: "A", coverUrl: "", durationMs: 1, playCount: 0 }) as Parameters<typeof trackMenuItems>[0];

describe("track menu", () => {
  it("offers Save as file everywhere and Show in folder for local files only", () => {
    const withSave = actions({ saveAsFile: vi.fn(), showInFolder: vi.fn() });
    expect(labels(trackMenuItems(track("dQw4w9WgXcQ"), {}, withSave))).toContain("ui.export.save_file");
    expect(labels(trackMenuItems(track("dQw4w9WgXcQ"), {}, withSave))).not.toContain("ui.local.show_in_folder");
    expect(labels(trackMenuItems(track(`local:${"a".repeat(32)}`), {}, withSave))).toContain("ui.local.show_in_folder");
    expect(labels(trackMenuItems(track("dQw4w9WgXcQ"), {}, actions()))).not.toContain("ui.export.save_file");
  });

  it("hides what a song cannot do instead of dimming it, and never leaves an empty section", () => {
    const items = trackMenuItems({ ...track("dQw4w9WgXcQ"), durationMs: 0 }, {}, actions());
    expect(labels(items)).not.toContain("ui.entity.go_artist");
    expect(labels(items)).not.toContain("ui.trim.menu");
    expect(items.some((item) => item !== "separator" && "disabled" in item && item.disabled)).toBe(false);
    expect(items.some((item, index) => item === "separator" && items[index + 1] === "separator")).toBe(false);
    expect(items.at(-1)).not.toBe("separator");
  });

  it("puts a lone lyrics action in place and folds two under Lyrics", () => {
    const one = trackMenuItems(track("dQw4w9WgXcQ"), {}, actions({ editLyrics: vi.fn() }));
    expect(labels(one)).toContain("ui.lyrics.edit");
    const two = trackMenuItems(track("dQw4w9WgXcQ"), {}, actions({ editLyrics: vi.fn(), translateLyrics: vi.fn() }));
    expect(labels(two)).toContain("ui.lyrics.edit_title");
    expect(labels(two)).not.toContain("ui.lyrics.edit");
  });
});
