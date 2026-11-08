import { describe, expect, it } from "vitest";
import { sizedCoverUrl } from "./coverUrl";

describe("sizedCoverUrl", () => {
  const base = "https://lh3.googleusercontent.com/abc_DEF-1";

  it("replaces an existing size suffix with the drawn size", () => {
    expect(sizedCoverUrl(`${base}=w544-h544-l90-rj`, 40)).toBe(`${base}=s80`);
    expect(sizedCoverUrl(`${base}=s0`, 200, 1.5)).toBe(`${base}=s300`);
  });

  it("adds a size when there is none", () => {
    expect(sizedCoverUrl(base, 56)).toBe(`${base}=s112`);
    expect(sizedCoverUrl("https://yt3.ggpht.com/xyz", 40, 1)).toBe("https://yt3.ggpht.com/xyz=s40");
  });

  it("leaves other URLs alone", () => {
    expect(sizedCoverUrl("https://i.ytimg.com/vi/id/hqdefault.jpg", 40)).toBe("https://i.ytimg.com/vi/id/hqdefault.jpg");
    expect(sizedCoverUrl("data:image/svg+xml,%3Csvg%3E", 40)).toBe("data:image/svg+xml,%3Csvg%3E");
    expect(sizedCoverUrl("", 40)).toBe("");
  });
});
