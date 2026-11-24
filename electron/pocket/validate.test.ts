import { expect, it, describe } from "vitest";
import { POCKET_MENU_KEYS } from "../../src/pocket/contracts";
import { validateFeed, validateMenu } from "./validate";

const LOOK = { light: false, field: "#101320", ink: "rgba(244, 247, 255, 0.9)" };
const TRACK = { id: "q", title: "T", artist: "A", coverUrl: "nuvo-core://local/v1/covers?src=x&size=128", durationMs: 1000 };
const FEED = { trackId: "t", coverUrl: "https://i.ytimg.com/x.jpg", upNext: [TRACK], look: LOOK };

describe("validateFeed", () => {
  it("passes a feed through without extra fields", () => {
    expect(validateFeed({ ...FEED, extra: 1, upNext: [{ ...TRACK, extra: 1 }] })).toEqual(FEED);
    expect(validateFeed({ trackId: null, coverUrl: null, upNext: [], look: LOOK })).not.toBeNull();
  });

  it("refuses other cover schemes, long queues and colours that are not colours", () => {
    for (const coverUrl of ["file:///etc/passwd", "data:image/png;base64,x", "http://a/b.png", "nuvo-core://other/x", 5]) {
      expect(validateFeed({ ...FEED, coverUrl })).toBeNull();
      expect(validateFeed({ ...FEED, upNext: [{ ...TRACK, coverUrl }] })).toBeNull();
    }
    expect(validateFeed({ ...FEED, upNext: Array.from({ length: 21 }, () => TRACK) })).toBeNull();
    for (const field of ["red;}", "url(x)", "#12", ""]) expect(validateFeed({ ...FEED, look: { ...LOOK, field } })).toBeNull();
    expect(validateFeed(null)).toBeNull();
  });
});

describe("validateMenu", () => {
  const labels = Object.fromEntries(POCKET_MENU_KEYS.map((key) => [key, key]));

  it("needs every label and known faces", () => {
    expect(validateMenu({ labels: { ...labels, extra: "x" }, face: "cover", faces: ["cover", "queue"] })).toEqual({
      labels,
      face: "cover",
      faces: ["cover", "queue"],
    });
    expect(validateMenu({ labels: { ...labels, close: undefined }, face: "cover", faces: [] })).toBeNull();
    expect(validateMenu({ labels: { ...labels, close: "x".repeat(81) }, face: "cover", faces: [] })).toBeNull();
    expect(validateMenu({ labels, face: "side", faces: [] })).toBeNull();
    expect(validateMenu({ labels, face: "cover", faces: ["cover", "side"] })).toBeNull();
  });
});
