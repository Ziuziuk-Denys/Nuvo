import { describe, expect, it } from "vitest";
import { captionFor, hashtag } from "./caption";

const lines = [
  { fromMs: 1_000, toMs: 3_000, text: "Before the clip", companion: false, instrumental: false },
  { fromMs: 41_000, toMs: 44_000, text: "Boy, I think about it every night and day", companion: false, instrumental: false },
];
const song = { title: "Glass Radio", artists: "Velvet Hour", lines, fromMs: 40_000, toMs: 55_000, credit: "made with nuvo" };

describe("post caption", () => {
  it("puts the song first, then tags, then a quiet credit", () => {
    expect(captionFor({ ...song, style: "song" })).toBe(
      "Velvet Hour - Glass Radio\n\n#velvethour #glassradio #lyrics #lyricvideo\nmade with nuvo · nuvo.quest",
    );
  });

  it("can lead with the first line sung in the clip", () => {
    expect(captionFor({ ...song, style: "line" })).toBe(
      "Boy, I think about it every night and day\n\nVelvet Hour - Glass Radio\n#velvethour #glassradio #lyrics\nmade with nuvo · nuvo.quest",
    );
  });

  it("falls back to the song when the clip has no words, and keeps the short style short", () => {
    expect(captionFor({ ...song, fromMs: 10_000, toMs: 20_000, style: "line" })).toBe(captionFor({ ...song, fromMs: 10_000, toMs: 20_000, style: "song" }));
    expect(captionFor({ ...song, style: "short" })).toBe("Glass Radio\n#velvethour #glassradio\nnuvo.quest");
  });

  it("builds lowercase tags any app accepts, Cyrillic included", () => {
    expect(hashtag("Ночные снайперы")).toBe("#ночныеснайперы");
    expect(hashtag("AC/DC & friends!")).toBe("#acdcfriends");
    expect(hashtag("   ")).toBe("");
  });
});
