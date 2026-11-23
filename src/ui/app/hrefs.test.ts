import { describe, expect, it } from "vitest";
import { artistHref, artistsOf } from "./hrefs";

describe("artistHref", () => {
  it("carries the id and the name", () => {
    expect(artistHref({ id: "UCf_gP4AMRSgAfyzbkeS9k4g", name: "Travis Scott" })).toBe("/artist?id=UCf_gP4AMRSgAfyzbkeS9k4g&name=Travis+Scott");
  });

  it.each(["", "unknown", "sc_user_9", "local:1"])("goes by the name when %j is not a catalog id", (id) => {
    expect(artistHref({ id, name: "Кино" })).toBe(`/artist?${new URLSearchParams({ name: "Кино" })}`);
  });
});

describe("artistsOf", () => {
  it("keeps a credit list as it is, commas in a name included", () => {
    const artistList = [{ id: "UC1", name: "Tyler, The Creator" }, { name: "Frank Ocean" }];
    expect(artistsOf({ artists: "Tyler, The Creator, Frank Ocean", artistList })).toEqual(artistList);
  });

  it("splits a plain line and gives the first artist the known id", () => {
    expect(artistsOf({ artists: "A, B", artistId: "UC1" })).toEqual([{ id: "UC1", name: "A" }, { name: "B" }]);
    expect(artistsOf({ artists: "" })).toEqual([]);
  });
});
