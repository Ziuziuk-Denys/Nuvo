import { describe, expect, it } from "vitest";
import { listLink, type ListPorts } from "@/imports/flow";
import { IMPORT_SOURCES } from "./importSources";

describe("import sources", () => {
  it("the first run offers no service whose playlist links the import refuses", async () => {
    const unused = () => Promise.reject(new Error("no request expected"));
    const ports = { fetch: unused, youtube: {}, daemon: {} } as unknown as ListPorts;
    const refused = await listLink("https://music.yandex.ru/users/someone/playlists/3", ports, new AbortController().signal).catch(
      (error: { code?: string }) => error.code,
    );
    // when Yandex Music links start to import, offer it again on the start card
    expect(refused).toBe("yandex_lists");
    expect(IMPORT_SOURCES).not.toContain("yandex");
  });
});
