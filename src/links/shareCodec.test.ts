// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_CHARS,
  ShareError,
  cleanText,
  clampUtf8,
  decodeShare,
  encodeShare,
  fromBase64Url,
  normalizeShare,
  packYoutubeId,
  toBase64Url,
  unpackYoutubeId,
  type Share,
  type ShareTrack,
} from "./shareCodec";
import { randomShare, seeded } from "./shareFixtures";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

async function codeOf(payload: string): Promise<string> {
  try {
    await decodeShare(payload);
    return "ok";
  } catch (error) {
    if (error instanceof ShareError) return error.code;
    throw error;
  }
}

function raw(header: number, body: number[]): string {
  return toBase64Url(Uint8Array.from([header, ...body]));
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [bytes.length, ...bytes];
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("base64url", () => {
  it("round-trips every length and refuses bad input", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
    expect(fromBase64Url("A")).toBeNull();
    expect(fromBase64Url("AB=")).toBeNull();
    expect(fromBase64Url("AB")).toBeNull(); // non-zero trailing bits
    expect(fromBase64Url("AA")).toEqual(Uint8Array.from([0]));
  });
});

describe("YouTube id packing", () => {
  it("packs all 16 legal last characters losslessly", () => {
    const legal = [...B64].filter((_, value) => value % 4 === 0);
    expect(legal.join("")).toBe("AEIMQUYcgkosw048");
    for (const last of legal) {
      const id = `dQw4w9WgXc${last}`;
      const packed = packYoutubeId(id);
      expect(packed?.length).toBe(8);
      expect(unpackYoutubeId(packed as Uint8Array)).toBe(id);
    }
  });

  it("refuses the other 48 last characters and malformed ids", () => {
    for (const last of [...B64].filter((_, value) => value % 4 !== 0)) expect(packYoutubeId(`dQw4w9WgXc${last}`)).toBeNull();
    expect(packYoutubeId("dQw4w9WgXcQQ")).toBeNull();
    expect(packYoutubeId("dQw4w9WgX!Q")).toBeNull();
  });
});

describe("text rules", () => {
  it("turns control and bidi characters into spaces and clamps by bytes", () => {
    expect(cleanText(" a\tb\nc\u202ed\u0000 ")).toBe("a b c d");
    expect(cleanText("👨\u200d👩\u200d👧")).toBe("👨\u200d👩\u200d👧");
    expect(clampUtf8("ёжик", 5)).toBe("ёж");
    expect(clampUtf8("a😀b", 4)).toBe("a");
  });
});

const SONG: Share = {
  title: "",
  tracks: [
    {
      source: "youtube",
      id: "dQw4w9WgXcQ",
      artist: "Rick Astley",
      title: "Never Gonna Give You Up",
      durationSec: 213,
    },
  ],
};
const CYRILLIC: Share = {
  title: "",
  tracks: [{ source: "text", artist: "Кино", title: "Группа крови", durationSec: 287 }],
};
const MIXED = randomShare(seeded(50), 50, "Вечерний плейлист");

// Golden payload from this encoder (Node 24 zlib via CompressionStream); compared after decoding
const GOLDEN_SONG = "EAABDXUMOMPVoF3EI1JpY2sgQXN0bGV5CU5ldmVyIEdvbm5hIEdpdmUgWW91IFVw1QE";
const GOLDEN_CYRILLIC = "EAABDCDQmtC40L3QvgnQk9GA0YPQv9C_0LAg0LrRgNC-0LLQuJ8C";

describe("golden vectors", () => {
  it("decode to exactly the shared songs and nothing else", async () => {
    expect(await decodeShare(GOLDEN_SONG)).toEqual(SONG);
    expect(await decodeShare(GOLDEN_CYRILLIC)).toEqual(CYRILLIC);
    const decoded = await decodeShare(await encodeShare(MIXED));
    expect(decoded).toEqual(normalizeShare(MIXED));
    for (const track of [...SONG.tracks, ...CYRILLIC.tracks, ...decoded.tracks]) {
      for (const key of Object.keys(track)) expect(["source", "id", "artist", "title", "durationSec"]).toContain(key);
    }
  });

  it("current encodes of the golden songs decode the same", async () => {
    expect(await decodeShare(await encodeShare(SONG))).toEqual(SONG);
    expect(await decodeShare(await encodeShare(CYRILLIC))).toEqual(CYRILLIC);
  });
});

describe("round trip", () => {
  it("1,000 random playlists with emoji, RTL, tabs, newlines, empty artists and long fields", async () => {
    const random = seeded(7);
    for (let i = 0; i < 1000; i++) {
      const share = randomShare(random, 1 + Math.floor(random() * 30), i % 3 ? "Mix " + i : "x".repeat(260), true);
      expect(await decodeShare(await encodeShare(share))).toEqual(normalizeShare(share));
    }
  }, 60_000);

  it("an id that cannot be packed travels as a text track", () => {
    const share: Share = {
      title: "",
      tracks: [{ source: "youtube", id: "dQw4w9WgXcR", artist: "A", title: "B" }],
    };
    expect(normalizeShare(share).tracks[0]).toEqual({
      source: "text",
      artist: "A",
      title: "B",
    });
  });
});

