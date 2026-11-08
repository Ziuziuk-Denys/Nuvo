import { describe, expect, it } from "vitest";
import { errorMessage, noticeMessage } from "./messages";
import { ImportError } from "./types";

describe("messages", () => {
  it("names every import error by its code, with the host when there is one", () => {
    expect(errorMessage(new ImportError("unsupported_host", "example.org"))).toEqual({
      key: "ui.imports.error.unsupported_host",
      vars: { host: "example.org" },
    });
    expect(errorMessage(new ImportError("spotify_file_only"))).toEqual({
      key: "ui.imports.error.spotify_file_only",
    });
    expect(errorMessage(new Error("boom"))).toEqual({
      key: "ui.imports.error.network",
    });
  });

  it("words the listing notices", () => {
    expect(noticeMessage({ kind: "partial", shown: 100, total: 340 }, "apple-music")).toEqual({
      key: "ui.imports.notice.partial",
      vars: { shown: 100, total: 340, count: 340 },
    });
    expect(noticeMessage({ kind: "partial", shown: 100 }, "spotify")).toEqual({
      key: "ui.imports.notice.partial_spotify",
      vars: { shown: 100, count: 100 },
    });
    expect(noticeMessage({ kind: "capped", kept: 20_000 }, "deezer")).toEqual({
      key: "ui.imports.notice.capped",
      vars: { kept: 20_000, count: 20_000 },
    });
  });
});
