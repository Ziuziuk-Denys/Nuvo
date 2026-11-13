import { describe, expect, it } from "vitest";
import { listLink, type ListPorts } from "@/imports/flow";
import { IMPORT_SOURCES } from "./importSources";

describe("import sources", () => {
  it("the first run offers no service whose playlist links the import refuses", async () => {
    const unused = () => Promise.reject(new Error("no request expected"));
    const ports = { fetch: unused, youtube: {}, daemon: {} } as unknown as ListPorts;
    const refused = await listLink("https://vk.com/music/playlist/-147845620_2", ports, new AbortController().signal).catch(
      (error: { code?: string }) => error.code,
    );
    expect(refused).toBe("login_required");
    expect(IMPORT_SOURCES).not.toContain("vk");
  });
});
