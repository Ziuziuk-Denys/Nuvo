import { describe, expect, it, vi } from "vitest";
import { artworkData, MediaSessionMirror, type MediaSessionLike } from "./mediaSession";
import type { PlayerView } from "./types";

describe("media session artwork", () => {
  const session = (): MediaSessionLike => ({ metadata: null, playbackState: "none", setActionHandler: vi.fn(), setPositionState: vi.fn() });
  const view = (id: string, coverUrl: string) =>
    ({ status: "playing", current: { track: { id, title: id, artists: "A", coverUrl } } }) as unknown as PlayerView;
  const shown = (target: MediaSessionLike) => target.metadata as unknown as MediaMetadataInit | null;

  it("never hands the session a daemon URL: the text shows at once, the cover follows as data", async () => {
    const target = session();
    const mirror = new MediaSessionMirror(
      target,
      (init) => init as unknown as MediaMetadata,
      async () => "data:image/png;base64,AA==",
    );
    mirror.update(view("local:a", "nuvo-core://local/v1/local/tracks/local:a/cover"), false);
    expect(shown(target)?.title).toBe("local:a");
    expect(shown(target)?.artwork?.[0].src).toMatch(/^data:image\/png/);
    await vi.waitFor(() => expect(shown(target)?.artwork).toEqual([{ src: "data:image/png;base64,AA==" }]));
  });

  it("a cover that arrives after the track changed is dropped, a track without one asks for nothing", async () => {
    const target = session();
    const asked: string[] = [];
    let finish: (src: string) => void = () => undefined;
    const artwork = (url: string) => {
      asked.push(url);
      return new Promise<string>((resolve) => (finish = resolve));
    };
    const mirror = new MediaSessionMirror(target, (init) => init as unknown as MediaMetadata, artwork);
    mirror.update(view("a", "nuvo-core://a"), false);
    mirror.update(view("b", ""), false);
    finish("data:image/png;base64,AA==");
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toEqual(["nuvo-core://a"]);
    expect(shown(target)?.title).toBe("b");
    expect(shown(target)?.artwork?.[0].src).toMatch(/^data:image\/png/);
  });

  it("reads the picture into a data URL, and a failed answer gives nothing", async () => {
    const answer = { ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) } as Response;
    expect(await artworkData("nuvo-core://x", async () => answer)).toBe("data:image/png;base64,AQID");
    expect(await artworkData("nuvo-core://x", async () => new Response(null, { status: 404 }))).toBeNull();
  });
});
