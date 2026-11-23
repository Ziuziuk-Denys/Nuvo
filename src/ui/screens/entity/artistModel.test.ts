import { describe, expect, it } from "vitest";
import type { ArtistAlbumViewModel } from "../../ports/catalog";
import { heardOf, latestRelease, monthAndYear, nameWidth } from "./artistModel";

const release = (id: string, kind: ArtistAlbumViewModel["kind"], releaseDate?: string): ArtistAlbumViewModel => ({
  id,
  kind,
  title: id,
  releaseDate,
  coverUrl: "",
});

describe("artistModel", () => {
  it("takes the newest release and lets an album win its year", () => {
    const albums = [release("a21", "album", "2021"), release("a16", "album", "2016")];
    expect(latestRelease(albums, [release("s21", "single", "2021")])?.id).toBe("a21");
    expect(latestRelease(albums, [release("s26", "single", "2026")])?.id).toBe("s26");
    expect(latestRelease([], [release("none", "ep")])?.id).toBe("none");
    expect(latestRelease([], [])).toBeUndefined();
  });

  it("writes the first month the way each language says since", () => {
    expect(monthAndYear("2025-10-08T01:49:18Z", "en")).toBe("October 2025");
    expect(monthAndYear("2025-10-08T01:49:18Z", "ru")).toBe("октября 2025");
  });

  it("counts the heard songs of a list", () => {
    expect(heardOf([{ id: "a" }, { id: "b" }], ["b", "z"])).toBe(1);
  });

  it("gives wide scripts more room than Latin", () => {
    expect(nameWidth("宇多田")).toBeGreaterThan(nameWidth("Kino"));
    expect(nameWidth("")).toBe(1);
  });
});