describe("strict decoding", () => {
  const ok: number[] = [...text(""), 1, 0x04, ...text("A\tB")];

  it("accepts the minimal hand-made payload", async () => {
    expect(await codeOf(raw(0x10, ok))).toBe("ok");
  });

  it.each([
    ["version 0", raw(0x00, ok), "bad_share"],
    ["a future version", raw(0x20, ok), "newer_link"],
    ["a reserved flag bit", raw(0x12, ok), "bad_share"],
    ["an overlong varint", raw(0x10, [0x80, 0x00, 1, 0x04, ...text("A\tB")]), "bad_share"],
    ["a varint over 8 bytes", raw(0x10, [...text(""), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]), "bad_share"],
    ["invalid UTF-8", raw(0x10, [2, 0xc3, 0x28, 1, 0x04, ...text("A\tB")]), "bad_share"],
    ["a title over 200 bytes", raw(0x10, [...text("t".repeat(201)), 1, 0x04, ...text("A\tB")]), "bad_share"],
    ["zero tracks", raw(0x10, [...text(""), 0]), "bad_share"],
    ["5,001 tracks", raw(0x10, [...text(""), 0x89, 0x27]), "bad_share"],
    ["a text track without names", raw(0x10, [...text(""), 1, 0x00]), "bad_share"],
    ["names without a tab", raw(0x10, [...text(""), 1, 0x04, ...text("AB")]), "bad_share"],
    ["names with two tabs", raw(0x10, [...text(""), 1, 0x04, ...text("A\tB\tC")]), "bad_share"],
    ["names over 400 bytes", raw(0x10, [...text(""), 1, 0x04, 0x91, 0x03, ...Array.from({ length: 401 }, () => 0x41)]), "bad_share"],
    ["kind 3", raw(0x10, [...text(""), 1, 0x07, ...text("A\tB")]), "bad_share"],
    ["a high tag bit", raw(0x10, [...text(""), 1, 0x14, ...text("A\tB")]), "bad_share"],
    ["SoundCloud id 0", raw(0x10, [...text(""), 1, 0x02, 0]), "bad_share"],
    ["duration 0", raw(0x10, [...text(""), 1, 0x0c, ...text("A\tB"), 0]), "bad_share"],
    ["duration over a day", raw(0x10, [...text(""), 1, 0x0c, ...text("A\tB"), 0x81, 0xa3, 0x05]), "bad_share"],
    ["a newline in the title", raw(0x10, [...text("a\nb"), 1, 0x04, ...text("A\tB")]), "bad_share"],
    ["a bidi override in a name", raw(0x10, [...text("t"), 1, 0x04, ...text("A\u202eX\tB")]), "bad_share"],
    ["doubled spaces in a name", raw(0x10, [...text("t"), 1, 0x04, ...text("A\tB  C")]), "bad_share"],
    ["trailing bytes", raw(0x10, [...ok, 0]), "bad_share"],
    ["a character outside base64url", "EAAB.wQDQQlC", "bad_share"],
    ["one character", "E", "bad_share"],
  ])("refuses %s", async (_name, payload, code) => {
    expect(await codeOf(payload)).toBe(code);
  });

  it("refuses a payload truncated at every byte offset, raw and deflated", async () => {
    const payloads = [await encodeShare(SONG), await encodeShare(MIXED)];
    for (const payload of payloads) {
      const bytes = fromBase64Url(payload) as Uint8Array;
      for (let k = 0; k < bytes.length; k++) expect(await codeOf(toBase64Url(bytes.subarray(0, k)))).toBe("bad_share");
    }
    expect((fromBase64Url(payloads[1]) as Uint8Array)[0]).toBe(0x11);
  });

  it("stops a 10 MiB decompression bomb at the 512 KiB cap", async () => {
    const bomb = await deflate(new Uint8Array(10 * 1024 * 1024));
    const payload = toBase64Url(Uint8Array.from([0x11, ...bomb]));
    expect(payload.length).toBeLessThan(MAX_PAYLOAD_CHARS);
    expect(await codeOf(payload)).toBe("bad_share");
  });

  it("refuses a 65,537-character payload before reading it", async () => {
    expect(await codeOf("A".repeat(MAX_PAYLOAD_CHARS + 1))).toBe("bad_share");
  });

  it("decodes 100,000 random byte strings to a share or a ShareError, each within 10 ms", async () => {
    const random = seeded(99);
    const times: number[] = [];
    for (let i = 0; i < 100_000; i++) {
      const bytes = Uint8Array.from({ length: Math.floor(random() * 48) }, () => Math.floor(random() * 256));
      if (i % 4 === 0 && bytes.length) bytes[0] = 0x10 | (bytes[0] & 1);
      const started = performance.now();
      await codeOf(toBase64Url(bytes));
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.999)]).toBeLessThan(10);
    expect(times[times.length - 1]).toBeLessThan(250);
  }, 120_000);
});

describe("mutated payloads", () => {
  it("every mutation of a valid body is a share that re-encodes to itself, or a ShareError", async () => {
    const random = seeded(5);
    const base = fromBase64Url(
      toBase64Url(
        Uint8Array.from([
          0x10,
          ...text("Mix"),
          3,
          0x04,
          ...text("Кино\tГруппа крови"),
          0x01,
          ...(packYoutubeId("dQw4w9WgXcQ") as Uint8Array),
          0x0c,
          ...text("C\tD"),
          100,
        ]),
      ),
    ) as Uint8Array;
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      const bytes = Uint8Array.from(base);
      const edits = 1 + Math.floor(random() * 3);
      for (let k = 0; k < edits; k++) bytes[1 + Math.floor(random() * (bytes.length - 1))] = Math.floor(random() * 256);
      try {
        const share = await decodeShare(toBase64Url(bytes));
        accepted++;
        expect(normalizeShare(share)).toEqual(share);
      } catch (error) {
        expect(error).toBeInstanceOf(ShareError);
      }
    }
    expect(accepted).toBeGreaterThan(0);
  }, 60_000);
});

describe("fixtures", () => {
  it("random shares are deterministic per seed", () => {
    const a: ShareTrack[] = randomShare(seeded(1), 5, "x").tracks;
    expect(randomShare(seeded(1), 5, "x").tracks).toEqual(a);
  });
});
