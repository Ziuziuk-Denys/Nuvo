import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFeeds } from "./merge-update-feed.mjs";

const feed = (arch) =>
  `version: 1.2.0\nfiles:\n  - url: Nuvo-1.2.0-win-${arch}.exe\n    sha512: ${arch}sha\n    size: 10\npath: Nuvo-1.2.0-win-${arch}.exe\nsha512: ${arch}sha\nreleaseDate: '2026-11-08T00:00:00.000Z'\n`;

test("both installers in one feed, the first keeps the top-level path", () => {
  const merged = mergeFeeds([feed("x64"), feed("arm64")]);
  assert.equal(
    merged,
    "version: 1.2.0\nfiles:\n  - url: Nuvo-1.2.0-win-x64.exe\n    sha512: x64sha\n    size: 10\n  - url: Nuvo-1.2.0-win-arm64.exe\n    sha512: arm64sha\n    size: 10\npath: Nuvo-1.2.0-win-x64.exe\nsha512: x64sha\nreleaseDate: '2026-11-08T00:00:00.000Z'\n",
  );
  assert.equal(mergeFeeds([feed("x64")]), feed("x64"));
});

test("feeds of two versions are refused", () => {
  assert.throws(() => mergeFeeds([feed("x64"), feed("arm64").replace("1.2.0", "1.1.0")]), /disagree/);
  assert.throws(() => mergeFeeds(["version: 1.0.0\n"]), /files/);
});
