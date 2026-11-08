import { describe, expect, it } from "vitest";
import { audioFormats, chooseFormat, report, validUntilMs, type AudioFormat } from "./formats";
import { format } from "../test/formats";

const formats = (...specs: Parameters<typeof format>[0][]) => audioFormats({ adaptiveFormats: specs.map(format) });
const normal = { quality: "normal" as const };

describe("format choice", () => {
  it("video formats are not audio formats", () => {
    expect(
      audioFormats({
        adaptiveFormats: [{ itag: 137, mimeType: 'video/mp4; codecs="avc1"' }, format({ itag: 251 })],
      }).map((f) => f.itag),
    ).toEqual([251]);
  });

  it("CAT order: 251 first for normal quality", () => {
    expect(chooseFormat(formats({ itag: 140 }, { itag: 251 }), normal)?.itag).toBe(251);
  });

  it("the DRC variant of 251 is skipped", () => {
    const chosen = chooseFormat(formats({ itag: 251, isDrc: true }, { itag: 251 }), normal);
    expect(chosen?.isDrc).toBeUndefined();
  });

  it("review focus: a DRC-only upload still gets a format", () => {
    expect(chooseFormat(formats({ itag: 251, isDrc: true }), normal)?.itag).toBe(251);
  });

  it("the default audio track wins among languages", () => {
    const chosen = chooseFormat(
      formats({ itag: 251, audioTrack: { id: "de.1", audioIsDefault: false } }, { itag: 251, audioTrack: { id: "en.4", audioIsDefault: true } }),
      normal,
    );
    expect(chosen?.audioTrack?.id).toBe("en.4");
  });

  it("aac preference, then the highest bitrate among unknown itags", () => {
    expect(
      chooseFormat(formats({ itag: 251 }, { itag: 140 }), {
        quality: "normal",
        codec: "aac",
      })?.itag,
    ).toBe(140);
    expect(chooseFormat(formats({ itag: 600, bitrate: 90_000 }, { itag: 601, bitrate: 120_000 }), normal)?.itag).toBe(601);
  });

  it("hifi takes the highest average bitrate and reports it", () => {
    const chosen = chooseFormat(
      formats({ itag: 251, averageBitrate: 135_000 }, { itag: 140, averageBitrate: 129_000 }, { itag: 774, averageBitrate: 250_000 }),
      { quality: "hifi" },
    ) as AudioFormat;
    expect(chosen.itag).toBe(774);
    expect(report(chosen).bitrate).toBe(250_000);
  });

  it("hifi ties go to Opus", () => {
    expect(chooseFormat(formats({ itag: 140, averageBitrate: 130_000 }, { itag: 251, averageBitrate: 130_000 }), { quality: "hifi" })?.itag).toBe(251);
  });

  it("expire becomes validUntilMs, or null", () => {
    expect(validUntilMs("https://x.googlevideo.com/videoplayback?expire=1900000000")).toBe(1_900_000_000_000);
    expect(new Date(1_900_000_000_000).toISOString()).toBe("2030-03-17T17:46:40.000Z");
    expect(validUntilMs("https://x.googlevideo.com/videoplayback")).toBeNull();
  });

  it("reports MIME before the semicolon, codec by MIME, peak bitrate only as a fallback", () => {
    expect(report(formats({ itag: 140, bitrate: 131_000 })[0])).toMatchObject({
      mimeType: "audio/mp4",
      codec: "aac",
      bitrate: 131_000,
      sizeBytes: 4_000_000,
    });
    expect(report({ itag: 1, mimeType: "audio/webm" }).bitrate).toBe(160_000);
  });
});
