import { describe, expect, it, vi } from "vitest";
import { probeStreamingHosts } from "./probe";

describe("probeStreamingHosts", () => {
  it("is reachable when any streaming host answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null));
    await expect(probeStreamingHosts(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ mode: "no-cors" });
  });

  it("probes only a URL that answers 2xx and is allowed by the page policy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null));
    await probeStreamingHosts(fetchImpl);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(["https://music.youtube.com/generate_204"]);
  });

  it("is unreachable when every host fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(probeStreamingHosts(fetchImpl)).resolves.toBe(false);
  });
});
