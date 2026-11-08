import { describe, expect, it, vi } from "vitest";
import { createImportActions } from "./actions";
import { FakeDaemon, summary } from "./fixtures/fakeDaemon";
import { ImportError } from "./types";

function actions() {
  const daemon = new FakeDaemon();
  const started = vi.fn();
  const built = createImportActions({
    fetch: vi.fn(),
    youtube: { importUrl: vi.fn() },
    daemon,
    labels: {
      fallback: () => "Imported playlist",
      likes: (name) => `${name}: Likes`,
    },
    started,
  });
  return { built, daemon, started };
}

describe("createImportActions", () => {
  it("imports a picked file by its bytes, never its path", async () => {
    const { built, daemon, started } = actions();
    await built.importFile(new File(["a,b"], "likes.csv"));
    expect(daemon.started).toEqual([{ file: { name: "likes.csv", data: "YSxi" } }]);
    expect(started).toHaveBeenCalledWith([summary("i1")]);
  });

  it("sends a UTF-16 file as it is, so the daemon can detect the encoding", async () => {
    const { built, daemon } = actions();
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x2c, 0x00, 0x42, 0x00]);
    await built.importFile(new File([bytes], "likes.csv"));
    expect(daemon.started).toEqual([{ file: { name: "likes.csv", data: "//5BACwAQgA=" } }]);
  });

  it("refuses a file over 10 MB before reading it", async () => {
    const { built, daemon } = actions();
    const big = new File(["a"], "big.csv");
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    const read = vi.spyOn(big, "arrayBuffer");
    await expect(built.importFile(big)).rejects.toMatchObject({
      code: "file_too_large",
    });
    expect(read).not.toHaveBeenCalled();
    expect(daemon.started).toEqual([]);
  });

  it("turns a likes name into its likes link", async () => {
    const { built, daemon } = actions();
    daemon.soundcloud.set("https://soundcloud.com/nightowl/likes", {
      source: "soundcloud",
      label: "nightowl",
      likesOf: "nightowl",
      rows: [{ title: "a", artists: [] }],
    });
    const listing = await built.listLikes("nightowl", new AbortController().signal, () => {});
    expect(listing.likesOf).toBe("nightowl");
  });
});
