import { expect, it, describe } from "vitest";
import { pocketFeed } from "./usePocketFeed";

const LOOK = { light: false, field: "#000", ink: "#fff" };
const track = (id: string, coverUrl = `https://i.ytimg.com/${id}.jpg`) => ({ id, title: id, artists: "A", coverUrl, durationMs: 1000 });

describe("pocketFeed", () => {
  it("sends the cover through the daemon and the songs after the current one", () => {
    const queue = Array.from({ length: 30 }, (_, at) => track(`s${at}`));
    const feed = pocketFeed(queue[2], queue, 2, LOOK);
    expect(feed.trackId).toBe("s2");
    expect(feed.coverUrl).toMatch(/^nuvo-core:\/\/local\/v1\/covers\?src=https/);
    expect(feed.upNext).toHaveLength(20);
    expect(feed.upNext[0].id).toBe("s3");
  });

  it("leaves out covers the other window may not load", () => {
    expect(pocketFeed(track("a", "http://plain/x.jpg"), [], 0, LOOK).coverUrl).toBeNull();
    expect(pocketFeed(track("a", "data:image/png;base64,AA"), [], 0, LOOK).coverUrl).toBeNull();
    expect(pocketFeed(null, [], 0, LOOK)).toEqual({ trackId: null, coverUrl: null, upNext: [], look: LOOK });
  });
});
