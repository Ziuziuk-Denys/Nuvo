import { describe, expect, it } from "vitest";
import { YtError, type ImportedList, type YtCatalog } from "../youtube/types";
import { ImportError } from "./types";
import { listYoutube } from "./youtube";

const signal = new AbortController().signal;

// Compile-time guard: the real catalog port must satisfy the lister.
function listerOf(catalog: Pick<YtCatalog, "importUrl">) {
  return catalog;
}

const list: ImportedList = {
  source: "youtube",
  sourceUrl: "https://music.youtube.com/playlist?list=PL1",
  title: "Mix",
  tracks: [
    {
      ytId: "abc12345678",
      title: "Song",
      artistTexts: ["Band"],
      artistChannelIds: ["UC1"],
      coverUrl: "https://i.ytimg.com/x.jpg",
    },
  ],
};

describe("listYoutube against the real catalog shape", () => {
  it("reads a list from a catalog importUrl", async () => {
    const lister = listerOf({ importUrl: async () => list });
    const result = await listYoutube("https://music.youtube.com/playlist?list=PL1", lister, signal);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].track?.id).toBe("abc12345678");
  });

  it("maps catalog error codes to import errors", async () => {
    const lister = listerOf({
      importUrl: async () => {
        throw new YtError("empty-playlist");
      },
    });
    await expect(listYoutube("u", lister, signal)).rejects.toMatchObject({
      code: "empty",
    });
    await expect(listYoutube("u", lister, signal)).rejects.toBeInstanceOf(ImportError);
  });
});
