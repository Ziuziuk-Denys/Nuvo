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
});
