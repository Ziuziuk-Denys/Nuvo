// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationSheet } from "./TranslationSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tools = vi.hoisted(() => {
  class NoTranslatorError extends Error {}
  return { NoTranslatorError, translateTrack: vi.fn() };
});
vi.mock("../../ports/lyricsTools", () => tools);
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const TRACK = { id: "t", title: "Song", artists: "A", coverUrl: "", durationMs: 200_000 };
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("shows each line with its translation under it", async () => {
  tools.translateTrack.mockResolvedValueOnce({ original: ["Hello", "World"], translated: ["Привет", "Мир"] });
  await act(async () => root.render(<TranslationSheet open track={TRACK} onClose={() => undefined} />));
  const rows = [...document.body.querySelectorAll("li")].map((li) => li.textContent);
  expect(rows).toEqual(["HelloПривет", "WorldМир"]);
});

it("explains what to start when no local model answers", async () => {
  tools.translateTrack.mockRejectedValueOnce(new tools.NoTranslatorError("none"));
  await act(async () => root.render(<TranslationSheet open track={TRACK} onClose={() => undefined} />));
  expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("ui.lyrics.translate_no_model");
});
