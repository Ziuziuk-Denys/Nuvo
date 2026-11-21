import { afterEach, describe, expect, it, vi } from "vitest";

const changed = vi.hoisted(() => vi.fn());
vi.mock("./data/library/changes", () => ({ notifyLibraryChanged: changed }));

import { createDaemonLibrary } from "./playerBoot";

describe("daemon library", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the library UI after an external like request completes", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: [], nextCursor: null }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    changed.mockClear();

    const library = createDaemonLibrary();
    library.like("track-1");

    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("nuvo-core://local/v1/me/library/tracks/track-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track: null }),
    });
  });
});
